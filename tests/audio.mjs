// Launcher regressions without a browser, retail files, or Wasm compilation.
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../templates/launcher.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replaceAll('import.meta.url',JSON.stringify('https://example.test/launcher.js'));
function launcher(audioError=false,library=null,users=[],initPromise=null){
 const elements=new Map(), calls=[],writes=[],downloads=[];
 const element=id=>{
  if(!elements.has(id))elements.set(id,{disabled:false,hidden:false,textContent:'',style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},focus(){},setAttribute(){},addEventListener(){}});
  return elements.get(id);
 };
 const context={Blob,URL:class extends URL{static createObjectURL(blob){downloads.push(blob);return 'blob:fixture';}static revokeObjectURL(){}},window:{addEventListener(){}},VeraStorage:{open:async()=>{},library:async()=>library,users:async()=>users,write:async row=>{writes.push(row);users.push(row);},remove:async()=>{},saveLibrary:async()=>{}},set_persistence_callbacks(write,remove){context.persistence={write,remove};},restore_user_file(path){calls.push(`restore:${path}`);},document:{createElement(){return {click(){}};},getElementById:element,addEventListener(){},body:element('body')},navigator:{gpu:{}},MutationObserver:class{observe(){}},init:async()=>{await initPromise;},prepare_audio(){calls.push('audio');if(audioError)throw Error('blocked');},import_file(name){calls.push(name);},start_game(canvas,status){assert.equal(canvas,element('game'));assert.equal(typeof status,'function');status('Ready');calls.push('start');},setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},AbortController,fetch:async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:true})})}}),location:{reload(){}}};
 return {context,elements,calls,writes,downloads,run:async()=>{const api=await runInNewContext(`(async()=>{${source}\nreturn {selectResources};})()`,context);await initPromise;await new Promise(setImmediate);return api;}};
}
const resources=['ra2.mix','ra2md.mix','theme.mix','thememd.mix','audio.bag','audio.idx','voice.wav','sound.aud','movies01.mix','movmd03.mix','gamemd.exe'].map(name=>({name,size:1,arrayBuffer:async()=>new ArrayBuffer(1)}));
{
 const fixture=launcher(), api=await fixture.run();
 assert.equal(fixture.context.persistence.write,fixture.context.vera20kPersistWrite);
 assert.equal(fixture.context.persistence.remove,fixture.context.vera20kPersistRemove);
 api.selectResources(resources,'retail');
 await fixture.elements.get('start').onclick();
 assert.deepEqual(fixture.calls,['audio','ra2.mix','ra2md.mix','theme.mix','thememd.mix','audio.bag','audio.idx','voice.wav','sound.aud','movmd03.mix','start']);
}
{
 const fixture=launcher(true), api=await fixture.run();
 api.selectResources(resources,'retail');
 await fixture.elements.get('start').onclick();
 assert.deepEqual(fixture.calls,['audio']);
 assert.equal(fixture.elements.get('retry').hidden,false);
}
console.log('PASS: audio opens before resource reads; audio resources retained; output failure is visible');

{
 const cached={folder:'cached retail',files:resources.map(file=>({path:file.name,file}))};
 const fixture=launcher(false,cached,[{path:'/retail/RA2MD.INI',bytes:new Uint8Array([1]),modified_ms:123}]);
 await fixture.run();
 assert.equal(fixture.elements.get('start').disabled,false,'cached resources are ready without a folder picker');
 await fixture.elements.get('start').onclick();
 assert.equal(fixture.calls[0],'audio');
 assert.deepEqual(fixture.calls.slice(-2),['RA2MD.INI','start'],'user settings override imported settings before engine startup');
}
console.log('PASS: cached resources skip folder selection; user data restores before startup');

{
 const fixture=launcher();await fixture.run();
 const bytes=new Uint8Array([89,82]);
 fixture.context.vera20kPersistWrite('/retail/RA2MD.INI',bytes,123);
 bytes.fill(0);
 await fixture.elements.get('export-data').onclick();
 const backup=JSON.parse(await fixture.downloads[0].text());
 assert.equal(backup.files[0].path,'/retail/RA2MD.INI');
 assert.deepEqual(backup.files[0].bytes,[89,82],'Wasm memory changes cannot corrupt queued settings');
 assert.equal(fixture.writes[0].modified_ms,123);
}
console.log('PASS: settings queue copies Wasm memory; user backup contains persisted bytes');

{
 let finishInit;const initialization=new Promise(resolve=>{finishInit=resolve;});
 const fixture=launcher(false,null,[],initialization),running=fixture.run();
 fixture.elements.get('files').files=resources.map(file=>({...file,webkitRelativePath:`retail/${file.name}`}));
 fixture.elements.get('files').onchange();
 assert.equal(fixture.elements.get('start').disabled,true);
 assert.equal(fixture.elements.get('start-label').textContent,'正在准备游戏…');
 finishInit();await running;
 assert.equal(fixture.elements.get('start').disabled,false);
 assert.equal(fixture.elements.get('start-label').textContent,'开始游戏');
}
console.log('PASS: selecting a folder during engine loading shows why start is disabled and enables it after readiness');

{
 const fixture=launcher(false,null,[
  {path:'/saves/profile/VERA.INI',bytes:new Uint8Array([1]),modified_ms:123},
  {path:'/saves/deleted.sav',bytes:new Uint8Array(),modified_ms:123,deleted:true},
  {path:'/config.toml',bytes:new Uint8Array([2]),modified_ms:123},
 ]);
 const api=await fixture.run();api.selectResources(resources,'retail');
 await fixture.elements.get('start').onclick();
 assert.deepEqual(fixture.calls.slice(-2),['restore:/saves/profile/VERA.INI','start']);
}
console.log('PASS: original upstream persistence callbacks, canvas/status API, and saves-only restore schema');
