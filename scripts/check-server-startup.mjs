import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url);const {build}=require('../backend/node_modules/esbuild');
let releaseSchema;let seeded=0;globalThis.__startupSchema=new Promise(resolve=>{releaseSchema=resolve;});
globalThis.__startupSeed=options=>{assert.equal(options.forcePassword,false);seeded++;};
const result=await build({entryPoints:['backend/src/server.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'isolated-startup',setup(b){b.onResolve({filter:/^\.\/(ensureSchema|seed)\.js$/},args=>({path:args.path,namespace:'startup'}));b.onLoad({filter:/.*/,namespace:'startup'},args=>({contents:args.path.includes('ensureSchema')?'export const ensureSchema=()=>globalThis.__startupSchema;':'export const ensureSeededUsers=(options)=>globalThis.__startupSeed(options);'}));}}]});
const previous=process.env.VERCEL;process.env.VERCEL='1';const file=path.resolve('backend/node_modules/.startup-check.cjs');writeFileSync(file,result.outputFiles[0].text);let server;
try{
 const exported=require(file);assert.equal(typeof exported.default,'function','Vercel app is exported before asynchronous initialization finishes');
 server=exported.default.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let completed=false;const response=fetch(`http://127.0.0.1:${server.address().port}/api/machine-assignments`).then(r=>{completed=true;return r;});
 await new Promise(r=>setTimeout(r,50));assert.equal(completed,false,'requests wait for schema readiness');assert.equal(seeded,0);
 releaseSchema();assert.equal((await response).status,401);assert.equal(seeded,1);
 console.log('PASS immediate Vercel app export, readiness barrier, preserved password policy and authenticated-route guard.');
}finally{releaseSchema();if(server)await new Promise(r=>server.close(r));rmSync(file,{force:true});if(previous===undefined)delete process.env.VERCEL;else process.env.VERCEL=previous;}
