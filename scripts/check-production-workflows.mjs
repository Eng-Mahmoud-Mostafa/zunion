import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {build}=require('../backend/node_modules/esbuild');
const db=new PGlite();
globalThis.__productionQuery=(sql,args)=>db.query(sql,args);
globalThis.__productionTx=fn=>db.transaction(c=>fn({query:(sql,args)=>c.query(sql,args)}));
const bundle=await build({entryPoints:['backend/src/productionCompletion.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'database',setup(b){b.onResolve({filter:/^\.\/db\.js$/},()=>({path:'db',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const tx=(...a)=>globalThis.__productionTx(...a); export const query=(...a)=>globalThis.__productionQuery(...a);'}));}}]});
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
await db.exec(`create table users(id uuid primary key default gen_random_uuid());create table orders(id uuid primary key default gen_random_uuid(),type text,draft boolean default false,work_stage text default 'operation',status text default 'WORKER_STARTED',worker_name text,printing_worker text,sewing_worker text,printing_status text,sewing_status text,order_number text,customer_name_snapshot text,source_party text,color text,quantity int,delivery_date date,product_name_snapshot text,updated_by uuid,created_at timestamptz default now());create table order_items(order_id uuid,logo_place text);create table audit_logs(user_id uuid,user_email text,user_role text,action text,entity_type text,entity_id uuid,new_value_json jsonb);`);
await db.exec(api.PRODUCTION_DDL);await db.exec(api.PRODUCTION_DDL);
const actor=(await db.query('insert into users default values returning id')).rows[0];const user={...actor,email:'test@local',role:'Master'};
async function order(type,n){return (await db.query("insert into orders(type,order_number,printing_worker,sewing_worker,worker_name) values($1,$2,'Printer','Sewer','Embroiderer') returning *",[type,n])).rows[0];}
const p1=await order('طباعة','00047'),p2=await order('طباعة','26-9-15-266868'),s1=await order('خياطة','00055'),e1=await order('تطريز','00056');
let queue=await api.readProductionQueue('printing');assert.equal(queue.orders.length,2);
assert.equal(await api.saveProductionQueue('printing',[p2.id,p1.id],queue.revision,user),true);
assert.equal(await api.saveProductionQueue('printing',[p1.id,p2.id],queue.revision,user),false,'stale writes rejected');
queue=await api.readProductionQueue('printing');assert.deepEqual(queue.orders.map(r=>r.id),[p2.id,p1.id]);assert.equal((await api.readProductionQueue('sewing')).orders[0].id,s1.id);
assert.equal(await api.saveProductionQueue('printing',[s1.id,p1.id],queue.revision,user),false,'foreign department rejected');
for(const [row,stage] of [[p2,'printing'],[s1,'sewing'],[e1,'embroidery']]){
 const result=await api.completeProductionOrder(row.id,stage,actor.id);assert.equal(result.outcome,'transferred');assert.equal(result.current.work_stage,'finishing');assert.equal(result.current.status,'WORKER_DONE');
 assert.equal((await api.completeProductionOrder(row.id,stage,actor.id)).outcome,'already-transferred');
 const completion=(await db.query('select * from production_stage_completions where order_id=$1',[row.id])).rows[0];assert.ok(completion.completed_at);assert.ok(completion.worker_name);assert.equal(completion.snapshot.order_number,row.order_number);
}
assert.deepEqual((await api.readProductionQueue('printing')).orders.map(r=>r.id),[p1.id]);assert.equal((await db.query('select count(*)::int as n from production_stage_completions')).rows[0].n,3);
assert.equal((await api.completeProductionOrder(p1.id,'sewing',actor.id)).outcome,'wrong-type');
// Fail an archive write to prove the transaction leaves the order and queue untouched.
await db.exec("alter table production_stage_completions add constraint injected check(snapshot->>'order_number'<>'00047')");
await assert.rejects(api.completeProductionOrder(p1.id,'printing',actor.id));assert.equal((await db.query('select work_stage from orders where id=$1',[p1.id])).rows[0].work_stage,'operation');
assert.equal((await api.readProductionQueue('printing')).orders[0].id,p1.id);
assert.equal((await db.query('select count(*)::int as n from orders')).rows[0].n,4);
console.log('PASS: migrations repeat safely; persisted independent queues; stale/invalid reorder rejection; all three archives; idempotent completion; preserved workers/orders; sequential queue; rollback on failure.');
await db.close();
