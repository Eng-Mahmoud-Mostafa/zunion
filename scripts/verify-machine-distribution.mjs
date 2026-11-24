import assert from 'node:assert/strict';import {createServer} from 'node:http';import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createRequire} from 'node:module';import {launch,connect,evaluate,cleanup,shot} from './cdp.mjs';
const require=createRequire(import.meta.url);const {build}=require('../backend/node_modules/esbuild');
const rows=[['a','00071','operation'],['b','00072','operation'],['old','00070','finishing']].map(([id,n,stage])=>({id,order_number:n,type:'تطريز',work_stage:stage,status:stage==='finishing'?'WORKER_DONE':'SENT_TO_WORKER',draft:false,customer_name_snapshot:'عميل الاختبار',phone_snapshot:'01000000000',source_party:'الطرف',quantity:10,delivery_date:'2026-11-30',created_at:'2026-11-24T10:00:00Z'}));
let assignments=[{id:'old-assignment',order_id:'old',machine_name:'مكنة 1',position:1}],completions=[],writes=0;
const active=()=>rows.filter(o=>o.work_stage==='operation'&&o.status!=='WORKER_DONE');
const snapshot=()=>({orders:active(),assignments:assignments.filter(a=>active().some(o=>o.id===a.order_id)).sort((a,b)=>a.position-b.position)});
const machines=[{id:'m1',name:'مكنة 1',active:true,position:1},{id:'m2',name:'مكنة 2',active:true,position:2}];
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {MachineDistributionPage,OrdersPage,useOrders} from './src/App';localStorage.setItem('zunion-local-orders-v2','[]');const session={role:'Master',username:'test',email:'test@local'};function Fixture(){const {orders,setOrdersLocal}=useOrders(session);window.latest=orders;const board=<MachineDistributionPage orders={orders} session={session} machines={${JSON.stringify(machines)}}/>;if(new URLSearchParams(location.search).get('view')==='board')return board;return <><div id="operation"><OrdersPage orders={orders} setOrders={setOrdersLocal} session={session} queue="worker" machines={${JSON.stringify(machines)}}/></div><div id="board">{board}</div><div id="finishing"><OrdersPage orders={orders} setOrders={setOrdersLocal} session={session} queue="finish"/></div></>;}createRoot(document.getElementById('root')).render(<Fixture/>);`;
const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',loader:{'.png':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'test-exports',setup(b){b.onLoad({filter:/src[\\/]App\.tsx$/},args=>({contents:readFileSync(args.path,'utf8')+'\nexport {MachineDistributionPage,OrdersPage,useOrders};',loader:'tsx'}));}}]});
const css=readFileSync('dist/assets/'+readdirSync('dist/assets').find(f=>f.endsWith('.css')),'utf8');
const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');if(url.pathname.startsWith('/api/')){
 let body={};if(!['GET','HEAD'].includes(req.method)){let text='';for await(const part of req)text+=part;body=JSON.parse(text||'{}');}
 if(url.pathname==='/api/machine-assignments'){if(req.method==='POST'){assert.ok(active().some(o=>o.id===body.order_id));if(assignments.some(a=>active().some(o=>o.id===a.order_id)&&a.machine_name===body.machine_name&&a.position===body.position)){res.statusCode=409;res.end(JSON.stringify({message:'هذا الموقع أصبح مشغولاً. اختر خانة إضافة أخرى ثم أعد الحفظ.'}));return;}assert.ok(!assignments.some(a=>a.order_id===body.order_id));const a={id:'assignment-'+body.order_id,...body};assignments.push(a);writes++;res.end(JSON.stringify({assignment:a}));return;}res.end(JSON.stringify(snapshot()));return;}
 if(url.pathname==='/api/orders/a/status'||url.pathname==='/api/orders/b/status'){const id=url.pathname.split('/')[3];const row=rows.find(o=>o.id===id);row.status=body.status;row.work_stage='finishing';completions.push({order_id:id,completed_at:new Date().toISOString(),worker_name:'عامل',snapshot:{order_number:row.order_number,customer_name_snapshot:row.customer_name_snapshot}});writes++;res.end('{"ok":true}');return;}
 if(url.pathname.endsWith('/archive')){res.end(JSON.stringify({completions}));return;}
 if(url.pathname==='/api/production/embroidery/queue'){res.end(JSON.stringify({orders:active(),revision:0}));return;}
 if(url.pathname==='/api/orders'){res.end(JSON.stringify({orders:url.searchParams.get('workStage')==='finishing'?rows.filter(o=>o.work_stage==='finishing'):rows}));return;}
 if(url.pathname==='/api/workers'){res.end('{"workers":[]}');return;}if(url.pathname==='/api/users'){res.end('{"users":[]}');return;}
 res.end(JSON.stringify({orders:rows}));return;}
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}res.setHeader('Content-Type','text/html');res.end(`<html dir="rtl"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let child,cdp,second;
try{
 let target;({child,target}=await launch());cdp=await connect(target.webSocketDebuggerUrl);const page=e=>evaluate(cdp,e);
 const wait=async(e,client=cdp)=>{for(let i=0;i<120;i++){if(await evaluate(client,e))return;await new Promise(r=>setTimeout(r,100));}throw Error('timeout '+e);};
 await cdp.send('Page.navigate',{url:base});await wait('document.querySelectorAll("#operation [data-order-row-id]").length===2');await wait('!!document.querySelector("#board .md-cell-empty")');
 assert.equal(await page('!!document.querySelector("[data-assignment-order-id=old]")'),false);
 await page('document.querySelector("#board .md-cell-empty").click()');await wait('!!document.querySelector(".md-search-hit")');assert.equal(await page('document.querySelectorAll(".md-search-hit").length'),2);assert.equal(await page('document.querySelector(".md-search-list").textContent.includes("00070")'),false);
 await page('Array.from(document.querySelectorAll(".md-search-hit")).find(b=>b.textContent.includes("00071")).click()');await page('document.querySelector(".md-modal-actions .md-btn-primary").click()');await wait('!!document.querySelector("#board [data-assignment-order-id=a]")');assert.equal(writes,1);
 await page('document.querySelector("#board .md-cell-empty").click()');await wait('!!document.querySelector(".md-search-hit")');assert.equal(await page('document.querySelectorAll(".md-search-hit").length'),1);assert.equal(await page('document.querySelector(".md-search-list").textContent.includes("00071")'),false);await page('document.querySelector(".md-modal-close").click()');
 // Another browser window on the same origin receives BroadcastChannel events.
 const newTarget=await cdp.send('Target.createTarget',{url:base+'/?view=board'});const targets=await(await fetch('http://127.0.0.1:9333/json/list')).json();second=await connect(targets.find(t=>t.id===newTarget.targetId).webSocketDebuggerUrl);await wait('!!document.querySelector("[data-assignment-order-id=a]")',second);
 await page('Array.from(document.querySelectorAll("#operation [data-order-row-id=a] button")).find(b=>b.textContent.trim()==="إنهاء").click()');
 await wait('!document.querySelector("#operation [data-order-row-id=a]")');await wait('!document.querySelector("#board [data-assignment-order-id=a]")');await wait('!document.querySelector("[data-assignment-order-id=a]")',second);await wait('document.querySelector("#finishing").textContent.includes("00071")');await wait('window.latest.find(o=>o.id==="a")?.workStage==="finishing"');
 assert.equal(await page('document.querySelector(".ws-toast").textContent'),'تم إنهاء التشغيل وتحويل الأوردر إلى التشطيب بنجاح');assert.equal(await page('location.pathname'),'/');
 await page('Array.from(document.querySelectorAll("#operation button")).find(b=>b.textContent.trim()==="الأرشيف").click()');await wait('document.querySelector(".production-panel").textContent.includes("00071")');
 assert.ok(assignments.some(a=>a.order_id==='a'),'history retained');
 // Independent user: server change emits no browser event. Existing windows must poll.
 const old=rows.find(o=>o.id==='b');old.status='WORKER_DONE';old.work_stage='finishing';completions.push({order_id:'b',completed_at:new Date().toISOString(),worker_name:'عامل آخر',snapshot:{order_number:'00072'}});
 await wait('!document.querySelector("#operation [data-order-row-id=b]")');await wait('document.querySelector(".production-panel").textContent.includes("00072")');
 await cdp.send('Page.reload');await wait('!!document.querySelector("#board .md-screen")');await wait('document.querySelectorAll("#operation [data-order-row-id]").length===0');assert.equal(await page('document.querySelectorAll("#board [data-assignment-order-id]").length'),0);
 await page('document.querySelector("#board .md-cell-empty").click()');await wait('!!document.querySelector(".md-search-list")');assert.equal(await page('document.querySelectorAll(".md-search-hit").length'),0);
 await page('document.querySelector(".md-modal-close").click()');
 for(const [id,n] of [['c','00073'],['d','00074'],['e','00075']])rows.push({...rows[0],id,order_number:n,status:'SENT_TO_WORKER',work_stage:'operation'});
 await wait('document.querySelectorAll("#operation [data-order-row-id]").length===3');
 const openSlot=(machine,position)=>page(`document.querySelector('#board .md-cell-empty[data-machine-name="${machine}"][data-queue-position="${position}"]').click()`);
 const choose=number=>page(`Array.from(document.querySelectorAll('.md-search-hit')).find(b=>b.textContent.includes('${number}')).click()`);
 const save=()=>page('document.querySelector(".md-modal-actions .md-btn-primary").click()');
 await openSlot('مكنة 2',2);await wait('document.querySelectorAll(".md-search-hit").length===3');
 assert.equal(await page('document.querySelector(".md-modal-title").textContent'),'إضافة أوردر');
 assert.equal(await page('document.querySelector(".md-add-modal select")'),null);
 assert.equal(await page('document.querySelector(".md-search-input").placeholder'),'ابحث برقم الأوردر');
 await choose('00073');await save();await wait('document.querySelector("#board [data-assignment-order-id=c]")?.dataset.queuePosition==="2"');
 assert.equal(assignments.find(a=>a.order_id==='c').position,2);
 await openSlot('مكنة 1',3);await choose('00074');
 const compact=await cdp.send('Page.captureScreenshot',{format:'png'});const review=join(tmpdir(),'zunion-machine-distribution-review');mkdirSync(review,{recursive:true});writeFileSync(join(review,'compact-add-order.png'),Buffer.from(compact.data,'base64'));
 await save();await wait('document.querySelector("#board [data-assignment-order-id=d]")?.dataset.queuePosition==="3"');
 await openSlot('مكنة 1',2);await choose('00075');
 rows.push({...rows[0],id:'f',order_number:'00076',status:'SENT_TO_WORKER',work_stage:'operation'});assignments.push({id:'concurrent-f',order_id:'f',machine_name:'مكنة 1',position:2});
 await save();await wait('document.querySelector(".md-add-modal [role=alert]")?.textContent.includes("مشغول")');assert.ok(!assignments.some(a=>a.order_id==='e'));
 await openSlot('مكنة 1',1);await save();await wait('document.querySelector("#board [data-assignment-order-id=e]")?.dataset.queuePosition==="1"');
 assert.deepEqual(assignments.filter(a=>['c','d','f','e'].includes(a.order_id)).map(a=>[a.order_id,a.machine_name,a.position]),[['c','مكنة 2',2],['d','مكنة 1',3],['f','مكنة 1',2],['e','مكنة 1',1]]);
 await cdp.send('Page.reload');await wait('document.querySelector("#board [data-assignment-order-id=c]")?.dataset.queuePosition==="2"');await wait('document.querySelector("#board [data-assignment-order-id=d]")?.dataset.queuePosition==="3"');
 console.log('PASS compact popup without dropdowns; exact clicked machine/position including gaps; no assignment shifting; occupied-slot error inside popup; retry at another cell.');
 const out=join(tmpdir(),'zunion-machine-distribution-review');mkdirSync(out,{recursive:true});await shot(cdp,join(out,'completed-orders-excluded.png'));
 console.log('PASS real React: eligible picker; assignment; no historical jobs; completion removes active rows and queues; finishing/archive/tracking refresh; success toast; same-origin second window; independent-user polling; reload exclusion; history retained. Screenshot: '+out);
}finally{cdp?.close();second?.close();if(child)cleanup(child);await new Promise(r=>server.close(r));}
