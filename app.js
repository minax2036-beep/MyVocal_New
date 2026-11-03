(()=>{'use strict';
const $=id=>document.getElementById(id);
const DB='myvocal-db', STORE='voices', KEY='myvocal-project-v1';
let db, voices=[], dict={}, notes=[], selected=null, audioCtx=null, sources=[];
let editingVoice=null, decodedVoice=null, playhead=0, trimStart=0, trimEnd=0, raf=0, playing=false;

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function request(mode,fn){return new Promise((resolve,reject)=>{const r=fn(db.transaction(STORE,mode).objectStore(STORE));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function save(){localStorage.setItem(KEY,JSON.stringify({dict,notes}));}
function showPage(id){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===id));if(id==='editor')renderRoll();if(id==='dictionary')renderDictionary();}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>showPage(b.dataset.go));

async function refresh(){voices=await request('readonly',s=>s.getAll());$('vc').textContent=voices.length;$('vtotal').textContent=voices.length+'件';renderVoices();renderDictionary();}
function renderVoices(){
 const root=$('voiceList');root.innerHTML='';
 if(!voices.length){root.textContent='まだ音声素材がありません。';return;}
 voices.forEach(v=>{
  const row=document.createElement('div');row.className='row';
  const meta=document.createElement('div');meta.className='meta';meta.innerHTML='<b></b><small></small>';
  meta.querySelector('b').textContent=v.name;meta.querySelector('small').textContent='キー: '+v.key+' / '+v.fileName;
  const play=document.createElement('button');play.textContent='▶ 試聴';play.onclick=()=>playBlob(v.blob);
  const edit=document.createElement('button');edit.textContent='波形編集';edit.className='primary';edit.onclick=()=>openWaveEditor(v);
  const del=document.createElement('button');del.textContent='削除';del.onclick=async()=>{if(!confirm(v.name+'を削除しますか？'))return;await request('readwrite',s=>s.delete(v.id));Object.keys(dict).forEach(k=>{if(dict[k]===v.id)delete dict[k];});if(editingVoice===v.id)closeWaveEditor();save();await refresh();};
  row.append(meta,play,edit,del);root.append(row);
 });
}
$('voiceForm').onsubmit=async e=>{e.preventDefault();const file=$('vfile').files[0];if(!file)return;await request('readwrite',s=>s.add({id:crypto.randomUUID(),name:$('vname').value.trim(),key:$('vkey').value.trim(),fileName:file.name,blob:file}));e.target.reset();await refresh();};

function renderDictionary(){
 const select=$('dvoice');if(!select)return;select.innerHTML='';
 voices.forEach(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.name+' ('+v.key+')';select.append(o);});
 const root=$('dictList');root.innerHTML='';
 if(!Object.keys(dict).length){root.textContent='発音ルールがありません。';return;}
 Object.entries(dict).forEach(([key,id])=>{const v=voices.find(x=>x.id===id);const row=document.createElement('div');row.className='row';const meta=document.createElement('div');meta.className='meta';meta.innerHTML='<b></b><small></small>';meta.querySelector('b').textContent=key;meta.querySelector('small').textContent=v?'使用素材: '+v.name:'素材がありません';const del=document.createElement('button');del.textContent='削除';del.onclick=()=>{delete dict[key];save();renderDictionary();};row.append(meta,del);root.append(row);});
}
$('dictForm').onsubmit=e=>{e.preventDefault();if(!voices.length){alert('先に音声素材を登録してください');return;}dict[$('dtext').value.trim()]=$('dvoice').value;save();$('dtext').value='';renderDictionary();};

$('add').onclick=()=>{const lyric=$('lyric').value.trim()||'あ';const start=notes.length?Math.max(...notes.map(n=>n.start+n.duration)):0;notes.push({id:crypto.randomUUID(),lyric,midi:+$('pitch').value,start,duration:+$('duration').value});selected=notes[notes.length-1].id;save();renderRoll();};
$('clear').onclick=()=>{if(confirm('ノートをすべて削除しますか？')){notes=[];selected=null;save();renderRoll();}};
function pitchName(m){return ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][m%12]+(Math.floor(m/12)-1);}
function renderRoll(){
 const root=$('roll');root.innerHTML='';$('nc').textContent=notes.length;
 if(!notes.length){root.textContent='ノートを追加すると、ここに表示されます。';$('inspector').textContent='ノートが選択されていません。';return;}
 const pitches=[72,71,69,67,65,64,62,60,57,55],max=Math.max(8,...notes.map(n=>n.start+n.duration));root.style.minWidth=(max*80+50)+'px';
 pitches.forEach(m=>{const row=document.createElement('div');row.className='p-row';const label=document.createElement('span');label.textContent=pitchName(m);row.append(label);notes.filter(n=>n.midi===m).forEach(n=>{const b=document.createElement('button');b.className='note'+(n.id===selected?' selected':'');b.style.left=(50+n.start*80)+'px';b.style.width=Math.max(35,n.duration*80-4)+'px';b.textContent=n.lyric;b.onclick=()=>{selected=n.id;renderRoll();};row.append(b);});root.append(row);});renderInspector();
}
function renderInspector(){
 const root=$('inspector'),n=notes.find(x=>x.id===selected);root.innerHTML='';
 if(!n){root.textContent='ノートが選択されていません。';return;}
 [['歌詞','lyric','text'],['音高','midi','number'],['開始拍','start','number'],['長さ','duration','number']].forEach(([label,key,type])=>{const l=document.createElement('label');l.textContent=label;const i=document.createElement('input');i.type=type;i.value=n[key];i.step='0.5';i.onchange=()=>{n[key]=type==='number'?+i.value:i.value;save();renderRoll();};l.append(i);root.append(l);});
 const del=document.createElement('button');del.className='danger';del.textContent='ノート削除';del.onclick=()=>{notes=notes.filter(x=>x.id!==n.id);selected=null;save();renderRoll();};root.append(del);
}
async function audio(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')await audioCtx.resume();return audioCtx;}
function stopSources(){sources.forEach(s=>{try{s.stop();}catch{}});sources=[];}
async function playBlob(blob){stopSources();const c=await audio(),buffer=await c.decodeAudioData(await blob.arrayBuffer()),source=c.createBufferSource();source.buffer=buffer;source.connect(c.destination);source.start();sources.push(source);source.onended=()=>sources=sources.filter(x=>x!==source);}
$('play').onclick=async()=>{
 stopSources();if(!notes.length){alert('ノートを追加してください');return;}
 const c=await audio(),base=c.currentTime+.08;let count=0;
 for(const n of [...notes].sort((a,b)=>a.start-b.start)){
  const id=dict[n.lyric]||(voices.find(v=>v.key===n.lyric||v.name===n.lyric)||{}).id;const v=voices.find(x=>x.id===id);if(!v)continue;
  const buffer=await c.decodeAudioData(await v.blob.arrayBuffer()),source=c.createBufferSource();source.buffer=buffer;source.playbackRate.value=Math.pow(2,(n.midi-60)/12);source.connect(c.destination);source.start(base+n.start);source.stop(base+n.start+n.duration);sources.push(source);count++;
 }
 $('msg').textContent=count?count+'ノートを再生。ピッチ変更は再生速度方式です。':'対応する音声素材がありません。発音辞書を確認してください。';
};
$('stop').onclick=stopSources;

async function openWaveEditor(v){
 stopWavePlayback();editingVoice=v.id;$('waveEditor').hidden=false;$('waveTitle').textContent='波形編集：'+v.name;$('waveInfo').textContent='音声を解析中...';
 try{const c=await audio();decodedVoice=await c.decodeAudioData(await v.blob.arrayBuffer());trimStart=0;trimEnd=decodedVoice.duration;playhead=0;$('trimStart').value='0.000';$('trimEnd').value=trimEnd.toFixed(3);$('waveSeek').value=0;$('waveSeek').max=decodedVoice.duration;$('waveInfo').textContent=decodedVoice.duration.toFixed(3)+' 秒 ・ '+decodedVoice.sampleRate.toLocaleString()+' Hz ・ '+decodedVoice.numberOfChannels+' ch';drawWaveform();}
 catch(err){$('waveInfo').textContent='この音声をブラウザで解析できませんでした: '+err.message;decodedVoice=null;}
}
function closeWaveEditor(){stopWavePlayback();editingVoice=null;decodedVoice=null;$('waveEditor').hidden=true;}
$('closeWave').onclick=closeWaveEditor;
function drawWaveform(){
 const canvas=$('waveCanvas');if(!canvas||!decodedVoice)return;const w=Math.max(300,canvas.clientWidth),h=190,dpr=window.devicePixelRatio||1;canvas.width=w*dpr;canvas.height=h*dpr;const g=canvas.getContext('2d');g.scale(dpr,dpr);g.fillStyle='#091326';g.fillRect(0,0,w,h);
 const data=decodedVoice.getChannelData(0),step=Math.max(1,Math.floor(data.length/w)),mid=h/2;g.strokeStyle='#354666';g.lineWidth=1;
 for(let x=0;x<w;x+=Math.max(1,w/10)){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
 g.strokeStyle='#273957';g.beginPath();g.moveTo(0,mid);g.lineTo(w,mid);g.stroke();g.strokeStyle='#78d7d0';g.lineWidth=1;g.beginPath();
 for(let x=0;x<w;x++){let min=1,max=-1;const start=x*step,end=Math.min(data.length,start+step);for(let i=start;i<end;i++){const value=data[i];if(value<min)min=value;if(value>max)max=value;}g.moveTo(x,mid+min*(h*.43));g.lineTo(x,mid+max*(h*.43));}g.stroke();
 const sx=trimStart/decodedVoice.duration*w,ex=trimEnd/decodedVoice.duration*w;g.fillStyle='rgba(7,12,25,.55)';g.fillRect(0,0,sx,h);g.fillRect(ex,0,w-ex,h);g.strokeStyle='#a99cff';g.lineWidth=2;g.beginPath();g.moveTo(sx,0);g.lineTo(sx,h);g.moveTo(ex,0);g.lineTo(ex,h);g.stroke();const px=playhead/decodedVoice.duration*w;g.strokeStyle='#ffcf70';g.beginPath();g.moveTo(px,0);g.lineTo(px,h);g.stroke();
}
$('waveCanvas').addEventListener('click',e=>{if(!decodedVoice)return;const r=e.currentTarget.getBoundingClientRect();playhead=Math.max(0,Math.min(decodedVoice.duration,(e.clientX-r.left)/r.width*decodedVoice.duration));$('waveSeek').value=playhead;drawWaveform();});
$('waveSeek').oninput=e=>{if(!decodedVoice)return;playhead=+e.target.value;drawWaveform();};
function updateTrim(){if(!decodedVoice)return;const d=decodedVoice.duration;trimStart=Math.max(0,Math.min(d,+$('trimStart').value||0));trimEnd=Math.max(0,Math.min(d,+$('trimEnd').value||0));if(trimEnd<=trimStart){$('trimEnd').value=Math.min(d,trimStart+.01).toFixed(3);trimEnd=+$('trimEnd').value;}drawWaveform();}
$('trimStart').onchange=updateTrim;$('trimEnd').onchange=updateTrim;
async function playWave(){
 if(!decodedVoice)return;stopWavePlayback();const c=await audio(),source=c.createBufferSource();source.buffer=decodedVoice;source.connect(c.destination);
 let offset=Math.max(trimStart,Math.min(trimEnd,playhead));if(offset>=trimEnd)offset=trimStart;source.start(0,offset,trimEnd-offset);sources.push(source);playing=true;$('wavePlay').textContent='▶ 再生中';
 const started=c.currentTime,from=offset;const tick=()=>{if(!playing)return;playhead=Math.min(trimEnd,from+c.currentTime-started);$('waveSeek').value=playhead;drawWaveform();if(playhead>=trimEnd-.005){stopWavePlayback();return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
 source.onended=()=>{sources=sources.filter(x=>x!==source);if(playing)stopWavePlayback();};
}
function stopWavePlayback(){playing=false;cancelAnimationFrame(raf);stopSources();$('wavePlay').textContent='▶ 範囲を再生';}
$('wavePlay').onclick=playWave;$('waveStop').onclick=stopWavePlayback;
$('setIn').onclick=()=>{if(!decodedVoice)return;trimStart=playhead;$('trimStart').value=trimStart.toFixed(3);if(trimEnd<=trimStart){trimEnd=decodedVoice.duration;$('trimEnd').value=trimEnd.toFixed(3);}drawWaveform();};
$('setOut').onclick=()=>{if(!decodedVoice)return;trimEnd=playhead;$('trimEnd').value=trimEnd.toFixed(3);if(trimEnd<=trimStart){trimStart=0;$('trimStart').value='0.000';}drawWaveform();};
function wavBlob(buffer,start,end){
 const rate=buffer.sampleRate,from=Math.floor(start*rate),to=Math.max(from+1,Math.floor(end*rate)),length=to-from,channels=buffer.numberOfChannels,bytes=44+length*channels*2,ab=new ArrayBuffer(bytes),view=new DataView(ab);
 function writeText(offset,str){for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i));}
 writeText(0,'RIFF');view.setUint32(4,bytes-8,true);writeText(8,'WAVE');writeText(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);writeText(36,'data');view.setUint32(40,bytes-44,true);
 let offset=44;for(let i=0;i<length;i++)for(let c=0;c<channels;c++){let x=buffer.getChannelData(c)[from+i];x=Math.max(-1,Math.min(1,x));view.setInt16(offset,x<0?x*32768:x*32767,true);offset+=2;}return new Blob([ab],{type:'audio/wav'});
}
$('saveTrim').onclick=async()=>{if(!decodedVoice)return;if(trimEnd-trimStart<.02){alert('切り出し範囲が短すぎます。');return;}const original=voices.find(v=>v.id===editingVoice);if(!original)return;const blob=wavBlob(decodedVoice,trimStart,trimEnd);const item={id:crypto.randomUUID(),name:original.name+'_trim',key:original.key,fileName:original.name+'_trim.wav',blob};await request('readwrite',s=>s.add(item));await refresh();$('waveInfo').textContent='切り出した素材を追加しました（'+(trimEnd-trimStart).toFixed(3)+' 秒）。元素材はそのまま残っています。';};

function download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export').onclick=()=>download(new Blob([JSON.stringify({format:'MyVocalProject',version:1,dict,notes},null,2)],{type:'application/json'}),'myvocal-project.json');
$('import').onclick=()=>$('importFile').click();
$('importFile').onchange=async e=>{try{const p=JSON.parse(await e.target.files[0].text());if(p.format!=='MyVocalProject')throw new Error('形式が違います');dict=p.dict||{};notes=p.notes||[];selected=null;save();renderDictionary();renderRoll();$('nc').textContent=notes.length;alert('読み込みました');}catch(err){alert('読み込み失敗: '+err.message);}e.target.value='';};
window.addEventListener('resize',()=>{if(decodedVoice)drawWaveform();});
async function init(){db=await openDB();try{const p=JSON.parse(localStorage.getItem(KEY)||'{}');dict=p.dict||{};notes=p.notes||[];}catch{}await refresh();$('nc').textContent=notes.length;showPage('home');}
init().catch(err=>{console.error(err);alert('初期化に失敗しました。IndexedDB対応ブラウザで開いてください');});
})();