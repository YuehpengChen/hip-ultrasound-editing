import * as ort from './runtime/ort.wasm.min.mjs';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('./runtime/', import.meta.url).href;
let session, loading;
const expectedHash = '4be6ed5d9dbe98b9248ccc95fc40d10b9d6735c86dbf5abadcf1ea519f199f6d';
async function initialize(url) {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Keypoint model download failed: HTTP ' + response.status);
    const total = Number(response.headers.get('content-length')) || 36643847;
    const reader = response.body.getReader(), chunks = []; let received = 0;
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      chunks.push(value); received += value.length;
      postMessage({type: 'progress', value: received / total});
    }
    const bytes = new Uint8Array(received); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== expectedHash) throw new Error('Keypoint model checksum mismatch.');
    postMessage({type: 'initializing'});
    session = await ort.InferenceSession.create(bytes, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
    postMessage({type: 'ready', hash}); return session;
  })();
  try {return await loading;} catch (e) {loading = null; throw e;}
}
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'load') {await initialize(data.url); return;}
    if (data.type !== 'detect') return;
    if (!session) throw new Error('Keypoint model is not loaded.');
    const outputs = await session.run({[session.inputNames[0]]: new ort.Tensor('float32', data.image, [1, 3, 512, 512])});
    const tensor = outputs[session.outputNames[session.outputNames.length - 1]];
    if (tensor.dims.join(',') !== '1,3,512,512') throw new Error('Unexpected keypoint output shape.');
    const heatmaps = new Float32Array(tensor.data);
    for (const output of Object.values(outputs)) output.dispose?.();
    postMessage({type: 'keypoints', id: data.id, heatmaps}, [heatmaps.buffer]);
  } catch (e) {postMessage({type: 'error', id: data.id, message: e.message || String(e)});}
};
