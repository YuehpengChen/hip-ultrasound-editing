import {prepareEdit,runPreparedEdit,rgbaToGrayscale,extractNativeCrop,grayscaleBytes,solveTargetHead} from './geometry.mjs?v=20261010-fixed-origin';
import {captureInitialGeometry,boundTargetCenter,headHandlesAtCenter,targetPointsForRequest,anglesForPointer} from './bounded-controls.mjs?v=20261010-p4-ranges';
import {headCenter} from './landmark-controls.mjs?v=20261010-p5';
const $=id=>document.getElementById(id),BLUE='#42b5e5',YELLOW='#f1b64a';
const state={gray:null,width:256,height:256,points:Array(5).fill(null),head:Array(2).fill(null),initial:null,targetCenter:null,displayCenter:null,targetGeometry:null,prepared:null,signature:null,box:null,result:null,busy:false,job:0,modelReady:false};
let worker,readyResolve,readyReject,readyPromise,dragging=null;
const pending=new Map(),source=$('source'),edited=$('edited');
const finitePoint=p=>p&&p.length===2&&p.every(Number.isFinite);
function status(message,error=false){$('status').textContent=message;$('status').hidden=!message;$('status').classList.toggle('error',error);}
function ensureWorker(){
  if(worker)return;
  worker=new Worker(new URL('./model-worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    if(data.type==='progress'){$('progress').hidden=false;$('progress').value=Math.min(1,data.value);status('Loading model: '+Math.round(data.value*100)+'%');}
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
  const id=++state.job;
  const response=await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({type:'infer',id,image:tensors.image,mask:tensors.mask,geometry:tensors.geometry});});
  return response.prediction;
}
function invalidate(){state.result=null;$('result-state').textContent='';edited.getContext('2d').clearRect(0,0,edited.width,edited.height);$('diff-panel').hidden=true;status('');}
function hasPoints(){return state.points.every(finitePoint);}
function hasSourceHead(){return state.head.every(finitePoint)&&Math.hypot(state.head[0][0]-state.head[1][0],state.head[0][1]-state.head[1][1])>0;}
function captureSource(){
  if(!hasPoints())return;
  if(!state.initial&&dragging===null){
    state.initial=captureInitialGeometry(state.points,hasSourceHead()?state.head:null,state.width,state.height);
  }else if(state.initial&&!state.initial.sourceCenter&&hasSourceHead()&&dragging===null){
    // Adding the first H annotation never changes the initial roof landmarks/crop.
    state.initial=captureInitialGeometry(state.initial.points,state.head,state.width,state.height);
  }
  if(state.initial)state.box=state.initial.box;
}
function controlHead(){
  if(!state.initial?.sourceCenter)return state.head;
  return headHandlesAtCenter(state.initial,state.displayCenter??state.initial.sourceCenter);
}
function pointAt(index){
  if(index<5)return state.targetGeometry?.points[index]??state.points[index];
  if(index<7)return controlHead()[index-5];
  return state.displayCenter;
}
function pointLabel(index){return index<5?'p'+(index+1)+(state.initial&&index>=3?'*':''):index<7?'H'+(index-4):'f*';}
function locked(index){return state.initial?index<3||(index===7&&!state.initial.sourceCenter):index===7;}
function setTargetCenter(center){
  state.targetCenter=boundTargetCenter(state.initial,center);
  $('head-shift').checked=true;$('head-refine').checked=true;
}
function updateHeadPoint(index,point){
  if(state.initial?.sourceCenter){
    const endpoint=state.initial.headEndpoints[index],f=state.initial.sourceCenter;
    setTargetCenter(point.map((value,axis)=>value-(endpoint[axis]-f[axis])));
  }else{
    state.head[index]=point;
    if(hasSourceHead()){$('head-shift').checked=true;$('head-refine').checked=true;}
  }
}
function applyAngles(target,index=null){
  $('alpha').value=String(target.alpha);$('beta').value=String(target.beta);
  if(index===4||Math.abs(target.beta-state.initial.angles.beta)>1e-7)$('keep-beta').checked=false;
  $('beta').disabled=$('keep-beta').checked;
}
function updatePoint(index,point){
  if(index<5){
    if(state.initial){
      if(index<3)return;
      const target=anglesForPointer(state.initial,index,point,Number($('alpha').value),$('keep-beta').checked?null:Number($('beta').value));
      applyAngles(target,index);
    }else state.points[index]=point;
  }else if(index<7)updateHeadPoint(index-5,point);
  else if(state.initial?.sourceCenter)setTargetCenter(point);
}
function coordinateTable(){
  $('coordinates').replaceChildren();
  for(let i=0;i<8;i++){
    const row=document.createElement('tr'),label=document.createElement('td');label.textContent=pointLabel(i);row.append(label);
    for(let axis=0;axis<2;axis++){
      const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.step='0.1';input.dataset.point=i;input.dataset.axis=axis;
      input.addEventListener('change',()=>{
        if(state.busy||locked(i)){updateCoordinateInputs();return;}
        const n=Number(input.value);if(input.value===''||!Number.isFinite(n)||Math.abs(n)>10000){updateCoordinateInputs();return;}
        const point=(pointAt(i)??[null,null]).slice();point[axis]=n;
        try{updatePoint(i,point);changed();}catch(e){status(e.message,true);updateCoordinateInputs();}
      });td.append(input);row.append(td);
    }$('coordinates').append(row);
  }
}
function updateCoordinateInputs(){
  for(const input of $('coordinates').querySelectorAll('input')){
    const i=Number(input.dataset.point),axis=Number(input.dataset.axis),p=pointAt(i),label=pointLabel(i);
    input.setAttribute('aria-label',label+' '+(axis?'y':'x'));input.closest('tr').firstElementChild.textContent=label;
    input.value=Number.isFinite(p?.[axis])?p[axis].toFixed(2):'';input.disabled=state.busy||!state.gray||locked(i);
    input.closest('tr').classList.toggle('locked-point',locked(i));
  }
  const choice=$('point-choice');
  for(const option of choice.options){const i=Number(option.value);option.disabled=locked(i);if(i===3||i===4)option.textContent=pointLabel(i)+' · '+(i===3?'Bony rim':'Labrum centre');}
  if(choice.selectedOptions[0]?.disabled){const next=[...choice.options].find(option=>!option.disabled);if(next)choice.value=next.value;}
  $('reset-head-target').disabled=state.busy||!state.targetCenter;
  $('beta').disabled=state.busy||$('keep-beta').checked;
}
function prepare(){
  state.prepared=null;state.targetGeometry=null;state.displayCenter=null;
  if(!state.gray||!hasPoints())return;
  captureSource();
  if(!state.initial)return;
  const initial=state.initial,box=initial.box,shift=p=>[p[0]-box[0],p[1]-box[1]];
  const target=targetPointsForRequest(initial,Number($('alpha').value),$('keep-beta').checked?null:Number($('beta').value));
  applyAngles(target);state.targetGeometry=target;
  if(initial.sourceCenter){
    const requested=state.targetCenter??solveTargetHead(initial.points,initial.sourceCenter,target.alpha);
    state.displayCenter=boundTargetCenter(initial,requested);
  }
  // Every request starts with the original pixels and the captured source coordinates.
  const crop=extractNativeCrop(state.gray,state.width,state.height,box);
  state.prepared=prepareEdit({image:crop,normalized:true,points:initial.points.map(shift),targetAlpha:target.alpha,targetBeta:target.beta,
    headEndpoints:initial.headEndpoints?.map(shift)??null,targetHeadCenter:state.displayCenter?shift(state.displayCenter):null,
    headShift:$('head-shift').checked,headRefine:$('head-refine').checked});
}
function editSignature(){
  if(!state.prepared)return null;
  return JSON.stringify([state.prepared.targetAlpha,state.prepared.targetBeta,state.displayCenter,$('head-shift').checked,$('head-refine').checked,state.initial.headEndpoints]);
}
function changed(reset=false){
  if(state.busy)return;
  const previous=state.signature;
  $('delta').textContent='δ —';$('source-angles').textContent='Source α — β —';
  try{
    prepare();
    if(state.prepared){const a=state.initial.angles;$('source-angles').textContent='Source α '+a.alpha.toFixed(2)+'° · β '+a.beta.toFixed(2)+'°';
      if(state.displayCenter&&$('head-shift').checked){const f=state.initial.sourceCenter,d=state.displayCenter.map((v,i)=>v-f[i]);$('delta').textContent='δ = ('+d[0].toFixed(1)+', '+d[1].toFixed(1)+') px';}}
  }catch(e){state.prepared=null;status(e.message,true);}
  const next=editSignature();state.signature=next;
  if(previous!==next||reset){invalidate();if(!state.prepared&&hasPoints())status('Check the source landmarks and H endpoints.',true);}
  $('run').disabled=!state.prepared;updateCoordinateInputs();drawSource();
}
function imageData(bytes,w,h){const pixels=new Uint8ClampedArray(w*h*4);for(let i=0;i<bytes.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=bytes[i];pixels[i*4+3]=255;}return new ImageData(pixels,w,h);}
function displayScale(canvas){return state.width/(canvas.getBoundingClientRect().width||256);}
function drawLines(ctx,points,color,dashed=false){
  const scale=displayScale(ctx.canvas);ctx.strokeStyle=color;ctx.lineWidth=scale;ctx.setLineDash(dashed?[4*scale,3*scale]:[]);
  for(const [a,b]of[[0,1],[2,3],[3,4]]){if(!finitePoint(points[a])||!finitePoint(points[b]))continue;ctx.beginPath();ctx.moveTo(...points[a]);ctx.lineTo(...points[b]);ctx.stroke();}ctx.setLineDash([]);
}
function marker(ctx,p,label,color=BLUE,hollow=false,below=false,radius=3){
  if(!finitePoint(p)||p[0]<0||p[1]<0||p[0]>state.width||p[1]>state.height)return;
  const scale=displayScale(ctx.canvas);ctx.beginPath();ctx.arc(p[0],p[1],radius*scale,0,Math.PI*2);ctx.lineWidth=scale;
  if(!hollow){ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#111';}else{ctx.strokeStyle=color;ctx.lineWidth=1.5*scale;}ctx.stroke();
  if(!label)return;
  ctx.font='bold '+11*scale+'px Arial';ctx.lineWidth=2*scale;ctx.strokeStyle='#111';ctx.fillStyle=color;
  const labelWidth=ctx.measureText(label).width,x=Math.max(2*scale,Math.min(state.width-labelWidth-2*scale,p[0]+5*scale)),y=Math.max(12*scale,Math.min(state.height-2*scale,p[1]+(below?14:-5)*scale));
  ctx.strokeText(label,x,y);ctx.fillText(label,x,y);
}
function range(ctx,limit,color){
  if(!limit)return;
  const s=displayScale(ctx.canvas),box=limit.box;ctx.save();ctx.beginPath();ctx.rect(box[0],box[1],box[2]-box[0],box[3]-box[1]);ctx.clip();
  ctx.strokeStyle=color;ctx.lineWidth=s;ctx.setLineDash([3*s,3*s]);ctx.beginPath();ctx.arc(...limit.center,limit.radius,0,Math.PI*2);ctx.stroke();ctx.restore();
}
function drawSource(){
  if(!state.gray)return;
  source.width=state.width;source.height=state.height;const ctx=source.getContext('2d');ctx.putImageData(imageData(state.gray,state.width,state.height),0,0);
  if(!$('overlay').checked)return;
  range(ctx,state.initial?.rangeP4,BLUE);range(ctx,state.initial?.rangeHead,YELLOW);
  const points=state.targetGeometry?.points??state.points;drawLines(ctx,points,'#fff',Boolean(state.initial));
  points.forEach((p,i)=>marker(ctx,p,i>=3?pointLabel(i):'',BLUE,i<3&&Boolean(state.initial)));
  const head=controlHead();
  if(head.every(finitePoint)){ctx.strokeStyle=BLUE;ctx.lineWidth=displayScale(source);ctx.beginPath();ctx.moveTo(...head[0]);ctx.lineTo(...head[1]);ctx.stroke();}
  head.forEach((p,i)=>marker(ctx,p,'H'+(i+1),BLUE));
  const f=state.initial?.sourceCenter??(hasSourceHead()?headCenter(state.head):null);
  marker(ctx,f,'f',BLUE,false,false,4);
  marker(ctx,state.displayCenter,'f*',YELLOW,false,true);
}
function mergedResult(){const bytes=state.gray.slice(),crop=grayscaleBytes(state.result.image),[x0,y0]=state.box;for(let y=0;y<256;y++)for(let x=0;x<256;x++)bytes[(y+y0)*state.width+x+x0]=crop[y*256+x];return bytes;}
function resultPoints(ctx){
  if(!$('overlay').checked||!state.initial||!state.prepared)return;
  const initial=state.initial,points=state.prepared.targetPoints.map(p=>p.map((value,axis)=>value+state.box[axis]));
  initial.points.slice(0,3).forEach(p=>marker(ctx,p,'',BLUE,true));
  marker(ctx,initial.sourceCenter,'f',BLUE,false,false,4);
  points.slice(3).forEach((p,i)=>marker(ctx,p,i===0?'p4*':'',YELLOW));
  // Only display a translated target H when that operation was actually applied.
  if(state.prepared.headLayers&&initial.sourceCenter){
    const center=state.prepared.head.targetCenter.map((value,axis)=>value+state.box[axis]);
    const head=headHandlesAtCenter(initial,center);
    ctx.strokeStyle=YELLOW;ctx.lineWidth=displayScale(ctx.canvas);ctx.beginPath();ctx.moveTo(...head[0]);ctx.lineTo(...head[1]);ctx.stroke();
    head.forEach((p,i)=>marker(ctx,p,'H'+(i+1)+'*',YELLOW));
    marker(ctx,center,'f*',YELLOW,false,true);
  }
}
function drawResult(){
  if(!state.result)return;
  edited.width=state.width;edited.height=state.height;const ctx=edited.getContext('2d'),bytes=mergedResult();ctx.putImageData(imageData(bytes,state.width,state.height),0,0);
  resultPoints(ctx);
  const difference=new Uint8Array(state.width*state.height),[x0,y0]=state.box;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=y*256+x;difference[(y+y0)*state.width+x+x0]=Math.min(255,Math.round(Math.abs(state.result.image[i]-state.prepared.original[i])/0.35*255));}
  const canvas=$('difference');canvas.width=state.width;canvas.height=state.height;canvas.getContext('2d').putImageData(imageData(difference,state.width,state.height),0,0);$('diff-panel').hidden=!$('diff-toggle').checked;
}
async function setImage(blob,metadata=null){
  if(state.busy)return;dragging=null;
  const bitmap=await createImageBitmap(blob);if(state.busy){bitmap.close();return;}
  if(bitmap.width<256||bitmap.height<256||bitmap.width>4096||bitmap.height>4096){bitmap.close();throw new Error('Image dimensions must be between 256 and 4096 pixels.');}
  const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0);bitmap.close();
  state.gray=rgbaToGrayscale(ctx.getImageData(0,0,c.width,c.height).data);state.width=c.width;state.height=c.height;
  state.points=metadata?metadata.points.map(p=>p.slice()):Array(5).fill(null);state.head=metadata?.headEndpoints?metadata.headEndpoints.map(p=>p.slice()):Array(2).fill(null);
  state.initial=null;state.targetCenter=null;state.displayCenter=null;state.prepared=null;state.signature=null;state.targetGeometry=null;state.box=null;
  $('keep-beta').checked=true;
  if(metadata){$('alpha').value=Math.min(84,Math.max(30,metadata.source_alpha+10)).toFixed(1);$('beta').value=metadata.source_beta.toFixed(1);}
  $('source-size').textContent=c.width+' × '+c.height;edited.width=state.width;edited.height=state.height;$('point-choice').value='0';coordinateTable();changed(true);
}
function clickCoordinates(event){const rect=source.getBoundingClientRect();return[(event.clientX-rect.left)*state.width/rect.width,(event.clientY-rect.top)*state.height/rect.height];}
function pointerTarget(point){
  const threshold=7*displayScale(source),distance=p=>finitePoint(p)?Math.hypot(p[0]-point[0],p[1]-point[1]):Infinity;
  // f* is the editable inner yellow dot even when it initially overlaps f.
  if(state.displayCenter&&distance(state.displayCenter)<=3.5*displayScale(source))return 7;
  if(state.initial?.sourceCenter&&distance(state.initial.sourceCenter)<=threshold)return null;
  let nearest=null,best=threshold;
  for(let i=0;i<7;i++){const d=distance(pointAt(i));if(d<=best){nearest=i;best=d;}}
  if(nearest!==null)return locked(nearest)?null:nearest;
  const selected=Number($('point-choice').value);return locked(selected)?null:selected;
}
source.addEventListener('pointerdown',e=>{
  dragging=null;if(!state.gray||state.busy)return;
  const p=clickCoordinates(e);if(p[0]<0||p[1]<0||p[0]>=state.width||p[1]>=state.height)return;
  dragging=pointerTarget(p);if(dragging===null)return;
  source.setPointerCapture(e.pointerId);
  try{updatePoint(dragging,p);changed();}catch(err){status(err.message,true);}
});
source.addEventListener('pointermove',e=>{
  if(dragging===null||state.busy||locked(dragging))return;
  const p=clickCoordinates(e).map((v,i)=>Math.max(0,Math.min((i?state.height:state.width)-1,v)));
  try{updatePoint(dragging,p);changed();}catch(err){status(err.message,true);}
});
function finishDrag(){
  if(dragging!==null){
    const annotating=!state.initial||(dragging>=5&&dragging<7&&!state.initial.sourceCenter);
    if(annotating)$('point-choice').value=String(Math.min(6,dragging+1));
    dragging=null;if(annotating)changed(true);else updateCoordinateInputs();
  }
}
source.addEventListener('pointerup',finishDrag);source.addEventListener('pointercancel',finishDrag);
for(const id of ['alpha','beta','keep-beta','head-shift','head-refine'])$(id).addEventListener('change',()=>changed());
$('overlay').addEventListener('change',()=>{drawSource();drawResult();});
$('diff-toggle').addEventListener('change',()=>{$('diff-panel').hidden=!$('diff-toggle').checked||!state.result;});
$('reset-head-target').onclick=()=>{if(state.busy)return;state.targetCenter=null;changed();};
$('clear-h').onclick=()=>{
  if(state.busy)return;state.head=Array(2).fill(null);state.targetCenter=null;
  if(state.initial)state.initial=captureInitialGeometry(state.initial.points,null,state.width,state.height);
  $('point-choice').value='5';changed(true);
};
$('reset-points').onclick=()=>{
  if(state.busy)return;state.points=Array(5).fill(null);state.head=Array(2).fill(null);state.initial=null;state.targetCenter=null;state.box=null;$('point-choice').value='0';changed(true);
};
$('choose-image').onclick=()=>{$('upload').click();};
$('upload').onchange=async e=>{try{if(e.target.files[0])await setImage(e.target.files[0]);}catch(err){status(err.message,true);}};
async function runEdit(){
  if(state.busy)return;
  try{
    prepare();if(!state.prepared)throw new Error('Five source landmarks are required.');
    state.busy=true;for(const input of document.querySelectorAll('input,select,button'))input.disabled=true;
    const start=performance.now();if(!state.prepared.same)await loadModel();status('Running…');
    state.result=await runPreparedEdit(state.prepared,generate);state.result.elapsed=(performance.now()-start)/1000;
    drawResult();$('result-state').textContent=state.width+' × '+state.height;
    status(state.result.generatorCalls?'Done · '+state.result.elapsed.toFixed(2)+' s':'Unchanged');
  }catch(e){status(e.message,true);}
  finally{state.busy=false;for(const input of document.querySelectorAll('input,select,button'))input.disabled=false;updateCoordinateInputs();$('run').disabled=!state.prepared;$('progress').hidden=true;}
}
$('run').onclick=runEdit;coordinateTable();updateCoordinateInputs();
window.addEventListener('resize',()=>{drawSource();drawResult();});
try{
  const response=await fetch('./samples/samples.json');if(!response.ok)throw new Error('Failed to load examples.');
  const samples=await response.json();
  for(let i=0;i<samples.length;i++){
    const example=samples[i],button=document.createElement('button');button.textContent='Example '+(i+1);
    button.onclick=async()=>{try{const response=await fetch(new URL('./samples/'+example.image,import.meta.url));if(!response.ok)throw new Error('Failed to load example image.');await setImage(await response.blob(),example);}catch(e){status(e.message,true);}};
    $('examples').append(button);
  }
}catch(e){status(e.message,true);}
