/** Separate evidence copy and human-authored Wiki approval; no source/grant editor. */
export const wikiImportWebScript = String.raw`
async function wikiImports(){
 const epoch=session,current=generation,out=el('div','wiki-import-workbench');
 let closed=false,seq=0,active=null,phase='idle',sources=[],copyPlan=null,integrationPlan=null,copyUncertain=false,integrationUncertain=false;
 const live=()=>!closed&&epoch===session&&current===generation;
 const steps=el('div','merge-steps');['01 / 检查来源与复制','02 / 人工整合','03 / 单独批准知识'].forEach(text=>steps.append(el('span','',text)));out.append(steps);
 out.append(card('把资料带回来，由你决定如何使用','复制只保留已编译证据，不代表核实原始资料，也不批准正式知识。人工整合会保留本机来源与两侧限制；离线明文无法追回。来源、身份和共享授权仍由启动者配置。'));
 const feedback=el('div','merge-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
 const stop=button('停止当前操作',()=>{if(!live()||phase==='idle')return;seq++;active?.abort();active=null;phase='idle';clearCopy();clearIntegration();message('操作已停止，旧方案已清除。若刚才已请求保存，请先查看记忆库或运维记录；安全完成的提交不会被撤回，不会自动重试。');sync();},'danger');
 const status=el('div','actions');status.append(stop);out.append(feedback,status);
 const sourceCard=card('01 / 从已授权来源复制','先核对固定提交和完整材料，再明确确认复制。也可跳到下方，填写此前已经保留的导入证据 ID。');
 const source=field('importSource','共享资料库','text','',[]),sourceDetails=el('div','shared-source-details'),refresh=button('重新读取导入来源',loadSources);
 const keys=field('importKeys','来源页面名称（每行一项）','textarea'),copyScope=field('copyScope','复制作用域','text','',[['','继承更严格的来源范围'],...principal.scopes]),copyLevel=field('copySensitivity','复制敏感级别','text','',[['','继承更严格的来源分类'],...levels()]);
 const copySensitive=field('copySensitive','明确复制敏感资料','checkbox',false),copySecret=field('copySecret','明确复制机密资料','checkbox',false);
 keys.input.placeholder='concept:deployment';keys.label.classList.add('wide');keys.input.maxLength=5024;
 for(const field of [source,copyScope,copyLevel])field.input.required=false;
 const copyForm=el('form','forms'),prepareCopy=el('button','primary','预览复制方案');prepareCopy.type='submit';
 copyForm.append(source.label,keys.label,copyScope.label,copyLevel.label,copySensitive.label,copySecret.label,prepareCopy);
 const copyReview=el('div'),copyChecked=field('copyChecked','我已检查完整复制材料、固定提交和目标分类','checkbox',false),confirmCopy=button('确认复制为证据',applyCopy,'primary');
 sourceCard.append(refresh,sourceDetails,copyForm,copyReview,copyChecked.label,confirmCopy);out.append(sourceCard);
 const editor=card('02 / 编写要保留的知识','这里不会调用模型。先填写保留的证据 ID；创建使用修订 0，更新填写在 Wiki 中实际读取的修订。生成后仍需逐页审核，不会自动保存。');editor.classList.add('merge-editor');
 const draft=el('form','forms'),evidence=field('importEvidenceId','已保留的导入证据 ID'),target=field('integrationKey','目标 Wiki 页面名称'),revision=field('integrationRevision','目标当前修订（新建为 0）','number',0);
 evidence.input.placeholder='ev-…';revision.input.min=0;revision.input.max=Number.MAX_SAFE_INTEGER;revision.input.step=1;
 const title=field('integrationTitle','页面标题'),summary=field('integrationSummary','整合摘要'),body=field('integrationBody','人工编写的正文（Markdown）','textarea');
 evidence.input.maxLength=67;target.input.maxLength=200;title.input.maxLength=300;summary.input.maxLength=2000;body.input.maxLength=100000;body.label.classList.add('wide');
 const purpose=field('integrationPageType','页面用途','text','',[['','保留已有用途／新建综合页'],['concept','概念'],['entity','实体'],['synthesis','综合'],['comparison','比较'],['query','查询成果']]);
 const scope=field('integrationScope','整合作用域','text','',[['','继承更严格的范围'],...principal.scopes]),level=field('integrationSensitivity','整合敏感级别','text','',[['','继承更严格的分类'],...levels()]);
 const conflict=field('integrationStatus','未解决的差异','text','active',[['active','保留已有冲突状态'],['conflicted','另外标记为有冲突']]);
 const conditions=field('integrationConditions','新增适用条件（每行一项）','textarea'),uncertainty=field('integrationUncertainty','新增不确定性（每行一项）','textarea');
 const sensitive=field('integrationSensitive','明确读取及生成敏感内容','checkbox',false),secret=field('integrationSecret','明确读取及生成机密内容','checkbox',false);
 for(const item of [purpose,scope,level,conditions,uncertainty])item.input.required=false;
 conditions.input.maxLength=400100;uncertainty.input.maxLength=400100;
 const prepare=el('button','primary','生成整合审核方案');prepare.type='submit';
 draft.append(evidence.label,target.label,revision.label,title.label,summary.label,body.label,purpose.label,scope.label,level.label,conflict.label,conditions.label,uncertainty.label,sensitive.label,secret.label,prepare);editor.append(draft);out.append(editor);
 const comparison=el('div'),review=el('div'),integrationChecked=field('integrationChecked','我已逐页核对来源、条件、当前内容和全部修改','checkbox',false),approve=button('批准并保存整合知识',applyIntegration,'primary'),outcome=el('div');out.append(comparison,review,integrationChecked.label,approve,outcome);
 function levels(){return ['public','internal','sensitive','secret'].slice(0,['public','internal','sensitive','secret'].indexOf(principal.maxSensitivity)+1);}
 function message(text){feedback.textContent=text;}
 function chosen(){return sources.find(item=>item.id===source.input.value);}
 function clearCopy(){copyPlan=null;copyUncertain=false;copyChecked.input.checked=false;copyReview.replaceChildren();}
 function clearIntegration(){integrationPlan=null;integrationUncertain=false;integrationChecked.input.checked=false;comparison.replaceChildren();review.replaceChildren();outcome.replaceChildren();}
 function sync(){
  const saving=phase==='copying'||phase==='applying';for(const input of out.querySelectorAll('input,textarea,select'))input.disabled=saving;
  source.input.disabled=saving||!sources.length;refresh.disabled=phase!=='idle'||!can('read');
  prepareCopy.disabled=phase!=='idle'||!chosen()||!can('read')||!can('write');prepare.disabled=phase!=='idle'||!can('read')||!can('write');
  copySensitive.input.disabled=saving||!['sensitive','secret'].includes(chosen()?.maxSensitivity);copySecret.input.disabled=saving||chosen()?.maxSensitivity!=='secret';
  sensitive.input.disabled=saving||!['sensitive','secret'].includes(principal.maxSensitivity);secret.input.disabled=saving||principal.maxSensitivity!=='secret';
  copyChecked.label.hidden=!copyPlan;confirmCopy.hidden=!copyPlan;confirmCopy.disabled=phase!=='idle'||!copyPlan||!copyChecked.input.checked||!can('review');
  integrationChecked.label.hidden=!integrationPlan;approve.hidden=!integrationPlan;approve.disabled=phase!=='idle'||!integrationPlan||!integrationChecked.input.checked||!can('review');
  confirmCopy.textContent=copyUncertain?'重试原复制方案':'确认复制为证据';approve.textContent=integrationUncertain?'重试原整合方案':'批准并保存整合知识';stop.hidden=phase==='idle';
 }
 function invalidate(copy){if(!live())return;seq++;active?.abort();active=null;phase='idle';if(copy)clearCopy();clearIntegration();message('输入或来源已变化，旧整合方案已清除；请重新生成并审核。');sync();}
 function begin(next){if(!live()||phase!=='idle')return null;const turn=++seq;phase=next;active=new AbortController();sync();return {signal:active.signal,live:()=>live()&&turn===seq};}
 function finish(attempt){if(attempt.live()){phase='idle';active=null;sync();}}
 function showSource(){sourceDetails.replaceChildren();const item=chosen();if(item)sourceDetails.append(el('h3','',item.title),el('code','commit-reference','固定提交：'+item.commit),el('p','muted','范围：'+item.scopes.join(' / ')+' · 最高敏感级别：'+item.maxSensitivity));}
 function showArtifact(container,artifact){
  container.append(el('h3','','已编译来源：'+artifact.source.title),el('code','commit-reference',artifact.source.commit));
  for(const page of artifact.pages){const box=card(page.title,'固定修订 '+page.revision+' · '+page.key);box.append(tag(page.scope),tag(page.sensitivity),el('pre','',page.body));container.append(box);}
  const full=el('details');full.open=true;full.append(el('summary','','完整材料与原始来源引用、规则和继承限制'),pretty(artifact));container.append(full);
 }
 async function loadSources(){
  if(!live()||phase!=='idle')return;clearCopy();clearIntegration();const previous=source.input.value;sources=[];source.input.replaceChildren();sourceDetails.replaceChildren();copySensitive.input.checked=false;copySecret.input.checked=false;
  const attempt=begin('loading');if(!attempt)return;message('正在读取当前身份可用的导入来源…');
  try{const result=await api('shared-catalog',{},attempt.signal);if(!attempt.live())return;sources=result.sources;
   for(const item of sources){const option=el('option','',item.title+' · '+item.id);option.value=item.id;source.input.append(option);}source.input.value=sources.some(item=>item.id===previous)?previous:sources[0]?.id||'';showSource();
   message(!result.configured?'宿主尚未配置共享来源。已有的本机导入证据仍可在下方整合。':sources.length?'来源列表已读取。先检查固定提交，再预览复制内容。':'当前身份没有可用共享来源。已有保留证据仍需当前本机权限才能整合。');
  }catch(error){if(attempt.live())message(error.message+'；可由启动者核查共享配置，未使用其他来源。');}finally{finish(attempt);}
 }
 source.input.addEventListener('change',()=>{invalidate(true);copySensitive.input.checked=false;copySecret.input.checked=false;showSource();sync();});
 for(const item of [keys,copyScope,copyLevel,copySensitive,copySecret])item.input.addEventListener(item.input.type==='checkbox'||item.input.tagName.toLowerCase()==='select'?'change':'input',()=>invalidate(true));
 for(const input of draft.querySelectorAll('input,textarea,select'))input.addEventListener(input.type==='checkbox'||input.tagName.toLowerCase()==='select'?'change':'input',()=>invalidate(false));
 copyChecked.input.addEventListener('change',sync);integrationChecked.input.addEventListener('change',sync);
 copyForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!live()||phase!=='idle'||!can('read')||!can('write'))return;const item=chosen(),pageKeys=keys.input.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  if(!item||!pageKeys.length||pageKeys.length>25||new Set(pageKeys).size!==pageKeys.length||pageKeys.some(key=>key.length>200)){message('请先选择来源，填写 1–25 个不同页面名称，每项最多 200 字符。');return;}
  clearCopy();clearIntegration();const attempt=begin('preparing-copy');if(!attempt)return;message('正在核对固定来源并生成完整复制方案，不写知识…');
  try{const result=await api('shared-import-prepare',{sourceId:item.id,expectedCommit:item.commit,pageKeys,includeSensitive:copySensitive.input.checked,includeSecret:copySecret.input.checked,...(copyScope.input.value?{scope:copyScope.input.value}:{}),...(copyLevel.input.value?{sensitivity:copyLevel.input.value}:{})},attempt.signal);if(!attempt.live())return;
   if(result.plan.selection.sourceId!==item.id||result.plan.selection.expectedCommit!==item.commit)throw Error('来源或固定提交已变化，请重新读取列表。');
   const box=card('完整复制方案 · 尚未保存','复制后成为不可变证据，不会自动进入正式 Wiki。目标分类：'+result.plan.scope+' / '+result.plan.sensitivity);showArtifact(box,result.plan.artifact);
   const signed=el('details');signed.append(el('summary','','完整签名方案（含明文）'),pretty(result.plan));box.append(signed);copyReview.append(box);copyPlan=result.plan;message('请完整核对复制材料与分类，勾选后单独确认。');
  }catch(error){if(attempt.live()){clearCopy();message(error.message+'；未保存证据，不能批准旧方案。');}}finally{finish(attempt);}
 });
 async function applyCopy(){
  if(!live()||phase!=='idle'||!copyPlan||!copyChecked.input.checked||!can('review'))return;const plan=copyPlan;
  if(!confirm('确认复制这个固定版本为本机证据？来源 '+plan.artifact.source.id+'，提交 '+plan.artifact.source.commit+'。不会批准 Wiki；离线明文无法追回。'))return;
  const attempt=begin('copying');if(!attempt)return;message('正在重新检查来源、授权和密钥，再保存证据…');
  try{const result=await api('shared-import-apply',{plan,confirm:true},attempt.signal);if(!attempt.live())return;clearCopy();clearIntegration();evidence.input.value=result.evidenceId;
   outcome.append(card(result.duplicate?'这份证据已保留，本次没有新增提交':'证据已保留，尚未批准 Wiki',result.evidenceId+' · '+(result.commit||'没有新增 Git 提交')));message('可以在第二步人工编写整合内容，再生成独立审核方案。');
  }catch(error){if(attempt.live()){copyUncertain=true;message(error.message+'；保存结果未确认，请先检查记忆库或运维记录。仅在明确决定后重试原方案，不会自动重试。');}}finally{finish(attempt);}
 }
 draft.addEventListener('submit',async event=>{
  event.preventDefault();if(!live()||phase!=='idle'||!can('read')||!can('write'))return;
  const expectedRevision=Number(revision.input.value);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0){message('目标修订必须是非负整数，创建为 0。');return;}
  clearIntegration();const attempt=begin('preparing-integration');if(!attempt)return;message('正在读取本机保留证据并检查人工整合，不调用模型…');
  const lines=input=>input.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  const values={evidenceId:evidence.input.value.trim(),pageKey:target.input.value.trim(),expectedRevision,title:title.input.value,summary:summary.input.value,body:body.input.value,status:conflict.input.value,
   includeSensitive:sensitive.input.checked,includeSecret:secret.input.checked,conditions:lines(conditions.input),uncertainty:lines(uncertainty.input),
   ...(purpose.input.value?{pageType:purpose.input.value}:{}),...(scope.input.value?{scope:scope.input.value}:{}),...(level.input.value?{sensitivity:level.input.value}:{})};
  try{const result=await api('integration-prepare',values,attempt.signal);if(!attempt.live())return;const preview=await api('preview',{plan:result.plan},attempt.signal);if(!attempt.live())return;
   const before=card('本次使用的完整保留证据','这是已编译材料，不是独立核实的原始资料。');showArtifact(before,result.comparison.artifact);comparison.append(before);
   const local=card('当前本机目标',result.comparison.current?'现有页面及本机来源不会被静默覆盖。':'新建页面，当前没有同名目标。');if(result.comparison.current)local.append(pretty(result.comparison.current));comparison.append(local);
   const changes=card('03 / 逐页检查整合修改','旧条件、冲突、更早期限和分类限制仍然保留。批准是另一项操作。');renderPlanPreview(changes,preview);const full=el('details');full.append(el('summary','','完整签名整合方案（含明文）'),pretty(result.plan));changes.append(full);review.append(changes);integrationPlan=result.plan;
   message(can('review')?'请逐页检查完整修改，勾选后再单独批准。':'方案已准备，当前身份没有审核权限，不能批准。');
  }catch(error){if(attempt.live()){clearIntegration();message(error.message+'；不能批准旧方案，请核对证据及实际目标修订。');}}finally{finish(attempt);}
 });
 async function applyIntegration(){
  if(!live()||phase!=='idle'||!integrationPlan||!integrationChecked.input.checked||!can('review'))return;const plan=integrationPlan;
  if(!confirm('确认批准逐页检查过的整合知识？这会写入 Git，关闭页面不能撤回已完成提交。原始证据保持不变。'))return;
  const attempt=begin('applying');if(!attempt)return;let requested=false;message('正在校验原签名方案并保存整合知识…');
  try{if(!integrationUncertain)await api('preview',{plan},attempt.signal);if(!attempt.live())return;requested=true;
   const result=await api('apply',{plan,confirm:true},attempt.signal);if(!attempt.live())return;clearIntegration();outcome.append(card('整合审核已完成',result.commit?'Git 提交：'+result.commit:'此方案已完成，本次没有新增提交。'));message('知识已保存。继续修改时先在 Wiki 查看当前修订，再生成新方案。');
  }catch(error){if(attempt.live()){if(requested)integrationUncertain=true;else clearIntegration();message(error.message+(requested?'；保存结果未确认，先检查运维记录。可明确重试原签名方案，不要盲目生成新方案。':'；尚未批准，请重新检查并生成方案。'));}}finally{finish(attempt);}
 }
 pageCleanup=()=>{closed=true;seq++;active?.abort();active=null;copyPlan=null;integrationPlan=null;sources=[];for(const input of out.querySelectorAll('input,textarea,select')){input.value='';input.checked=false;}out.replaceChildren();};
 message('草稿与方案仅保存在当前页面内存，离开页面或断开连接会清除。');sync();void loadSources();return out;
}
`;
