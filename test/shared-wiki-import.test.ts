import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { SharedWikiImporter } from '../src/shared-wiki-import.js';
import { parseMarkdown, serializeMarkdown } from '../src/markdown.js';
import { readWikiImportArtifact, wikiImportRestrictions } from '../src/wiki-import-artifact.js';
import { withFileLock } from '../src/utils.js';
import type { CandidateMeta, EvidenceMeta, MemoryMeta, MarkdownDocument } from '../src/types.js';
import { integrity, sharedFixture } from './shared-wiki-fixture.js';
import { MemoryVault } from '../src/vault.js';
import { LlmClient } from '../src/llm.js';
import { renderPublicWikiCatalog } from '../src/wiki.js';
import type { WikiPageDraft, WikiPageMeta } from '../src/wiki-types.js';
import { importedWikiCaution } from '../src/wiki-import-artifact.js';

async function fixture(t: TestContext) {
  const data = await sharedFixture(t); data.principal.permissions = ['read','write','review'];
  const importer = new SharedWikiImporter(data.caller, { configPath: data.configPath, env: data.env });
  return { ...data, importer, selection: { ...data.input, expectedCommit: data.binding.commit } };
}

test('shared Wiki import: prepare has no canonical writes; confirmation copies one exact derived artifact and separate Wiki knowledge stays empty', async t => {
  const { source, caller, callerAdmin, importer, selection, calls } = await fixture(t), beforeSource = await integrity(source), beforeCaller = await integrity(caller), count = calls();
  const { plan } = await importer.prepare(selection);
  assert.deepEqual(await integrity(caller), beforeCaller); assert.deepEqual(await integrity(source), beforeSource); assert.equal(calls(), count);
  assert.match(JSON.stringify(plan), /DATED_WIKI_OLD_CANARY/); assert.doesNotMatch(JSON.stringify(plan), /DATED_WIKI_CURRENT_CANARY|SHARED_TEST_MASTER_KEY|\.scratch|attestationContext/);
  await assert.rejects(importer.apply(plan, { confirm: false } as unknown as { confirm: true }), { code: 'VALIDATION_FAILED' });
  assert.deepEqual(await integrity(caller), beforeCaller);
  const result = await importer.apply(plan, { confirm: true, signal: new AbortController().signal }); assert.ok(result.commit); assert.equal(result.duplicate, false);
  const record = await callerAdmin.get(result.evidenceId), artifact = readWikiImportArtifact(record as unknown as { path:string; meta:EvidenceMeta; body:string });
  assert.ok(artifact); assert.equal(artifact.source.commit, selection.expectedCommit); assert.equal(artifact.source.vaultId, plan.artifact.source.vaultId);
  assert.deepEqual(await callerAdmin.wikiCatalog(), []); assert.equal(calls(), count); assert.deepEqual(await integrity(source), beforeSource);
  const head = await caller.git.run(['rev-parse','HEAD']), raw = await readFile(join(caller.root, result.evidencePath));
  const duplicate = await importer.apply(plan, { confirm: true }); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.commit, null);
  assert.equal(await caller.git.run(['rev-parse','HEAD']), head); assert.deepEqual(await readFile(join(caller.root,result.evidencePath)), raw);
});

test('shared Wiki import: independent read/write/review, strict confirmation, proof and current host configuration are required', async t => {
  const { importer, selection, principal, binding, saveBindings, env, caller } = await fixture(t), { plan } = await importer.prepare(selection), before = await integrity(caller);
  for (const permissions of [['read'], ['write'], ['review'], ['read','write']] as Array<typeof principal.permissions>) {
    principal.permissions = permissions; await assert.rejects(importer.apply(plan,{confirm:true}), { code:'AUTHORIZATION_DENIED' });
  }
  principal.permissions = ['read','write','review'];
  principal.scopes.push('public'); // Exercise the source classification floor, separately from caller scope denial.
  for (const changed of [{ ...plan, proof:'0'.repeat(64) }, { ...plan, vaultId:'foreign' }, { ...plan, scope:'public' },
    { ...plan, artifact:{ ...plan.artifact, pages:plan.artifact.pages.map(page=>({...page,body:'forged'})) } }, { ...plan, root:caller.root }]) {
    await assert.rejects(importer.apply(changed,{confirm:true}), { code:'VALIDATION_FAILED' });
  }
  binding.readers.push({id:'another-granted-reader',tenantId:binding.readers[0]!.tenantId});await saveBindings();
  await assert.rejects(importer.apply(plan,{confirm:true}),{code:'VALIDATION_FAILED'});binding.readers.pop();await saveBindings();
  env.SHARED_TEST_MASTER_KEY = '99'.repeat(32);await assert.rejects(importer.apply(plan,{confirm:true}),{code:'VALIDATION_FAILED'});
  assert.deepEqual(await integrity(caller),before);
});

test('shared Wiki import: source pin changes and current withdrawal refuse the copied preview without fallback', async t => {
  const { source, caller, importer, selection, binding, saveBindings } = await fixture(t), { plan } = await importer.prepare(selection), before = await integrity(caller);
  binding.commit = await source.git.run(['rev-parse','HEAD']);await saveBindings();
  await assert.rejects(importer.apply(plan,{confirm:true}),{code:'VALIDATION_FAILED'});
  binding.commit = selection.expectedCommit;await saveBindings(); await source.wikiRevoke(selection.pageKeys[0]!, 'Withdraw copied preview fixture');
  await assert.rejects(importer.apply(plan,{confirm:true}),{code:'NOT_FOUND'});assert.deepEqual(await integrity(caller),before);
});

test('shared Wiki import: current stricter conditions/conflict/expiry survive an old pin and cannot be downgraded', async t => {
  const { source, importer, selection, principal } = await fixture(t), directory = join(source.root,'wiki/pages');
  principal.scopes.push('public');
  for (const file of await readdir(directory)) {
    const path = join(directory,file), document = parseMarkdown<Record<string,unknown>>(await readFile(path,'utf8'));
    document.meta.conditions = [...document.meta.conditions as string[], 'CURRENT_IMPORT_CONDITION'];
    document.meta.uncertainty = [...document.meta.uncertainty as string[], 'CURRENT_IMPORT_UNCERTAINTY'];document.meta.status='conflicted';document.meta.expiresAt='2090-01-01T00:00:00Z';
    await writeFile(path,serializeMarkdown(document.meta,document.body));
  }
  await source.git.commit('Synthetic current import support restrictions',source.principal,['wiki']);
  const { plan } = await importer.prepare(selection), boundary=wikiImportRestrictions(plan.artifact);
  assert.ok(boundary.conditions.includes('CURRENT_IMPORT_CONDITION'));assert.ok(boundary.uncertainty.includes('CURRENT_IMPORT_UNCERTAINTY'));
  assert.equal(boundary.conflicted,true);assert.equal(boundary.expiresAt,'2090-01-01T00:00:00Z');
  assert.match(JSON.stringify(plan.artifact.pages),/DATED_WIKI_OLD_CANARY/);assert.doesNotMatch(JSON.stringify(plan.artifact.pages),/CURRENT_IMPORT_CONDITION/);
  await assert.rejects(importer.prepare({...selection,scope:'public'}),{code:'VALIDATION_FAILED'});
  const result=await importer.apply(plan,{confirm:true});assert.ok(result.commit);
});

test('shared Wiki import: concurrent identical confirmations retain one immutable artifact and one capture commit', async t => {
  const { importer, selection, caller } = await fixture(t), { plan } = await importer.prepare(selection);
  const results=await Promise.all([importer.apply(plan,{confirm:true}),importer.apply(plan,{confirm:true})]);
  assert.equal(results.filter(result=>result.commit).length,1);assert.equal(new Set(results.map(result=>result.evidenceId)).size,1);
  assert.equal((await caller.listRecords({collection:'evidence'})).total,1);
});

test('shared Wiki import: copying an old internal version retains its currently secret classification', async t => {
  const { source, callerAdmin, importer, selection }=await fixture(t);
  const secret=await source.capture({content:'CURRENT_SECRET_IMPORT_CANARY',scope:'project',sensitivity:'secret',extract:false});
  await source.wikiIngest({evidenceIds:[secret.evidenceId],apply:true});
  const chosen={...selection,includeSecret:true}, {plan}=await importer.prepare(chosen);
  assert.equal(plan.artifact.pages.every(page=>page.sensitivity==='internal'),true);assert.equal(plan.artifact.support.sensitivity,'secret');assert.equal(plan.sensitivity,'secret');
  assert.doesNotMatch(JSON.stringify(plan),/CURRENT_SECRET_IMPORT_CANARY/);
  await assert.rejects(importer.prepare({...chosen,sensitivity:'internal'}),{code:'VALIDATION_FAILED'});
  const captured=await importer.apply(plan,{confirm:true}), bytes=await readFile(join(callerAdmin.root,captured.evidencePath),'utf8');
  assert.doesNotMatch(bytes,/DATED_WIKI_OLD_CANARY|Compiled Wiki import artifact/);assert.equal((await callerAdmin.get(captured.evidenceId)).meta.sensitivity,'secret');
});

test('shared Wiki import: unrelated memory expiry on an exact retry cannot create a generated housekeeping commit', async t => {
  const { callerAdmin, caller, importer, selection }=await fixture(t), base=Date.now();let shifted=false;t.mock.method(Date,'now',()=>base+(shifted?1001:0));
  const raw=await callerAdmin.capture({content:'Unrelated expiring memory support',scope:'project',extract:false});
  const candidate=await callerAdmin.propose({kind:'fact',key:'retry-expiry',statement:'RETRY_EXPIRY_CANARY',scope:'project',sensitivity:'internal',confidence:1,explicit:true,
    conditions:[],tags:[],expiresAt:new Date(base+1000).toISOString()},[raw.evidencePath]);await callerAdmin.approve(candidate.id);
  const {plan}=await importer.prepare(selection);await importer.apply(plan,{confirm:true});
  const before=await integrity(caller), resident=await readFile(join(caller.root,'MEMORY.md'));
  assert.match(resident.toString(),/RETRY_EXPIRY_CANARY/);shifted=true;
  const duplicate=await importer.apply(plan,{confirm:true});assert.equal(duplicate.commit,null);assert.equal(duplicate.duplicate,true);
  assert.deepEqual(await integrity(caller),before);assert.deepEqual(await readFile(join(caller.root,'MEMORY.md')),resident);
});

test('shared Wiki import: actual destination wait crossing current source expiry rolls back the whole capture', async t => {
  const { source, caller, importer, selection } = await fixture(t), base=Date.now();let shifted=false;
  t.mock.method(Date,'now',()=>base+(shifted?1001:0));
  for (const file of await readdir(join(source.root,'wiki/pages'))) {
    const path=join(source.root,'wiki/pages',file), document=parseMarkdown<Record<string,unknown>>(await readFile(path,'utf8'));
    document.meta.expiresAt=new Date(base+1000).toISOString();await writeFile(path,serializeMarkdown(document.meta,document.body));
  }
  await source.git.commit('Synthetic short current support',source.principal,['wiki']);
  const {plan}=await importer.prepare(selection), before=await integrity(caller), original=caller.captureWikiImport.bind(caller), acquired=deferred(), release=deferred();let owner:Promise<void>|undefined;
  t.mock.method(caller,'captureWikiImport',async (...args:Parameters<typeof original>)=>{
    owner=withFileLock(join(caller.root,'.amem/write.lock'),async()=>{acquired.resolve();await release.promise;});await acquired.promise;return original(...args);
  });
  const pending=importer.apply(plan,{confirm:true}).then(()=>null,error=>error);
  try{await acquired.promise;await waitFor(async()=> (await readdir(join(caller.root,'.amem/write.lock.queue'))).length===2);shifted=true;release.resolve();
    const error=await pending;assert.equal(error?.code,'NOT_FOUND');
  }finally{release.resolve();await owner;}
  assert.deepEqual(await integrity(caller),before);assert.equal((await caller.listRecords({collection:'evidence'})).total,0);
});

test('shared Wiki import: raw inspection works while ordinary-memory proposal/extraction and forged old records refuse artifact support', async t => {
  const { importer, selection, callerAdmin }=await fixture(t), {plan}=await importer.prepare(selection), captured=await importer.apply(plan,{confirm:true});
  let modelCalls=0;t.mock.method(callerAdmin.llm,'extractMemories',async()=>{modelCalls++;return [];});
  const proposal={kind:'fact' as const,key:'import-bypass',statement:'IMPORT_ORDINARY_BYPASS',scope:'project' as const,sensitivity:'internal' as const,confidence:1,explicit:true,conditions:[],tags:[]};
  const before=await integrity(callerAdmin);await assert.rejects(callerAdmin.extract(captured.evidenceId),{code:'VALIDATION_FAILED'});
  await assert.rejects(callerAdmin.propose(proposal,[captured.evidencePath]),{code:'VALIDATION_FAILED'});assert.equal(modelCalls,0);assert.deepEqual(await integrity(callerAdmin),before);
  const raw=await callerAdmin.capture({content:'Independent ordinary fixture',scope:'project',extract:false});
  const candidate=await callerAdmin.propose(proposal,[raw.evidencePath]), approved=await callerAdmin.approve(candidate.id);
  const memory=await callerAdmin.get(approved.memoryId), oldCandidate=await callerAdmin.get(candidate.id);
  for(const record of [memory,oldCandidate]){const meta=record.meta as unknown as MemoryMeta|CandidateMeta;meta.evidence=[captured.evidencePath];await writeFile(join(callerAdmin.root,record.path),serializeMarkdown(meta,record.body));}
  await callerAdmin.git.commit('Synthetic older invalid ordinary import support',callerAdmin.principal,['wiki','candidates']);const forged=await integrity(callerAdmin);
  for(const action of [()=>callerAdmin.get(approved.memoryId),()=>callerAdmin.get(candidate.id),()=>callerAdmin.approve(candidate.id),()=>callerAdmin.consolidate()])await assert.rejects(action(),{code:'VALIDATION_FAILED'});
  assert.ok(await callerAdmin.get(captured.evidenceId));assert.deepEqual(await integrity(callerAdmin),forged);
});

test('shared Wiki import: a compiler omitting all restrictions cannot make copied conflicted/time-limited knowledge unrestricted', async t => {
  const { source, callerAdmin, importer, selection }=await fixture(t);
  for(const file of await readdir(join(source.root,'wiki/pages'))){const path=join(source.root,'wiki/pages',file),doc=parseMarkdown<Record<string,unknown>>(await readFile(path,'utf8'));
    doc.meta.status='conflicted';doc.meta.expiresAt='2090-01-01T00:00:00Z';await writeFile(path,serializeMarkdown(doc.meta,doc.body));}
  await source.git.commit('Synthetic copied support conflict and expiry',source.principal,['wiki']);
  const {plan}=await importer.prepare(selection), captured=await importer.apply(plan,{confirm:true});
  installCompiler(callerAdmin.llm,'concept:integrated-copy',[],[]);
  const prepared=await callerAdmin.wikiIngest({evidenceIds:[captured.evidenceId]}), preview=await callerAdmin.wikiPreview(prepared.plan);
  for(const page of preview.pages){assert.equal(page.after.status,'conflicted');assert.ok(page.after.conditions.includes('Synthetic dates, not verified facts.'));assert.ok(page.after.uncertainty.includes(importedWikiCaution));}
  await callerAdmin.wikiApply(prepared.plan);const catalog=await callerAdmin.wikiCatalog();assert.equal(catalog.length,2);
  for(const page of catalog){const document=await callerAdmin.get(page.id);assert.equal(document.meta.expiresAt,'2090-01-01T00:00:00Z');assert.equal(document.meta.status,'conflicted');}
  t.mock.method(Date,'now',()=>Date.parse('2091-01-01T00:00:00Z'));
  assert.deepEqual(await callerAdmin.wikiCatalog(),[]);await assert.rejects(callerAdmin.wikiPreview(prepared.plan));assert.ok(await callerAdmin.get(captured.evidenceId));
});

test('shared Wiki import: real public import retains mandatory uncertainty and public rendering refuses a weakened derived page',async t=>{
  const root=await mkdtemp(join(process.cwd(),'.scratch/wiki-import-public-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=new MemoryVault(join(root,'source')),caller=new MemoryVault(join(root,'caller'));await source.initialize('Synthetic public source');await caller.initialize('Synthetic public caller');
  installCompiler(source.llm,'concept:public-origin',['PUBLIC_ORIGIN_CONDITION'],['PUBLIC_ORIGIN_UNCERTAINTY']);
  const raw=await source.capture({content:'Public synthetic evidence',scope:'public',sensitivity:'public',extract:false});await source.wikiIngest({evidenceIds:[raw.evidenceId],apply:true});
  const sc=await source.config(),cc=await caller.config(),pin=await source.git.run(['rev-parse','HEAD']),configPath=join(caller.root,'.amem/shared-wiki.json');
  await writeFile(configPath,JSON.stringify({version:1,sources:[{id:'public-source',title:'Public source',root:source.root,commit:pin,vaultId:sc.vaultId,tenantId:sc.tenantId,
    readers:[{id:caller.principal.id,tenantId:cc.tenantId}],scopes:['public'],maxSensitivity:'public'}]}));
  const importer=new SharedWikiImporter(caller,{configPath}), {plan}=await importer.prepare({sourceId:'public-source',pageKeys:['concept:public-origin'],expectedCommit:pin});
  const captured=await importer.apply(plan,{confirm:true});installCompiler(caller.llm,'concept:public-import-target',[],[]);
  const prepared=await caller.wikiIngest({evidenceIds:[captured.evidenceId]});await caller.wikiApply(prepared.plan);
  const documents:MarkdownDocument<Record<string,unknown>>[]=[await caller.get(captured.evidenceId),...await Promise.all((await caller.wikiCatalog()).map(page=>caller.get(page.id)))];
  const index=await readFile(join(caller.root,'WIKI.md'),'utf8');assert.match(index,/PUBLIC_ORIGIN_CONDITION/);assert.match(index,/original raw sources were not copied/);
  const weakened=structuredClone(documents),target=weakened.find(doc=>doc.meta.key==='concept:public-import-target')!;
  (target.meta as unknown as WikiPageMeta).uncertainty=[];(target.meta as unknown as WikiPageMeta).conditions=[];
  assert.doesNotMatch(renderPublicWikiCatalog(weakened),/concept:public-import-target|Imported target/);
  assert.match(renderPublicWikiCatalog(documents),/Imported target/);
});

function installCompiler(llm:LlmClient,key:string,conditions:string[],uncertainty:string[]){
  llm.wiki=async<T>(operation:Parameters<LlmClient['wiki']>[0],value:object)=>{
    const input=value as {catalog:Array<{key:string}>;sources:Array<{id:string}>};if(operation==='navigate')return {keys:input.catalog.map(page=>page.key)} as T;
    const draft=(key:string,pageType:WikiPageDraft['pageType'],title:string,links:string[]):WikiPageDraft=>({key,pageType,title,summary:'Synthetic compilation',body:'Synthetic compiled content',
      evidenceIds:input.sources.map(source=>source.id),links,status:'active',conditions,uncertainty});
    return {pages:[...input.sources.map(source=>draft('source:'+source.id,'source','Imported source',[])),draft(key,'concept','Imported target',input.sources.map(source=>'source:'+source.id))]} as T;
  };
}

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
async function waitFor(predicate:()=>Promise<boolean>){const end=performance.now()+4000;while(!await predicate()){assert.ok(performance.now()<end,'Expected real destination lock wait');await delay(10);}}
