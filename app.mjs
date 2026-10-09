import {prepareEdit,runPreparedEdit,rgbaToGrayscale,cropBox,extractNativeCrop,grayscaleBytes} from './geometry.mjs';
const $ = id=>document.getElementById(id);
const state={gray:null,width:256,height:256,points:Array(5).fill(null),head:Array(2).fill(null),prepared:null,box:null,result:null,busy:false,job:0,modelReady:false};
let worker,readyResolve,readyReject,readyPromise; const pending=new Map();
const source=$('source'),edited=$('edited');
function status(message,error=false){$('status').textContent=message;$('status').hidden=!message;$('status').classList.toggle('error',error);}
function ensureWorker(){
  if(worker)return;
  worker=new Worker(new URL('./model-worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='progress'){$('progress').hidden=false;$('progress').value=Math.min(1,data.value);status(`Loading model: ${Math.round(data.value*100)}%`);}
    if(data.type==='initializing'){status('Initializing…');$('progress').hidden=true;}
    if(data.type==='ready'){state.modelReady=true;readyResolve?.();status('Running…');}
    if(data.type==='prediction'){pending.get(data.id)?.resolve(data);pending.delete(data.id);}
    if(data.type==='error'){pending.get(data.id)?.reject(new Error(data.message));pending.delete(data.id);readyReject?.(new Error(data.message));}
  };
  worker.onerror=e=>{status('Browser worker failed to load.',true);readyReject?.(new Error(e.message));for(const p of pending.values())p.reject(new Error(e.message));pending.clear();};
}
async function loadModel(){
  if(state.modelReady)return;
  ensureWorker();
  if(!readyPromise){readyPromise=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});worker.postMessage({type:'load',url:new URL('./models/angleviz_v4_fp32.onnx',import.meta.url).href});}
  try{await readyPromise;}catch(e){readyPromise=null;throw e;}
}
async function generate(tensors){
  const id=++state.job;const response=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({type:'infer',id,image:tensors.image,mask:tensors.mask,geometry:tensors.geometry});});
  return response.prediction;
}
function invalidate(){state.result=null;$('download').disabled=true;$('parameters').disabled=true;$('result-state').textContent='';edited.getContext('2d').clearRect(0,0,edited.width,edited.height);$('diff-panel').hidden=true;status('');}
function coordinateTable(){
  $('coordinates').replaceChildren();
  for(let i=0;i<7;i++){
    const row=document.createElement('tr'),label=document.createElement('td');label.textContent=i<5?`p${i+1}`:`H${i-4}`;row.append(label);
    for(let axis=0;axis<2;axis++){
      const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.step='0.1';input.setAttribute('aria-label',`${label.textContent} ${axis?'y':'x'}`);input.dataset.point=i;input.dataset.axis=axis;
      const point=i<5?state.points[i]:state.head[i-5];input.value=point?point[axis].toFixed(2):'';
      input.addEventListener('change',()=>{
        const n=Number(input.value);if(input.value===''||!Number.isFinite(n)||Math.abs(n)>10000)return;
        const collection=i<5?state.points:state.head,index=i<5?i:i-5;
        if(!collection[index])collection[index]=[0,0];collection[index][axis]=n;changed(false);
      });td.append(input);row.append(td);
    }$('coordinates').append(row);
  }
}
function updateCoordinateInputs(){for(const input of $('coordinates').querySelectorAll('input')){const i=Number(input.dataset.point),a=Number(input.dataset.axis),p=i<5?state.points[i]:state.head[i-5];input.value=p?p[a].toFixed(2):'';input.disabled=state.busy;}}
function hasPoints(){return state.points.every(p=>p&&p.every(Number.isFinite));}
function prepare(){
  if(!state.gray||!hasPoints()){state.prepared=null;return;}
  const box=cropBox(state.points,state.width,state.height),shift=p=>[p[0]-box[0],p[1]-box[1]];
  const crop=extractNativeCrop(state.gray,state.width,state.height,box);
  const alpha=Number($('alpha').value),beta=$('keep-beta').checked?null:Number($('beta').value);
  if(!Number.isFinite(alpha)||alpha<30||alpha>84)throw new Error('Target α* must be between 30° and 84°.');
  if(beta!==null&&(!Number.isFinite(beta)||beta<=0||beta>=90))throw new Error('Target β* must be between 0° and 90°.');
  state.prepared=prepareEdit({image:crop,normalized:true,points:state.points.map(shift),targetAlpha:alpha,targetBeta:beta,headEndpoints:state.head.every(Boolean)?state.head.map(shift):null,headShift:$('head-shift').checked,headRefine:$('head-refine').checked});state.box=box;
}
function changed(sync=true){
  if(state.busy)return;invalidate();
  $('delta').textContent='δ —';$('source-angles').textContent='Source α — β —';
  try{prepare();if(state.prepared){const a=state.prepared.sourceAngles;$('source-angles').textContent=`Source α ${a.alpha.toFixed(2)}° · β ${a.beta.toFixed(2)}°`;const h=state.prepared.head;$('delta').textContent=h&&$('head-shift').checked?`δ = (${h.delta[0].toFixed(1)}, ${h.delta[1].toFixed(1)}) px`:'δ —';$('run').disabled=false;}else{$('run').disabled=true;}}
  catch(e){state.prepared=null;$('run').disabled=true;status(e.message,true);}
  if(sync)updateCoordinateInputs();drawSource();
}
function imageData(bytes,w,h){const pixels=new Uint8ClampedArray(w*h*4);for(let i=0;i<bytes.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=bytes[i];pixels[i*4+3]=255;}return new ImageData(pixels,w,h);}
function line(ctx,points,color,dashed=false){ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.8,state.width/256*1.6);ctx.setLineDash(dashed?[state.width/60,state.width/90]:[]);for(const [a,b]of[[0,1],[2,3],[3,4]]){ctx.beginPath();ctx.moveTo(...points[a]);ctx.lineTo(...points[b]);ctx.stroke();}ctx.setLineDash([]);}
function marker(ctx,p,label,hollow=false){if(!p||p[0]<0||p[1]<0||p[0]>state.width||p[1]>state.height)return;const scale=Math.max(1,state.width/256),r=3.5*scale;ctx.beginPath();ctx.arc(p[0],p[1],r,0,Math.PI*2);ctx.fillStyle='#fff';ctx.strokeStyle='#111';ctx.lineWidth=1.2*scale;if(!hollow)ctx.fill();else{ctx.strokeStyle='#fff';ctx.lineWidth=2*scale;}ctx.stroke();ctx.font=`bold ${10*scale}px Arial`;ctx.lineWidth=2.5*scale;ctx.strokeStyle='#111';ctx.fillStyle='#fff';const x=Math.max(3,Math.min(state.width-24*scale,p[0]+6*scale)),y=Math.max(13*scale,Math.min(state.height-3,p[1]-6*scale));ctx.strokeText(label,x,y);ctx.fillText(label,x,y);}
function overlays(canvas,target=false){if(!$('overlay').checked||!hasPoints())return;const ctx=canvas.getContext('2d');const pts=target&&state.prepared?state.prepared.targetPoints.map(p=>[p[0]+state.box[0],p[1]+state.box[1]]):state.points;line(ctx,pts,'#fff',target);pts.forEach((p,i)=>marker(ctx,p,`p${i+1}${target?'*':''}`,target));if(state.head.every(Boolean)){const c=target&&state.prepared?.head?state.prepared.head.targetCenter.map((v,i)=>v+state.box[i]):[(state.head[0][0]+state.head[1][0])/2,(state.head[0][1]+state.head[1][1])/2];marker(ctx,c,target?'f*':'f',target);}}
function drawSource(){if(!state.gray)return;source.width=state.width;source.height=state.height;source.getContext('2d').putImageData(imageData(state.gray,state.width,state.height),0,0);overlays(source,false);if($('overlay').checked){if(state.head[0])marker(source.getContext('2d'),state.head[0],'H1');if(state.head[1])marker(source.getContext('2d'),state.head[1],'H2');}}
function mergedResult(){const bytes=state.gray.slice(),crop=grayscaleBytes(state.result.image),[x0,y0]=state.box;for(let y=0;y<256;y++)for(let x=0;x<256;x++)bytes[(y+y0)*state.width+x+x0]=crop[y*256+x];return bytes;}
function drawResult(){if(!state.result)return;edited.width=state.width;edited.height=state.height;const bytes=mergedResult();edited.getContext('2d').putImageData(imageData(bytes,state.width,state.height),0,0);overlays(edited,true);const difference=new Uint8Array(state.width*state.height),[x0,y0]=state.box;for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=y*256+x;difference[(y+y0)*state.width+x+x0]=Math.min(255,Math.round(Math.abs(state.result.image[i]-state.prepared.original[i])/0.35*255));}const canvas=$('difference');canvas.width=state.width;canvas.height=state.height;canvas.getContext('2d').putImageData(imageData(difference,state.width,state.height),0,0);$('diff-panel').hidden=!$('diff-toggle').checked;}
async function setImage(blob,metadata=null){
  if(state.busy)return;const bitmap=await createImageBitmap(blob);if(bitmap.width<256||bitmap.height<256||bitmap.width>4096||bitmap.height>4096){bitmap.close();throw new Error('Image dimensions must be between 256 and 4096 pixels.');}
  const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0);bitmap.close();state.gray=rgbaToGrayscale(ctx.getImageData(0,0,c.width,c.height).data);state.width=c.width;state.height=c.height;
  state.points=metadata?metadata.points.map(p=>p.slice()):Array(5).fill(null);state.head=metadata?.headEndpoints?metadata.headEndpoints.map(p=>p.slice()):Array(2).fill(null);
  if(metadata){$('alpha').value=Math.min(84,Math.max(30,metadata.source_alpha+10)).toFixed(1);$('beta').value=metadata.source_beta.toFixed(1);}
  $('source-size').textContent=`${c.width} × ${c.height}`;edited.width=state.width;edited.height=state.height;coordinateTable();changed();
}
function clickCoordinates(event){const rect=source.getBoundingClientRect(),scale=Math.min(rect.width/state.width,rect.height/state.height),left=rect.left+(rect.width-state.width*scale)/2,top=rect.top+(rect.height-state.height*scale)/2;return[(event.clientX-left)/scale,(event.clientY-top)/scale];}
let dragging=null;
source.addEventListener('pointerdown',e=>{if(!state.gray||state.busy)return;const p=clickCoordinates(e);if(p[0]<0||p[1]<0||p[0]>=state.width||p[1]>=state.height)return;const all=[...state.points,...state.head];const threshold=8*state.width/source.getBoundingClientRect().width;dragging=all.findIndex(q=>q&&Math.hypot(q[0]-p[0],q[1]-p[1])<threshold);if(dragging<0)dragging=Number($('point-choice').value);const collection=dragging<5?state.points:state.head,index=dragging<5?dragging:dragging-5;collection[index]=p;source.setPointerCapture(e.pointerId);changed();});
source.addEventListener('pointermove',e=>{if(dragging===null||state.busy)return;const p=clickCoordinates(e);p[0]=Math.max(0,Math.min(state.width-1,p[0]));p[1]=Math.max(0,Math.min(state.height-1,p[1]));(dragging<5?state.points:state.head)[dragging<5?dragging:dragging-5]=p;changed();});
source.addEventListener('pointerup',()=>{if(dragging!==null){$('point-choice').value=String(Math.min(6,dragging+1));dragging=null;}});source.addEventListener('pointercancel',()=>{dragging=null;});
for(const id of ['alpha','beta','keep-beta','head-shift','head-refine'])$(id).addEventListener('change',()=>{$('beta').disabled=$('keep-beta').checked;changed();});
$('overlay').addEventListener('change',()=>{drawSource();drawResult();});$('diff-toggle').addEventListener('change',()=>{$('diff-panel').hidden=!$('diff-toggle').checked||!state.result;});
$('clear-h').onclick=()=>{if(state.busy)return;state.head=Array(2).fill(null);changed();};$('reset-points').onclick=()=>{if(state.busy)return;state.points=Array(5).fill(null);state.head=Array(2).fill(null);changed();};
$('choose-image').onclick=()=>{$('upload').click();};
$('upload').onchange=async e=>{try{if(e.target.files[0])await setImage(e.target.files[0]);}catch(err){status(err.message,true);}};
$('run').onclick=async()=>{
  if(state.busy)return;try{prepare();if(!state.prepared)throw new Error('Five source landmarks are required.');state.busy=true;for(const input of document.querySelectorAll('input,select,button'))input.disabled=true;const start=performance.now();if(!state.prepared.same)await loadModel();status('Running…');state.result=await runPreparedEdit(state.prepared,generate);state.result.elapsed=(performance.now()-start)/1000;drawResult();$('result-state').textContent=`${state.width} × ${state.height}`;$('download').disabled=false;$('parameters').disabled=false;status(state.result.generatorCalls?`Done · ${state.result.elapsed.toFixed(2)} s`:'Unchanged');}
  catch(e){status(e.message,true);}
  finally{state.busy=false;for(const input of document.querySelectorAll('input,select,button'))input.disabled=false;$('beta').disabled=$('keep-beta').checked;$('run').disabled=!state.prepared;$('download').disabled=!state.result;$('parameters').disabled=!state.result;$('progress').hidden=true;}
};
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('download').onclick=()=>{if(!state.result)return;const c=document.createElement('canvas');c.width=state.width;c.height=state.height;c.getContext('2d').putImageData(imageData(mergedResult(),state.width,state.height),0,0);c.toBlob(blob=>downloadBlob(blob,'edited-hip.png'),'image/png');};
$('parameters').onclick=()=>{if(!state.result)return;const p=state.prepared,metadata={coordinateFrame:'sourcePoints, targetPoints and H are crop-local pixels; cropBox is in original-image pixels',originalImageSize:[state.width,state.height],sourcePoints:p.sourcePoints,targetPoints:p.targetPoints,sourceAngles:p.sourceAngles,targetAlpha:p.targetAlpha,targetBeta:p.targetBeta,H:state.head.every(Boolean)?state.head.map(v=>[v[0]-state.box[0],v[1]-state.box[1]]):null,headShift:$('head-shift').checked,headRefine:$('head-refine').checked,prescribedDelta:p.head?.delta??null,cropBox:state.box,generatorCalls:state.result.generatorCalls,modelSHA256:'af028a3ffb524b7c9dc90a93e9f21e59cb154d23749a8a34aa35d0990d8dce07',warning:'Requested geometry is not measured output anatomy. Research only.'};downloadBlob(new Blob([JSON.stringify(metadata,null,2)],{type:'application/json'}),'editing-parameters.json');};
coordinateTable();
try{const response=await fetch('./samples/samples.json');if(!response.ok)throw new Error('Failed to load examples.');const samples=await response.json();for(let i=0;i<samples.length;i++){const example=samples[i],button=document.createElement('button');button.textContent=`Example ${i+1}`;button.onclick=async()=>{try{const response=await fetch(new URL('./samples/'+example.image,import.meta.url));if(!response.ok)throw new Error('Failed to load example image.');await setImage(await response.blob(),example);}catch(e){status(e.message,true);}};$('examples').append(button);}}
catch(e){status(e.message,true);}
