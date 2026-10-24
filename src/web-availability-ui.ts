/** Page-owned selection, cancellation and confirmation; source bodies remain plain text. */
export const availabilityWebScript = String.raw`
async function availability(){
 const epoch=session,current=generation,out=el('div','availability-workbench');
 let closed=false,turn=0,busy=false,active=null,confirming=false,confirmCleanup=()=>{};
 const live=()=>!closed&&epoch===session&&current===generation;
 pageCleanup=()=>{closed=true;turn++;active?.abort();confirmCleanup();for(const input of out.querySelectorAll('input,textarea')){input.value='';input.checked=false;}out.replaceChildren();};
 const intro=card('只重建有记录支持的知识','先明确记录选定知识何时可读，查询时再返回对应版本。没有记录、无法验证或同刻内容冲突，就显示未知。不根据 Git 日期猜测，也不能证明 Agent 首次何时理解了知识。');out.append(intro);
 const selection=card('01 / 选择知识','页面名称每行一项，最多 25 项。沿用当前资料权限、来源密钥、撤回与到期限制；私密资料需要单独选择。离开页面会清除当前表单和结果。'),form=el('div','forms');
 const keys=field('availabilityKeys','Wiki 页面名称（每行一项）','textarea'),sensitive=field('availabilitySensitive','明确读取敏感资料','checkbox',false),secret=field('availabilitySecret','明确读取机密资料','checkbox',false);
 keys.label.classList.add('wide');keys.input.placeholder='concept:deployment';form.append(keys.label,sensitive.label,secret.label);selection.append(form);out.append(selection);
 const observation=card('02 / 明确记录当前版本','记录来自本机时钟与本地证明密钥，是部分可用性证据，不是独立时间认证。只保存不可变观察，不修改或批准 Wiki 内容。'),observe=button('确认记录当前知识',saveObservation,'primary'),receipt=el('div');
 if(can('read')&&can('write'))observation.append(observe,receipt);else observation.append(empty('当前身份没有完整读写权限，只能查询已有观察。'));out.append(observation);
 const query=card('03 / 按观察时间读取','返回不晚于指定时刻的最新可验证观察，包含精确提交和完整来源。不调用模型，不产生新观察。'),queryForm=el('form','forms'),at=field('availabilityAt','查询时刻（ISO，须带时区）','text',new Date().toISOString()),ids=field('availabilityIds','只查这些观察 ID（可选，每行一项）','textarea');
 ids.input.required=false;ids.label.classList.add('wide');at.label.classList.add('wide');at.input.placeholder='2026-10-24T12:00:00Z';const read=el('button','primary','读取已观察知识');read.type='submit';queryForm.append(at.label,ids.label,read);query.append(queryForm,el('p','muted','留空 ID 会扫描当前可读且明确选择的证据；填写后只查该集合，不能排除集合外有更新或冲突。'));out.append(query);
 const feedback=el('div','availability-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');const resultView=el('div'),stop=button('停止当前操作',()=>{if(!busy)return;turn++;active?.abort();active=null;busy=false;resultView.replaceChildren();receipt.replaceChildren();message('已停止等待，没有自动重试。保存可能已经完成，请先查看原始证据与 Git 历史。');sync();},'danger');out.append(feedback,resultView);
 function message(text){feedback.replaceChildren(el('p','',text),stop);}
 function sync(){for(const input of out.querySelectorAll('input,textarea,select,button'))if(input!==stop)input.disabled=busy;
  observe.disabled=busy||!can('read')||!can('write');read.disabled=busy||!can('read');sensitive.input.disabled=busy||!['sensitive','secret'].includes(principal.maxSensitivity);secret.input.disabled=busy||principal.maxSensitivity!=='secret';stop.hidden=!busy;
 }
 function lines(value){return value.split(/\r?\n/).map(item=>item.trim()).filter(Boolean);}
 function selected(){const pageKeys=lines(keys.input.value);if(!pageKeys.length||pageKeys.length>25||new Set(pageKeys).size!==pageKeys.length||pageKeys.some(key=>key.length>200))throw Error('请填写 1–25 个不同的页面名称，每项最多 200 字符');
  return {pageKeys,includeSensitive:sensitive.input.checked,includeSecret:secret.input.checked};
 }
 function invalidate(){if(!live())return;turn++;active?.abort();active=null;busy=false;confirmCleanup();receipt.replaceChildren();resultView.replaceChildren();message('选择已变化，旧结果已清除；请重新查询。');sync();}
 async function ask(description){if(!live()||busy||confirming)return false;confirming=true;const revision=turn;
  return new Promise(resolve=>{const dialog=el('dialog'),title=el('h2','','确认记录当前知识？'),actions=el('div','actions');let done=false;title.id='availability-confirm-title';dialog.setAttribute('aria-labelledby',title.id);
   const finish=accepted=>{if(done)return;done=true;confirming=false;confirmCleanup=()=>{};dialog.close();dialog.remove();resolve(accepted&&live()&&revision===turn);};confirmCleanup=()=>finish(false);
   const cancel=button('取消',()=>finish(false)),accept=button('确认保存观察',()=>finish(true),'primary');actions.append(cancel,accept);dialog.append(title,el('p','',description),actions);document.body.append(dialog);
   dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});dialog.addEventListener('close',()=>finish(false));dialog.showModal();cancel.focus();
  });
 }
 async function run(text,action){if(!live()||busy)return;const attempt=++turn;active=new AbortController();const signal=active.signal;busy=true;resultView.replaceChildren();message(text);sync();
  const valid=()=>live()&&attempt===turn;
  try{await action(signal,valid);}catch(error){if(valid())message(error.message+'。没有自动重试；若涉及保存，请先核查证据和 Git 历史。');}
  finally{if(valid()){active=null;busy=false;sync();}}
 }
 async function saveObservation(){if(!live()||busy||!can('read')||!can('write'))return;let input;try{input=selected();}catch(error){message(error.message);return;}
  if(!await ask('将记录 '+input.pageKeys.join('、')+' 的当前完整版本及依赖。不会批准、修改或执行知识；明文读出后无法追回。'))return;
  receipt.replaceChildren();void run('正在核对来源并保存观察，请勿重复提交…',async(signal,valid)=>{const result=await api('wiki-observe',{...input,confirm:true},signal);if(!valid())return;
   receipt.append(el('div','review-summary','观察已保存；不是首次理解知识的证明。'),el('code','commit-reference',result.evidenceId),el('p','', '本机观察时间：'+result.observedAt),el('code','commit-reference','内容提交：'+result.observedCommit),button('只查本次观察',()=>{if(!live()||busy)return;at.input.value=result.observedAt;ids.input.value=result.evidenceId;resultView.replaceChildren();void readObserved();}));message('已保存观察。查询仍需单独发起，表单内容保留。');
  });
 }
 async function readObserved(){if(!live()||busy||!can('read'))return;let input;try{input={...selected(),at:at.input.value.trim()};const observationIds=lines(ids.input.value);if(observationIds.length)input.observationIds=observationIds;}catch(error){message(error.message);return;}
  void run('正在读取有观察支持的完整版本…',async(signal,valid)=>{const result=await api('wiki-as-known-at',input,signal);if(!valid())return;
   resultView.append(el('div','review-summary',result.coverage.mode==='explicit-observation-ids'?'本次仅查询指定观察 ID；集合外的更新或冲突未排除。':'本次扫描当前可读且明确选择的原始证据；不代表完整历史。'),el('p','', '查询时刻：'+result.at));
   for(const item of result.items){const box=card(item.key,item.status==='observed'?'有可验证观察支持；仍以当前权限和来源检查为准。':'未知：没有足够的可验证观察，或同刻观察存在冲突。');box.append(tag(item.status));
    if(item.status==='observed'){box.append(el('p','', '观察时间：'+item.observedAt),el('code','commit-reference',item.observationId),el('code','commit-reference',item.snapshot.commit));const details=el('details');details.append(el('summary','','查看完整页面、来源与规则'),pretty(item.snapshot));box.append(details);}else if(item.reason)box.append(el('p','muted',item.reason));resultView.append(box);
   }
   const limits=card('本次结果的限制','部分记录不等于完整历史；已复制的明文无法撤回。');for(const warning of result.warnings)limits.append(el('p','muted',warning));resultView.append(limits);message('读取完成，没有写入观察或正式知识。');
  });
 }
 for(const input of [keys.input,at.input,ids.input])input.addEventListener('input',invalidate);
 for(const input of [sensitive.input,secret.input])input.addEventListener('change',invalidate);
 queryForm.addEventListener('submit',event=>{event.preventDefault();void readObserved();});message('先选择知识。已有观察可直接查询；记录当前版本需要单独确认。');sync();return out;
}
`;
