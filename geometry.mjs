/**
 * Faithful CPU preprocessing/compositing for the published AngleViz v4 runtime.
 * This module is independent of ONNX Runtime and the UI. Coordinates are native
 * image pixels, not rescaled landmarks. Images/tensors are channel-first Float32.
 *
 * Canonical source: geom.py, dataset.py and infer.py frozen on 2026-09-15, whose
 * hashes were also checked against the live GX10 runtime on 2026-10-09.
 * No thin-plate spline is used at inference: the head operation is a rigid,
 * integer-nearest source-patch translation, as in infer.render_from_gray_lm.
 */

export const RUNTIME = Object.freeze({
  cropSize: 256, keypointSigma: 7, lineSigma: 3.5,
  sweepAlphas: Object.freeze([34, 45, 56, 68, 82]),
  sweepBetas: Object.freeze([35, 50, 65, 80]),
  trainingAlphaRange: Object.freeze([34, 82]),
  trainingBetaRange: Object.freeze([35, 86]),
  headSlopeLateral: -0.0124, headSlopeDepth: -0.0132,
  headScale: 0.9, geometryChannels: 8,
  sourceHashes: Object.freeze({
    geom: '77cc2b09a1be03050dfe80449d822a84f3721871d394e47f2096e20410bcdee7',
    dataset: '0802cdf02955e8568dbb03e3bee48734b691cfed05bb2b362bb2a821179ef8dc',
    infer: '8f440ab92194e23bc35c24c8720e4e92cbcf0e6991f2483b10cbda5569719d55',
  }),
});

const f32 = Math.fround;
const clip = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const copyPoints = points => points.map(p => [Number(p[0]), Number(p[1])]);

/** Python/numpy round-to-nearest, ties-to-even, including negative half values. */
export function roundEven(value) {
  const lo = Math.floor(value), frac = value - lo;
  return frac < 0.5 ? lo : frac > 0.5 ? lo + 1 : (lo % 2 === 0 ? lo : lo + 1);
}

function validatePoints(points) {
  if (!Array.isArray(points) || points.length !== 5 ||
      points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) {
    throw new TypeError('Exactly five finite [x, y] source landmarks are required.');
  }
  if (Math.hypot(...sub(points[1], points[0])) < 1e-6 ||
      Math.hypot(...sub(points[3], points[2])) < 1e-6 ||
      Math.hypot(...sub(points[4], points[3])) < 1e-6) {
    throw new RangeError('Baseline, bony roof and cartilage roof must have non-zero lengths.');
  }
}

export function signedAngle(u, v) {
  let a = (Math.atan2(v[1], v[0]) - Math.atan2(u[1], u[0])) * 180 / Math.PI;
  while (a <= -180) a += 360;
  while (a > 180) a -= 360;
  return a;
}

export function lineLineAngle(a0, a1, b0, b1) {
  const a = Math.abs(signedAngle(sub(a1, a0), sub(b1, b0))) % 180;
  return a <= 90 ? a : 180 - a;
}

export function grafAngles(points) {
  validatePoints(points);
  return {
    alpha: lineLineAngle(points[0], points[1], points[2], points[3]),
    beta: lineLineAngle(points[0], points[1], points[3], points[4]),
  };
}

/** Direct target coordinates keep the source baseline and p3 fixed. */
export function validateTargetPoints(sourcePoints, requestedPoints) {
  validatePoints(sourcePoints);
  validatePoints(requestedPoints);
  if (requestedPoints.slice(0, 3).some((point, index) =>
    point.some((value, axis) => Math.abs(value - sourcePoints[index][axis]) > 1e-7))) {
    throw new RangeError('Direct targets must keep source p1, p2 and p3 fixed.');
  }
  const result = copyPoints(requestedPoints);
  // Normalize permitted floating-point noise without moving any source anchor.
  for (let index = 0; index < 3; index++) result[index] = sourcePoints[index].slice();
  return result;
}

function rotateToTarget(u, anchor, tip, target) {
  const v = sub(tip, anchor), length = Math.hypot(...v);
  if (length < 1e-6) return [...tip];
  const phi = signedAngle(u, v), side = phi >= 0 ? 1 : -1;
  const phiNew = side * (Math.abs(phi) <= 90 ? target : 180 - target);
  const delta = (phiNew - phi) * Math.PI / 180;
  const c = Math.cos(delta), s = Math.sin(delta);
  return [anchor[0] + c * v[0] - s * v[1], anchor[1] + s * v[0] + c * v[1]];
}

/** Preserve source branch/orientation and both original roof segment lengths. */
export function solveTargetKeypoints(points, targetAlpha, targetBeta = null) {
  validatePoints(points);
  if (!Number.isFinite(targetAlpha) || targetAlpha < 0 || targetAlpha > 90 ||
      (targetBeta !== null && (!Number.isFinite(targetBeta) || targetBeta < 0 || targetBeta > 90))) {
    throw new RangeError('Requested undirected angles must be between 0 and 90 degrees.');
  }
  const u = sub(points[1], points[0]), result = copyPoints(points);
  result[3] = rotateToTarget(u, points[2], points[3], targetAlpha);
  if (targetBeta === null) targetBeta = grafAngles(points).beta;
  const v45 = sub(points[4], points[3]), length = Math.hypot(...v45);
  const phi = signedAngle(u, v45), side = phi >= 0 ? 1 : -1;
  const phiNew = side * (Math.abs(phi) <= 90 ? targetBeta : 180 - targetBeta);
  const ang = Math.atan2(v45[1], v45[0]) + (phiNew - phi) * Math.PI / 180;
  result[4] = [result[3][0] + length * Math.cos(ang), result[3][1] + length * Math.sin(ang)];
  return result;
}

export function headFromEndpoints(endpoints) {
  if (endpoints === null || endpoints === undefined) return null;
  if (!Array.isArray(endpoints) || endpoints.length !== 2 ||
      endpoints.some(p => p.length !== 2 || !p.every(Number.isFinite))) {
    throw new TypeError('H requires two finite [x, y] diameter endpoints.');
  }
  return {
    center: [(endpoints[0][0] + endpoints[1][0]) * 0.5,
             (endpoints[0][1] + endpoints[1][1]) * 0.5],
    radius: Math.hypot(...sub(endpoints[1], endpoints[0])) / 2,
  };
}

export function signedHeadAxes(points) {
  const baseline = sub(points[1], points[0]), length = Math.hypot(...baseline) + 1e-9;
  const u = baseline.map(v => v / length);
  const signU = dot(sub(points[3], points[2]), u) >= 0 ? 1 : -1;
  const lateral = u.map(v => v * signU);
  const v = [-lateral[1], lateral[0]];
  const baselineMid = points[0].map((x, i) => 0.5 * (x + points[1][i]));
  const signV = dot(sub(points[2], baselineMid), v) >= 0 ? 1 : -1;
  return { lateral, depth: v.map(x => x * signV), length };
}

export function solveTargetHead(points, sourceCenter, targetAlpha) {
  if (!sourceCenter) return null;
  const dA = targetAlpha - grafAngles(points).alpha;
  const { lateral, depth, length } = signedHeadAxes(points);
  return sourceCenter.map((x, i) => x + dA * length *
    (RUNTIME.headSlopeLateral * lateral[i] + RUNTIME.headSlopeDepth * depth[i]));
}

/** Exactly the native crop_box clamp/round policy; does not rescale the image. */
export function cropBox(points, width, height, size = 256) {
  validatePoints(points);
  const center = [0, 1].map(i => (points[2][i] + points[3][i] + points[4][i]) / 3);
  let x0 = clip(roundEven(center[0] - size / 2), 0, width - size);
  let y0 = clip(roundEven(center[1] - size / 2), 0, height - size);
  if (width < size) x0 = 0;
  if (height < size) y0 = 0;
  return [x0, y0, x0 + Math.min(size, width), y0 + Math.min(size, height)];
}

/** PIL's fixed-point RGB-to-L conversion. Alpha must already be composited opaque. */
export function rgbaToGrayscale(rgba) {
  if (rgba.length % 4 !== 0) throw new RangeError('RGBA length must be divisible by four.');
  const gray = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    gray[i] = (19595 * rgba[j] + 38470 * rgba[j + 1] + 7471 * rgba[j + 2] + 32768) >>> 16;
  }
  return gray;
}

export function extractNativeCrop(image, width, height, box, normalized = false) {
  if (image.length !== width * height) throw new RangeError('Image length does not match its dimensions.');
  const [x0, y0, x1, y1] = box, cw = x1 - x0, ch = y1 - y0;
  const crop = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const value = image[(y + y0) * width + x + x0];
    crop[y * cw + x] = normalized ? value : f32(value / 255);
  }
  return crop;
}

export function gaussianHeatmap(width, height, center, sigma) {
  const result = new Float32Array(width * height), denominator = 2 * sigma ** 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    result[y * width + x] = Math.exp(-((x - center[0]) ** 2 + (y - center[1]) ** 2) / denominator);
  }
  return result;
}

export function lineRaster(width, height, a, b, sigma = 3.5) {
  const result = new Float32Array(width * height), ab = sub(b, a);
  const length2 = dot(ab, ab) + 1e-9, denominator = 2 * sigma ** 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const t = clip(((x - a[0]) * ab[0] + (y - a[1]) * ab[1]) / length2, 0, 1);
    const px = a[0] + t * ab[0], py = a[1] + t * ab[1];
    result[y * width + x] = Math.exp(-((x - px) ** 2 + (y - py) ** 2) / denominator);
  }
  return result;
}

/** Numpy float32 cumulative-sum order, including edge padding and cancellation. */
export function boxBlur(image, width, height, kernel) {
  if (kernel <= 1) return image.slice();
  const pad = Math.floor(kernel / 2), pw = width + 2 * pad, ph = height + 2 * pad;
  const integral = new Float32Array((pw + 1) * (ph + 1));
  const stride = pw + 1;
  // np.cumsum(np.cumsum(edge_padded, axis=0), axis=1): do not swap axes.
  for (let x = 0; x < pw; x++) {
    let column = 0;
    const sourceX = clip(x - pad, 0, width - 1);
    for (let y = 0; y < ph; y++) {
      column = f32(column + image[clip(y - pad, 0, height - 1) * width + sourceX]);
      integral[(y + 1) * stride + x + 1] = column;
    }
  }
  for (let y = 1; y <= ph; y++) {
    let row = 0;
    for (let x = 1; x <= pw; x++) {
      row = f32(row + integral[y * stride + x]);
      integral[y * stride + x] = row;
    }
  }
  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = f32(integral[(y + kernel) * stride + x + kernel] - integral[y * stride + x + kernel]);
    value = f32(value - integral[(y + kernel) * stride + x]);
    value = f32(value + integral[y * stride + x]);
    result[y * width + x] = f32(value / (kernel * kernel));
  }
  return result;
}

export function geometryCondition(width, height, points, headCenter = null, headRadius = 0, channels = 8) {
  if (channels !== 8 && channels !== 9) throw new RangeError('Canonical geometry has eight or nine channels.');
  const maps = points.map(point => gaussianHeatmap(width, height, point, RUNTIME.keypointSigma));
  maps.push(lineRaster(width, height, points[0], points[1], RUNTIME.lineSigma));
  maps.push(lineRaster(width, height, points[2], points[3], RUNTIME.lineSigma));
  maps.push(lineRaster(width, height, points[3], points[4], RUNTIME.lineSigma));
  if (channels === 9) maps.push(headCenter && headRadius > 0
    ? gaussianHeatmap(width, height, headCenter, Math.max(6, headRadius * 0.4))
    : new Float32Array(width * height));
  const tensor = new Float32Array(channels * width * height);
  maps.forEach((map, i) => tensor.set(map, i * width * height));
  return tensor;
}

/** Inference jitter is off. The source-defined angle sweeps are not UI limits. */
export function hipMask(width, height, points, origin = [0, 0], extraPointSets = [], headCenters = [], headRadius = 0) {
  const local = ps => ps.map(p => sub(p, origin));
  const sourceLocal = local(points), p3 = sourceLocal[2];
  const length = Math.hypot(...sub(points[3], points[2])) + 1e-6;
  const radius = 0.62 * length;
  const mask = new Float64Array(width * height);
  function unionDisc(center, r, initial = false) {
    const denominator = 2 * (r * 0.55) ** 2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const value = Math.exp(-((x - center[0]) ** 2 + (y - center[1]) ** 2) / denominator);
      mask[i] = initial ? value : Math.max(mask[i], value);
    }
  }
  unionDisc(p3, 0.75 * radius, true);
  const pointSets = [...extraPointSets];
  for (const angle of RUNTIME.sweepAlphas) pointSets.push(local(solveTargetKeypoints(points, angle)));
  for (const angle of RUNTIME.sweepBetas) pointSets.push(local(solveTargetKeypoints(points, grafAngles(points).alpha, angle)));
  pointSets.push(sourceLocal);
  for (const p of pointSets) {
    const centers = [p[3], p[4], add(p[2], p[3]).map(v => v * 0.5),
      add(p[3], p[4]).map(v => v * 0.5), add(p[3], sub(p[3], p[2]).map(v => 0.35 * v))];
    for (const c of centers) unionDisc(c, radius);
  }
  if (headCenters.length && headRadius > 0) {
    for (const c of headCenters) unionDisc(c, headRadius * 1.30);
  }
  const pad = Math.max(8, Math.floor(Math.min(width, height) / 14));
  const edge = new Float32Array(width * height);
  for (let y = pad; y < height - pad; y++) for (let x = pad; x < width - pad; x++) edge[y * width + x] = 1;
  const edgeBlur = boxBlur(edge, width, height, pad | 1), featherInput = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) featherInput[i] = mask[i] * edgeBlur[i];
  const feathered = boxBlur(featherInput, width, height, 9), gain = f32(1.35);
  for (let i = 0; i < feathered.length; i++) feathered[i] = clip(f32(feathered[i] * gain), 0, 1);
  return feathered;
}

function prepareHeadLayers(original, width, height, targetPoints, sourceCenter, targetCenter, radius, scale) {
  const dx = targetCenter[0] - sourceCenter[0], dy = targetCenter[1] - sourceCenter[1];
  const sigma = Math.max(10, radius * scale);
  const translated = new Float32Array(original.length);
  const weight = gaussianHeatmap(width, height, targetCenter, sigma);
  const roofKeep = new Float32Array(original.length);
  const roofMaps = [[0, 1], [2, 3], [3, 4]].map(([a, b]) => lineRaster(width, height, targetPoints[a], targetPoints[b], 7));
  const seam = new Float32Array(original.length), outerDenom = 2 * (sigma * 1.5) ** 2;
  const innerDenom = 2 * (sigma * 0.7) ** 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, sx = clip(roundEven(x - dx), 0, width - 1), sy = clip(roundEven(y - dy), 0, height - 1);
    translated[i] = original[sy * width + sx];
    const roof = Math.max(...roofMaps.map(map => map[i]));
    roofKeep[i] = clip(f32(1 - f32(f32(1.3) * roof)), 0, 1);
    weight[i] = f32(weight[i] * roofKeep[i]);
    const d2 = (x - targetCenter[0]) ** 2 + (y - targetCenter[1]) ** 2;
    seam[i] = f32(f32(clip(Math.exp(-d2 / outerDenom) - Math.exp(-d2 / innerDenom), 0, 1)) * roofKeep[i]);
  }
  return { translated, weight, roofKeep, seam, delta: [dx, dy], sigma };
}

/**
 * Input image is already a native 256 × 256 grayscale crop. By default pixels
 * are [0,255]; normalized=true accepts [0,1]. Do not supply a zeroed/masked image.
 * H is optional and supplied as two source diameter endpoints in this crop.
 * targetHeadCenter optionally prescribes f* without changing source f/radius.
 * Omitting it preserves the paper's angle-derived target and original numerics.
 * Optional targetPoints uses direct p4/p5 coordinates instead of the original
 * angle solver. Its measured angles drive H; its complete geometry drives GAN.
 */
export function prepareEdit({ image, points, targetAlpha, targetBeta = null,
  targetPoints: requestedTargetPoints = null,
  headEndpoints = null, targetHeadCenter = null, headShift = true, headRefine = true, headScale = 0.9,
  width = 256, height = 256, normalized = false, geometryChannels = 8 }) {
  if (width !== 256 || height !== 256) throw new RangeError('This exported model requires a native 256 × 256 crop.');
  validatePoints(points);
  if (!(headScale > 0 && Number.isFinite(headScale))) throw new RangeError('Head scale must be positive.');
  const original = extractNativeCrop(image, width, height, [0, 0, width, height], normalized);
  if (original.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new RangeError('Invalid grayscale pixel range.');
  const sourceAngles = grafAngles(points);
  let targetPoints, sameGeometry;
  if (requestedTargetPoints !== null) {
    targetPoints = validateTargetPoints(points, requestedTargetPoints);
    const measured = grafAngles(targetPoints);
    targetAlpha = measured.alpha;
    targetBeta = measured.beta;
    // Direct length-only changes must not take the old same-angle shortcut.
    sameGeometry = targetPoints.every((point, index) =>
      point.every((value, axis) => value === points[index][axis]));
  } else {
    if (targetBeta === null) targetBeta = sourceAngles.beta;
    const sameAngles = Math.abs(targetAlpha - sourceAngles.alpha) < 1e-3 && Math.abs(targetBeta - sourceAngles.beta) < 1e-3;
    targetPoints = sameAngles ? copyPoints(points) : solveTargetKeypoints(points, targetAlpha, targetBeta);
    sameGeometry = sameAngles;
  }
  const head = headFromEndpoints(headEndpoints), sourceCenter = head?.center ?? null, radius = head?.radius ?? 0;
  if (targetHeadCenter !== null && (!Array.isArray(targetHeadCenter) || targetHeadCenter.length !== 2 || !targetHeadCenter.every(Number.isFinite))) {
    throw new TypeError('Target f* must be a finite [x, y] point.');
  }
  if (targetHeadCenter !== null && (!head || radius <= 0)) {
    throw new RangeError('Target f* requires two distinct source H endpoints.');
  }
  const manualTarget = headShift && targetHeadCenter !== null;
  const targetCenter = manualTarget ? targetHeadCenter.slice() : solveTargetHead(points, sourceCenter, targetAlpha);
  const same = sameGeometry && !(manualTarget && Math.hypot(...sub(targetCenter, sourceCenter)) >= 1e-3);
  const geometry = geometryCondition(width, height, targetPoints, targetCenter, radius, geometryChannels);
  // Canonical infer uses both source/solved H discs even with headShift disabled.
  const mask = hipMask(width, height, points, [0, 0], [targetPoints],
    [sourceCenter, targetCenter].filter(Boolean), radius);
  const headLayers = headShift && sourceCenter && targetCenter
    ? prepareHeadLayers(original, width, height, targetPoints, sourceCenter, targetCenter, radius, headScale)
    : null;
  return { original, mask, geometry, width, height, geometryChannels,
    sourcePoints: copyPoints(points), targetPoints, sourceAngles, targetAlpha, targetBeta, same,
    head: head ? { sourceCenter, targetCenter, radius, delta: sub(targetCenter, sourceCenter) } : null,
    headLayers, refineEnabled: Boolean(headRefine && headLayers && !same) };
}

function validateGenerated(generated, n) {
  if (!generated || generated.length !== n || Array.from(generated).some(v => !Number.isFinite(v))) {
    throw new RangeError('Generator must return one finite 256 × 256 output channel.');
  }
}

/** First GAN output -> rigid head blend -> M composite. Values are kept float32. */
export function compositeFirstPass(prepared, generated) {
  if (prepared.same) return prepared.original.slice();
  validateGenerated(generated, prepared.original.length);
  const result = new Float32Array(generated.length), oneMinus = value => f32(1 - value);
  for (let i = 0; i < result.length; i++) {
    let region = generated[i];
    if (prepared.headLayers) {
      const { weight, translated } = prepared.headLayers;
      region = f32(f32(weight[i] * translated[i]) + f32(oneMinus(weight[i]) * generated[i]));
    }
    result[i] = clip(f32(f32(prepared.mask[i] * region) +
      f32(oneMinus(prepared.mask[i]) * prepared.original[i])), 0, 1);
  }
  return result;
}

/** Second seam-only GAN output -> final composite. No second output if H absent/off. */
export function compositeRefinement(prepared, firstPass, regenerated) {
  if (!prepared.refineEnabled || prepared.same) return firstPass.slice();
  validateGenerated(regenerated, firstPass.length);
  const result = new Float32Array(firstPass.length), seam = prepared.headLayers.seam;
  for (let i = 0; i < result.length; i++) {
    result[i] = clip(f32(f32(seam[i] * regenerated[i]) + f32(f32(1 - seam[i]) * firstPass[i])), 0, 1);
  }
  return result;
}

/** UI/runtime adapter: callback consumes {image, mask, geometry, dims}. */
export async function runPreparedEdit(prepared, generate) {
  if (prepared.same) return { image: prepared.original.slice(), firstPass: prepared.original.slice(), generatorCalls: 0 };
  const dims = { image: [1, 1, prepared.height, prepared.width],
    mask: [1, 1, prepared.height, prepared.width], geometry: [1, prepared.geometryChannels, prepared.height, prepared.width] };
  const generated = await generate({ image: prepared.original, mask: prepared.mask, geometry: prepared.geometry, dims });
  const firstPass = compositeFirstPass(prepared, generated);
  if (!prepared.refineEnabled) return { image: firstPass, firstPass, generated, generatorCalls: 1 };
  const regenerated = await generate({ image: firstPass, mask: prepared.headLayers.seam, geometry: prepared.geometry, dims });
  return { image: compositeRefinement(prepared, firstPass, regenerated), firstPass, generated, regenerated, generatorCalls: 2 };
}

/** The canonical PIL export truncates 255-scaled values, rather than rounding. */
export function grayscaleBytes(image) {
  const result = new Uint8Array(image.length);
  for (let i = 0; i < image.length; i++) result[i] = Math.trunc(f32(clip(image[i], 0, 1) * 255));
  return result;
}
