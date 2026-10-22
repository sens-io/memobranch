/** Shares the workbench's DOM helpers; no HTML injection or persistent browser storage. */
export const experienceWebScript = String.raw`
async function experiences(){
 const epoch=session,current=generation,out=el('div','experience-workbench');
 let closed=false,turn=0,active=null,busy=false,plan=null,exported=null,confirmCleanup=()=>{},confirming=false;
 const live=()=>!closed&&epoch===session&&current===generation;
 pageCleanup=()=>{closed=true;turn++;active?.abort();confirmCleanup();plan=null;exported=null;};
 async function ask(title,description){
  if(!live()||busy||confirming)return false;confirming=true;const revision=turn;
  return new Promise(resolve=>{const dialog=el('dialog'),heading=el('h2','',title),actions=el('div','actions');let done=false;
   heading.id='experience-confirm-title';dialog.setAttribute('aria-labelledby',heading.id);
   const finish=accepted=>{if(done)return;done=true;confirming=false;confirmCleanup=()=>{};dialog.close();dialog.remove();resolve(accepted&&live()&&revision===turn);};confirmCleanup=()=>finish(false);
   const cancel=button('取消',()=>finish(false)),accept=button('确认继续',()=>finish(true),'primary');actions.append(cancel,accept);dialog.append(heading,el('p','',description),actions);document.body.append(dialog);
   dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});dialog.addEventListener('close',()=>finish(false));dialog.showModal();cancel.focus();
  });
 }
 const steps=el('div','merge-steps');['01 / 记录经历','02 / 整理步骤','03 / 验证','04 / 单独导出'].forEach(text=>steps.append(el('span','',text)));out.append(steps);
 const warning=card('成功一次，不等于值得复用','经历只是调用者的观察。至少需要两个不同成功任务和独立的迁移、保留行为及安全检查；判断是否正确由可信宿主程序负责。这里不会自动批准记忆、安装技能或执行上传脚本。草稿只保存在当前页面内存，离开页面或断开后清除。');warning.classList.add('experience-intro');out.append(warning);
 const selection=card('查看经历与验证原始记录','列表按标记检索，不证明记录真实或验证通过；整理与导出时会校验签名和当前来源。未选择的敏感、机密正文不会解密。');
 const controls=el('div','actions'),kind=field('experienceKind','记录类型','text','trace',[['trace','经历记录'],['validation','验证原始记录']]),sensitive=field('includeSensitive','明确读取敏感资料','checkbox',false),secret=field('includeSecret','明确读取机密资料','checkbox',false);
 sensitive.input.disabled=!['sensitive','secret'].includes(principal.maxSensitivity);secret.input.disabled=principal.maxSensitivity!=='secret';
 const refresh=button('读取记录',()=>load(0)),rows=el('div','experience-records'),pager=el('div','pager');controls.append(kind.label,sensitive.label,secret.label,refresh);selection.append(controls,rows,pager);out.append(selection);
 const feedback=el('div','experience-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');out.append(feedback);
 const capture=card('01 / 记录一次真实经历','保存不可变的原始证据，不会生成正式知识。步骤和限制每行一项。');
 const captureForm=el('form','forms'),traceFields={};
 for(const [name,title,type,value,options] of [
  ['family','任务类别'],['taskId','任务编号'],['runId','本次执行编号'],['context','任务背景','textarea'],['actions','实际采取的步骤（每行一项）','textarea'],
  ['observedResult','实际观察到的结果','textarea'],['outcome','结果','text','success',[['success','成功'],['partial','部分完成'],['failure','失败']]],['limitations','限制与尚未验证的部分（每行一项）','textarea'],...classifications()
 ]){const item=field(name,title,type,value,options);traceFields[name]=item.input;if(type==='textarea')item.label.classList.add('wide');captureForm.append(item.label);}
 const save=el('button','primary','确认记录经历');save.type='submit';captureForm.append(save);capture.append(captureForm);if(can('write'))out.append(capture);
 const prepareCard=card('02 / 整理候选步骤','来源必须属于同一任务类别。生成的是有期限的签名候选，不是已验证技能。编辑后需要重新生成。');
 const prepareForm=el('form','forms'),proposalFields={};
 for(const [name,title,type] of [['traceIds','来源经历 ID（每行一项）','textarea'],['name','技能名称（小写英文与连字符）'],['description','适用描述'],['procedure','要验证的完整步骤（Markdown）','textarea'],['conditions','适用条件（每行一项）','textarea'],['limitations','限制（每行一项）','textarea']]){
  const item=field(name,title,type);proposalFields[name]=item.input;if(type==='textarea')item.label.classList.add('wide');prepareForm.append(item.label);
 }
 proposalFields.name.pattern='[a-z0-9]+(-[a-z0-9]+)*';proposalFields.name.maxLength=63;proposalFields.description.maxLength=1000;proposalFields.procedure.maxLength=100000;
 const prepare=el('button','primary','生成待验证候选');prepare.type='submit';prepareForm.append(prepare);const planView=el('div');prepareCard.append(prepareForm,planView);if(can('write'))out.append(prepareCard);
 const validationCard=card('03 / 用独立任务验证','检查输入与判定标准每次都由你核对。宿主程序接收候选步骤和每个任务，返回实际观察与逐项判断；页面不能上传执行程序，也不能提交预填的通过结果。');
 const capability=el('p','muted','正在检查宿主验证程序…'),validationForm=el('form','forms'),suiteName=field('suiteName','这组检查的名称'),caseList=el('div','wide'),cases=[];let nextCase=0;
 validationForm.append(suiteName.label,caseList);let evaluatorAvailable=false;
 function addCase(category='transfer'){
  const index=++nextCase,box=el('fieldset','experience-case'),legend=el('legend','','检查 '+index),fields={};box.append(legend);
  for(const [name,title,type,value,options] of [
   ['id','检查编号','text','case-'+index],['taskId','独立任务编号','text','held-out-'+index],['category','检查类型','text',category,[['transfer','迁移：未参与归纳的新任务'],['retention','保留行为：不破坏已有能力'],['safety','安全：不越权或产生危险行为']]],['input','检查输入（不要填通过结果）','textarea'],['criteria','判定标准（每行一项）','textarea']
  ]){const item=field(name,title,type,value,options);fields[name]=item.input;box.append(item.label);}
  const remove=button('移除此项',()=>{if(busy)return;cases.splice(cases.indexOf(entry),1);box.remove();invalidate(false);});box.append(remove);const entry={box,fields};cases.push(entry);caseList.append(box);sync();
 }
 const add=button('添加检查',()=>{if(!busy&&cases.length<32){addCase();invalidate(false);}}),validate=el('button','primary','确认运行宿主验证');validate.type='submit';validationForm.append(add,validate);
 const validationView=el('div');validationCard.append(capability,validationForm,validationView);out.append(validationCard);
 const exportCard=card('04 / 核对并单独导出','可选择本次或已有的验证记录。服务端会重新检查签名、所有检查结果、来源、当前权限及密钥。明文副本下载后无法撤回，不会自动安装。');
 const exportForm=el('form','forms'),validationId=field('validationId','验证证据 ID'),exportButton=el('button','primary','确认读取技能文件'),files=el('div');exportButton.type='submit';exportForm.append(validationId.label,exportButton);exportCard.append(exportForm,files);out.append(exportCard);
 const stop=button('停止当前操作',()=>{if(!busy)return;turn++;active?.abort();active=null;busy=false;exported=null;files.replaceChildren();feedback.textContent='已停止等待，未自动重试。保存可能已经完成；先重新读取记录及 Git 历史，再决定是否重试。';sync();},'danger');feedback.append(stop);
 function flags(){return {includeSensitive:sensitive.input.checked,includeSecret:secret.input.checked};}
 function lines(value){return value.split(/\r?\n/).map(item=>item.trim()).filter(Boolean);}
 function sync(){
  for(const input of out.querySelectorAll('input,textarea,select,button')){if(input===stop)continue;input.disabled=busy;}
  sensitive.input.disabled=busy||!['sensitive','secret'].includes(principal.maxSensitivity);secret.input.disabled=busy||principal.maxSensitivity!=='secret';
  prepare.disabled=busy||!can('write');save.disabled=busy||!can('write');validate.disabled=busy||!plan||!evaluatorAvailable||!can('write')||!can('review');exportButton.disabled=busy||!can('review')||!validationId.input.value.trim();add.disabled=busy||cases.length>=32;stop.hidden=!busy;
 }
 function message(text){feedback.replaceChildren(el('p','',text),stop);}
 function invalidate(proposalChanged=true){
  if(!live()||busy)return;turn++;active?.abort();active=null;exported=null;files.replaceChildren();validationView.replaceChildren();validationId.input.value='';
  if(proposalChanged){plan=null;planView.replaceChildren();}message(proposalChanged?'选择或步骤已变化；旧候选、验证与下载控件已清除。':'检查已变化，请重新验证；旧导出控件已清除。');sync();
 }
 function begin(text){if(!live()||busy)return null;const attempt=++turn;active=new AbortController();busy=true;message(text);sync();return {signal:active.signal,live:()=>live()&&attempt===turn};}
 function finish(attempt){if(attempt.live()){busy=false;active=null;sync();}}
 async function run(text,action){const attempt=begin(text);if(!attempt)return;try{await action(attempt);}catch(error){if(attempt.live())message(error.message+'。没有自动重试；若涉及保存，请先读取记录及 Git 历史。');}finally{finish(attempt);}}
 async function load(offset){await run('正在读取所选原始记录…',async attempt=>{
  const result=await api('experience-records',{kind:kind.input.value,offset,...flags()},attempt.signal);if(!attempt.live())return;rows.replaceChildren();pager.replaceChildren();
  if(!result.items.length)rows.append(empty('当前选择没有记录；敏感或机密资料需要单独勾选。'));
  for(const row of result.items){const item=el('article','experience-record');item.append(el('code','',row.id),tag(row.scope),tag(row.sensitivity),el('small','muted',stamp(row.createdAt)));const details=el('details');details.append(el('summary','','查看原始摘要（非验证结论）'),el('pre','',row.snippet));item.append(details);
   if(kind.input.value==='trace'&&can('write'))item.append(button('加入候选来源',()=>{if(busy)return;const ids=lines(proposalFields.traceIds.value);if(!ids.includes(row.id))ids.push(row.id);proposalFields.traceIds.value=ids.join('\n');invalidate();}));
   if(kind.input.value==='validation'&&can('review'))item.append(button('选择此验证记录',()=>{if(busy)return;exported=null;files.replaceChildren();validationId.input.value=row.id;sync();}));rows.append(item);
  }
  if(offset>0)pager.append(button('上一页',()=>load(Math.max(0,offset-result.limit))));pager.append(el('span','muted','共 '+result.total+' 条 · '+(offset+1)+' 起'));if(offset+result.limit<result.total)pager.append(button('下一页',()=>load(offset+result.limit)));message('原始记录已读取；列表标记不代表验证通过。');
 });}
 for(const input of [kind.input,sensitive.input,secret.input])input.addEventListener('change',()=>{invalidate();rows.replaceChildren(empty('选择已变化，请重新读取。'));pager.replaceChildren();});
 prepareForm.addEventListener('input',()=>invalidate());validationForm.addEventListener('input',()=>invalidate(false));
 validationId.input.addEventListener('input',()=>{if(busy)return;exported=null;files.replaceChildren();sync();});
 captureForm.addEventListener('submit',async event=>{event.preventDefault();if(busy||!live())return;if(!await ask('确认保存经历？','保存不可变的原始证据，不是正式知识；表单内容会保留。'))return;
  const values=Object.fromEntries(Object.entries(traceFields).map(([key,input])=>[key,input.value])),{scope,sensitivity,...trace}=values;trace.actions=lines(trace.actions);trace.limitations=lines(trace.limitations);
  void run('正在保存经历；不要重复提交…',async attempt=>{const result=await api('experience-capture',{trace,scope,sensitivity},attempt.signal);if(!attempt.live())return;message('已保存经历：'+result.evidenceId+'。可重新读取列表并加入候选来源；表单内容保留。');});
 });
 prepareForm.addEventListener('submit',event=>{event.preventDefault();if(busy||!live())return;invalidate();const proposal=Object.fromEntries(Object.entries(proposalFields).map(([key,input])=>[key,input.value]));for(const key of ['traceIds','conditions','limitations'])proposal[key]=lines(proposal[key]);
  void run('正在绑定来源和完整步骤…',async attempt=>{const result=await api('experience-prepare',{proposal:{...proposal,...flags()}},attempt.signal);if(!attempt.live())return;plan=result;planView.append(el('div','review-summary',result.name+' · '+result.scope+' / '+result.sensitivity+' · 候选到期 '+stamp(result.expiresAt)));const detail=el('details');detail.append(el('summary','','核对完整候选与来源'),pretty(result));planView.append(detail);message('候选已生成，尚未验证；没有批准任何记忆。');});
 });
 validationForm.addEventListener('submit',async event=>{event.preventDefault();if(busy||!live()||!plan||!evaluatorAvailable)return;if(!await ask('确认运行宿主验证？','候选：'+plan.name+'。将保存不可变结果；失败不会导出技能。验证程序的执行权限由启动应用负责。'))return;
  const exact=plan,suite={name:suiteName.input.value,cases:cases.map(({fields})=>Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,key==='criteria'?lines(input.value):input.value])))};invalidate(false);
  void run('正在运行宿主验证；可以停止等待…',async attempt=>{const result=await api('experience-validate',{plan:exact,suite,...flags(),confirm:true},attempt.signal);if(!attempt.live())return;validationId.input.value=result.evidenceId;validationView.append(el('div',result.passed?'review-summary':'error',result.passed?'本组选定检查全部通过；不是通用能力保证。':'检查未全部通过，不能导出技能。'),el('code','',result.evidenceId));for(const item of result.report.results)validationView.append(el('p','',item.caseId+' · '+item.status),pretty({observed:item.observed,checks:item.checks}));message('验证原始记录已保存；导出需要下一步单独确认。');});
 });
 exportForm.addEventListener('submit',async event=>{event.preventDefault();if(busy||!live()||!can('review'))return;if(!await ask('确认读取技能明文？','验证记录：'+validationId.input.value.trim()+'。下载后的明文无法撤回；不会安装或执行。'))return;exported=null;files.replaceChildren();
  void run('正在重新检查当前来源、签名与全部验证结果…',async attempt=>{const result=await api('experience-export',{validationId:validationId.input.value.trim(),...flags(),confirm:true},attempt.signal);if(!attempt.live())return;exported=result;files.append(el('p','review-summary','文件已准备好，尚未下载或安装。明文副本无法撤回。'));
   for(const path of ['SKILL.md','references/validation.md']){const body=result.files[path];const details=el('details');details.append(el('summary','','核对 '+path),el('pre','',body));const download=button('下载 '+path,()=>{if(!live()||busy||exported!==result)return;const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));const link=el('a');link.href=url;link.download=path==='SKILL.md'?'SKILL.md':'validation.md';out.append(link);link.click();link.remove();URL.revokeObjectURL(url);});files.append(details,download);}
   files.append(el('p','muted','下载后自行将 validation.md 放到 references/ 目录。只在本次选定范围内验证；离开页面会清除文件控件。'));message('校验通过；请核对明文，再分别点击下载。');
  });
 });
 for(const category of ['transfer','transfer','retention','safety'])addCase(category);
 await run('正在检查本机验证能力…',async attempt=>{const result=await api('experience-status',{},attempt.signal);if(!attempt.live())return;evaluatorAvailable=result.evaluatorAvailable;capability.textContent=evaluatorAvailable?'宿主已提供可信验证程序；不会接收网页上传的执行脚本。':'当前宿主未提供验证程序。可记录、整理并导出已验证记录；新验证需应用通过 startWebServer 的 experienceRunner 提供可信函数。';message('先读取已有经历，或记录一次真实任务。');});sync();return out;
}
`;
