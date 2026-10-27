const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=name=>fs.readFileSync(`${__dirname}/../templates/${name}`,'utf8');
test('blocked database rejects and closes a late connection',async()=>{
 const req={};let closed=false;
 const context=vm.createContext({indexedDB:{open:()=>req},setTimeout,clearTimeout,Uint8Array,Date});
 vm.runInContext(source('storage.js'),context);
 const opening=context.VeraStorage.open();req.onblocked();
 await assert.rejects(opening,/其他页面/);
 req.result={close(){closed=true;}};req.onsuccess();assert.ok(closed);
});
test('database timeout rejects and permits retry',async()=>{
 let expire;const requests=[];
 const context=vm.createContext({indexedDB:{open:()=>{const req={};requests.push(req);return req;}},setTimeout:fn=>{expire=fn;return 1;},clearTimeout(){},Uint8Array,Date});
 vm.runInContext(source('storage.js'),context);
 const opening=context.VeraStorage.open();expire();await assert.rejects(opening,/超时/);
 const retry=context.VeraStorage.open();requests[1].result={close(){}};requests[1].onsuccess();await retry;
 assert.equal(requests.length,2);
});
test('manual folder wins over late cache restoration and storage does not gate engine',async()=>{
 let restore;const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,style:{},classList:{toggle(){},add(){},remove(){},contains(){return false;}},setAttribute(){},addEventListener(){}});return elements.get(id);};
 const context=vm.createContext({console,URL,Uint8Array,Map,Set,WeakMap,Date,Error,Number,Math,Promise,
 setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
 navigator:{gpu:{}},window:{addEventListener(){}},document:{getElementById:element,body:{classList:element('body').classList},addEventListener(){}},
 MutationObserver:class{observe(){}},
 fetch:async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:true})})}}),
 AbortController,init:async()=>{},set_persistence_callbacks(){},VeraStorage:{open:async()=>{},library:()=>new Promise(resolve=>restore=resolve)},
 import_file(){},prepare_audio(){},restore_user_file(){},start_game(){}
 });
 vm.runInContext(source('launcher.js').replace(/^import .*\n/,'').replaceAll('import.meta.url',JSON.stringify('https://example.test/launcher.js')),context);
 await new Promise(setImmediate);
 vm.runInContext("selectResources([{name:'ra2.mix',size:1},{name:'ra2md.mix',size:1}],'manual')",context);
 assert.equal(element('start').disabled,false);
 restore({folder:'cached',files:[{path:'ra2.mix',file:{name:'ra2.mix',size:1}},{path:'ra2md.mix',file:{name:'ra2md.mix',size:1}}]});
 await new Promise(setImmediate);
 assert.equal(element('folder-name').textContent,'manual');
});

test('startup waits for saved preferences even when storage opens after the engine',async()=>{
 let openStorage;const calls=[],elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,style:{},classList:{toggle(){},add(){},remove(){},contains(){return false;}},setAttribute(){},addEventListener(){}});return elements.get(id);};
 const opening=new Promise(resolve=>openStorage=resolve);
 const context=vm.createContext({console,URL,Uint8Array,Map,Set,WeakMap,Date,Error,Number,Math,Promise,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},AbortController,
 navigator:{gpu:{}},window:{addEventListener(){}},document:{getElementById:element,body:element('body'),addEventListener(){}},MutationObserver:class{observe(){}},
 fetch:async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:true})})}}),init:async()=>{},set_persistence_callbacks(){},
 VeraStorage:{open:()=>opening,library:async()=>null,users:async()=>[{path:'/retail/RA2MD.INI',bytes:new Uint8Array([89]),modified_ms:1}],saveLibrary:async()=>{}},
 prepare_audio(){},import_file(name){calls.push(name);},restore_user_file(path){calls.push(path);},start_game(){calls.push('start');}
 });
 vm.runInContext(source('launcher.js').replace(/^import .*\n/,'').replaceAll('import.meta.url',JSON.stringify('https://example.test/launcher.js')),context);
 await new Promise(setImmediate);
 vm.runInContext("selectResources(['ra2.mix','ra2md.mix'].map(name=>({name,size:1,arrayBuffer:async()=>new ArrayBuffer(1)})),'manual')",context);
 const starting=element('start').onclick();
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(!calls.includes('start'),'must not boot with defaults while preferences are still opening');
 openStorage();await starting;
 assert.deepEqual(calls.slice(-2),['RA2MD.INI','start']);
});

test('optional gateway restores and validates origins without probing or gating single-player',async()=>{
 const elements=new Map(),writes=[],requests=[];
 let startCalls=0;
 const element=id=>{
  if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,disabled:false,style:{},classList:{toggle(){},add(){},remove(){},contains(){return false;}},setAttribute(){},addEventListener(){}});
  return elements.get(id);
 };
 const context=vm.createContext({console,URL,Uint8Array,Map,Set,WeakMap,Date,Error,Number,Math,Promise,
 setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},AbortController,
 localStorage:{getItem:()=> 'wss://gateway.example:8443/',setItem(key,value){writes.push([key,value]);}},
 navigator:{gpu:{}},window:{addEventListener(){}},document:{getElementById:element,body:element('body'),addEventListener(){}},MutationObserver:class{observe(){}},
 fetch:async url=>{requests.push(String(url));return {ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:true})})}};},
 init:async()=>{},set_persistence_callbacks(){},VeraStorage:{open:async()=>{},library:async()=>null,users:async()=>[],saveLibrary:async()=>{}},
 import_file(){},prepare_audio(){},restore_user_file(){},start_game(){startCalls++;}
 });
 vm.runInContext(source('launcher.js').replace(/^import .*\n/,'').replaceAll('import.meta.url',JSON.stringify('https://example.test/launcher.js')),context);
 await new Promise(setImmediate);
 assert.equal(context.veraGatewayBase(),'https://gateway.example:8443');
 const input=element('gateway-address');
 input.value='ws://localhost:9090';input.oninput();
 assert.equal(context.veraGatewayBase(),'http://localhost:9090');
 assert.deepEqual(writes.at(-1),['vera20k.gateway-origin','http://localhost:9090']);
 for(const value of ['https://name:secret@example.test','https://example.test/path','https://example.test/?key=x','https://example.test/#room','ftp://example.test','https://example.test/../']){
  input.value=value;input.oninput();
  assert.throws(()=>context.veraGatewayBase(),/联机配置错误/);
  assert.match(element('gateway-status').textContent,/联机配置错误/);
 }
 vm.runInContext("selectResources(['ra2.mix','ra2md.mix'].map(name=>({name,size:1,arrayBuffer:async()=>new ArrayBuffer(1)})),'manual')",context);
 assert.equal(element('start').disabled,false);
 await element('start').onclick();
 assert.equal(startCalls,1);
 assert.equal(requests.length,1,'only the Wasm engine is fetched, never a gateway probe');
 assert.ok(requests[0].startsWith('https://example.test/'));
 input.value='';input.oninput();assert.equal(context.veraGatewayBase(),'');
 Object.defineProperty(context,'localStorage',{get(){throw Error('storage blocked');}});
 input.value='https://other.example';assert.doesNotThrow(()=>input.oninput());
 assert.equal(context.veraGatewayBase(),'https://other.example');
});
