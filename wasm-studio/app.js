(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const fileInput = $("audioFile"), dropZone = $("dropZone"), waveform = $("waveform"), waveCtx = waveform.getContext("2d");
  const pitchCanvas = $("pitchGraph"), pitchCtx = pitchCanvas.getContext("2d");
  const player = $("audioPlayer"), editedPlayer = $("editedPlayer");
  let engine = null, audioContext = null, sourceBuffer = null, sourceUrl = null, editedUrl = null;
  let mono = null, analysis = null, currentFile = null, editedWav = null, playing = false;

  function setStatus(text, ready=false) { $("engineStatus").textContent = text; $("engineStatus").classList.toggle("ready", ready); }
  function fmt(seconds) { const m=Math.floor(seconds/60), s=(seconds%60).toFixed(1).padStart(4,"0"); return String(m).padStart(2,"0")+":"+s; }
  function downmix(buffer) {
    const out = new Float32Array(buffer.length), channels = buffer.numberOfChannels;
    for (let c=0;c<channels;c++) { const data=buffer.getChannelData(c); for(let i=0;i<out.length;i++) out[i]+=data[i]/channels; }
    return out;
  }
  function drawWave(data) {
    const w=waveform.width,h=waveform.height; waveCtx.clearRect(0,0,w,h); waveCtx.fillStyle="#0b1424"; waveCtx.fillRect(0,0,w,h);
    waveCtx.strokeStyle="#263750"; waveCtx.lineWidth=1; waveCtx.beginPath(); waveCtx.moveTo(0,h/2); waveCtx.lineTo(w,h/2); waveCtx.stroke();
    if(!data) return; const step=Math.max(1,Math.floor(data.length/w)); waveCtx.strokeStyle="#61d6bd"; waveCtx.lineWidth=1.3; waveCtx.beginPath();
    for(let x=0;x<w;x++){let min=1,max=-1;const start=x*step;for(let j=0;j<step&&start+j<data.length;j++){const v=data[start+j];if(v<min)min=v;if(v>max)max=v;}waveCtx.moveTo(x,(1+min)*h/2);waveCtx.lineTo(x,(1+max)*h/2);}waveCtx.stroke();
  }
  function drawPitch(values, hopSeconds) {
    const w=pitchCanvas.width,h=pitchCanvas.height;pitchCtx.clearRect(0,0,w,h);pitchCtx.fillStyle="#0b1424";pitchCtx.fillRect(0,0,w,h);
    pitchCtx.font="14px system-ui";pitchCtx.fillStyle="#9aa9c1";pitchCtx.strokeStyle="#263750";
    [0,250,500,750,1000].forEach(v=>{const y=h-24-v/1000*(h-45);pitchCtx.beginPath();pitchCtx.moveTo(45,y);pitchCtx.lineTo(w,y);pitchCtx.stroke();pitchCtx.fillText(String(v),5,y+4);});
    const maxTime=Math.max(hopSeconds*(values.length-1),0.01);pitchCtx.strokeStyle="#82aaff";pitchCtx.lineWidth=2;pitchCtx.beginPath();let started=false;
    values.forEach((v,i)=>{if(!v||v<60||v>1000){started=false;return;}const x=45+(w-55)*(i*hopSeconds/maxTime),y=h-24-v/1000*(h-45);if(!started){pitchCtx.moveTo(x,y);started=true;}else pitchCtx.lineTo(x,y);});pitchCtx.stroke();
  }
  function enableLoaded() { ["playButton","stopButton","analyzeButton","previewEdit","resetEdit"].forEach(id=>$(id).disabled=false); }
  async function loadFile(file) {
    if(!file) return;
    if(!file.type.startsWith("audio/")) { alert("音声ファイルを選択してください。"); return; }
    try {
      if(!audioContext) audioContext=new (window.AudioContext||window.webkitAudioContext)();
      const bytes=await file.arrayBuffer();sourceBuffer=await audioContext.decodeAudioData(bytes.slice(0));
      currentFile=file;mono=downmix(sourceBuffer);analysis=null;editedWav=null;
      if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=URL.createObjectURL(file);player.src=sourceUrl;
      $("fileInfo").textContent=file.name+" · "+sourceBuffer.numberOfChannels+"ch · "+sourceBuffer.sampleRate+" Hz · "+(file.size/1024/1024).toFixed(2)+" MB";
      $("durationLabel").textContent=fmt(sourceBuffer.duration);$("timeReadout").textContent=fmt(0)+" / "+fmt(sourceBuffer.duration);
      $("startSlider").max=sourceBuffer.duration;$("endSlider").max=sourceBuffer.duration;$("endSlider").value=sourceBuffer.duration;
      $("startSlider").value=0;$("startValue").textContent="0.00 s";$("endValue").textContent=sourceBuffer.duration.toFixed(2)+" s";
      drawWave(mono);drawPitch([],0);$("medianF0").textContent="—";$("voicedFrames").textContent="—";$("totalFrames").textContent="—";
      $("downloadCsv").disabled=true;$("downloadWav").disabled=true;$("editInfo").textContent="編集結果はまだありません。";editedPlayer.removeAttribute("src");enableLoaded();
    } catch(err) { console.error(err);alert("音声を読み込めませんでした。この形式に対応していない可能性があります。"); }
  }
  function allocFloats(array) { const ptr=engine._malloc(array.length*4);engine.HEAPF32.set(array,ptr/4);return ptr; }
  function analyze() {
    if(!engine||!mono)return;
    const frameSize=Math.min(2048,Math.max(512,Math.round(sourceBuffer.sampleRate*0.04))),hop=Math.max(128,Math.round(sourceBuffer.sampleRate*0.01));
    const maxFrames=Math.max(1,Math.ceil(mono.length/hop)),inPtr=allocFloats(mono),outPtr=engine._malloc(maxFrames*4);
    try {
      const count=engine._analyze_f0(inPtr,mono.length,sourceBuffer.sampleRate,frameSize,hop,outPtr,maxFrames);
      if(count<0)throw new Error("F0 analysis failed");
      const values=Array.from(engine.HEAPF32.slice(outPtr/4,outPtr/4+count));
      const voiced=values.filter(v=>v>0),sorted=[...voiced].sort((a,b)=>a-b),median=sorted.length?(sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2):0;
      analysis={values,hopSeconds:hop/sourceBuffer.sampleRate};
      drawPitch(values,analysis.hopSeconds);$("medianF0").textContent=median?median.toFixed(1)+" Hz":"検出なし";
      $("voicedFrames").textContent=voiced.length;$("totalFrames").textContent=count;$("downloadCsv").disabled=false;
    } catch(err){console.error(err);alert("解析に失敗しました: "+err.message);}
    finally{engine._free(inPtr);engine._free(outPtr);}
  }
  function makeWav(samples,sampleRate) {
    const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
    const write=(offset,str)=>{for(let i=0;i<str.length;i++)view.setUint8(offset+i,str.charCodeAt(i));};
    write(0,"RIFF");view.setUint32(4,36+samples.length*2,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,"data");view.setUint32(40,samples.length*2,true);
    let offset=44;for(const sample of samples){const s=Math.max(-1,Math.min(1,sample));view.setInt16(offset,s<0?s*32768:s*32767,true);offset+=2;}return new Blob([buffer],{type:"audio/wav"});
  }
  function edit() {
    if(!engine||!mono)return;
    const start=Math.floor(Number($("startSlider").value)*sourceBuffer.sampleRate),end=Math.max(start+1,Math.floor(Number($("endSlider").value)*sourceBuffer.sampleRate));
    if(end<=start||end>mono.length){alert("開始位置と終了位置を確認してください。");return;}
    const semitones=Number($("pitchSlider").value),gain=Number($("gainSlider").value)/100;
    const outLength=engine._processed_length(mono.length,start,end,semitones);if(outLength<=0||outLength>sourceBuffer.sampleRate*60*10){alert("編集後の音声サイズが不正です。");return;}
    const inPtr=allocFloats(mono),outPtr=engine._malloc(outLength*4);
    try {
      const count=engine._process_audio(inPtr,mono.length,start,end,semitones,gain,outPtr,outLength);
      if(count<0)throw new Error("Audio processing failed");
      const samples=engine.HEAPF32.slice(outPtr/4,outPtr/4+count);editedWav=makeWav(samples,sourceBuffer.sampleRate);
      if(editedUrl)URL.revokeObjectURL(editedUrl);editedUrl=URL.createObjectURL(editedWav);editedPlayer.src=editedUrl;
      $("downloadWav").disabled=false;$("editInfo").textContent="生成完了 · "+fmt(count/sourceBuffer.sampleRate)+" · PCM 16-bit WAV";
    }catch(err){console.error(err);alert("編集に失敗しました: "+err.message);}finally{engine._free(inPtr);engine._free(outPtr);}
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportCsv(){if(!analysis)return;let csv="time_seconds,f0_hz\n";analysis.values.forEach((v,i)=>csv+=(i*analysis.hopSeconds).toFixed(4)+","+(v||"")+"\n");download(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),"myvocal_f0.csv");}
  fileInput.addEventListener("change",e=>loadFile(e.target.files[0]));
  ["dragenter","dragover"].forEach(name=>dropZone.addEventListener(name,e=>{e.preventDefault();dropZone.classList.add("dragging");}));
  ["dragleave","drop"].forEach(name=>dropZone.addEventListener(name,e=>{e.preventDefault();dropZone.classList.remove("dragging");}));
  dropZone.addEventListener("drop",e=>loadFile(e.dataTransfer.files[0]));
  $("analyzeButton").addEventListener("click",analyze);$("previewEdit").addEventListener("click",edit);
  $("downloadCsv").addEventListener("click",exportCsv);$("downloadWav").addEventListener("click",()=>editedWav&&download(editedWav,"myvocal_edited.wav"));
  $("playButton").addEventListener("click",()=>{if(player.paused)player.play();else player.pause();});
  $("stopButton").addEventListener("click",()=>{player.pause();player.currentTime=0;});
  player.addEventListener("timeupdate",()=>{$("timeReadout").textContent=fmt(player.currentTime)+" / "+fmt(player.duration||0);});
  $("pitchSlider").addEventListener("input",e=>$("pitchValue").textContent=e.target.value+" semitones");
  $("gainSlider").addEventListener("input",e=>$("gainValue").textContent=e.target.value+"%");
  $("startSlider").addEventListener("input",e=>{let v=Math.min(Number(e.target.value),Number($("endSlider").value)-0.01);e.target.value=Math.max(0,v);$("startValue").textContent=Number(e.target.value).toFixed(2)+" s";});
  $("endSlider").addEventListener("input",e=>{let v=Math.max(Number(e.target.value),Number($("startSlider").value)+0.01);e.target.value=Math.min(sourceBuffer?.duration||0,v);$("endValue").textContent=Number(e.target.value).toFixed(2)+" s";});
  $("resetEdit").addEventListener("click",()=>{$("pitchSlider").value=0;$("gainSlider").value=100;$("startSlider").value=0;$("endSlider").value=sourceBuffer.duration;$("pitchValue").textContent="0 semitones";$("gainValue").textContent="100%";$("startValue").textContent="0.00 s";$("endValue").textContent=sourceBuffer.duration.toFixed(2)+" s";});
  if(typeof createMyVocalEngine!=="function"){setStatus("WASM engine missing");return;}
  createMyVocalEngine().then(instance=>{engine=instance;setStatus("C++ / WASM ready",true);}).catch(err=>{console.error(err);setStatus("WASM load failed");});
})();
