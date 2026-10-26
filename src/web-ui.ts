/** Self-contained assets: no CDN, build-time asset copying or executable document markup. */
import { experienceWebScript } from './web-experience-ui.js';
import { availabilityWebScript } from './web-availability-ui.js';
import { sharedWikiWebScript } from './web-shared-wiki-ui.js';

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
.sidebar nav button[data-page=jobs][aria-current=page] { background: #292044; border-color: #7560a8; }
.sidebar nav button[data-page=jobs][aria-current=page]::before { background: var(--violet); }
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
.job-board { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(265px, 1fr); gap: 20px; align-items: start; }
.job-row { padding: 22px 0; border-top: 1px solid var(--line); min-width: 0; }
.job-row h3 { margin: 0 0 8px; overflow-wrap: anywhere; font-family: var(--mono); font-size: 12px; }
.job-row .actions { margin-top: 14px; }
.job-row .meta { font-size: 12px; color: var(--muted); }
.job-status { display: inline-block; border-radius: 20px; border: 1px solid #536b93; padding: 3px 11px; font-size: 12px; color: #c9d8f4; }
.job-status.running { color: #d4bfff; background: #2a204a; border-color: #8164b7; }
.job-status.ready, .job-status.duplicate { color: #90f1d6; background: #112f32; border-color: #347a71; }
.job-status.failed, .job-status.cancelled { color: #ffc0ca; background: #351f2e; border-color: #8b4d60; }
.job-stages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; margin: 17px 0; }
.job-stages span { border-top: 2px solid #415371; padding-top: 9px; color: var(--muted); font-size: 11px; }
.job-stages span.current { border-color: var(--violet); color: #dccdff; }
.job-queue-note { border-left: 3px solid var(--violet); padding: 9px 15px; background: #211b39; border-radius: 0 6px 6px 0; }
.job-applied { color: #90f1d6; border: 1px solid #347a71; background: #112f32; padding: 16px; border-radius: 8px; overflow-wrap: anywhere; }
.job-submit .forms { grid-template-columns: minmax(0, 1fr); }
.job-submit .actions button { width: 100%; }
.time-summary { margin: 13px 0; padding: 13px 16px; border-left: 3px solid var(--mint); background: #0d252d; border-radius: 0 7px 7px 0; overflow-wrap: anywhere; }
.time-summary.ended, .time-summary.future { border-color: #d0a45d; background: #302820; }
.time-summary.unknown { border-color: #8195bd; background: #17243d; }
.time-summary strong { display: block; color: #dce8ff; font-size: 12px; margin: 0 0 5px; }
.time-summary p { margin: 4px 0; font: 11px/1.8 var(--mono); }
.record .time-summary p { display: block; overflow: visible; -webkit-line-clamp: unset; }
.time-query { border-top: 2px solid var(--mint); }
.time-query .forms { margin-bottom: 18px; }
.time-query input[type=datetime-local], .time-editor input[type=datetime-local] { font-variant-numeric: tabular-nums; min-width: 0; }
.time-query .query-context { margin-top: 16px; padding: 13px 16px; background: #142d3d; border: 1px solid #365c6d; border-radius: 7px; overflow-wrap: anywhere; }
.dated-record { padding: 19px 0; border-bottom: 1px solid var(--line); }
.dated-record .record { padding-top: 0; border-bottom: 0; }
.time-editor { margin-top: 22px; border-top: 1px solid var(--line); padding-top: 20px; }
.time-editor .review-summary { border-left-color: var(--mint); }
.merge-workbench [hidden] { display: none !important; }
.merge-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.merge-steps span { border-top: 2px solid var(--violet); padding: 12px 10px 0 0; color: #c9b9ef; font: 12px/1.7 var(--mono); }
.merge-steps span:last-child { border-color: var(--mint); color: #91e4d2; }
.merge-selection { border-left: 3px solid var(--violet); }
.merge-editor { border-top: 2px solid var(--accent); }
.merge-editor textarea[name=body] { min-height: 280px; font: 13px/1.9 var(--mono); }
.merge-feedback { margin: 16px 0; overflow-wrap: anywhere; }
.merge-workbench .comparison { margin-bottom: 20px; }
.merge-workbench .commit-reference { font: 11px/1.8 var(--mono); overflow-wrap: anywhere; color: var(--muted); }
.merge-selection .forms>label { min-width: 0; }
.merge-selection input[name=at], .merge-selection input[name=fromCommit] { font: 12px/1.8 var(--mono); }
.recorded-selection { border-left-color: var(--mint); }
.recorded-selection code { display: block; margin: 8px 0; font: 12px/1.8 var(--mono); color: var(--ink); }
@media (max-width: 1100px) { .job-board { grid-template-columns: minmax(0, 1fr); } }
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
  .merge-steps { gap: 8px; }
  .merge-steps span { font-size: 10px; }
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
.experience-intro { border-left: 3px solid var(--mint); }
.experience-workbench .merge-steps { flex-wrap: wrap; }
.experience-records { display: grid; gap: 12px; margin-top: 18px; }
.experience-record { min-width: 0; border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
.experience-record>code { display: block; color: var(--accent); margin-bottom: 9px; overflow-wrap: anywhere; }
.experience-record small { display: block; margin: 8px 0; }
.experience-case { min-width: 0; border: 1px solid var(--line); border-radius: 12px; padding: 18px; margin: 16px 0; }
.experience-case legend { color: var(--violet); font-family: var(--mono); padding: 0 8px; }
.experience-case label { display: block; margin: 12px 0; }
.experience-feedback { position: sticky; top: 12px; z-index: 1; background: var(--paper); border-radius: 12px; padding: 1px 14px; }
.availability-workbench .forms>label { min-width: 0; }
.availability-workbench .commit-reference { display: block; overflow-wrap: anywhere; font: 12px/1.8 var(--mono); margin: 10px 0; }
.shared-workbench .forms>label, .shared-workbench select { min-width: 0; }
.shared-workbench .commit-reference { display: block; overflow-wrap: anywhere; font: 12px/1.8 var(--mono); margin: 10px 0; }
.shared-source-details { margin: 20px 0 0; border-left: 3px solid var(--violet); padding-left: 16px; }
.shared-workbench h2, .shared-workbench h3 { overflow-wrap: anywhere; }

`;

export const webScript = String.raw`
'use strict';
${experienceWebScript}
${availabilityWebScript}
${sharedWikiWebScript}
const app = document.getElementById('app');
const notice = document.getElementById('notice');
let token = '', principal = null, vaultName = '', page = 'overview', generation = 0, session = 0, toastTimer, pageCleanup = () => {};
const requests = new Set();
const pages = [['overview','总览','Overview'],['records','记忆库','Memory library'],['review','审核队列','Review queue'],['wiki','LLM Wiki','Knowledge wiki'],['experiences','经验与技能','Experience and skills'],['availability','知识可用时间','Knowledge availability'],['sharedWiki','共享 Wiki','Shared Wiki'],['merges','知识合并','Merge review'],['jobs','编译任务','Compilation jobs'],['settings','配置','Configuration'],['operations','运维记录','Operations']];
const descriptions = {overview:'让每一条记忆有据可查，让知识持续生长。',records:'保存原始证据，浏览经过审核的长期记忆。原始资料不会被覆盖。',review:'让人决定方向。检查候选内容与来源，再将其纳入正式知识。',wiki:'摄取、查询、维护各司其职。所有写回都需要单独确认。',merges:'把历史与当前放在一起读。由你编辑，保留来源，再明确批准。',jobs:'编译进度加密保存在本机。执行、重试与批准，都由你明确决定。',settings:'调整知识管理策略。密钥、租户与身份仍由启动环境管理。',operations:'检查健康状态、查看 Git 历史，或明确发起维护与同步。'};
descriptions.experiences='从真实经历中整理步骤，独立验证，再明确导出。成功一次不等于可普遍复用。';
descriptions.availability='明确记录当前知识何时可读，再按时间重建有记录支持的版本。没有证据就保留未知。';
descriptions.sharedWiki='查看明确授权的本机及云端资料库，固定版本、保留来源，不自动复制或合并知识。';
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
async function api(operation,data={},signal){
 const controller=new AbortController(), epoch=session;requests.add(controller);
 const abort=()=>controller.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 try{const response=await fetch('/api/'+operation,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(data),signal:controller.signal,cache:'no-store'});
 const json=await response.json();if(epoch!==session)throw Error('会话已结束');if(controller.signal.aborted)throw Error('读取已停止');
 if(!response.ok){const code=json.error?.code||'REQUEST_FAILED';const hint=code==='AUTHORIZATION_DENIED'?'权限不足，或访问令牌已失效':code==='VALIDATION_FAILED'?'输入无效或数据版本已变化，请刷新后核对':code==='OPERATION_CANCELLED'?'操作已取消；请刷新确认状态后再操作':code==='DEPENDENCY_UNAVAILABLE'?'模型服务不可用，请检查启动环境的模型配置':code==='ENCRYPTION_KEY_UNAVAILABLE'?'未提供解密密钥，请检查启动环境':json.error?.message||code;
 throw Error(hint+' ['+code+']'+(json.error?.committed?'；已完成提交：'+JSON.stringify(json.error.committed):'')+(json.error?.completedValidation?'；已保存验证记录（请先核查，勿重复运行）：'+JSON.stringify(json.error.completedValidation):'')+(json.error?.completedAvailability?'；已保存观察（请先核查，勿重复提交）：'+JSON.stringify(json.error.completedAvailability):''));}return json.result;
 }finally{requests.delete(controller);signal?.removeEventListener('abort',abort);}
}
function logout(){session++;generation++;pageCleanup();pageCleanup=()=>{};for(const c of requests)c.abort();token='';principal=null;vaultName='';notice.textContent='';document.querySelectorAll('dialog').forEach(d=>d.remove());login();}
function brandLogo(){const image=el('img','brand-logo');image.src='/assets/logo.png';image.alt='';image.width=40;image.height=40;return image;}
function login(){app.replaceChildren();const box=el('main','login');const brand=el('div','brand');brand.append(brandLogo(),el('span','','MemoBranch'));const story=el('section','login-story');story.append(brand,el('div','section-number','LOCAL KNOWLEDGE WORKBENCH'),el('h1','','知识，留在你手中。'),el('p','','把对话变成有来源、可审核、可追溯的长期知识。'));const principles=el('div','login-principles');['Git 可追溯','来源可核验','本机优先'].forEach(text=>principles.append(el('span','',text)));story.append(principles);const access=el('section','login-access');access.append(el('div','section-number','SECURE LOCAL SESSION'),el('h2','','连接工作台'),el('p','','输入启动命令显示的访问令牌，连接本机记忆库。'));const form=el('form');const label=el('label','','访问令牌');const input=el('input');input.type='password';input.autocomplete='off';input.required=true;input.placeholder='粘贴终端中的 token';label.append(input);const submit=el('button','primary','连接工作台 →');submit.type='submit';const error=el('div');form.append(label,submit,error);form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;token=input.value.trim();input.value='';error.replaceChildren();try{const data=await api('session');principal=data.principal;vaultName=data.name;page='overview';shell();await navigate(page);}catch(e){token='';error.append(el('p','error',e.message));}finally{submit.disabled=false;}});access.append(form,el('small','','仅监听 127.0.0.1 · 令牌仅保存在当前页面内存 · 重启服务后失效'));box.append(story,access);app.append(box);input.focus();}
function shell(){app.replaceChildren();const layout=el('div','layout'),side=el('aside','sidebar'),brand=el('div','brand');brand.append(brandLogo(),el('span','','MemoBranch'));side.append(brand,el('div','eyebrow','YOUR KNOWLEDGE, BRANCHED.'));const nav=el('nav');nav.setAttribute('aria-label','主导航');pages.forEach(([key,title],i)=>{const b=button('',()=>navigate(key));b.dataset.page=key;b.append(el('span','nav-index',String(i+1).padStart(2,'0')),document.createTextNode(title));nav.append(b);});side.append(nav);const foot=el('footer');foot.append(el('div','eyebrow','OPERATOR'),el('div','',principal.name),button('断开连接',logout));side.append(foot);const work=el('div','workspace'),top=el('header','topbar');top.append(el('span','',vaultName));const online=el('span','online');online.append(el('span','dot'),document.createTextNode('本机连接 · Git 原生'));top.append(online);work.append(top,el('main','content'));layout.append(side,work);app.append(layout);}
async function navigate(key){pageCleanup();pageCleanup=()=>{};page=key;const current=++generation;document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===key)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});const main=app.querySelector('main.content');if(!main)return;main.replaceChildren(el('div','loading','正在读取授权范围内的数据…'));try{const content=await ({overview,records:()=>records('memories'),review:()=>records('candidates'),wiki,experiences,availability,sharedWiki,merges,jobs,settings,operations}[key])();if(current!==generation)return;const head=el('header','page-head'),left=el('div');left.append(el('div','section-number',pages.find(p=>p[0]===key)[2].toUpperCase()),el('h1','',pages.find(p=>p[0]===key)[1]),el('p','',descriptions[key]));head.append(left);main.replaceChildren(head,content);}catch(e){if(current!==generation)return;main.replaceChildren(el('div','error',e.message),button('重新读取',()=>navigate(key)));}}
function field(name,title,type='text',value='',options){const label=el('label','',title),input=el(type==='textarea'?'textarea':options?'select':'input');input.name=name;if(options){options.forEach(o=>{const option=el('option','',Array.isArray(o)?o[1]:o);option.value=Array.isArray(o)?o[0]:o;input.append(option);});}else if(type!=='textarea')input.type=type;if(type==='checkbox')input.checked=Boolean(value);else input.value=String(value??'');if(type==='number')input.step='any';if(type!=='checkbox')input.required=true;label.append(input);return {label,input};}
function form(fields,label,action){const wrapper=el('div'),f=el('form','forms');const inputs={};fields.forEach(spec=>{const [name,title,type='text',value='',options,optional=false]=spec;const item=field(name,title,type,value,options);if(type==='textarea')item.label.classList.add('wide');if(optional)item.input.required=false;inputs[name]=item.input;f.append(item.label);});const actions=el('div','actions wide'),submit=el('button','primary',label);submit.type='submit';actions.append(submit);const output=el('div','wide');f.append(actions);wrapper.append(f,output);f.addEventListener('submit',async e=>{e.preventDefault();e.stopPropagation();if(submit.disabled)return;const values={};for(const [key,input] of Object.entries(inputs))values[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;submit.disabled=true;submit.textContent='处理中…';output.replaceChildren();try{const result=await action(values,output);if(result!==undefined)output.append(pretty(result));}catch(e){output.append(el('div','error',e.message));}finally{submit.disabled=false;submit.textContent=label;}});return wrapper;}
function classifications(){const levels=['public','internal','sensitive','secret'].slice(0,['public','internal','sensitive','secret'].indexOf(principal.maxSensitivity)+1);return [['scope','作用域','text',principal.scopes[0],principal.scopes],['sensitivity','敏感级别','text',levels.includes('internal')?'internal':'public',levels]];}
async function overview(){const [memories,candidates,evidence,catalog]=await Promise.all([api('records',{collection:'memories',limit:1}),api('records',{collection:'candidates',status:'pending',limit:1}),api('records',{collection:'evidence',limit:1}),api('catalog')]);const out=el('div'),stats=el('div','stats');[['正式记忆',memories.total],['待审核',candidates.total],['原始证据',evidence.total],['Wiki 页面',catalog.length]].forEach(([label,value])=>{const s=el('div','stat');s.append(el('span','muted',label),el('strong','',value),el('small','','当前身份可见'));stats.append(s);});out.append(stats);const grid=el('div','grid'),hero=card('从资料到知识，保留每一步。','捕获不是记住。经过来源核验与审核，资料才成为可复用的知识。');hero.classList.add('hero');const flow=el('div','flow');['01 原始证据','→','02 候选 / 编译','→','03 正式知识'].forEach(t=>flow.append(el('span','',t)));hero.append(flow);grid.append(hero);const policy=card('你的访问边界','权限来自服务启动环境，网页无法提升权限。');principal.permissions.forEach(v=>policy.append(tag(v)));policy.append(el('p','', '作用域：'+principal.scopes.join(' / ')+' · 最高敏感级别：'+principal.maxSensitivity));grid.append(policy);out.append(grid);const recent=card('最近的知识页面','按授权目录展示，可从 LLM Wiki 打开全文与来源。');if(!catalog.length)recent.append(empty('还没有 Wiki 页面。先捕获证据，再创建摄取计划。'));catalog.slice(0,5).forEach(row=>recent.append(recordButton({id:row.id,title:row.title,snippet:row.summary,...row})));out.append(recent);return out;}
function recordButton(row,onChanged){const b=button('',()=>openDocument(row.id,onChanged));b.className='record';const line=el('div','row-head');line.append(el('strong','',row.title||row.key||row.id),el('small','',row.createdAt?stamp(row.createdAt):row.pageType||''));b.append(line);[row.status,row.scope,row.sensitivity].filter(Boolean).forEach(v=>b.append(tag(v)));if(row.type==='memory')b.append(memoryTime(row));if(row.snippet)b.append(el('p','',row.snippet));return b;}
function utcInput(value){return value?new Date(value).toISOString().slice(0,-1):'';}
function utcTimestamp(value){
 const match=String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
 if(!match)throw Error('请选择完整的 UTC 日期和时间，最多保留三位毫秒。');
 const normalized=match[1]+'T'+match[2]+':'+(match[3]||'00')+'.'+(match[4]||'').padEnd(3,'0')+'Z',date=new Date(normalized);
 if(!Number.isFinite(date.getTime())||date.toISOString()!==normalized)throw Error('日期不存在或时间无效，请重新选择。');
 return normalized;
}
function timeBound(value){return value||'未知（未标注）';}
function memoryTime(meta){
 const now=Date.now(),from=meta.validFrom,until=meta.validUntil;
 const state=until&&Date.parse(until)<=now?'ended':from&&Date.parse(from)>now?'future':!from&&!until?'unknown':'within';
 const box=el('div','time-summary '+state),labels={ended:'已结束 · 不进入当前回答',future:'尚未生效 · 不进入当前回答',unknown:'时间未知 · 未从保存时间推测',within:from&&until?'当前在标注区间内':'未超出已知界限 · 另一个端点未知'};
 box.append(el('strong','',labels[state]),el('p','','开始（包含）：'+timeBound(from)),el('p','','结束（不包含）：'+timeBound(until)));
 if(meta.status&&meta.status!=='active')box.append(el('p','','记录状态 '+meta.status+'；日期匹配不会恢复或批准这条记忆。'));
 return box;
}
function validityEditor(doc,live,signal,reload,onChanged,setSaving){
 const section=el('section','time-editor');section.append(el('h3','','审核记忆有效期'),el('p','','所有输入均为 UTC。留空表示未知，不是创建时间；清空已有端点会移除相应时间限制。只修改时间标注，不重新证明事实，也不安排未来替代。保存期间暂停读取和编辑；关闭窗口不能撤回已完成的提交。'));
 const wrapper=form([['validFrom','开始时间（UTC，包含）','datetime-local',utcInput(doc.meta.validFrom),null,true],['validUntil','结束时间（UTC，不包含）','datetime-local',utcInput(doc.meta.validUntil),null,true]],'核对并保存有效期',async(values,output)=>{
  if(!live()||!section.isConnected)return;
  const from=values.validFrom?utcTimestamp(values.validFrom):null,until=values.validUntil?utcTimestamp(values.validUntil):null;
  if(from&&until&&Date.parse(from)>=Date.parse(until))throw Error('开始时间必须早于结束时间；结束时刻不包含在区间内。');
  const comparison='当前版本 v'+doc.meta.revision+'\n原开始：'+timeBound(doc.meta.validFrom)+'\n原结束：'+timeBound(doc.meta.validUntil)+'\n新开始：'+timeBound(from)+'\n新结束：'+timeBound(until);
  output.append(el('pre','review-summary',comparison));
  if(!confirm('确认保存这条记忆的时间标注？将检查当前版本并可能写入 Git。\n清空端点会移除相应时间限制。\n\n'+comparison)||!live()||!section.isConnected)return;
  if(!setSaving(true))return;let result;
  try{result=await api('memory-validity',{id:doc.meta.id,validFrom:from,validUntil:until,expectedRevision:doc.meta.revision,confirm:true},signal);}
  catch(e){if(live()){wrapper.querySelector('form').remove();output.replaceChildren(el('div','error',e.message),el('p','muted','未自动重试。保存结果不明时，先查看当前版本及 Git 历史；重新读取后再决定是否修改。'),button('重新读取当前版本',reload));}return;}
  finally{setSaving(false);}
  if(!live())return;
  toast('有效期已保存 · v'+result.revision+(result.commit?' · '+result.commit.slice(0,8):' · 无内容变化'));
  await reload();
  if(onChanged&&live()){try{await onChanged();}catch{if(live())toast('有效期已保存，但列表刷新失败；请手动刷新列表。');}}
 });
 wrapper.querySelectorAll('input').forEach(input=>{if(input.type!=='datetime-local')return;input.step='0.001';const original=doc.meta[input.name];if(!original)return;
  let represented=false;try{represented=utcTimestamp(input.value)===new Date(original).toISOString();}catch{}
  if(!represented){input.type='text';input.value=utcInput(original);input.placeholder='YYYY-MM-DDTHH:mm:ss.sss';section.append(el('p','muted','此原始日期不受浏览器日历支持，已用 UTC 文本完整保留；不会自动清空。'));}
 });section.append(wrapper);return section;
}
function datedMemories(onChanged){
 const epoch=session,current=generation,section=card('按日期查看记忆','匹配审核者明确标注的生效区间；返回最新保留版本和最新标注，不是历史 Wiki，也不是“当时系统知道什么”。');section.classList.add('time-query');
 let closed=false,seq=0,criteria=null,controller=null,lastOffset=0;const live=()=>!closed&&epoch===session&&current===generation;
 const oldCleanup=pageCleanup;pageCleanup=()=>{oldCleanup();closed=true;seq++;controller?.abort();};
 const results=el('div'),pager=el('div','pager');results.setAttribute('aria-live','polite');
 async function load(offset=0){
  if(!criteria||!live())return;controller?.abort();controller=new AbortController();const request=++seq,data={...criteria,offset,limit:20};lastOffset=offset;
  results.replaceChildren(el('div','loading inline-loading','正在按指定日期读取授权记录…'));pager.replaceChildren();
  try{const result=await api('memories-at',data,controller.signal);if(!live()||request!==seq)return;
   results.replaceChildren(el('p','query-context','查询时刻（UTC）：'+result.at+' · 以下是本次读取的最新保留记录，打开详情会重新读取当前版本。'),el('p','muted','当前权限、来源访问、到期、撤销和删除限制仍然生效。日期匹配不表示事实已核实。'));
   if(!result.items.length)results.append(empty('此页没有符合条件的记录。完全未标日期的记录默认排除；可明确选择包含时间未知记录。'));
   for(const item of result.items){const row=el('section','dated-record');row.append(recordButton({...item,type:'memory',title:item.key},async()=>{await load(lastOffset);if(onChanged)await onChanged();}),el('p','meta muted','本次读取版本 v'+item.revision+' · 保存于 '+stamp(item.recordedAt)),el('pre','',item.body));
    if(item.status==='superseded'||item.status==='conflicted')row.append(el('p','error',item.status==='superseded'?'这条记录已被替代，仅作保留参考，不是当前断言。':'这条记录存在未解决冲突，不可直接当作已确认事实。'));
    row.append(el('h3','','来源'),sourceList(item.evidence));if(item.conditions?.length)row.append(el('h3','','适用条件'),textList(item.conditions,''));if(item.uncertainty?.length)row.append(el('h3','','时间与记录的不确定性'),textList(item.uncertainty,''));results.append(row);
   }
   const prev=button('上一页',()=>{if(request===seq)void load(Math.max(0,result.offset-result.limit));}),next=button('下一页',()=>{if(request===seq)void load(result.offset+result.limit);});prev.disabled=result.offset===0;next.disabled=result.offset+result.limit>=result.total;
   pager.replaceChildren(prev,el('span','',result.total+' 条 · 第 '+(Math.floor(result.offset/result.limit)+1)+' 页'),next);
  }catch(e){if(live()&&request===seq)results.replaceChildren(el('div','error',e.message),button('重新读取日期查询',()=>load(offset)));}
 }
 const query=form([['at','查询时刻（UTC）','datetime-local',utcInput(new Date().toISOString())],['key','记忆名称精确匹配（可留空）','text','',null,true],['includeUnknown','明确包含完全未标日期的记录（仍标为未知）','checkbox',false]],'按指定日期查询',async(values)=>{
  const at=utcTimestamp(values.at);if(!live())return;criteria={at,includeUnknown:values.includeUnknown,...(values.key.trim()?{key:values.key.trim()}:{})};await load(0);
 });
 query.querySelectorAll('input').forEach(input=>{if(input.type==='datetime-local')input.step='0.001';if(input.name==='key')input.maxLength=512;});
 const refresh=el('div','actions');refresh.append(button('刷新已提交的日期查询',()=>load(lastOffset)));section.append(query,refresh,results,pager);
 return {element:section,refresh:()=>load(lastOffset)};
}
function textList(values,fallback){if(!values?.length)return el('p','muted',fallback);const list=el('ul');values.forEach(value=>list.append(el('li','',value)));return list;}
function sourceList(values){if(!values?.length)return el('p','muted','未列明来源');const list=el('ul','source-list');values.forEach(value=>{const row=el('li'),match=String(value).match(/(?:^|\/|-)(ev-[a-f0-9]{12})(?:\.md)?$/);row.append(match?button(value,()=>openDocument(match[1])):el('span','',value));list.append(row);});return list;}
async function openDocument(id,onChanged){
 const epoch=session,controller=new AbortController(),dialog=el('dialog');dialog.setAttribute('aria-label','文档详情');const head=el('div','dialog-head'),body=el('div');head.append(el('h2','','文档详情'),button('关闭',()=>dialog.close()));dialog.append(head,body);document.body.append(dialog);
 let read=0,saving=false;const live=()=>epoch===session&&dialog.isConnected;dialog.addEventListener('close',()=>{controller.abort();dialog.remove();});dialog.showModal();
 function setSaving(value){if(value&&saving)return false;saving=value;if(live()){body.querySelectorAll('button').forEach(control=>{control.disabled=value;});body.querySelectorAll('input').forEach(control=>{control.disabled=value;});}return true;}
 async function load(){if(!live()||saving)return;const requested=++read;body.replaceChildren(el('div','loading','读取中…'));try{const doc=await api('get',{id},controller.signal);if(!live()||requested!==read)return;head.querySelector('h2').textContent=doc.meta.title||doc.meta.key||id;body.replaceChildren(el('div','meta muted',doc.path+(doc.meta.revision?' · 当前版本 v'+doc.meta.revision:'')));const badges=el('p');[doc.meta.type,doc.meta.status,doc.meta.scope,doc.meta.sensitivity].filter(Boolean).forEach(v=>badges.append(tag(v)));body.append(badges);
  if(doc.meta.type==='memory')body.append(memoryTime(doc.meta),el('p','muted','生效时间独立于保存时间，由审核者明确标注。此处时间状态按读取时的时钟显示；需要最新状态请重新读取。'));
  body.append(el('pre','',doc.body));if(Array.isArray(doc.meta.evidence)){body.append(el('h3','','来源'),sourceList(doc.meta.evidence));}if(doc.meta.conditions?.length)body.append(el('h3','','适用条件'),textList(doc.meta.conditions,''));if(doc.meta.uncertainty?.length)body.append(el('h3','','不确定性'),textList(doc.meta.uncertainty,''));const meta=el('details');meta.append(el('summary','','来源与元数据'),pretty(doc.meta));body.append(meta);
  const actions=el('div','actions');actions.append(button('重新读取当前版本',load));if(doc.meta.type==='memory-candidate'&&doc.meta.status==='pending'&&can('review')){actions.append(actionButton('批准纳入记忆','approve',{id},()=>dialog.close()));actions.append(reasonButton('拒绝候选','reject',id,()=>dialog.close()));}if(doc.meta.type==='memory'&&can('review')&&doc.meta.status!=='revoked')actions.append(reasonButton('撤回记忆','forget',id,()=>dialog.close()));if(doc.meta.type==='wiki-page'&&can('review')&&doc.meta.status!=='revoked')actions.append(reasonButton('撤回页面','revoke',doc.meta.key,()=>dialog.close()));body.append(actions);
  if(doc.meta.type==='memory'&&can('review')&&doc.meta.status!=='revoked')body.append(validityEditor(doc,live,controller.signal,load,onChanged,setSaving));
  if(doc.meta.type==='wiki-page'&&can('read')&&can('write'))body.append(correctionForm(doc.meta.key,doc.meta.revision));
 }catch(e){if(live()&&requested===read)body.replaceChildren(el('div','error',e.message),button('重新读取当前版本',load));}}
 await load();
}
function correctionForm(key,expectedRevision){const section=el('section','correction');section.append(el('h3','','纠正这页知识'),el('p','','说明哪里有误以及应如何修改。原话会先保存为不可变证据，再生成修订计划；审核后才更新页面。'));section.append(form([['instruction','纠正内容','textarea']],'保存纠正并生成计划',async(values,output)=>{const epoch=session;output.append(el('div','loading inline-loading','正在保存纠正原话并生成修订计划…'));let result;try{result=await api('correct',{key,instruction:values.instruction,expectedRevision});}catch(e){if(epoch===session){output.replaceChildren(el('div','error',e.message),el('p','muted','计划未能生成；纠正原话可能已经保存。请先查看原始证据，再决定是否重试。'));}return;}if(epoch!==session)return;output.replaceChildren(el('p','', '纠正原话已保存 · 证据 '+result.evidenceId));await showPlan(output,result);}));return section;}
function actionButton(label,operation,data={},after){const b=button(label,async()=>{if(!confirm(label+'？此操作可能写入 Git 历史。'))return;b.disabled=true;try{const result=await api(operation,{...data,confirm:true});toast('操作完成'+(result.commit?' · '+result.commit.slice(0,8):''));if(after)after();await navigate(page);}catch(e){toast(e.message);}finally{b.disabled=false;}});return b;}
function reasonButton(label,operation,id,after){const b=button(label,async()=>{const reason=prompt(label+'：请填写原因（将写入审计记录）');if(!reason?.trim())return;if(!confirm('确认'+label+'？历史记录仍会保留。'))return;b.disabled=true;try{await api(operation,{id,reason,confirm:true});toast('已完成'+label);if(after)after();await navigate(page);}catch(e){toast(e.message);}finally{b.disabled=false;}},'danger');return b;}
async function records(initial){const out=el('div'),list=card(),toolbar=el('form','toolbar'),collection=field('collection','集合','text',initial,[['memories','正式记忆'],['evidence','原始证据'],['candidates','候选记忆']]).input,query=el('input');query.placeholder='按内容或名称筛选';query.setAttribute('aria-label','筛选记忆');query.maxLength=200;const status=field('status','状态','text',initial==='candidates'?'pending':'',[['','全部状态'],['pending','待审核'],['promoted','已批准'],['rejected','已拒绝'],['active','已批准'],['conflicted','冲突'],['superseded','已替代'],['revoked','已撤回']]).input;collection.setAttribute('aria-label','集合');status.setAttribute('aria-label','状态');const search=el('button','','筛选');search.type='submit';toolbar.append(collection,query,status,search);const rows=el('div'),pager=el('div','pager');let offset=0,seq=0;
 async function load(){const current=++seq;rows.replaceChildren(el('div','loading','读取中…'));pager.replaceChildren();try{const data=await api('records',{collection:collection.value,query:query.value,status:status.value,offset,limit:20});if(seq!==current)return;rows.replaceChildren();if(!data.items.length)rows.append(empty('暂无符合条件的记录。可切换状态或添加原始证据。'));data.items.forEach(row=>rows.append(recordButton(row,async()=>{await load();await temporal?.refresh();})));const prev=button('上一页',()=>{offset=Math.max(0,offset-20);load();}),next=button('下一页',()=>{offset+=20;load();});prev.disabled=offset===0;next.disabled=offset+20>=data.total;pager.replaceChildren(prev,el('span','',data.total+' 条 · 第 '+(offset/20+1)+' 页'),next);}catch(e){if(seq===current)rows.replaceChildren(el('div','error',e.message));}}
 const temporal=initial==='memories'?datedMemories(load):null;
 toolbar.addEventListener('submit',e=>{e.preventDefault();offset=0;load();});collection.addEventListener('change',()=>{status.value='';offset=0;load();});list.append(toolbar,rows,pager);out.append(list);if(temporal)out.append(temporal.element);if(can('read'))out.append(retrievalSearch());
 if(can('write')){const capture=card('添加原始证据','原文不可变；这里不会自动调用模型或批准记忆。');capture.append(form([['content','资料正文','textarea'],...classifications()],'保存证据',async values=>{const result=await api('capture',values);await load();return result;}));const proposal=card('提出记忆候选','候选不是正式记忆。请检查来源，并交由审核者决定。');proposal.append(form([['key','记忆名称'],['kind','类型','text','fact',['preference','fact','episode','procedure','decision']],['statement','候选内容','textarea'],['evidence','来源路径（逗号分隔，可留空）','text','',null,true],...classifications(),['confidence','置信度 0–1','number',0.8],['explicit','用户明确要求记住','checkbox',false]],'创建候选',async values=>{const result=await api('propose',{...values,evidence:split(values.evidence)});await load();return result;}));const grid=el('div','grid');grid.append(capture,proposal);out.append(grid);}await load();return out;}
function versionPanel(label,version){const panel=el('section','version-panel');panel.append(el('h3','',label));if(!version){panel.append(el('p','muted','此页尚不存在'));return panel;}panel.append(el('p','meta muted','版本 v'+version.revision+' · '+version.status+' · '+version.scope+' / '+version.sensitivity),el('pre','',version.body),el('h4','','来源'),sourceList(version.evidence),el('h4','','适用条件'),textList(version.conditions,'未列明适用条件'),el('h4','','不确定性'),textList(version.uncertainty,'未列明不确定性'));return panel;}
function renderPlanPreview(target,data){const summary=el('div','review-summary');summary.append(el('strong','','本次涉及 '+data.pages.length+' 页'),el('p','','操作：'+({compile:'摄取资料',file:'保存查询成果',repair:'修订知识'}[data.kind]||data.kind)));target.append(summary);for(const item of data.pages){const details=el('details','plan-page');details.open=true;const operation={create:'新建',update:'更新',unchanged:'无变化'}[item.operation]||item.operation;details.append(el('summary','',operation+' · '+item.title+' · '+item.pageType),el('p','meta muted',item.key));const comparison=el('div','comparison');comparison.append(versionPanel('修改前',item.before),versionPanel('修改后',item.after));details.append(comparison);const changes=el('details');changes.append(el('summary','','正文差异 · 新增 '+item.diff.added+' 行 / 删除 '+item.diff.removed+' 行'));const diff=el('div','diff');diff.setAttribute('aria-label','正文逐行差异');for(const line of item.diff.lines){const prefix={added:'+ ',removed:'− ',context:'  ',omitted:'… '}[line.kind]||'';diff.append(el('div','diff-line '+line.kind,prefix+line.text));}changes.append(diff);if(item.diff.truncated)changes.append(el('p','muted','差异较长，部分行已省略；上方保留修改前后全文。'));details.append(changes);target.append(details);}const affected=el('details');affected.open=true;affected.append(el('summary','','受影响页面（'+data.affectedPageKeys.length+'）'),textList(data.affectedPageKeys,'没有受影响页面'));target.append(affected);}
async function showPlan(container,result){if(!result?.plan){container.append(pretty(result));return;}const plan=JSON.parse(JSON.stringify(result.plan)),epoch=session,preview=card('待审核变更计划','尚未写入正式知识。请逐页检查来源、内容与影响；版本变化后需要重新生成。'),content=el('div'),approval=el('div','actions');const raw=el('details');raw.append(el('summary','','完整签名计划'),pretty(plan));preview.append(content,raw,approval);container.append(preview);async function load(){content.replaceChildren(el('div','loading inline-loading','正在校验签名、权限与页面版本，并读取修改前后内容…'));content.setAttribute('aria-busy','true');approval.replaceChildren();try{const data=await api('preview',{plan});if(epoch!==session)return;content.replaceChildren();renderPlanPreview(content,data);if(can('review'))approval.append(actionButton('批准并应用此计划','apply',{plan},()=>{const dialog=preview.closest('dialog');if(dialog)dialog.close();}));else approval.append(el('p','','当前身份没有审核权限，不能应用计划。'));}catch(e){if(epoch!==session)return;content.replaceChildren(el('div','error',e.message),el('p','muted','预览校验未通过，暂时不能应用。页面可能已经变化，请核对后重新生成计划。'),button('重新校验此计划',load));}finally{content.removeAttribute('aria-busy');}}await load();}
function retrievalSearch(){const section=card('检索与匹配说明','搜索正式记忆和 Wiki 页面，查看系统实际使用的匹配分数。点击结果可查看当前版本与来源。');section.append(form([['query','要查找的内容','textarea']],'检索并查看说明',async(values,output)=>{const epoch=session;output.append(el('div','loading inline-loading','正在检索授权范围内的内容…'));let result;try{result=await api('explain',{query:values.query});}catch(e){if(epoch===session)output.replaceChildren(el('div','error',e.message));return;}if(epoch!==session)return;output.replaceChildren();const explanation=result.explanation,note=el('div','retrieval-note'),semanticLabel={disabled:'未启用',ready:'可用',degraded:'暂不可用，使用词法匹配'}[result.semanticStatus]||result.semanticStatus;note.append(el('strong','',explanation.strategy==='hybrid'?'词法与语义混合检索':'词法检索'),el('p','','语义检索状态：'+semanticLabel+' · '+(result.indexRebuilt?'本次已重建检索索引':'使用现有检索索引')));if(explanation.notes.length)note.append(textList(explanation.notes,''));output.append(note);if(!result.hits.length){output.append(empty('没有匹配结果。可换用页面标题、关键词或更具体的内容。'));return;}for(const hit of result.hits){const row=el('section','retrieval-hit');row.append(recordButton(hit),el('p','meta muted',hit.path));const signal=explanation.signals.find(value=>value.id===hit.id&&value.path===hit.path),scores=el('dl');[['综合分数',signal?signal.score:hit.score],['词法分数',signal?.lexicalScore],['语义分数',signal?.semanticScore]].forEach(([label,value])=>{const pair=el('div');pair.append(el('dt','',label),el('dd','',typeof value==='number'&&Number.isFinite(value)?String(value):'未参与'));scores.append(pair);});row.append(scores);output.append(row);}}));return section;}

async function merges(){
 const epoch=session,current=generation,out=el('div','merge-workbench');
 let closed=false,seq=0,active=null,phase='idle',loaded=null,proposal=null,uncertain=null,dirty=false,saved=false;
 const valid=()=>!closed&&epoch===session&&current===generation;
 const steps=el('div','merge-steps');['01 / 读取历史与当前','02 / 编辑并检查方案','03 / 单独批准'].forEach(text=>steps.append(el('span','',text)));out.append(steps);
 const selection=card('选择这次要比较的版本','仅限同一资料库。历史仍受当前权限、撤回、密钥和期限约束；不是 Git 分支合并。');selection.classList.add('merge-selection');
 const selector=el('form','forms'),key=field('pageKey','正式 Wiki 页面','text','',[]),mode=field('historySelector','历史版本选择方式','text','commit',[['commit','按完整提交编号'],['at','按 Git 记录时间']]),commit=field('fromCommit','完整历史提交编号'),at=field('at','记录时刻（ISO，必须带时区）');commit.input.maxLength=64;at.input.maxLength=64;
 commit.label.classList.add('wide');at.label.classList.add('wide');at.input.placeholder='2026-01-15T12:00:00+08:00';at.input.autocomplete='off';at.input.spellcheck=false;
 const dateHelp=el('p','muted wide','示例：2026-01-15T12:00:00+08:00 或 2026-01-15T04:00:00Z，最多三位毫秒。沿当前 HEAD 的第一父链，选择首个提交者时间不晚于此时刻的版本，最多检查 2000 条。Git 时间可被改写，不是事实生效时间或“当时已知内容”；不会按本机时区猜测。');dateHelp.id='wiki-recorded-time-help';at.input.setAttribute('aria-describedby',dateHelp.id);
 const sensitive=field('includeSensitive','明确读取敏感资料','checkbox',false),secret=field('includeSecret','明确读取机密资料','checkbox',false);
 const loadButton=el('button','primary','读取历史与当前');loadButton.type='submit';const loadActions=el('div','actions wide');loadActions.append(loadButton);
 selector.append(key.label,mode.label,commit.label,at.label,dateHelp,sensitive.label,secret.label,loadActions);selection.append(selector,el('p','muted','正文和草稿只在当前页面内存中保留；离开或断开会清除，不会自动保存。'));
 const feedback=el('div','merge-feedback'),resolution=el('div');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');selection.append(feedback,resolution);out.append(selection);
 const history=el('div'),editor=card('编辑要保留的知识','编辑区从当前正文开始，不包含自动生成的来源链接。请结合两侧资料修改；旧条件、冲突和更早期限不会因此消失。');editor.classList.add('merge-editor');editor.hidden=true;
 const draft=el('form','forms'),title=field('title','页面标题（可留空沿用）'),summary=field('summary','合并摘要'),body=field('body','合并正文（Markdown）','textarea');title.input.required=false;title.input.maxLength=300;summary.input.maxLength=2000;body.input.maxLength=100000;body.label.classList.add('wide');
 const prepare=el('button','primary','生成合并审核方案');prepare.type='submit';const prepareActions=el('div','actions wide');prepareActions.append(prepare);draft.append(title.label,summary.label,body.label,prepareActions);editor.append(draft);out.append(history,editor);
 const review=el('div'),approval=el('div','actions'),outcome=el('div');out.append(review,approval,outcome);
 function sync(){
  loadButton.disabled=phase!=='idle'||!key.input.value;prepare.disabled=phase!=='idle'||!loaded||!can('write')||saved;
  for(const input of [key.input,mode.input,title.input,summary.input,body.input])input.disabled=phase==='applying'||(saved&&[title.input,summary.input,body.input].includes(input));
  const dated=mode.input.value==='at';commit.label.hidden=dated;at.label.hidden=!dated;dateHelp.hidden=!dated;commit.input.required=!dated;at.input.required=dated;commit.input.disabled=phase==='applying'||dated;at.input.disabled=phase==='applying'||!dated;
  sensitive.input.disabled=phase==='applying'||!['sensitive','secret'].includes(principal.maxSensitivity);
  secret.input.disabled=phase==='applying'||principal.maxSensitivity!=='secret';
  loadButton.textContent=phase==='loading'?'正在读取…':'读取历史与当前';prepare.textContent=phase==='preparing'?'正在生成与校验…':'生成合并审核方案';
 }
 function invalidate(selectionChanged){
  if(!valid()||phase==='applying')return;
  seq++;active?.abort();active=null;phase='idle';proposal=null;uncertain=null;saved=false;review.replaceChildren();approval.replaceChildren();outcome.replaceChildren();
  if(selectionChanged){loaded=null;history.replaceChildren();resolution.replaceChildren();editor.hidden=!dirty||!can('write');feedback.textContent=dirty?'选择已变化。下方保留上一组版本的未保存草稿，可继续编辑或复制；重新读取会先确认重置，旧方案不能批准。':'选择已变化，请重新读取。';}
  else{dirty=true;feedback.textContent='草稿已变化，旧方案不能批准；请重新生成。';}sync();
 }
 mode.input.addEventListener('change',()=>invalidate(true));
 for(const input of [key.input,commit.input,at.input,sensitive.input,secret.input])input.addEventListener('input',()=>invalidate(true));
 for(const input of [title.input,summary.input,body.input])input.addEventListener('input',()=>invalidate(false));
 function begin(next){if(!valid()||phase!=='idle')return null;const turn=++seq;active=new AbortController();phase=next;sync();return {signal:active.signal,live:()=>valid()&&turn===seq};}
 function finish(attempt){if(attempt.live()){phase='idle';active=null;sync();}}
 function showResolution(base){
  resolution.replaceChildren();if(!base.selection)return;
  const info=base.selection,note=el('section','review-summary recorded-selection');note.setAttribute('aria-label','日期选择结果');note.append(el('strong','','日期已解析为实际提交'),el('p','','请求时刻（UTC）：'+info.at),el('p','','选中提交者时间：'+info.committedAt),el('code','',base.commit),el('p','','沿第一父链检查 '+info.scannedCommits+' 条；合并准备使用以上完整提交，不会再次按日期选择。'),el('p','','Git 时间可被改写，旧正文不是已核实的历史事实。当前权限、撤回、期限和密钥限制仍然有效。'));
  const warnings=el('details');warnings.append(el('summary','','读取限制与服务端提示'),textList(base.warnings,'未提供额外提示'));note.append(warnings);resolution.append(note);
 }
 function showComparison(base,target){
  const old=base.pages.find(page=>page.meta.type==='wiki-page'&&page.meta.key===key.input.value);if(!old)throw Error('历史正式页面不可用，请重新选择。');
  const comparison=card('历史与当前 · 完整正文','旧正文不是当前事实。两边的来源、条件和不确定性都需要人工核对。');
  comparison.append(el('p','commit-reference','历史提交 '+base.commit+' · 当前页 v'+target.meta.revision));
  const columns=el('div','comparison');columns.append(versionPanel('历史 · v'+old.meta.revision,{...old.meta,body:old.body}),versionPanel('当前 · v'+target.meta.revision,{...target.meta,body:target.body}));comparison.append(columns);
  comparison.append(el('p','muted','历史到期：'+timeBound(old.meta.expiresAt)+' · 当前到期：'+timeBound(target.meta.expiresAt)));
  const graph=el('details');graph.append(el('summary','','历史关联页面与条件（'+base.pages.length+'）'),pretty(base.pages));comparison.append(graph);history.replaceChildren(comparison);
 }
 selector.addEventListener('submit',async event=>{
  event.preventDefault();event.stopPropagation();if(!valid()||phase!=='idle')return;
  if(dirty&&!confirm('重新读取将重置当前编辑区。确认放弃未保存的草稿？'))return;
  const options={pageKeys:[key.input.value],includeSensitive:sensitive.input.checked,includeSecret:secret.input.checked};let values;
  if(mode.input.value==='at'){if(!at.input.value.trim()){feedback.replaceChildren(el('div','error','请输入带时区的 ISO 日期和时间。'));return;}values={...options,at:at.input.value.trim()};}
  else if(mode.input.value==='commit'){if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.input.value.trim())){feedback.replaceChildren(el('div','error','请输入完整的本地历史提交编号，可从运维记录查看。'));return;}values={...options,commit:commit.input.value.trim()};}
  else{feedback.replaceChildren(el('div','error','请选择有效的历史版本选择方式。'));return;}
  loaded=null;proposal=null;uncertain=null;history.replaceChildren();resolution.replaceChildren();review.replaceChildren();approval.replaceChildren();outcome.replaceChildren();editor.hidden=true;
  const attempt=begin('loading');if(!attempt)return;feedback.textContent='正在检查历史、当前权限与支持关系…';
  try{
   const base=await api('wiki-snapshot',values,attempt.signal);if(!attempt.live())return;
   const live=await api('wiki-snapshot',{...options,commit:base.authorityHead},attempt.signal);if(!attempt.live())return;
   const target=live.pages.find(page=>page.meta.type==='wiki-page'&&page.meta.key===values.pageKeys[0]);
   if(!target||base.authorityHead!==live.authorityHead||target.meta.revision!==target.currentRevision||base.pages.find(page=>page.meta.key===values.pageKeys[0])?.currentRevision!==target.meta.revision)throw Error('读取期间资料已变化，请重新读取历史与当前版本。');
   loaded={fromCommit:base.commit,pageKey:values.pageKeys[0],expectedRevision:target.meta.revision,includeSensitive:values.includeSensitive,includeSecret:values.includeSecret};
   showComparison(base,target);showResolution(base);title.input.value=target.meta.title;summary.input.value=target.meta.summary;body.input.value=target.body.split('<!-- MEMOBRANCH_WIKI_LINKS -->')[0].trim();dirty=false;saved=false;
   editor.hidden=!can('write');feedback.textContent=can('write')?'已读取。请编辑合并正文，再生成审核方案；尚未保存任何知识。':'已读取完整比较。当前身份没有写入权限，不能准备合并。';
  }catch(error){if(attempt.live())feedback.replaceChildren(el('div','error',error.message));}finally{finish(attempt);}
 });
 async function inspect(plan,attempt){
  proposal=null;approval.replaceChildren();const preview=await api('preview',{plan},attempt.signal);if(!attempt.live())return;
  review.replaceChildren();const header=card('待批准的人工合并','下列是这次签名方案的完整影响。原始证据不会被改写；批准是另一项操作。');renderPlanPreview(header,preview);
  const raw=el('details');raw.append(el('summary','','完整签名方案（包含明文，请勿随意分享）'),pretty(plan));header.append(raw);review.append(header);proposal=plan;
  if(can('review'))approval.append(button('批准并保存这次合并',()=>apply(plan),'primary'));
  else approval.append(el('p','muted','当前身份没有审核权限，不能批准。签名不授予额外权限。'));
 }
 draft.addEventListener('submit',async event=>{
  event.preventDefault();event.stopPropagation();if(!valid()||phase!=='idle'||!loaded||!can('write')||saved)return;
  if(!body.input.value.trim()||!summary.input.value.trim()){feedback.replaceChildren(el('div','error','请填写合并正文和摘要。'));return;}
  const values={...loaded,body:body.input.value,summary:summary.input.value,...(title.input.value.trim()?{title:title.input.value}:{} )};
  const attempt=begin('preparing');if(!attempt)return;proposal=null;uncertain=null;approval.replaceChildren();review.replaceChildren();outcome.replaceChildren();feedback.textContent='正在重新读取两边资料并检查合并影响，不调用模型…';
  try{const result=await api('merge-prepare',values,attempt.signal);if(!attempt.live())return;showComparison(result.comparison.base,result.comparison.current);await inspect(JSON.parse(JSON.stringify(result.plan)),attempt);if(attempt.live())feedback.textContent='方案已生成但未写入。请检查每个修改前后版本，再单独批准。';}
  catch(error){if(attempt.live()){proposal=null;approval.replaceChildren();review.replaceChildren();feedback.replaceChildren(el('div','error',error.message),el('p','muted','不能应用旧方案。请核对版本，必要时重新读取；编辑区尚未自动保存。'));}}finally{finish(attempt);}
 });
 async function apply(plan){
  if(!valid()||phase!=='idle'||proposal!==plan||!can('review'))return;
  if(!confirm('确认批准这次合并？历史提交 '+plan.merge.fromCommit+'。请先逐页核对正文与来源；这会写入 Git，关闭页面不能撤回已完成提交。'))return;
  const attempt=begin('applying');if(!attempt)return;let requested=false;outcome.replaceChildren();for(const control of approval.querySelectorAll('button'))control.disabled=true;
  try{
   // An uncertain successful application makes ordinary preview stale. Only an
   // explicit retry of the exact retained plan may use the core's replay check.
   if(uncertain!==plan)await api('preview',{plan},attempt.signal);if(!attempt.live())return;requested=true;
   const result=await api('apply',{plan,confirm:true},attempt.signal);if(!attempt.live())return;
   proposal=null;uncertain=null;loaded=null;dirty=false;saved=true;approval.replaceChildren();outcome.append(el('div','job-applied',result.commit?'合并已保存 · Git 提交 '+result.commit:'此签名方案已完成，本次没有新增提交。'));feedback.textContent='本次审核已完成。需要继续修改时，请重新读取当前版本。';
  }catch(error){if(attempt.live()){
   outcome.replaceChildren(el('div','error',error.message),el('p','muted',requested?'保存结果未确认。先检查运维记录；如需重试，仅重复提交原方案，勿盲目生成新方案。':'当前预览校验失败，不能批准。请重新读取并生成方案。'));
   if(!requested){proposal=null;approval.replaceChildren();}else{uncertain=plan;for(const control of approval.querySelectorAll('button'))control.textContent='重试原签名方案';}
  }}finally{if(attempt.live()){for(const control of approval.querySelectorAll('button'))control.disabled=false;}finish(attempt);}
 }
 pageCleanup=()=>{closed=true;seq++;active?.abort();active=null;loaded=null;proposal=null;uncertain=null;for(const input of [title.input,summary.input,body.input,commit.input,at.input])input.value='';out.replaceChildren();};
 const attempt=begin('loading');
 try{const catalog=await api('catalog',{},attempt.signal);if(attempt.live()){
  const entries=catalog.filter(page=>!page.key.startsWith('legacy:'));for(const page of entries){const option=el('option','',page.title+' · v'+page.revision);option.value=page.key;key.input.append(option);}
  if(entries.length)key.input.value=entries[0].key;else feedback.textContent='没有可合并的正式 Wiki 页面。请先摄取资料并审核页面。';
 }}catch(error){if(attempt.live())feedback.replaceChildren(el('div','error',error.message));}finally{finish(attempt);}
 return out;
}

const jobLabels={queued:'等待执行',running:'正在编译',ready:'计划待审核',duplicate:'已摄取，无需重编',failed:'执行失败',cancelled:'已取消'};
const jobReasons={'worker-interrupted':'执行进程已退出；需要明确重试','context-erased':'相关资料已删除，旧计划不可再用',deadline:'达到本次执行时限',cancelled:'已取消本次任务','compilation-failed':'编译或结果校验失败'};
async function jobs(){
 const epoch=session,current=generation,out=el('div'),lifetime=new AbortController(),dialogs=new Set();
 let closed=false,timer,inFlight=false,refreshAgain=false,rows=[],rendered='';const rowCache=new Map();
 const valid=()=>!closed&&epoch===session&&current===generation;
 const visible=()=>valid()&&!document.hidden;
 const stats=el('div','stats'),board=el('div','job-board'),list=card('本机编译记录','这里只显示当前身份可见的任务；编译完成不代表已批准。'),listing=el('div'),feedback=el('p','meta muted');
 feedback.setAttribute('role','status');
 const filter=field('job-status','任务状态','text','all',[['all','全部任务'],...Object.entries(jobLabels)]).input;
 filter.setAttribute('aria-label','筛选任务状态');
 const refreshButton=button('刷新状态',()=>refresh()),toolbar=el('div','toolbar');toolbar.append(filter,refreshButton);list.append(toolbar,feedback,listing);
 function close(){if(closed)return;closed=true;clearTimeout(timer);lifetime.abort();document.removeEventListener('visibilitychange',visibility);for(const dialog of dialogs)dialog.remove();dialogs.clear();}
 pageCleanup=close;
 function visibility(){clearTimeout(timer);if(visible())void refresh();}
 document.addEventListener('visibilitychange',visibility);
 function action(label,operation,job,message){
  const control=button(label,async()=>{if(control.disabled||!valid()||!confirm(message))return;control.disabled=true;
   try{const result=await api(operation,{id:job.id,confirm:true});if(!valid())return;
    toast(operation==='jobs-run'?'执行请求已接收；以任务状态为准':operation==='jobs-retry'?'已重新排队；点击执行才会调用模型':'任务操作已保存');await refresh();return result;
   }catch(e){if(valid())toast(e.message+'；请先刷新确认状态，再决定是否重试。');}
   finally{control.disabled=false;}
  },operation==='jobs-remove'?'danger':'');return control;
 }
 function render(){
  stats.replaceChildren();[['等待执行',rows.filter(r=>r.status==='queued').length],['正在执行',rows.filter(r=>r.status==='running').length],['计划待审核',rows.filter(r=>r.status==='ready').length],['失败 / 取消',rows.filter(r=>r.status==='failed'||r.status==='cancelled').length]].forEach(([label,count])=>{const item=el('div','stat');item.append(el('span','muted',label),el('strong','',count),el('small','','当前身份可见'));stats.append(item);});
  const selected=[...rows].reverse().filter(job=>filter.value==='all'||job.status===filter.value),fingerprint=JSON.stringify([filter.value,rows.length,selected]);
  if(fingerprint===rendered)return;rendered=fingerprint;
  const ids=new Set(selected.map(job=>job.id));for(const [id,cached]of rowCache){if(!ids.has(id)){cached.row.remove();rowCache.delete(id);}}
  if(!selected.length){listing.replaceChildren(empty(rows.length?'没有符合此状态的任务。':'还没有编译任务。提交已有证据编号后，再明确执行。'));return;}
  for(const child of [...listing.children])if(!child.classList.contains('job-row'))child.remove();
  for(const [index,job]of selected.entries()){
   const fingerprint=JSON.stringify(job),cached=rowCache.get(job.id);
   if(cached?.fingerprint===fingerprint){if(listing.children[index]!==cached.row)listing.insertBefore(cached.row,listing.children[index]||null);continue;}
   const row=el('article','job-row'),head=el('div','row-head');head.append(el('h3','',job.id),el('span','job-status '+job.status,jobLabels[job.status]||job.status));row.append(head);
   row.append(el('p','meta','尝试 '+job.attempts+' / 3 · 创建 '+stamp(job.createdAt)+' · 更新 '+stamp(job.updatedAt)));
   const stages=el('div','job-stages');stages.setAttribute('aria-label','真实编译阶段');
   const active=job.status==='ready'?3:job.status==='queued'?0:job.stage==='compiling'?1:job.stage==='validating'?2:-1;
   ['等待执行','模型编译','结果校验','等待审核'].forEach((label,index)=>stages.append(el('span',index===active?'current':'',label)));row.append(stages);
   if(job.cancelRequested&&job.status==='running')row.append(el('p','muted','取消请求已保存，等待执行进程停止…'));
   if(job.error)row.append(el('p','error',(jobReasons[job.error.reason]||'任务未完成')+' · '+job.error.code));
   const actions=el('div','actions');
   if(can('write')){
    if(job.status==='queued')actions.append(action('执行一次','jobs-run',job,'确认调用模型编译这个任务？关闭网页不会停止已接收的执行；不会自动批准知识。'));
    if(['queued','running','ready'].includes(job.status)&&!job.cancelRequested)actions.append(action('取消任务','jobs-cancel',job,'确认取消这个任务并使其保留计划不可再用？已单独授权的应用操作不由此撤回。'));
    if(['failed','cancelled'].includes(job.status)&&job.attempts<3)actions.append(action('重新排队','jobs-retry',job,'确认重新排队？不会自动执行；再次执行可能重复产生模型费用。'));
    if(job.status!=='running')actions.append(action('删除任务','jobs-remove',job,'确认永久删除这个任务及计划密钥？正式 Wiki 页面和原始证据不受影响。'));
   }
   if(job.status==='ready')actions.append(button('查看变更与审核',()=>review(job.id),'primary'));
   row.append(actions);if(cached)cached.row.remove();listing.insertBefore(row,listing.children[index]||null);rowCache.set(job.id,{fingerprint,row});
  }
 }
 async function refresh(){
  if(!visible())return;if(inFlight){refreshAgain=true;return;}clearTimeout(timer);inFlight=true;refreshButton.disabled=true;feedback.textContent='正在读取已保存状态…';
  try{const result=await api('jobs-list',{},lifetime.signal);if(!visible())return;rows=result;render();feedback.textContent='状态已更新 · '+rows.length+' / 100 个保留任务';}
  catch(e){if(visible()){rendered='';feedback.textContent='状态读取失败';listing.replaceChildren(el('div','error',e.message),button('重新读取任务',()=>refresh()));}}
  finally{inFlight=false;refreshButton.disabled=false;if(visible()){timer=setTimeout(()=>{if(out.isConnected)void refresh();else close();},refreshAgain?1000:2000);refreshAgain=false;}}
 }
 async function review(id){
  if(!valid())return;const dialog=el('dialog'),head=el('div','dialog-head'),content=el('div'),approval=el('div','actions'),controller=new AbortController();
  dialog.setAttribute('aria-label','审核编译任务');head.append(el('h2','','审核编译任务'),button('关闭',()=>dialog.close()));dialog.append(head,el('p','meta muted',id),content,approval);document.body.append(dialog);dialogs.add(dialog);
  dialog.addEventListener('close',()=>{controller.abort();dialogs.delete(dialog);dialog.remove();});dialog.showModal();
  const live=()=>valid()&&dialog.isConnected;
  async function load(){
   approval.replaceChildren();content.replaceChildren(el('div','loading inline-loading','正在重新校验任务计划、来源和页面版本…'));
   try{const data=await api('jobs-review',{id},controller.signal);if(!live())return;content.replaceChildren();renderPlanPreview(content,data.preview);
    const raw=el('details');raw.append(el('summary','','完整签名计划'),pretty(data.plan));content.append(raw);
    if(!can('review')){approval.append(el('p','','当前身份没有审核权限，不能应用计划。'));return;}
    const apply=button('批准并应用此任务计划',async()=>{
     if(apply.disabled||!live()||!confirm('确认应用刚才预览的这个签名计划？将写入正式 Wiki 和 Git 历史。'))return;apply.disabled=true;
     try{const result=await api('jobs-apply',{id,proof:data.plan.proof,confirm:true},controller.signal);if(!live())return;
      content.replaceChildren(el('p','job-applied','本次批准已完成 · 提交 '+(result.commit||'无内容变化')));approval.replaceChildren();toast('已明确批准并应用计划');await refresh();
     }catch(e){if(live())approval.replaceChildren(el('p','error',e.message+'；未确认的结果请先检查历史，勿重复批准。'),button('重新预览当前计划',load));}
    },'primary');approval.append(apply);
   }catch(e){if(live()){content.replaceChildren(el('div','error',e.message),el('p','muted','预览无效或任务已变化。请重新核对状态，不能直接批准。'));approval.append(button('重新预览当前计划',load));}}
  }
  await load();
 }
 filter.addEventListener('change',render);board.append(list);
 if(can('write')){const submit=card('提交编译任务','选择已有证据；这里不会抓取新网址、自动执行或批准知识。');submit.classList.add('job-submit');
  submit.append(form([['evidenceIds','证据编号（1–40 个，逗号或换行分隔）','textarea'],['maxPages','最多读取页面（1–40）','number',20]],'保存为待执行任务',async(values,output)=>{
   if(!valid()||!confirm('确认加密保存这个编译任务？保存后仍需点击执行。'))return;
   const ids=split(values.evidenceIds);if(!ids.length||ids.length>40||new Set(ids).size!==ids.length||ids.some(id=>!/^ev-[a-f0-9]{12,64}$/.test(id))||!Number.isInteger(values.maxPages)||values.maxPages<1||values.maxPages>40)throw Error('请填写 1–40 个不同的证据编号，页面上限为 1–40 的整数。');
   let result;try{result=await api('jobs-enqueue',{evidenceIds:ids,maxPages:values.maxPages,confirm:true});}catch(e){if(valid())output.append(el('p','muted','保存结果未确认；请刷新任务列表后再决定是否重复提交。'));throw e;}
   if(!valid())return;output.append(el('p','', '已保存，尚未执行 · '+result.id));toast('任务已保存；尚未调用模型');await refresh();
  }));submit.append(el('p','muted','需要启动环境中的 AMEM_MASTER_KEY 和模型配置。重试最多三次，不保证模型费用只产生一次。'));board.append(submit);
 }else board.append(card('只读任务视图','可查看当前身份的任务和计划；执行、取消、重试和删除需要 write 权限，批准需要 review 权限。'));
 out.append(el('p','job-queue-note','排队不会自动执行。点击“执行一次”，或另行启动终端 worker；离开此页只停止刷新，不停止已接收的执行。'),stats,board);await refresh();return out;
}
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
