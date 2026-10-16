// Reproduction harness for the "إدارة الأطراف popup jumps/moves" bug.
// Samples the popup geometry over time and after each interaction.
import { launch, connect, evaluate, shot, cleanup } from "./cdp.mjs";
const BASE = process.env.BASE_URL || "http://127.0.0.1:5195";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MASTER = { email: "m@zunion.local", username: "mahmoud", fullName: "Mahmoud", role: "Master", expiresAt: new Date(Date.now() + 86400000).toISOString(), loggedInAt: new Date().toISOString(), mustChangePassword: false };
const SEED = `(()=>{try{if(!localStorage.getItem('zunion-local-session'))localStorage.setItem('zunion-local-session',JSON.stringify(${JSON.stringify(MASTER)}));sessionStorage.setItem('__zpparties',JSON.stringify([{id:'p1',name:'أحمد',position:1,active:true},{id:'p2',name:'حسن',position:2,active:true},{id:'p3',name:'خليفة',position:3,active:true},{id:'p4',name:'أخرى',position:4,active:true}]));window.__zerr=[];window.addEventListener('error',e=>window.__zerr.push(String(e.message||e.error)));const json=(b,s)=>new Response(JSON.stringify(b),{status:s||200,headers:{'Content-Type':'application/json'}});const o=window.fetch.bind(window);window.fetch=(i,init)=>{const u=typeof i==='string'?i:(i&&i.url)||'';const m=((init&&init.method)||'GET').toUpperCase();const idM=u.match(/\\/api\\/parties\\/([^/?]+)/);if(u.indexOf('/api/parties')!==-1){const store=JSON.parse(sessionStorage.getItem('__zpparties'));if(m==='GET')return Promise.resolve(json({parties:store}));if(m==='POST'){let b={};try{b=JSON.parse(init.body);}catch{}const p={id:'p'+Date.now(),name:String(b.name||'').trim(),position:store.length+1,active:true};sessionStorage.setItem('__zpparties',JSON.stringify([...store,p]));return Promise.resolve(json({party:p}));}if(m==='PATCH'&&idM){const id=decodeURIComponent(idM[1]);let b={};try{b=JSON.parse(init.body);}catch{}const nx=store.map(x=>x.id===id?{...x,...b}:x);sessionStorage.setItem('__zpparties',JSON.stringify(nx));return Promise.resolve(json({party:nx.find(x=>x.id===id)}));}}if(u.indexOf('/api/')!==-1)return Promise.resolve(json({message:'m'},503));return o(i,init);};}catch(e){}})();`;
const H = `const setVal=(el,v)=>{const p=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};`;

const { child, target } = await launch();
const cdp = await connect(target.webSocketDebuggerUrl);
const rect = () => evaluate(cdp, `(()=>{const m=document.querySelector('.party-modal');if(!m)return null;const r=m.getBoundingClientRect();return {l:Math.round(r.left),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};})()`);
const log = (label, r) => console.log(`${label.padEnd(34)} ${r ? `L=${r.l} T=${r.t} W=${r.w} H=${r.h}` : "null"}`);

try {
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await cdp.send("Page.navigate", { url: BASE }); await sleep(3500);
  await evaluate(cdp, `window.location.hash='#/new'`); await sleep(1600);

  // open popup (sample rapidly to catch any open-jump)
  await evaluate(cdp, `(()=>{${H}const s=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('طرف')&&x.querySelector('select')).querySelector('select');setVal(s,'أخرى');})()`);
  const openSamples = [];
  for (let i = 0; i < 40; i++) { openSamples.push(await rect()); await sleep(16); }
  const oL = openSamples.filter(Boolean).map((s) => s.l), oT = openSamples.filter(Boolean).map((s) => s.t);
  console.log(`open-settle left range: ${Math.min(...oL)}..${Math.max(...oL)}  top range: ${Math.min(...oT)}..${Math.max(...oT)}  (frames=${openSamples.filter(Boolean).length})`);
  log("after open", await rect());

  console.log("\n-- idle drift (sampling 30x50ms, no interaction) --");
  const samples = [];
  for (let i = 0; i < 30; i++) { samples.push(await rect()); await sleep(50); }
  const Ls = samples.map((s) => s && s.l), Ts = samples.map((s) => s && s.t);
  console.log(`idle left range: ${Math.min(...Ls)}..${Math.max(...Ls)}  top range: ${Math.min(...Ts)}..${Math.max(...Ts)}`);

  console.log("\n-- styles --");
  const cs = await evaluate(cdp, `(()=>{const m=document.querySelector('.party-modal');const h=document.querySelector('.party-modal-head');const o=document.querySelector('.party-modal-overlay');const g=(e)=>{const c=getComputedStyle(e);return{transform:c.transform,transition:c.transitionProperty+' '+c.transitionDuration,animation:c.animationName+' '+c.animationDuration,position:c.position,willChange:c.willChange};};return{modal:g(m),head:g(h),overlay:g(o)};})()`);
  console.log(JSON.stringify(cs, null, 1));

  console.log("\n-- single mouse move over page (no button) --");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 400, y: 400 });
  await sleep(200);
  log("after stray mousemove", await rect());

  console.log("\n-- type in the add-name field --");
  await evaluate(cdp, `(()=>{${H}setVal(document.querySelector('.party-manager-toolbar input'),'اختبار');})()`);
  await sleep(400); log("after typing", await rect());

  console.log("\n-- click إضافة طرف --");
  await evaluate(cdp, `document.querySelector('.party-manager-toolbar button').click()`);
  await sleep(900); log("after add", await rect());

  console.log("\n-- start edit then cancel --");
  await evaluate(cdp, `(()=>{[...document.querySelector('.party-manager-table tbody tr').querySelectorAll('button')].find(b=>b.textContent.includes('تعديل')).click();})()`);
  await sleep(400); log("after edit start", await rect());
  await evaluate(cdp, `(()=>{[...document.querySelector('.party-manager-table tbody tr').querySelectorAll('button')].find(b=>b.textContent.includes('إلغاء')).click();})()`);
  await sleep(400); log("after cancel", await rect());

  console.log("\n-- scroll the list --");
  await evaluate(cdp, `document.querySelector('.party-manager').scrollTop=9999`);
  await sleep(200); log("after scroll", await rect());

  console.log("\n-- real drag from empty header area, release, then move mouse far --");
  const pt = await evaluate(cdp, `(()=>{const r=document.querySelector('.party-modal-head').getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x + i * 20, y: pt.y + i * 8, button: "left", buttons: 1 }); await sleep(20); }
  const during = await rect(); log("during drag", during);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x + 160, y: pt.y + 64, button: "left", clickCount: 1, buttons: 0 });
  await sleep(200); const released = await rect(); log("after release", released);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1500, y: 900 });
  await sleep(200); log("after post-release move", await rect());
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 100 });
  await sleep(200); log("after post-release move 2", await rect());

  console.log("\n-- duplicate-name validation notice (adds a notice, must not move) --");
  await evaluate(cdp, `(()=>{${H}const inp=document.querySelector('.party-manager-toolbar input');const existing=document.querySelector('.party-manager-name').textContent.trim();setVal(inp,existing);document.querySelector('.party-manager-toolbar button').click();})()`);
  await sleep(700); log("after duplicate (validation)", await rect());

  console.log("\n-- right-button drag must NOT move --");
  const rp = await evaluate(cdp, `(()=>{const r=document.querySelector('.party-modal-head').getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  const beforeR = await rect();
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rp.x, y: rp.y, button: "right", clickCount: 1, buttons: 2 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rp.x + 150, y: rp.y + 90, button: "right", buttons: 2 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rp.x + 150, y: rp.y + 90, button: "right", clickCount: 1, buttons: 0 });
  await sleep(200); log("after right-button drag", await rect());
  console.log(`right-button moved? ${JSON.stringify(beforeR)} -> ${JSON.stringify(await rect())}`);

  console.log("\n-- close then reopen (must not jump) --");
  await evaluate(cdp, `document.querySelector('.party-modal-close').click()`);
  await sleep(500); log("after close", await rect());
  await evaluate(cdp, `(()=>{${H}const s=[...document.querySelectorAll('label')].find(x=>x.textContent.includes('طرف')&&x.querySelector('select')).querySelector('select');setVal(s,'أخرى');})()`);
  const reSamples = [];
  for (let i = 0; i < 30; i++) { reSamples.push(await rect()); await sleep(30); }
  const rL = reSamples.filter(Boolean).map((s) => s.l), rT = reSamples.filter(Boolean).map((s) => s.t);
  console.log(`reopen-settle left range: ${Math.min(...rL)}..${Math.max(...rL)}  top range: ${Math.min(...rT)}..${Math.max(...rT)}`);

  await shot(cdp, `${process.env.TEMP}\\zunion-shots\\repro-popup.png`);
  console.log("\nconsole errors:", JSON.stringify(await evaluate(cdp, `window.__zerr`)));
} finally {
  try { cdp.close(); } catch {}
  cleanup(child);
  process.exit(0);
}
