import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);const {build}=require('../backend/node_modules/esbuild');
const folder=path.resolve('.local/workflow-api-check');mkdirSync(folder,{recursive:true});
const source=readFileSync('backend/src/server.ts','utf8').replace('void start();','export { app, signAppSession };');
const bundle=await build({stdin:{contents:source,resolveDir:path.resolve('backend/src'),loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'isolated-db',setup(b){b.onResolve({filter:/\/db\.js$/},()=>({path:'db',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export async function query(sql,params){if(sql.includes('insert into users (email, role, username, full_name)'))return {rows:[{id:'11111111-1111-4111-8111-111111111111',email:params[0],role:params[1],token_version:0}]};throw new Error('Unexpected database access: '+sql);}export async function tx(){throw new Error('Unexpected write');}export const databaseAvailable=()=>false;`}));}}]});
// Resolve external packages from backend, without starting its production bootstrap.
const file=path.resolve('backend/node_modules/.workflow-api-check.cjs');writeFileSync(file,bundle.outputFiles[0].text);
let server;
try {
 const {app,signAppSession}=require(file);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 const cookie=role=>`zunion_app_session=${signAppSession({role,email:'isolated@test.local',username:'isolated',permissions:[],expiresAt:new Date(Date.now()+60000).toISOString()})}`;
 for(const role of ['Worker','Helper','Operator','Supervisor','Finish']){
  for(const [method,url] of [['POST','/api/machine-assignments'],['POST','/machine-assignments'],['PATCH','/api/machine-assignments/reorder'],['PATCH','/api/machine-assignments/11111111-1111-4111-8111-111111111111'],['DELETE','/api/machine-assignments/11111111-1111-4111-8111-111111111111'],['POST','/api/workers'],['PATCH','/api/workers/11111111-1111-4111-8111-111111111111'],['DELETE','/api/workers/11111111-1111-4111-8111-111111111111'],['POST','/api/parties'],['PATCH','/api/parties/11111111-1111-4111-8111-111111111111'],['POST','/api/users'],['PUT','/api/production/printing/queue'],['PUT','/api/production/sewing/queue'],['PATCH','/api/orders/11111111-1111-4111-8111-111111111111/complete-production']]){
   const response=await fetch(base+url,{method,headers:{Cookie:cookie(role),'Content-Type':'application/json'},body:JSON.stringify({name:'forbidden',stage:'printing',ids:[],revision:0})});assert.equal(response.status,403,`${role} ${method} ${url}`);
  }
 }
 assert.equal((await fetch(base+'/api/production/printing/queue')).status,401);
 for(const url of ['/api/workers','/api/parties','/api/production/printing/queue']) assert.equal((await fetch(base+url,{method:url.includes('queue')?'PUT':'POST',headers:{Cookie:cookie('Master'),'Content-Type':'application/json'},body:'{}'})).status,400);
 console.log('PASS: 70 unauthorized direct/legacy master-data and production mutation requests rejected; unauthenticated request rejected; Master reaches validation. No database/business writes.');
}finally{if(server)await new Promise(r=>server.close(r));rmSync(file,{force:true});}
