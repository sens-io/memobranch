/** Read-only host-pinned sources. No grant editor, root selector, import or approval. */
export const sharedWikiWebScript = String.raw`
async function sharedWiki(){
 const epoch=session,current=generation,out=el('div','shared-workbench');let closed=false,turn=0,busy=false,active=null,sources=[];
 const live=()=>!closed&&epoch===session&&current===generation;
 pageCleanup=()=>{closed=true;turn++;active?.abort();sources=[];for(const input of out.querySelectorAll('input,textarea,select')){input.value='';input.checked=false;}out.replaceChildren();};
 out.append(card('固定版本，明确来源','只读取宿主已经配置、当前身份有权查看的本机及云端资料库。提交由宿主固定，不自动跟随新版；仍检查当前来源、密钥、撤回与到期。这里不导入、合并、批准或修改共享授权。'));
 const selection=card('01 / 选择共享来源','列表只显示当前身份有权查看的名称和限制，不显示路径、密钥或其他读者。来源是否实际可读，需要读取时重新核对。'),refresh=button('重新读取共享列表',load),source=field('sharedSource','共享资料库','text','',[]),sourceDetails=el('div','shared-source-details');
 source.input.required=false;selection.append(refresh,source.label,sourceDetails);out.append(selection);
 const query=card('02 / 读取固定版本','每行填写一个页面名称，最多 25 项。敏感／机密内容需明确选择，并满足调用方与共享来源的共同权限限制。'),form=el('form','forms'),keys=field('sharedKeys','Wiki 页面名称（每行一项）','textarea'),sensitive=field('sharedSensitive','明确读取敏感资料','checkbox',false),secret=field('sharedSecret','明确读取机密资料','checkbox',false),read=el('button','primary','读取共享知识');
 keys.label.classList.add('wide');keys.input.placeholder='concept:deployment';read.type='submit';form.append(keys.label,sensitive.label,secret.label,read);query.append(form);out.append(query);
 const feedback=el('div','shared-feedback');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');const results=el('div'),stop=button('停止当前操作',()=>{if(!busy)return;turn++;active?.abort();active=null;busy=false;results.replaceChildren();message('已停止读取，没有自动重试；当前输入保留。');sync();},'danger');out.append(feedback,results);
 function chosen(){return sources.find(item=>item.id===source.input.value);}
 function message(text){feedback.replaceChildren(el('p','',text),stop);}
 function sync(){for(const input of out.querySelectorAll('input,textarea,select,button'))if(input!==stop)input.disabled=busy;
  const item=chosen(),level=item?.maxSensitivity;refresh.disabled=busy||!can('read');source.input.disabled=busy||!sources.length;read.disabled=busy||!item||!can('read');
  sensitive.input.disabled=busy||!item||!['sensitive','secret'].includes(level);secret.input.disabled=busy||!item||level!=='secret';stop.hidden=!busy;
 }
 function showSource(){sourceDetails.replaceChildren();const item=chosen();if(!item)return;
  sourceDetails.append(el('h3','',item.title),el('code','commit-reference','来源：'+item.id),el('code','commit-reference','固定提交：'+item.commit),el('p','muted','允许范围：'+item.scopes.join(' / ')+' · 最高敏感级别：'+item.maxSensitivity));
 }
 function invalidate(){if(!live())return;turn++;active?.abort();active=null;busy=false;results.replaceChildren();message('选择已变化，旧内容已清除；请重新读取。');sync();}
 async function run(text,action){if(!live()||busy)return;const attempt=++turn;active=new AbortController();const signal=active.signal;busy=true;results.replaceChildren();message(text);sync();const valid=()=>live()&&attempt===turn;
  try{await action(signal,valid);}catch(error){if(valid())message(error.message+'。不会退回其他版本或自动重试；可请启动者核查当前共享配置。');}
  finally{if(valid()){active=null;busy=false;sync();}}
 }
 async function load(){if(!live()||busy)return;const previous=source.input.value;sources=[];source.input.replaceChildren();sourceDetails.replaceChildren();sensitive.input.checked=false;secret.input.checked=false;
  void run('正在读取当前身份的共享列表…',async(signal,valid)=>{const result=await api('shared-catalog',{},signal);if(!valid())return;sources=result.sources;
   for(const item of sources){const option=el('option','',item.title+' · '+item.id);option.value=item.id;source.input.append(option);}source.input.value=sources.some(item=>item.id===previous)?previous:sources[0]?.id||'';showSource();
   message(!result.configured?'宿主尚未配置共享来源。请由启动者配置后重新连接；网页不会增加授权。':sources.length?'列表已读取。先核对来源与固定提交，再明确读取页面。':'当前身份没有可读的共享来源；未显示其他读者的配置。');
  });
 }
 source.input.addEventListener('change',()=>{invalidate();sensitive.input.checked=false;secret.input.checked=false;showSource();sync();});
 keys.input.addEventListener('input',invalidate);for(const input of [sensitive.input,secret.input])input.addEventListener('change',invalidate);
 form.addEventListener('submit',event=>{event.preventDefault();if(!live()||busy||!can('read'))return;const item=chosen(),pageKeys=keys.input.value.split(/\r?\n/).map(item=>item.trim()).filter(Boolean);
  if(!item){message('先选择当前可读的共享来源。');return;}if(!pageKeys.length||pageKeys.length>25||new Set(pageKeys).size!==pageKeys.length||pageKeys.some(key=>key.length>200)){message('请填写 1–25 个不同页面名称，每项最多 200 字符。');return;}
  const input={sourceId:item.id,pageKeys,expectedCommit:item.commit,includeSensitive:sensitive.input.checked,includeSecret:secret.input.checked};
  void run('正在核对当前权限与来源，读取固定版本…',async(signal,valid)=>{const result=await api('shared-snapshot',input,signal);if(!valid())return;
   if(result.source.id!==item.id||result.source.commit!==item.commit){message('共享来源或固定提交已变化，请重新读取共享列表后再查看。');return;}
   const heading=card('已读取固定版本 · '+result.source.title,'这是有来源的旧版本读取，不是当前建议。明文复制后无法追回，也不会自动进入本地正式知识。');heading.append(el('code','commit-reference','来源：'+result.source.id),el('code','commit-reference','固定提交：'+result.source.commit));results.append(heading);
   for(const page of result.snapshot.pages){const box=card(page.meta.title||page.meta.key||page.meta.id,'保留版本 '+page.meta.revision+' · 当前版本 '+page.currentRevision);box.append(tag(page.meta.scope),tag(page.meta.sensitivity));if(page.meta.conditions?.length)box.append(el('p','', '适用条件：'+page.meta.conditions.join('；')));if(page.meta.uncertainty?.length)box.append(el('p','', '不确定内容：'+page.meta.uncertainty.join('；')));box.append(el('pre','',page.body));results.append(box);}
   const references=el('details');references.append(el('summary','','查看完整结果与来源／规则引用'),pretty(result));results.append(references);
   const limits=card('共享与离线限制');for(const warning of [...result.warnings,...result.snapshot.warnings])limits.append(el('p','muted',warning));results.append(limits);message('读取完成；没有导入、合并或修改任何知识。');
  });
 });
 message('共享来源由宿主配置，网页仅提供只读查看。');sync();void load();return out;
}
`;
