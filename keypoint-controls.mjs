export const KEYPOINT_SIZE = 512;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Pillow's 8-bit separable bilinear resize, including downsample antialiasing.
function coefficients(inputSize, outputSize) {
  const scale = inputSize / outputSize, support = Math.max(1, scale), precision = 2 ** 22;
  return Array.from({length: outputSize}, (_, index) => {
    const center = (index + 0.5) * scale;
    const start = Math.max(0, Math.floor(center - support + 0.5));
    const end = Math.min(inputSize, Math.floor(center + support + 0.5));
    const weights = Array.from({length: end - start}, (_, k) =>
      Math.max(0, 1 - Math.abs((start + k - center + 0.5) / support)));
    const sum = weights.reduce((a, b) => a + b, 0);
    return {start, weights: weights.map(v => Math.floor(v / sum * precision + 0.5))};
  });
}

export function keypointTensor(rgba, width, height, size = KEYPOINT_SIZE) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      !Number.isInteger(size) || size < 1 || rgba.length !== width * height * 4)
    throw new RangeError('Invalid keypoint input image.');
  const cx = coefficients(width, size), cy = coefficients(height, size);
  const horizontal = new Uint8Array(size * height * 3), output = new Float32Array(3 * size * size);
  const precision = 2 ** 22, half = 2 ** 21;
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) {
    const {start, weights} = cx[x];
    for (let c = 0; c < 3; c++) {
      let sum = half;
      for (let k = 0; k < weights.length; k++) sum += rgba[(y * width + start + k) * 4 + c] * weights[k];
      horizontal[(y * size + x) * 3 + c] = clamp(Math.floor(sum / precision), 0, 255);
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const {start, weights} = cy[y];
    for (let c = 0; c < 3; c++) {
      let sum = half;
      for (let k = 0; k < weights.length; k++) sum += horizontal[((start + k) * size + x) * 3 + c] * weights[k];
      output[c * size * size + y * size + x] = clamp(Math.floor(sum / precision), 0, 255) / 255;
    }
  }
  return output;
}

function percentile(sorted, fraction) {
  const position = (sorted.length - 1) * fraction, lo = Math.floor(position), hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
}

function fitLine(heat, size) {
  let peak = -Infinity;
  for (const value of heat) {
    if (!Number.isFinite(value)) throw new RangeError('Non-finite keypoint model output.');
    peak = Math.max(peak, value);
  }
  // A conservative blank/noise guard, not a calibrated confidence score.
  if (!(peak >= 0.05)) throw new RangeError('No usable Graf line was detected.');
  const threshold = 0.4 * peak, pixels = [];
  let total = 0, mx = 0, my = 0;
  for (let i = 0; i < heat.length; i++) if (heat[i] >= threshold) {
    const x = i % size, y = Math.floor(i / size), weight = heat[i];
    pixels.push([x, y, weight]); total += weight; mx += x * weight; my += y * weight;
  }
  if (pixels.length < 5 || total < 1e-6) throw new RangeError('Insufficient Graf-line evidence.');
  mx /= total; my /= total;
  let xx = 0, xy = 0, yy = 0;
  for (const [x, y, weight] of pixels) {xx += weight * (x - mx) ** 2; xy += weight * (x - mx) * (y - my); yy += weight * (y - my) ** 2;}
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy), dx = Math.cos(angle), dy = Math.sin(angle);
  const projections = pixels.map(([x, y]) => (x - mx) * dx + (y - my) * dy).sort((a, b) => a - b);
  const a = percentile(projections, 0.05), b = percentile(projections, 0.95);
  if (!(b - a > 1)) throw new RangeError('Degenerate Graf-line prediction.');
  return {ends: [[mx + a * dx, my + a * dy], [mx + b * dx, my + b * dy]], strength: peak};
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function decodeGrafHeatmaps(heatmaps, width, height, size = KEYPOINT_SIZE) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      !Number.isInteger(size) || size < 2) throw new RangeError('Invalid keypoint output dimensions.');
  if (heatmaps.length !== 3 * size * size) throw new RangeError('Expected three Graf-line heatmaps.');
  const lines = [0, 1, 2].map(c => fitLine(heatmaps.subarray(c * size * size, (c + 1) * size * size), size));
  const [baseline, bony, cartilage] = lines.map(line => line.ends.map(p => [p[0] * width / size, p[1] * height / size]));
  // The shared bony/cartilage endpoint is p4. The other bony endpoint is p3.
  // This avoids the legacy approximate helper's baseline-distance ambiguity.
  let pair = [0, 0], best = Infinity;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const d = distance(bony[i], cartilage[j]);
    if (d < best) {best = d; pair = [i, j];}
  }
  const [i, j] = pair, p4 = bony[i].map((value, axis) => 0.5 * (value + cartilage[j][axis]));
  const p3 = bony[1 - i], p5 = cartilage[1 - j];
  const ordered = distance(baseline[0], p4) >= distance(baseline[1], p4) ? baseline : baseline.slice().reverse();
  const points = [...ordered, p3, p4, p5].map(p => p.map((value, axis) => clamp(value, 0, (axis ? height : width) - 1)));
  if (distance(points[0], points[1]) < 1 || distance(points[2], points[3]) < 1 || distance(points[3], points[4]) < 1)
    throw new RangeError('Detected landmarks require manual correction.');
  return {points, strengths: lines.map(line => line.strength)};
}
