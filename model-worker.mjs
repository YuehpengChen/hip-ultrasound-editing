import * as ort from './runtime/ort.wasm.min.mjs';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('./runtime/',import.meta.url).href;
let session, loading;
const expectedHash = 'af028a3ffb524b7c9dc90a93e9f21e59cb154d23749a8a34aa35d0990d8dce07';
async function initialize(url) {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 77144129;
    const reader = response.body.getReader(), chunks = []; let received = 0;
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      chunks.push(value); received += value.length;
      postMessage({type:'progress', value:received / total});
    }
    const bytes = new Uint8Array(received); let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if (hash !== expectedHash) throw new Error('Model checksum mismatch.');
    postMessage({type:'initializing'});
    session = await ort.InferenceSession.create(bytes, {executionProviders:['wasm'], graphOptimizationLevel:'all'});
    postMessage({type:'ready', backend:'WASM CPU', hash}); return session;
  })();
  try { return await loading; } catch(e) { loading = null; throw e; }
}
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'load') { await initialize(data.url); return; }
    if (data.type !== 'infer') return;
    if (!session) throw new Error('Model is not loaded.');
    const start = performance.now();
    const outputs = await session.run({
      original:new ort.Tensor('float32',data.image,[1,1,256,256]),
      mask:new ort.Tensor('float32',data.mask,[1,1,256,256]),
      geometry:new ort.Tensor('float32',data.geometry,[1,8,256,256]),
    });
    const prediction = new Float32Array(outputs.prediction.data);
    for (const output of Object.values(outputs)) output.dispose?.();
    postMessage({type:'prediction',id:data.id,prediction,seconds:(performance.now()-start)/1000},[prediction.buffer]);
  } catch(e) { postMessage({type:'error',id:data.id,message:e.message || String(e)}); }
};
