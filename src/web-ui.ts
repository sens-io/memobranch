/** Self-contained assets: no CDN, build-time asset copying or executable document markup. */
export const webHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MemoBranch · 知识工作台</title><link rel="icon" type="image/png" href="/assets/logo.png"><link rel="stylesheet" href="/style.css"><script defer src="/app.js"></script></head>
<body><div id="app"></div><div id="notice" role="status" aria-live="polite"></div><noscript>请启用 JavaScript 以使用本机管理界面。</noscript></body></html>`;

/** Match assets/logo.png: cobalt actions, violet Wiki accents, teal success states. */
export const webCss = String.raw`

:root {
  color-scheme: dark;
  --paper: #080f21;
  --surface: #101b33;
  --raised: #15233e;
  --ink: #edf3ff;
  --muted: #a4b3cf;
  --line: #2b3d60;
  --accent: #8babff;
  --blue: #315de3;
  --violet: #b49aff;
  --mint: #48e2c0;
  --soft: #1c2c4c;
  --danger: #ffb5bc;
  --serif: 'Baskerville', 'Palatino Linotype', 'Songti SC', serif;
  --sans: 'Avenir Next', 'Trebuchet MS', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --mono: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.7 var(--sans); }
button, input, select, textarea { font: inherit; }
button { cursor: pointer; min-height: 42px; border: 1px solid #3b5077; border-radius: 8px; background: #182744; color: var(--ink); padding: 9px 16px; transition: background .16s, border-color .16s, transform .16s; }
button:hover { background: #22385e; border-color: #718fc2; }
button:active { transform: translateY(1px); }
button:disabled { opacity: .5; cursor: not-allowed; transform: none; }
button.primary { background: var(--blue); color: #fff; border-color: #6d90ff; box-shadow: 0 4px 18px #163a9b33; }
button.primary:hover { background: #244dca; border-color: #9bb5ff; }
button.danger { color: var(--danger); border-color: #81505e; background: #351f30; }
button.danger:hover { background: #49273a; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 3px solid var(--mint); outline-offset: 3px; }
a { color: var(--accent); text-underline-offset: 3px; }
input, select, textarea { width: 100%; border: 1px solid #5e7398; border-radius: 7px; padding: 11px 12px; background: #0b152b; color: var(--ink); }
input::placeholder, textarea::placeholder { color: #91a2c0; opacity: 1; }
input[type=checkbox] { width: auto; margin-right: 8px; accent-color: var(--blue); }
textarea { min-height: 120px; resize: vertical; }
label { display: block; font-size: 12px; font-weight: 600; letter-spacing: .025em; color: #cbd7ed; }
label input, label select, label textarea { margin-top: 8px; }
h1, h2, h3, h4, p { margin-top: 0; }
h1 { font: 600 clamp(32px, 3.2vw, 46px)/1.25 var(--serif); letter-spacing: -.04em; margin-bottom: 13px; }
h2 { font-size: 18px; letter-spacing: -.025em; line-height: 1.5; }
h3 { font-size: 15px; line-height: 1.5; }
p, small, .muted { color: var(--muted); }
p { max-width: 76ch; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.9 var(--mono); background: #091327; border: 1px solid var(--line); padding: 18px; border-radius: 8px; max-height: 480px; overflow: auto; color: #d1def6; tab-size: 2; }
code { overflow-wrap: anywhere; }
details { border-top: 1px solid var(--line); padding-top: 16px; margin-top: 18px; }
summary { cursor: pointer; font-weight: 600; margin-bottom: 15px; color: #d6e3ff; overflow-wrap: anywhere; }
.layout { display: grid; grid-template-columns: 244px minmax(0, 1fr); min-height: 100vh; }
.sidebar { background: #0b1429; border-right: 1px solid var(--line); padding: 31px 22px; display: flex; flex-direction: column; gap: 32px; position: sticky; top: 0; align-self: start; min-height: 100vh; max-height: 100vh; overflow-y: auto; }
.brand { display: flex; align-items: center; gap: 10px; font-family: var(--serif); font-size: 23px; font-weight: 600; letter-spacing: -.7px; color: var(--ink); }
.brand-logo { display: block; width: 43px; height: 43px; object-fit: contain; flex-shrink: 0; }
.eyebrow { font: 10px/1.9 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: #8d9fca; padding-left: 3px; }
.sidebar nav { display: grid; gap: 7px; }
.sidebar nav button { border: 1px solid transparent; background: transparent; color: #a8b9d9; text-align: left; padding: 13px 12px; position: relative; }
.sidebar nav button:hover { background: #142440; border-color: #30476d; color: #edf3ff; }
.sidebar nav button[aria-current=page] { background: #182e5a; border-color: #4165a6; color: #f2f6ff; }
.sidebar nav button[aria-current=page]::before { content: ''; position: absolute; inset: 10px auto 10px -1px; width: 3px; border-radius: 3px; background: #83a4ff; }
.sidebar nav button[data-page=wiki][aria-current=page] { background: #292044; border-color: #7560a8; }
.sidebar nav button[data-page=wiki][aria-current=page]::before { background: var(--violet); }
.nav-index { font: 11px var(--mono); margin-right: 18px; color: #8fa7d8; }
.sidebar footer { margin-top: auto; padding-top: 28px; overflow-wrap: anywhere; font-size: 12px; color: #afbfdd; border-top: 1px solid #223454; }
.sidebar footer .eyebrow { padding: 0; color: #89a0cb; margin-bottom: 5px; }
.sidebar footer button { margin-top: 15px; background: #101e36; color: #bdcdeb; border-color: #344c74; }
.workspace { min-width: 0; background: radial-gradient(ellipse at 70% -12%, #17396755, transparent 55%), var(--paper); }
.topbar { min-height: 74px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; padding: 17px 40px; font-size: 12px; gap: 12px; color: #b7c8e7; }
.topbar>span:first-child { overflow-wrap: anywhere; min-width: 0; }
.online { display: flex; align-items: center; gap: 9px; white-space: nowrap; font: 11px var(--mono); color: #a7c7d2; }
.dot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--mint); box-shadow: 0 0 0 4px #48e2c011; }
.content { max-width: 1320px; margin: auto; padding: 38px 40px 60px; animation: arrive .3s ease-out both; }
.page-head { display: flex; justify-content: space-between; align-items: start; gap: 24px; margin-bottom: 29px; }
.page-head p { max-width: 650px; margin-bottom: 0; }
.section-number { font: 10px/1.8 var(--mono); color: var(--accent); letter-spacing: .18em; margin-bottom: 12px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 25px; }
.stat { background: #101d37; border: 1px solid var(--line); border-top: 2px solid #6089f8; border-radius: 10px; padding: 20px; min-width: 0; }
.stat:nth-child(2) { border-top-color: #d0a45d; }
.stat:nth-child(3) { border-top-color: #42bfa8; }
.stat:nth-child(4) { border-top-color: #9e7ee4; }
.stat strong { display: block; font: 500 clamp(32px, 3.7vw, 48px)/1.25 var(--mono); letter-spacing: -.07em; margin: 14px 0 11px; color: #d4e1ff; }
.stat:nth-child(3) strong { color: #87e0cb; }
.stat:nth-child(4) strong { color: #c7b4ff; }
.stat small { font-size: 10px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 25px; margin-bottom: 20px; min-width: 0; }
.card h2 { margin-bottom: 8px; color: #e1eaff; }
.card p:last-child { margin-bottom: 0; }
.hero { background: radial-gradient(ellipse at 100% 0, #24498788, transparent 65%), #10203e; border-color: #3b5688; position: relative; overflow: hidden; }
.hero h2 { font: 500 27px/1.5 var(--serif); letter-spacing: -.03em; position: relative; }
.hero::after { content: ''; position: absolute; width: 210px; height: 210px; right: -100px; bottom: -150px; border: 1px solid #6f91de55; border-radius: 50%; box-shadow: 0 0 0 25px #6f91de0a, 0 0 0 55px #6f91de0a; pointer-events: none; }
.flow { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; margin-top: 22px; position: relative; z-index: 1; }
.flow span { background: #0a172d; border: 1px solid #3a527b; border-radius: 5px; padding: 7px 10px; font-size: 11px; color: #bbd2ff; }
.toolbar, .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.toolbar { margin-bottom: 20px; }
.toolbar input { flex: 1; min-width: 150px; }
.toolbar select { width: auto; max-width: 100%; }
.forms { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
.wide { grid-column: 1/-1; }
.forms .actions { margin-top: 4px; }
.tag { display: inline-block; border: 1px solid #405578; border-radius: 4px; padding: 2px 7px; font: 10px/1.7 var(--mono); color: #bdcdec; margin: 0 5px 4px 0; overflow-wrap: anywhere; max-width: 100%; }
.tag.active, .tag.immutable, .tag.promoted { background: #112f32; color: #90f1d6; border-color: #347a71; }
.tag.pending, .tag.conflicted { background: #352b20; color: #ffda94; border-color: #896c3f; }
.record { display: block; width: 100%; text-align: left; padding: 20px 0; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; }
.record:hover { background: #172744; border-color: #4b6391; }
.record strong { display: block; font-size: 15px; margin-bottom: 8px; overflow-wrap: anywhere; color: #dbe7ff; }
.record p { font-size: 12px; margin: 8px 0 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.row-head { display: flex; justify-content: space-between; gap: 10px; }
.row-head small { flex-shrink: 0; }
.empty { text-align: center; border: 1px dashed #435779; border-radius: 8px; padding: 42px 20px; color: #adbedc; background: #0d1930; }
.error { background: #351f2e; border: 1px solid #8b4d60; border-radius: 8px; color: #ffc0ca; padding: 15px; overflow-wrap: anywhere; }
.loading { padding: 64px 20px; text-align: center; color: #b4c9f2; animation: pulse 1.4s ease-in-out infinite; }
.inline-loading { padding: 22px 12px; }
.pager { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 20px; font-size: 12px; }
.login { max-width: 1020px; margin: max(7vh, 28px) auto; display: grid; grid-template-columns: 1.08fr 1fr; background: #101b33; border: 1px solid #34496e; border-radius: 16px; overflow: hidden; box-shadow: 0 28px 100px #0005; }
.login-story { position: relative; isolation: isolate; padding: 38px 40px 220px; min-width: 0; background: radial-gradient(ellipse at 35% 90%, #2a4f8f66, transparent 65%), #0b1730; border-right: 1px solid #34496e; }
.login-story::after { content: ''; z-index: -1; position: absolute; bottom: 14px; right: 32px; width: 195px; height: 195px; background: url('/assets/logo.png') center/contain no-repeat; opacity: .9; pointer-events: none; }
.login-story::before { content: ''; z-index: -1; position: absolute; width: 275px; height: 275px; bottom: -60px; left: -100px; border: 1px solid #456cb066; border-radius: 50%; box-shadow: 0 0 0 30px #456cb00d, 0 0 0 60px #456cb00b; pointer-events: none; }
.login .brand { margin-bottom: 42px; }
.login .brand-logo { width: 46px; height: 46px; }
.login h1 { font-size: clamp(32px, 4vw, 45px); line-height: 1.4; max-width: 10ch; margin-bottom: 18px; }
.login-story>p { max-width: 29ch; color: #b5c7e8; font-size: 13px; }
.login-principles { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 26px; }
.login-principles span { color: #a9c7f4; border-left: 2px solid #5c80cc; padding-left: 8px; font: 10px/1.7 var(--mono); }
.login-access { padding: 56px 40px 36px; align-self: center; min-width: 0; }
.login-access h2 { font-size: 23px; margin: 8px 0 12px; }
.login-access>p { font-size: 12px; }
.login form { margin-top: 30px; }
.login form button { width: 100%; margin-top: 21px; min-height: 47px; }
.login small { display: block; margin-top: 25px; font-size: 10px; line-height: 1.9; color: #9eafcd; }
#notice { position: fixed; bottom: 24px; right: 24px; max-width: 440px; z-index: 10; background: #1d3154; color: #f3f6ff; border: 0 solid #678ac8; border-radius: 8px; padding: 0; box-shadow: 0 8px 32px #0005; white-space: pre-wrap; overflow-wrap: anywhere; }
#notice:not(:empty) { padding: 15px 20px; border-width: 1px; }
dialog { border: 1px solid #4b6390; border-radius: 12px; max-width: 900px; width: calc(100% - 36px); max-height: 88vh; padding: 29px; color: var(--ink); background: #101b33; box-shadow: 0 30px 120px #0008; }
dialog::backdrop { background: #030919bc; backdrop-filter: blur(4px); }
dialog .dialog-head { display: flex; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--line); margin-bottom: 20px; padding-bottom: 10px; }
dialog h2 { overflow-wrap: anywhere; }
dialog .meta { font-size: 11px; color: #a9bddf; }
.history { border-bottom: 1px solid var(--line); padding: 14px 0; }
.history strong { font-size: 12px; color: #c8d9f9; }
.history p { margin: 5px 0; font-size: 12px; overflow-wrap: anywhere; }
.review-summary { padding: 17px 19px; background: #192d52; border: 1px solid #476599; border-left: 3px solid var(--violet); border-radius: 7px; margin: 18px 0; overflow-wrap: anywhere; }
.review-summary p:last-child { margin: 0; }
.plan-page { padding-bottom: 18px; }
.comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.version-panel { min-width: 0; background: #0c162c; border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
.version-panel:nth-child(2) { border-top: 2px solid #658bff; }
.version-panel h3 { margin-bottom: 10px; }
.version-panel pre { background: #081123; padding: 12px; margin-bottom: 15px; }
.version-panel ul, .source-list { padding-left: 20px; overflow-wrap: anywhere; color: #b9c9e6; }
.version-panel h4 { font-size: 12px; margin: 15px 0 5px; color: #bfaff2; }
.source-list button { font-size: 11px; padding: 4px 8px; max-width: 100%; overflow-wrap: anywhere; text-align: left; min-height: 34px; }
.diff { border: 1px solid var(--line); border-radius: 7px; max-height: 320px; overflow: auto; margin-top: 12px; font: 12px/1.8 var(--mono); }
.diff-line { white-space: pre-wrap; overflow-wrap: anywhere; padding: 3px 12px; }
.diff-line.added { background: #10352f; color: #a0f2d7; }
.diff-line.removed { background: #3b2232; color: #ffc5cf; }
.diff-line.omitted { background: #16233f; color: #afbfdb; }
.retrieval-note { border-left: 3px solid var(--violet); padding-left: 14px; margin: 18px 0; }
.retrieval-hit { border-top: 1px solid var(--line); padding: 13px 0; }
.retrieval-hit .record { border: 0; padding-top: 4px; }
.retrieval-hit dl { display: flex; gap: 10px 22px; flex-wrap: wrap; margin: 8px 0; font-size: 12px; }
.retrieval-hit dl>div { display: flex; gap: 8px; }
.retrieval-hit dt { color: var(--muted); }
.retrieval-hit dd { margin: 0; font-variant-numeric: tabular-nums; color: #d6e4ff; }
.correction { margin-top: 24px; padding-top: 22px; border-top: 1px solid var(--line); }
.correction h3 { margin-bottom: 8px; color: #cab6ff; }
@keyframes pulse { 50% { opacity: .55; } }
@keyframes arrive { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
@media (min-width: 701px) and (max-width: 1050px) {
  .sidebar .brand { font-size: 20px; gap: 8px; }
  .brand-logo { width: 36px; height: 36px; }
}
@media (max-width: 1100px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .content { padding: 30px 26px 46px; }
  .layout { grid-template-columns: 216px minmax(0, 1fr); }
  .grid { grid-template-columns: 1fr; }
  .sidebar { padding: 26px 18px; }
  .login { margin: 35px 24px; }
}
@media (max-width: 700px) {
  .layout { display: block; }
  .sidebar { position: static; min-height: auto; max-height: none; overflow: visible; padding: 19px 18px; gap: 18px; }
  .sidebar nav { display: flex; flex-wrap: wrap; gap: 5px; }
  .sidebar nav button { padding: 9px 11px; min-height: 42px; }
  .nav-index, .sidebar footer .eyebrow { display: none; }
  .sidebar footer { display: flex; justify-content: space-between; align-items: center; padding-top: 15px; }
  .sidebar footer button { margin: 0; }
  .topbar { min-height: 60px; padding: 15px 18px; flex-wrap: wrap; }
  .content { padding: 26px 18px 40px; }
  .forms, .comparison { grid-template-columns: minmax(0, 1fr); }
  .page-head { display: block; }
  .page-head>.actions { margin-top: 18px; }
  h1 { font-size: 32px; }
  .login { grid-template-columns: minmax(0, 1fr); margin: 20px 14px; }
  .login-story { padding: 25px 25px 29px; border-right: 0; border-bottom: 1px solid #34496e; }
  .login-story::after { width: 100px; height: 100px; right: 12px; bottom: 12px; opacity: .35; }
  .login .brand { margin-bottom: 24px; }
  .login h1 { max-width: 13ch; font-size: 32px; position: relative; }
  .login-story>p, .login-principles { position: relative; }
  .login-access { padding: 28px 25px; }
  .login-access h2 { font-size: 21px; }
  .login form { margin-top: 22px; }
  .card { padding: 21px; }
  .row-head { display: block; }
  #notice { left: 18px; right: 18px; bottom: 18px; }
  .stats { gap: 10px; }
  .stat { padding: 17px; }
  .stat strong { font-size: 36px; }
  .version-panel { padding: 13px; }
  .retrieval-hit dl { display: block; }
  .retrieval-hit dl>div { margin-bottom: 4px; }
  dialog { padding: 22px 18px; width: calc(100% - 24px); }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}

`;

export const webScript = String.raw`
'use strict';
const app = document.getElementById('app');
const notice = document.getElementById('notice');
let token = '', principal = null, vaultName = '', page = 'overview', generation = 0, session = 0, toastTimer;
const requests = new Set();
const pages = [['overview','总览','Overview'],['records','记忆库','Memory library'],['review','审核队列','Review queue'],['wiki','LLM Wiki','Knowledge wiki'],['settings','配置','Configuration'],['operations','运维记录','Operations']];
const descriptions = {overview:'让每一条记忆有据可查，让知识持续生长。',records:'保存原始证据，浏览经过审核的长期记忆。原始资料不会被覆盖。',review:'让人决定方向。检查候选内容与来源，再将其纳入正式知识。',wiki:'摄取、查询、维护各司其职。所有写回都需要单独确认。',settings:'调整知识管理策略。密钥、租户与身份仍由启动环境管理。',operations:'检查健康状态、查看 Git 历史，或明确发起维护与同步。'};
function el(tag, cls, text){const n=document.createElement(tag);if(cls){n.className=cls;if(cls.split(' ').includes('loading'))n.setAttribute('role','status');if(cls.split(' ').includes('error'))n.setAttribute('role','alert');}if(text!==undefined)n.textContent=String(text);return n;}
function button(label,action,cls=''){const b=el('button',cls,label);b.type='button';b.addEventListener('click',action);return b;}
function can(permission){return principal && (principal.permissions.includes('admin')||principal.permissions.includes(permission));}
function toast(message){clearTimeout(toastTimer);notice.textContent=message;toastTimer=setTimeout(()=>notice.textContent='',7000);}
function pretty(value){return el('pre','',JSON.stringify(value,null,2));}
function empty(message){return el('div','empty',message);}
function card(title,description){const c=el('section','card');if(title)c.append(el('h2','',title));if(description)c.append(el('p','',description));return c;}
function tag(value){return el('span','tag '+(typeof value==='string'&&/^[a-z-]+$/.test(value)?value:''),value);}
function stamp(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';}
function split(value){return value.split(/[,\n]/).map(s=>s.trim()).filter(Boolean);}
async function api(operation,data={}){
 const controller=new AbortController(), epoch=session;requests.add(controller);
 try{const response=await fetch('/api/'+operation,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(data),signal:controller.signal,cache:'no-store'});
 const json=await response.json();if(epoch!==session)throw Error('会话已结束');
 if(!response.ok){const code=json.error?.code||'REQUEST_FAILED';const hint=code==='AUTHORIZATION_DENIED'?'权限不足，或访问令牌已失效':code==='VALIDATION_FAILED'?'输入无效或数据版本已变化，请刷新后核对':code==='OPERATION_CANCELLED'?'操作已取消；请刷新确认状态后再操作':code==='DEPENDENCY_UNAVAILABLE'?'模型服务不可用，请检查启动环境的模型配置':code==='ENCRYPTION_KEY_UNAVAILABLE'?'未提供解密密钥，请检查启动环境':json.error?.message||code;
 throw Error(hint+' ['+code+']'+(json.error?.committed?'；已完成提交：'+JSON.stringify(json.error.committed):''));}return json.result;
 }finally{requests.delete(controller);}
}
function logout(){session++;generation++;for(const c of requests)c.abort();token='';principal=null;vaultName='';notice.textContent='';document.querySelectorAll('dialog').forEach(d=>d.remove());login();}
function brandLogo(){const image=el('img','brand-logo');image.src='/assets/logo.png';image.alt='';image.width=40;image.height=40;return image;}
function login(){app.replaceChildren();const box=el('main','login');const brand=el('div','brand');brand.append(brandLogo(),el('span','','MemoBranch'));const story=el('section','login-story');story.append(brand,el('div','section-number','LOCAL KNOWLEDGE WORKBENCH'),el('h1','','知识，留在你手中。'),el('p','','把对话变成有来源、可审核、可追溯的长期知识。'));const principles=el('div','login-principles');['Git 可追溯','来源可核验','本机优先'].forEach(text=>principles.append(el('span','',text)));story.append(principles);const access=el('section','login-access');access.append(el('div','section-number','SECURE LOCAL SESSION'),el('h2','','连接工作台'),el('p','','输入启动命令显示的访问令牌，连接本机记忆库。'));const form=el('form');const label=el('label','','访问令牌');const input=el('input');input.type='password';input.autocomplete='off';input.required=true;input.placeholder='粘贴终端中的 token';label.append(input);const submit=el('button','primary','连接工作台 →');submit.type='submit';const error=el('div');form.append(label,submit,error);form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;token=input.value.trim();input.value='';error.replaceChildren();try{const data=await api('session');principal=data.principal;vaultName=data.name;page='overview';shell();await navigate(page);}catch(e){token='';error.append(el('p','error',e.message));}finally{submit.disabled=false;}});access.append(form,el('small','','仅监听 127.0.0.1 · 令牌仅保存在当前页面内存 · 重启服务后失效'));box.append(story,access);app.append(box);input.focus();}
function shell(){app.replaceChildren();const layout=el('div','layout'),side=el('aside','sidebar'),brand=el('div','brand');brand.append(brandLogo(),el('span','','MemoBranch'));side.append(brand,el('div','eyebrow','YOUR KNOWLEDGE, BRANCHED.'));const nav=el('nav');nav.setAttribute('aria-label','主导航');pages.forEach(([key,title],i)=>{const b=button('',()=>navigate(key));b.dataset.page=key;b.append(el('span','nav-index',String(i+1).padStart(2,'0')),document.createTextNode(title));nav.append(b);});side.append(nav);const foot=el('footer');foot.append(el('div','eyebrow','OPERATOR'),el('div','',principal.name),button('断开连接',logout));side.append(foot);const work=el('div','workspace'),top=el('header','topbar');top.append(el('span','',vaultName));const online=el('span','online');online.append(el('span','dot'),document.createTextNode('本机连接 · Git 原生'));top.append(online);work.append(top,el('main','content'));layout.append(side,work);app.append(layout);}
async function navigate(key){page=key;const current=++generation;document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===key)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});const main=app.querySelector('main.content');if(!main)return;main.replaceChildren(el('div','loading','正在读取授权范围内的数据…'));try{const content=await ({overview,records:()=>records('memories'),review:()=>records('candidates'),wiki,settings,operations}[key])();if(current!==generation)return;const head=el('header','page-head'),left=el('div');left.append(el('div','section-number',pages.find(p=>p[0]===key)[2].toUpperCase()),el('h1','',pages.find(p=>p[0]===key)[1]),el('p','',descriptions[key]));head.append(left);main.replaceChildren(head,content);}catch(e){if(current!==generation)return;main.replaceChildren(el('div','error',e.message),button('重新读取',()=>navigate(key)));}}
function field(name,title,type='text',value='',options){const label=el('label','',title),input=el(type==='textarea'?'textarea':options?'select':'input');input.name=name;if(options){options.forEach(o=>{const option=el('option','',Array.isArray(o)?o[1]:o);option.value=Array.isArray(o)?o[0]:o;input.append(option);});}else if(type!=='textarea')input.type=type;if(type==='checkbox')input.checked=Boolean(value);else input.value=String(value??'');if(type==='number')input.step='any';if(type!=='checkbox')input.required=true;label.append(input);return {label,input};}
function form(fields,label,action){const wrapper=el('div'),f=el('form','forms');const inputs={};fields.forEach(spec=>{const [name,title,type='text',value='',options,optional=false]=spec;const item=field(name,title,type,value,options);if(type==='textarea')item.label.classList.add('wide');if(optional)item.input.required=false;inputs[name]=item.input;f.append(item.label);});const actions=el('div','actions wide'),submit=el('button','primary',label);submit.type='submit';actions.append(submit);const output=el('div','wide');f.append(actions);wrapper.append(f,output);f.addEventListener('submit',async e=>{e.preventDefault();e.stopPropagation();if(submit.disabled)return;const values={};for(const [key,input] of Object.entries(inputs))values[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;submit.disabled=true;submit.textContent='处理中…';output.replaceChildren();try{const result=await action(values,output);if(result!==undefined)output.append(pretty(result));}catch(e){output.append(el('div','error',e.message));}finally{submit.disabled=false;submit.textContent=label;}});return wrapper;}
function classifications(){const levels=['public','internal','sensitive','secret'].slice(0,['public','internal','sensitive','secret'].indexOf(principal.maxSensitivity)+1);return [['scope','作用域','text',principal.scopes[0],principal.scopes],['sensitivity','敏感级别','text',levels.includes('internal')?'internal':'public',levels]];}
async function overview(){const [memories,candidates,evidence,catalog]=await Promise.all([api('records',{collection:'memories',limit:1}),api('records',{collection:'candidates',status:'pending',limit:1}),api('records',{collection:'evidence',limit:1}),api('catalog')]);const out=el('div'),stats=el('div','stats');[['正式记忆',memories.total],['待审核',candidates.total],['原始证据',evidence.total],['Wiki 页面',catalog.length]].forEach(([label,value])=>{const s=el('div','stat');s.append(el('span','muted',label),el('strong','',value),el('small','','当前身份可见'));stats.append(s);});out.append(stats);const grid=el('div','grid'),hero=card('从资料到知识，保留每一步。','捕获不是记住。经过来源核验与审核，资料才成为可复用的知识。');hero.classList.add('hero');const flow=el('div','flow');['01 原始证据','→','02 候选 / 编译','→','03 正式知识'].forEach(t=>flow.append(el('span','',t)));hero.append(flow);grid.append(hero);const policy=card('你的访问边界','权限来自服务启动环境，网页无法提升权限。');principal.permissions.forEach(v=>policy.append(tag(v)));policy.append(el('p','', '作用域：'+principal.scopes.join(' / ')+' · 最高敏感级别：'+principal.maxSensitivity));grid.append(policy);out.append(grid);const recent=card('最近的知识页面','按授权目录展示，可从 LLM Wiki 打开全文与来源。');if(!catalog.length)recent.append(empty('还没有 Wiki 页面。先捕获证据，再创建摄取计划。'));catalog.slice(0,5).forEach(row=>recent.append(recordButton({id:row.id,title:row.title,snippet:row.summary,...row})));out.append(recent);return out;}
function recordButton(row){const b=button('',()=>openDocument(row.id));b.className='record';const line=el('div','row-head');line.append(el('strong','',row.title||row.id),el('small','',row.createdAt?stamp(row.createdAt):row.pageType||''));b.append(line);[row.status,row.scope,row.sensitivity].filter(Boolean).forEach(v=>b.append(tag(v)));if(row.snippet)b.append(el('p','',row.snippet));return b;}
function textList(values,fallback){if(!values?.length)return el('p','muted',fallback);const list=el('ul');values.forEach(value=>list.append(el('li','',value)));return list;}
function sourceList(values){if(!values?.length)return el('p','muted','未列明来源');const list=el('ul','source-list');values.forEach(value=>{const row=el('li'),match=String(value).match(/(?:^|\/|-)(ev-[a-f0-9]{12})(?:\.md)?$/);row.append(match?button(value,()=>openDocument(match[1])):el('span','',value));list.append(row);});return list;}
async function openDocument(id){const dialog=el('dialog');dialog.setAttribute('aria-label','文档详情');const head=el('div','dialog-head');head.append(el('h2','','文档详情'),button('关闭',()=>dialog.close()));const body=el('div');body.append(el('div','loading','读取中…'));dialog.append(head,body);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();try{const doc=await api('get',{id});if(!dialog.isConnected)return;head.querySelector('h2').textContent=doc.meta.title||doc.meta.key||id;body.replaceChildren(el('div','meta muted',doc.path+(doc.meta.revision?' · 当前版本 v'+doc.meta.revision:'')));const badges=el('p');[doc.meta.type,doc.meta.status,doc.meta.scope,doc.meta.sensitivity].filter(Boolean).forEach(v=>badges.append(tag(v)));body.append(badges,el('pre','',doc.body));if(Array.isArray(doc.meta.evidence)){body.append(el('h3','','来源'),sourceList(doc.meta.evidence));}if(doc.meta.conditions?.length)body.append(el('h3','','适用条件'),textList(doc.meta.conditions,''));if(doc.meta.uncertainty?.length)body.append(el('h3','','不确定性'),textList(doc.meta.uncertainty,''));const meta=el('details');meta.append(el('summary','','来源与元数据'),pretty(doc.meta));body.append(meta);const actions=el('div','actions');if(doc.meta.type==='memory-candidate'&&doc.meta.status==='pending'&&can('review')){actions.append(actionButton('批准纳入记忆','approve',{id},()=>dialog.close()));actions.append(reasonButton('拒绝候选','reject',id,()=>dialog.close()));}if(doc.meta.type==='memory'&&can('review')&&doc.meta.status!=='revoked')actions.append(reasonButton('撤回记忆','forget',id,()=>dialog.close()));if(doc.meta.type==='wiki-page'&&can('review')&&doc.meta.status!=='revoked')actions.append(reasonButton('撤回页面','revoke',doc.meta.key,()=>dialog.close()));body.append(actions);if(doc.meta.type==='wiki-page'&&can('read')&&can('write'))body.append(correctionForm(doc.meta.key,doc.meta.revision));}catch(e){body.replaceChildren(el('div','error',e.message));}}
function correctionForm(key,expectedRevision){const section=el('section','correction');section.append(el('h3','','纠正这页知识'),el('p','','说明哪里有误以及应如何修改。原话会先保存为不可变证据，再生成修订计划；审核后才更新页面。'));section.append(form([['instruction','纠正内容','textarea']],'保存纠正并生成计划',async(values,output)=>{const epoch=session;output.append(el('div','loading inline-loading','正在保存纠正原话并生成修订计划…'));let result;try{result=await api('correct',{key,instruction:values.instruction,expectedRevision});}catch(e){if(epoch===session){output.replaceChildren(el('div','error',e.message),el('p','muted','计划未能生成；纠正原话可能已经保存。请先查看原始证据，再决定是否重试。'));}return;}if(epoch!==session)return;output.replaceChildren(el('p','', '纠正原话已保存 · 证据 '+result.evidenceId));await showPlan(output,result);}));return section;}
function actionButton(label,operation,data={},after){const b=button(label,async()=>{if(!confirm(label+'？此操作可能写入 Git 历史。'))return;b.disabled=true;try{const result=await api(operation,{...data,confirm:true});toast('操作完成'+(result.commit?' · '+result.commit.slice(0,8):''));if(after)after();await navigate(page);}catch(e){toast(e.message);}finally{b.disabled=false;}});return b;}
function reasonButton(label,operation,id,after){const b=button(label,async()=>{const reason=prompt(label+'：请填写原因（将写入审计记录）');if(!reason?.trim())return;if(!confirm('确认'+label+'？历史记录仍会保留。'))return;b.disabled=true;try{await api(operation,{id,reason,confirm:true});toast('已完成'+label);if(after)after();await navigate(page);}catch(e){toast(e.message);}finally{b.disabled=false;}},'danger');return b;}
async function records(initial){const out=el('div'),list=card(),toolbar=el('form','toolbar'),collection=field('collection','集合','text',initial,[['memories','正式记忆'],['evidence','原始证据'],['candidates','候选记忆']]).input,query=el('input');query.placeholder='按内容或名称筛选';query.setAttribute('aria-label','筛选记忆');query.maxLength=200;const status=field('status','状态','text',initial==='candidates'?'pending':'',[['','全部状态'],['pending','待审核'],['promoted','已批准'],['rejected','已拒绝'],['active','有效'],['conflicted','冲突'],['superseded','已替代'],['revoked','已撤回']]).input;collection.setAttribute('aria-label','集合');status.setAttribute('aria-label','状态');const search=el('button','','筛选');search.type='submit';toolbar.append(collection,query,status,search);const rows=el('div'),pager=el('div','pager');let offset=0,seq=0;
 async function load(){const current=++seq;rows.replaceChildren(el('div','loading','读取中…'));pager.replaceChildren();try{const data=await api('records',{collection:collection.value,query:query.value,status:status.value,offset,limit:20});if(seq!==current)return;rows.replaceChildren();if(!data.items.length)rows.append(empty('暂无符合条件的记录。可切换状态或添加原始证据。'));data.items.forEach(row=>rows.append(recordButton(row)));const prev=button('上一页',()=>{offset=Math.max(0,offset-20);load();}),next=button('下一页',()=>{offset+=20;load();});prev.disabled=offset===0;next.disabled=offset+20>=data.total;pager.replaceChildren(prev,el('span','',data.total+' 条 · 第 '+(offset/20+1)+' 页'),next);}catch(e){if(seq===current)rows.replaceChildren(el('div','error',e.message));}}
 toolbar.addEventListener('submit',e=>{e.preventDefault();offset=0;load();});collection.addEventListener('change',()=>{status.value='';offset=0;load();});list.append(toolbar,rows,pager);out.append(list);if(can('read'))out.append(retrievalSearch());
 if(can('write')){const capture=card('添加原始证据','原文不可变；这里不会自动调用模型或批准记忆。');capture.append(form([['content','资料正文','textarea'],...classifications()],'保存证据',async values=>{const result=await api('capture',values);await load();return result;}));const proposal=card('提出记忆候选','候选不是正式记忆。请检查来源，并交由审核者决定。');proposal.append(form([['key','记忆名称'],['kind','类型','text','fact',['preference','fact','episode','procedure','decision']],['statement','候选内容','textarea'],['evidence','来源路径（逗号分隔，可留空）','text','',null,true],...classifications(),['confidence','置信度 0–1','number',0.8],['explicit','用户明确要求记住','checkbox',false]],'创建候选',async values=>{const result=await api('propose',{...values,evidence:split(values.evidence)});await load();return result;}));const grid=el('div','grid');grid.append(capture,proposal);out.append(grid);}await load();return out;}
function versionPanel(label,version){const panel=el('section','version-panel');panel.append(el('h3','',label));if(!version){panel.append(el('p','muted','此页尚不存在'));return panel;}panel.append(el('p','meta muted','版本 v'+version.revision+' · '+version.status+' · '+version.scope+' / '+version.sensitivity),el('pre','',version.body),el('h4','','来源'),sourceList(version.evidence),el('h4','','适用条件'),textList(version.conditions,'未列明适用条件'),el('h4','','不确定性'),textList(version.uncertainty,'未列明不确定性'));return panel;}
function renderPlanPreview(target,data){const summary=el('div','review-summary');summary.append(el('strong','','本次涉及 '+data.pages.length+' 页'),el('p','','操作：'+({compile:'摄取资料',file:'保存查询成果',repair:'修订知识'}[data.kind]||data.kind)));target.append(summary);for(const item of data.pages){const details=el('details','plan-page');details.open=true;const operation={create:'新建',update:'更新',unchanged:'无变化'}[item.operation]||item.operation;details.append(el('summary','',operation+' · '+item.title+' · '+item.pageType),el('p','meta muted',item.key));const comparison=el('div','comparison');comparison.append(versionPanel('修改前',item.before),versionPanel('修改后',item.after));details.append(comparison);const changes=el('details');changes.append(el('summary','','正文差异 · 新增 '+item.diff.added+' 行 / 删除 '+item.diff.removed+' 行'));const diff=el('div','diff');diff.setAttribute('aria-label','正文逐行差异');for(const line of item.diff.lines){const prefix={added:'+ ',removed:'− ',context:'  ',omitted:'… '}[line.kind]||'';diff.append(el('div','diff-line '+line.kind,prefix+line.text));}changes.append(diff);if(item.diff.truncated)changes.append(el('p','muted','差异较长，部分行已省略；上方保留修改前后全文。'));details.append(changes);target.append(details);}const affected=el('details');affected.open=true;affected.append(el('summary','','受影响页面（'+data.affectedPageKeys.length+'）'),textList(data.affectedPageKeys,'没有受影响页面'));target.append(affected);}
async function showPlan(container,result){if(!result?.plan){container.append(pretty(result));return;}const plan=JSON.parse(JSON.stringify(result.plan)),epoch=session,preview=card('待审核变更计划','尚未写入正式知识。请逐页检查来源、内容与影响；版本变化后需要重新生成。'),content=el('div'),approval=el('div','actions');const raw=el('details');raw.append(el('summary','','完整签名计划'),pretty(plan));preview.append(content,raw,approval);container.append(preview);async function load(){content.replaceChildren(el('div','loading inline-loading','正在校验签名、权限与页面版本，并读取修改前后内容…'));content.setAttribute('aria-busy','true');approval.replaceChildren();try{const data=await api('preview',{plan});if(epoch!==session)return;content.replaceChildren();renderPlanPreview(content,data);if(can('review'))approval.append(actionButton('批准并应用此计划','apply',{plan},()=>{const dialog=preview.closest('dialog');if(dialog)dialog.close();}));else approval.append(el('p','','当前身份没有审核权限，不能应用计划。'));}catch(e){if(epoch!==session)return;content.replaceChildren(el('div','error',e.message),el('p','muted','预览校验未通过，暂时不能应用。页面可能已经变化，请核对后重新生成计划。'),button('重新校验此计划',load));}finally{content.removeAttribute('aria-busy');}}await load();}
function retrievalSearch(){const section=card('检索与匹配说明','搜索正式记忆和 Wiki 页面，查看系统实际使用的匹配分数。点击结果可查看当前版本与来源。');section.append(form([['query','要查找的内容','textarea']],'检索并查看说明',async(values,output)=>{const epoch=session;output.append(el('div','loading inline-loading','正在检索授权范围内的内容…'));let result;try{result=await api('explain',{query:values.query});}catch(e){if(epoch===session)output.replaceChildren(el('div','error',e.message));return;}if(epoch!==session)return;output.replaceChildren();const explanation=result.explanation,note=el('div','retrieval-note'),semanticLabel={disabled:'未启用',ready:'可用',degraded:'暂不可用，使用词法匹配'}[result.semanticStatus]||result.semanticStatus;note.append(el('strong','',explanation.strategy==='hybrid'?'词法与语义混合检索':'词法检索'),el('p','','语义检索状态：'+semanticLabel+' · '+(result.indexRebuilt?'本次已重建检索索引':'使用现有检索索引')));if(explanation.notes.length)note.append(textList(explanation.notes,''));output.append(note);if(!result.hits.length){output.append(empty('没有匹配结果。可换用页面标题、关键词或更具体的内容。'));return;}for(const hit of result.hits){const row=el('section','retrieval-hit');row.append(recordButton(hit),el('p','meta muted',hit.path));const signal=explanation.signals.find(value=>value.id===hit.id&&value.path===hit.path),scores=el('dl');[['综合分数',signal?signal.score:hit.score],['词法分数',signal?.lexicalScore],['语义分数',signal?.semanticScore]].forEach(([label,value])=>{const pair=el('div');pair.append(el('dt','',label),el('dd','',typeof value==='number'&&Number.isFinite(value)?String(value):'未参与'));scores.append(pair);});row.append(scores);output.append(row);}}));return section;}
async function wiki(){const catalog=await api('catalog'),out=el('div'),list=card('知识目录','页面保留来源、版本、关联与不确定性；点击打开原文。');if(!catalog.length)list.append(empty('知识目录为空。添加资料后，从下方生成摄取计划。'));catalog.forEach(row=>list.append(recordButton({...row,snippet:row.summary})));out.append(list);const grid=el('div','grid'),query=card('Query · 只读问答','使用实际读取的页面作答；不会自动保存答案。');query.append(form([['question','你的问题','textarea']],'查询 Wiki',async(values,output)=>{const result=await api('query',values);output.append(el('pre','',result.answer));const citations=el('div','actions');result.citations.forEach(c=>citations.append(button(c.key+' · v'+c.revision,()=>openDocument(c.id))));output.append(citations);if(result.uncertainty.length)output.append(el('p','','不确定性：'+result.uncertainty.join('；')));if(can('write')){const filing=el('details');filing.append(el('summary','','将此答案纳入知识（先生成计划）'),form([['title','保存标题'],['pageType','页面类型','text','query',['query','comparison']]],'生成保存计划',async(values,target)=>showPlan(target,await api('file',{...values,result}))));output.append(filing);}}));grid.append(query);if(can('write')){const ingest=card('Ingest · 摄取资料','输入证据 ID，编译为有来源的页面。需要配置 LLM 服务。');ingest.append(form([['evidenceIds','证据 ID（逗号分隔）','textarea']],'生成摄取计划',async(values,output)=>showPlan(output,await api('ingest',{evidenceIds:split(values.evidenceIds)}))));grid.append(ingest);}out.append(grid);if(can('maintain')){const lint=card('Lint · 检查与维护','结构检查不依赖模型。语义检查的建议不会自动生效。');lint.append(form([['semantic','同时执行语义检查（需模型）','checkbox',false]],'运行检查',async(values,output)=>{const result=await api('lint',values);output.append(pretty({...result,plans:undefined}));result.plans.forEach(plan=>showPlan(output,{plan}));}));out.append(lint);}return out;}
async function settings(){const [current,rules]=await Promise.all([api('settings'),api('rules')]),out=el('div'),general=card('运行策略','保存会写入 Git。若配置已被其他窗口修改，本次保存会被拒绝。维护调度参数供 maintenance / serve 使用；web 本身不会启动后台维护。');const values=current.values;
 const fields=[['name','Vault 名称','text',values.name],['residentBudget','常驻记忆条数（1–500）','number',values.residentBudget],['minimumConfidence','最低置信度（0–1）','number',values.minimumConfidence],['minimumProcedureEvidence','流程所需证据数（1–100）','number',values.minimumProcedureEvidence]];
 const labels={'index.maxDocuments':'索引最大文档数','index.lexicalWeight':'词法权重（0–1）','index.semanticWeight':'语义权重（0–1）','index.embeddingModel':'嵌入模型（留空使用默认）','maintenance.intervalMs':'维护间隔（毫秒）','maintenance.debounceMs':'维护防抖（毫秒）','maintenance.autoSync':'维护时自动同步（需 sync 权限）','limits.maxContentCharacters':'最大内容字符数','limits.maxQueryCharacters':'最大查询字符数','limits.maxResults':'最大结果数','limits.maxContextCharacters':'最大上下文字符数'};
 Object.entries(labels).forEach(([key,label])=>{const [a,b]=key.split('.'),value=values[a][b];fields.push([key,label,typeof value==='boolean'?'checkbox':typeof value==='number'?'number':'text',value,null,key==='index.embeddingModel']);});
 if(can('admin'))general.append(form(fields,'保存配置',async data=>{if(!confirm('确认保存运行配置？'))return;const next=JSON.parse(JSON.stringify(values));for(const [key,value]of Object.entries(data)){const parts=key.split('.');if(parts.length===1)next[key]=value;else next[parts[0]][parts[1]]=key==='index.embeddingModel'&&!value.trim()?null:value;}const result=await api('settings-save',{values:next,revision:current.revision,confirm:true});current.revision=result.revision;Object.assign(values,result.values);vaultName=result.values.name;app.querySelector('.topbar>span').textContent=vaultName;toast('配置已保存');return {commit:result.commit};}));else general.append(el('p','','当前身份仅可查看配置；保存需要 admin 权限。'),pretty(values));out.append(general);
 const rulecard=card('Wiki 目的与维护规则','规则按作用域和敏感级别隔离，并参与 Ingest / Query / Lint。相同分类的保存会更新对应规则。');rules.forEach(rule=>{const detail=el('details');detail.append(el('summary','',rule.meta.purpose+' · '+rule.meta.scope+' / '+rule.meta.sensitivity+' · v'+rule.meta.revision),el('pre','',rule.body));rulecard.append(detail);});
 if(can('maintain'))rulecard.append(form([['purpose','知识库目的','textarea'],['instructions','维护规则','textarea'],...classifications()],'保存此分类的规则',async data=>{const old=rules.find(rule=>rule.meta.scope===data.scope&&rule.meta.sensitivity===data.sensitivity&&!rule.meta.id.startsWith('builtin-'));if(!confirm('确认'+(old?'替换':'创建')+'此分类的 Wiki 规则？'))return;const result=await api('rules-save',{...data,expectedRevision:old?.meta.revision||0,confirm:true});toast('规则已保存');await navigate('settings');return result;}));out.append(rulecard);const security=card('身份与凭据','网页不读取或保存 API 密钥、主密钥、租户设置、加密策略或远端 URL。请在可信终端中配置 AMEM_* 环境变量，重启服务后生效。');security.append(pretty(principal));out.append(security);return out;}
async function operations(){const out=el('div'),grid=el('div','grid');if(can('maintain')){const health=card('Vault 健康检查','显式运行诊断；不会自动修复或删除数据。');health.append(form([],'运行诊断',()=>api('doctor')));const actions=el('div','actions');actions.append(actionButton('重建词法索引','reindex'),actionButton('恢复未完成事务','recover'));health.append(actions);grid.append(health);}if(can('sync')){const sync=card('Git 远端同步','状态读取不触发 fetch。同步会连接已配置的远端；推送需要单独选择。');sync.append(form([],'查看本地同步状态',()=>api('remote-status')));sync.append(actionButton('拉取并合并','sync',{push:false}),document.createTextNode(' '),actionButton('同步并推送','sync',{push:true}));grid.append(sync);}out.append(grid);const history=card('Git 操作历史','最近 30 次提交。受限身份看到的提交说明按核心权限策略脱敏。'),entries=await api('history');if(!entries.length)history.append(empty('暂无历史记录'));entries.forEach(entry=>{const row=el('div','history');row.append(el('strong','',entry.subject||entry.hash||'Commit'),el('p','',Object.entries(entry).filter(([k])=>k!=='subject').map(([k,v])=>k+': '+v).join(' · ')));history.append(row);});out.append(history);return out;}
login();
`;
