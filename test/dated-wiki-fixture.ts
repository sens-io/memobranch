import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LlmClient } from '../src/llm.js';
import type { Sensitivity } from '../src/types.js';
import { MemoryVault } from '../src/vault.js';
import { wikiPageId } from '../src/wiki-schema.js';
import type { WikiPageDraft } from '../src/wiki-types.js';

export const pageKey = 'entity:dated-wiki', before = '2026-01-10T00:00:00Z', after = '2026-01-20T00:00:00Z';
export const between = '2026-01-15T08:00:00+08:00', masterKey = '85'.repeat(32);

export async function atGitTime<T>(at: string, action: () => Promise<T>, author = at): Promise<T> {
  const saved = [process.env.GIT_COMMITTER_DATE, process.env.GIT_AUTHOR_DATE];
  process.env.GIT_COMMITTER_DATE = at; process.env.GIT_AUTHOR_DATE = author;
  try { return await action(); }
  finally {
    for (const [index, key] of ['GIT_COMMITTER_DATE', 'GIT_AUTHOR_DATE'].entries()) {
      if (saved[index] === undefined) delete process.env[key!]; else process.env[key!] = saved[index];
    }
  }
}

export async function fixture(t: TestContext, sensitivity: Sensitivity = 'internal') {
  await mkdir(join(process.cwd(), '.scratch'), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.scratch/dated-wiki-')), cleanup: Array<() => Promise<unknown>> = [];
  t.after(async () => { for (const stop of cleanup.reverse()) await stop(); await rm(root, { recursive: true, force: true }); });
  const llm = new LlmClient({ apiKey: '', embeddingModel: '' }); let calls = 0;
  llm.wiki = async <T>(operation: string, value: object) => {
    calls++; const data = value as { catalog: Array<{ key: string }>; sources: Array<{ id: string; body: string }> };
    if (operation === 'navigate') return { keys: data.catalog.map(page => page.key) } as T;
    const draft = (key: string, pageType: WikiPageDraft['pageType'], body: string, links: string[]): WikiPageDraft => ({ key, pageType,
      title: key, summary: 'Synthetic dated Wiki.', body, evidenceIds: data.sources.map(source => source.id), links,
      status: 'active', conditions: ['Synthetic dates, not verified facts.'], uncertainty: ['Not historical agent knowledge.'] });
    return { pages: [...data.sources.map(source => draft(`source:${source.id}`, 'source', source.body, [pageKey])),
      draft(pageKey, 'entity', data.sources.map(source => source.body).join('\n'), data.sources.map(source => `source:${source.id}`))] } as T;
  };
  const vault = new MemoryVault(root, { llm, masterKey });
  await atGitTime('2026-01-01T00:00:00Z', () => vault.initialize('Dated Wiki fixture'));
  const versions = [];
  for (const [at, content] of [[before, 'DATED_WIKI_OLD_CANARY 中文 🧠'], [after, 'DATED_WIKI_CURRENT_CANARY']] as const) {
    versions.push(await atGitTime(at, async () => {
      const source = await vault.capture({ content, scope: 'project', sensitivity, extract: false });
      await vault.wikiIngest({ evidenceIds: [source.evidenceId], apply: true });
      return { ...source, commit: await vault.git.run(['rev-parse', 'HEAD']), body: (await vault.get(wikiPageId(pageKey))).body };
    }));
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AMEM_') && key !== 'OPENAI_API_KEY')) as Record<string, string>;
  Object.assign(env, { AMEM_PERMISSIONS: 'read', AMEM_ALLOWED_SCOPES: 'user,project', AMEM_MAX_SENSITIVITY: 'secret',
    AMEM_TENANT_ID: (await vault.config()).tenantId, AMEM_MASTER_KEY: masterKey });
  return { root, vault, versions, llm, env, cleanup, calls: () => calls, input: { at: between, pageKeys: [pageKey] } };
}
