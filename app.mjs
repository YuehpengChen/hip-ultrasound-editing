import {prepareEdit,runPreparedEdit,rgbaToGrayscale,cropBox,extractNativeCrop,grayscaleBytes} from './geometry.mjs?v=20261010-head-target';
import {LOCKED_COLOR,EDITABLE_COLOR,isFixedSourcePoint,isLockedSourcePoint,headCenter,resolveSourcePointerTarget} from './landmark-controls.mjs?v=20261010-p5';
import {targetHeadEndpoints,moveTargetHead} from './head-controls.mjs?v=20261010-head-target';
import {createHeadEditRunner,headEditSignature} from './head-edit-runner.mjs?v=20261010-head-auto';
const $ = id=>document.getElementById(id);
const state={gray:null,width:256,height:256,points:Array(5).fill(null),head:Array(2).fill(null),targetHead:null,headModePending:false,prepared:null,box:null,result:null,busy:false,job:0,modelReady:false};
let worker,readyResolve,readyReject,readyPromise; const pending=new Map();
const source=$('source'),edited=$('edited');
const headEditRunner=createHeadEditRunner({run:runEdit,canRun:()=>!state.busy&&Boolean(headEditSignature(state.prepared,state.box))});
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
function invalidate(){state.result=null;$('result-state').textContent='';edited.getContext('2d').clearRect(0,0,edited.width,edited.height);$('diff-panel').hidden=true;status('');}
function hasSourceHead(){return Boolean(headCenter(state.head))&&Math.hypot(state.head[0][0]-state.head[1][0],state.head[0][1]-state.head[1][1])>0;}
function targetMode(){return $('head-controls').value==='target';}
function controlHead(){
  if(!targetMode())return state.head;
  if(state.targetHead&&$('head-shift').checked)return state.targetHead;
  const center=state.prepared?.head?.targetCenter.map((value,axis)=>value+state.box[axis])??headCenter(state.head);
  return targetHeadEndpoints(state.head,center)??state.head;
}
function updateHeadPoint(index,point,autoTarget=true){
  if(targetMode()){
    if(!$('head-shift').checked||!hasSourceHead())return;
    state.targetHead=moveTargetHead(controlHead(),index,point);
  }else{const incomplete=!hasSourceHead();state.head[index]=point;state.targetHead=null;if(autoTarget&&incomplete&&hasSourceHead())state.headModePending=true;}
  if(hasSourceHead()){$('head-shift').checked=true;$('head-refine').checked=true;}
}
function finishSourceHead(){
  if(state.headModePending&&hasSourceHead()&&hasPoints()){$('head-controls').value='target';state.headModePending=false;updateCoordinateInputs();drawSource();}
}
function coordinateTable(){
  $('coordinates').replaceChildren();
  for(let i=0;i<7;i++){
    const row=document.createElement('tr'),label=document.createElement('td');label.textContent=i<5?`p${i+1}`:`H${i-4}`;row.append(label);
    for(let axis=0;axis<2;axis++){
      const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.step='0.1';input.setAttribute('aria-label',`${label.textContent} ${axis?'y':'x'}`);input.dataset.point=i;input.dataset.axis=axis;
      const point=i<5?state.points[i]:controlHead()[i-5];input.value=point?point[axis].toFixed(2):'';
      input.addEventListener('change',()=>{
        if(state.busy||isFixedSourcePoint(i)){updateCoordinateInputs();return;}
        const n=Number(input.value);if(input.value===''||!Number.isFinite(n)||Math.abs(n)>10000)return;
        if(i<5){if(!state.points[i])state.points[i]=[0,0];state.points[i][axis]=n;}
        else{const point=(controlHead()[i-5]??[0,0]).slice();point[axis]=n;updateHeadPoint(i-5,point,false);}
        changed();
      });td.append(input);row.append(td);
    }$('coordinates').append(row);
  }
}
function updateCoordinateInputs(){
  const controls=controlHead(),target=targetMode();
  for(const input of $('coordinates').querySelectorAll('input')){
    const i=Number(input.dataset.point),a=Number(input.dataset.axis),p=i<5?state.points[i]:controls[i-5];
    const label=i<5?`p${i+1}`:`H${i-4}${target?'*':''}`;
    input.setAttribute('aria-label',`${label} ${a?'y':'x'}`);input.closest('tr').firstElementChild.textContent=label;
    input.value=p?p[a].toFixed(2):'';input.disabled=state.busy||!state.gray||isFixedSourcePoint(i)||(i>=5&&target&&!$('head-shift').checked);
    input.closest('tr').classList.toggle('locked-point',isLockedSourcePoint(i,state.points));
  }
  const choice=$('point-choice');
  for(const option of choice.options){const i=Number(option.value);option.disabled=isLockedSourcePoint(i,state.points)||(i>=5&&target&&!$('head-shift').checked);if(i>=5)option.textContent=`H${i-4}${target?'*':''} · ${target?'Target':'Source'} diameter endpoint ${i-4}`;}
  if(choice.selectedOptions[0]?.disabled){const next=[...choice.options].find(option=>!option.disabled);if(next)choice.value=next.value;}
  $('head-controls').disabled=state.busy||!hasSourceHead()||!hasPoints();
  $('reset-head-target').disabled=state.busy||!state.targetHead;
}
function hasPoints(){return state.points.every(p=>p&&p.every(Number.isFinite));}
function prepare(){
  if(!state.gray||!hasPoints()){state.prepared=null;return;}
  const box=cropBox(state.points,state.width,state.height),shift=p=>[p[0]-box[0],p[1]-box[1]];
  const crop=extractNativeCrop(state.gray,state.width,state.height,box);
  const alpha=Number($('alpha').value),beta=$('keep-beta').checked?null:Number($('beta').value);
  if(!Number.isFinite(alpha)||alpha<30||alpha>84)throw new Error('Target α* must be between 30° and 84°.');
  if(beta!==null&&(!Number.isFinite(beta)||beta<=0||beta>=90))throw new Error('Target β* must be between 0° and 90°.');
  const targetCenter=headCenter(state.targetHead),localTarget=targetCenter?shift(targetCenter):null;
  if(localTarget&&$('head-shift').checked&&localTarget.some(value=>value<0||value>=256))throw new Error('Target f* must stay inside the native 256 × 256 editing region.');
  state.prepared=prepareEdit({image:crop,normalized:true,points:state.points.map(shift),targetAlpha:alpha,targetBeta:beta,headEndpoints:state.head.every(Boolean)?state.head.map(shift):null,targetHeadCenter:localTarget,headShift:$('head-shift').checked,headRefine:$('head-refine').checked});state.box=box;
}
function changed(sync=true,autoHead=true){
  if(state.busy)return;
  const previousHead=headEditSignature(state.prepared,state.box),pendingHead=headEditRunner.isPending();
  headEditRunner.cancel();invalidate();
  $('delta').textContent='δ —';$('source-angles').textContent='Source α — β —';
  try{prepare();if(state.prepared){const a=state.prepared.sourceAngles;$('source-angles').textContent=`Source α ${a.alpha.toFixed(2)}° · β ${a.beta.toFixed(2)}°`;const h=state.prepared.head;$('delta').textContent=h&&$('head-shift').checked?`δ = (${h.delta[0].toFixed(1)}, ${h.delta[1].toFixed(1)}) px`:'δ —';$('run').disabled=false;}else{$('run').disabled=true;}}
  catch(e){state.prepared=null;$('run').disabled=true;status(e.message,true);}
  if(sync)updateCoordinateInputs();drawSource();
  const nextHead=headEditSignature(state.prepared,state.box);
  if(autoHead&&nextHead&&(nextHead!==previousHead||pendingHead))headEditRunner.request();
}
function imageData(bytes,w,h){const pixels=new Uint8ClampedArray(w*h*4);for(let i=0;i<bytes.length;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=bytes[i];pixels[i*4+3]=255;}return new ImageData(pixels,w,h);}
function displayScale(canvas){return state.width/(canvas.getBoundingClientRect().width||256);}
function line(ctx,points,color,dashed=false){
  const scale=displayScale(ctx.canvas);ctx.strokeStyle=color;ctx.lineWidth=scale;ctx.setLineDash(dashed?[4*scale,3*scale]:[]);
  for(const [a,b]of[[0,1],[2,3],[3,4]]){if(!points[a]||!points[b])continue;ctx.beginPath();ctx.moveTo(...points[a]);ctx.lineTo(...points[b]);ctx.stroke();}ctx.setLineDash([]);
}
function marker(ctx,p,label,locked=false,hollow=false,below=false){
  if(!p||p[0]<0||p[1]<0||p[0]>state.width||p[1]>state.height)return;
  const scale=displayScale(ctx.canvas),r=3*scale,color=locked?LOCKED_COLOR:EDITABLE_COLOR;
  ctx.beginPath();ctx.arc(p[0],p[1],r,0,Math.PI*2);ctx.lineWidth=scale;
  if(!hollow){ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#111';}else{ctx.strokeStyle=color;ctx.lineWidth=1.5*scale;}
  ctx.stroke();ctx.font=`bold ${11*scale}px Arial`;ctx.lineWidth=2*scale;ctx.strokeStyle='#111';ctx.fillStyle=color;
  const labelWidth=ctx.measureText(label).width;
  const x=Math.max(2*scale,Math.min(state.width-labelWidth-2*scale,p[0]+5*scale)),y=Math.max(12*scale,Math.min(state.height-2*scale,p[1]+(below?14:-5)*scale));
  ctx.strokeText(label,x,y);ctx.fillText(label,x,y);
}
function overlays(canvas,target=false){
  if(!$('overlay').checked)return;
  const ctx=canvas.getContext('2d'),pts=target&&state.prepared?state.prepared.targetPoints.map(p=>[p[0]+state.box[0],p[1]+state.box[1]]):state.points;
  line(ctx,pts,'#fff',target);pts.forEach((p,i)=>marker(ctx,p,`p${i+1}${target?'*':''}`,target||isLockedSourcePoint(i,state.points),target));
  const c=target&&state.prepared?.head?state.prepared.head.targetCenter.map((v,i)=>v+state.box[i]):headCenter(state.head);
  marker(ctx,c,target?'f*':'f',true,target);
}
function drawSource(){if(!state.gray)return;source.width=state.width;source.height=state.height;source.getContext('2d').putImageData(imageData(state.gray,state.width,state.height),0,0);overlays(source,false);if($('overlay').checked){const ctx=source.getContext('2d'),head=controlHead(),target=targetMode(),locked=target&&!$('head-shift').checked;if(head[0])marker(ctx,head[0],target?'H1*':'H1',locked);if(head[1])marker(ctx,head[1],target?'H2*':'H2',locked);if(target)marker(ctx,headCenter(head),'f*',true,true,true);}}
function mergedResult(){const bytes=state.gray.slice(),crop=grayscaleBytes(state.result.image),[x0,y0]=state.box;for(let y=0;y<256;y++)for(let x=0;x<256;x++)bytes[(y+y0)*state.width+x+x0]=crop[y*256+x];return bytes;}
function drawResult(){if(!state.result)return;edited.width=state.width;edited.height=state.height;const bytes=mergedResult();edited.getContext('2d').putImageData(imageData(bytes,state.width,state.height),0,0);overlays(edited,true);const difference=new Uint8Array(state.width*state.height),[x0,y0]=state.box;for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=y*256+x;difference[(y+y0)*state.width+x+x0]=Math.min(255,Math.round(Math.abs(state.result.image[i]-state.prepared.original[i])/0.35*255));}const canvas=$('difference');canvas.width=state.width;canvas.height=state.height;canvas.getContext('2d').putImageData(imageData(difference,state.width,state.height),0,0);$('diff-panel').hidden=!$('diff-toggle').checked;}
async function setImage(blob,metadata=null){
  if(state.busy)return;headEditRunner.cancel();const bitmap=await createImageBitmap(blob);if(state.busy){bitmap.close();return;}if(bitmap.width<256||bitmap.height<256||bitmap.width>4096||bitmap.height>4096){bitmap.close();throw new Error('Image dimensions must be between 256 and 4096 pixels.');}
  const c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0);bitmap.close();state.gray=rgbaToGrayscale(ctx.getImageData(0,0,c.width,c.height).data);state.width=c.width;state.height=c.height;
  state.points=metadata?metadata.points.map(p=>p.slice()):Array(5).fill(null);state.head=metadata?.headEndpoints?metadata.headEndpoints.map(p=>p.slice()):Array(2).fill(null);state.targetHead=null;state.headModePending=false;$('head-controls').value=hasSourceHead()?'target':'source';
  if(metadata){$('alpha').value=Math.min(84,Math.max(30,metadata.source_alpha+10)).toFixed(1);$('beta').value=metadata.source_beta.toFixed(1);}
  $('source-size').textContent=`${c.width} × ${c.height}`;edited.width=state.width;edited.height=state.height;$('point-choice').value='0';coordinateTable();changed(true,false);
}
function clickCoordinates(event){const rect=source.getBoundingClientRect(),scale=Math.min(rect.width/state.width,rect.height/state.height),left=rect.left+(rect.width-state.width*scale)/2,top=rect.top+(rect.height-state.height*scale)/2;return[(event.clientX-left)/scale,(event.clientY-top)/scale];}
let dragging=null;
source.addEventListener('pointerdown',e=>{
  dragging=null;if(!state.gray||state.busy)return;
  const p=clickCoordinates(e);if(p[0]<0||p[1]<0||p[0]>=state.width||p[1]>=state.height)return;
  const threshold=7*displayScale(source),fixedCenter=headCenter(state.head);
  if(fixedCenter&&Math.hypot(fixedCenter[0]-p[0],fixedCenter[1]-p[1])<=threshold)return;
  dragging=resolveSourcePointerTarget({points:state.points,head:controlHead(),point:p,selectedIndex:Number($('point-choice').value),threshold});
  if(dragging===null)return;
  if(dragging>=5&&targetMode()&&!$('head-shift').checked){dragging=null;return;}
  headEditRunner.hold();
  if(dragging<5)state.points[dragging]=p;else updateHeadPoint(dragging-5,p);
  source.setPointerCapture(e.pointerId);changed();
});
source.addEventListener('pointermove',e=>{if(dragging===null||state.busy||isLockedSourcePoint(dragging,state.points))return;const p=clickCoordinates(e);p[0]=Math.max(0,Math.min(state.width-1,p[0]));p[1]=Math.max(0,Math.min(state.height-1,p[1]));if(dragging<5)state.points[dragging]=p;else updateHeadPoint(dragging-5,p);changed();});
source.addEventListener('pointerup',()=>{if(dragging!==null){$('point-choice').value=String(Math.min(6,dragging+1));dragging=null;finishSourceHead();updateCoordinateInputs();headEditRunner.release();}});source.addEventListener('pointercancel',()=>{dragging=null;finishSourceHead();headEditRunner.release();});
for(const id of ['alpha','beta','keep-beta','head-shift','head-refine'])$(id).addEventListener('change',()=>{$('beta').disabled=$('keep-beta').checked;changed();});
$('overlay').addEventListener('change',()=>{drawSource();drawResult();});$('diff-toggle').addEventListener('change',()=>{$('diff-panel').hidden=!$('diff-toggle').checked||!state.result;});
$('head-controls').addEventListener('change',()=>{state.headModePending=false;updateCoordinateInputs();drawSource();});
$('reset-head-target').onclick=()=>{if(state.busy)return;state.targetHead=null;changed();};
$('clear-h').onclick=()=>{if(state.busy)return;state.head=Array(2).fill(null);state.targetHead=null;state.headModePending=false;$('head-controls').value='source';$('point-choice').value='5';changed();};$('reset-points').onclick=()=>{if(state.busy)return;state.points=Array(5).fill(null);state.head=Array(2).fill(null);state.targetHead=null;state.headModePending=false;$('head-controls').value='source';$('point-choice').value='0';changed();};
$('choose-image').onclick=()=>{$('upload').click();};
$('upload').onchange=async e=>{try{if(e.target.files[0])await setImage(e.target.files[0]);}catch(err){status(err.message,true);}};
async function runEdit(){
  if(state.busy)return;headEditRunner.cancel();try{prepare();if(!state.prepared)throw new Error('Five source landmarks are required.');state.busy=true;for(const input of document.querySelectorAll('input,select,button'))input.disabled=true;const start=performance.now();if(!state.prepared.same)await loadModel();status('Running…');state.result=await runPreparedEdit(state.prepared,generate);state.result.elapsed=(performance.now()-start)/1000;drawResult();$('result-state').textContent=`${state.width} × ${state.height}`;status(state.result.generatorCalls?`Done · ${state.result.elapsed.toFixed(2)} s`:'Unchanged');}
  catch(e){status(e.message,true);}
  finally{state.busy=false;for(const input of document.querySelectorAll('input,select,button'))input.disabled=false;updateCoordinateInputs();$('beta').disabled=$('keep-beta').checked;$('run').disabled=!state.prepared;$('progress').hidden=true;}
}
$('run').onclick=runEdit;
coordinateTable();
updateCoordinateInputs();
window.addEventListener('resize',()=>{drawSource();drawResult();});
try{const response=await fetch('./samples/samples.json');if(!response.ok)throw new Error('Failed to load examples.');const samples=await response.json();for(let i=0;i<samples.length;i++){const example=samples[i],button=document.createElement('button');button.textContent=`Example ${i+1}`;button.onclick=async()=>{try{const response=await fetch(new URL('./samples/'+example.image,import.meta.url));if(!response.ok)throw new Error('Failed to load example image.');await setImage(await response.blob(),example);}catch(e){status(e.message,true);}};$('examples').append(button);}}
catch(e){status(e.message,true);}
