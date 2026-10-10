import assert from 'node:assert/strict';
import {KEYPOINT_SIZE, keypointTensor, decodeGrafHeatmaps} from './keypoint-controls.mjs';

let checks = 0;
const check = (condition, message) => {assert.ok(condition, message); checks++;};
const throws = (fn, pattern) => {assert.throws(fn, pattern); checks++;};
check(KEYPOINT_SIZE === 512, 'trained detector dimensions');

const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 255, 100, 110, 120, 255]);
const exact = keypointTensor(rgba, 2, 2, 2);
const expected = [10, 40, 70, 100, 20, 50, 80, 110, 30, 60, 90, 120];
for (let i = 0; i < exact.length; i++)
  check(exact[i] === Math.fround(expected[i] / 255), 'RGB NCHW identity resize');
const one = keypointTensor(new Uint8ClampedArray([23, 129, 254, 255]), 1, 1, 5);
for (let c = 0; c < 3; c++) for (let i = 0; i < 25; i++)
  check(one[c * 25 + i] === Math.fround([23, 129, 254][c] / 255), 'constant image interpolation');
const mean = keypointTensor(rgba, 2, 2, 1);
for (let c = 0; c < 3; c++) check(mean[c] === Math.fround([55, 65, 75][c] / 255), 'Pillow bilinear half-up average');
const odd = new Uint8ClampedArray(7 * 3 * 4);
for (let i = 0; i < odd.length; i++) odd[i] = i * 17 % 256;
const resized = keypointTensor(odd, 7, 3, 9);
check(resized.length === 3 * 9 * 9, 'odd-aspect image shape');
check(resized.every(v => Number.isFinite(v) && v >= 0 && v <= 1), 'finite normalized input');
throws(() => keypointTensor(rgba, 3, 2), /Invalid/);
throws(() => keypointTensor(rgba, 0, 2), /Invalid/);
throws(() => keypointTensor(rgba, 2, 2, 0), /Invalid/);

const size = 64, heat = new Float32Array(3 * size * size);
const lines = [[[8, 6], [52, 6]], [[14, 50], [40, 26]], [[40, 26], [52, 42]]];
for (let c = 0; c < 3; c++) {
  const [a, b] = lines[c], dx = b[0] - a[0], dy = b[1] - a[1], norm = dx * dx + dy * dy;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / norm));
    const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
    heat[c * size * size + y * size + x] = Math.exp(-d * d / 0.5);
  }
}
const detected = decodeGrafHeatmaps(heat, size, size, size);
check(detected.points.length === 5 && detected.strengths.length === 3, 'five landmarks from three lines');
check(detected.points[0][0] < detected.points[1][0], 'far baseline endpoint is p1');
const landmarks = [[8, 6], [52, 6], [14, 50], [40, 26], [52, 42]];
for (let i = 0; i < 5; i++)
  check(Math.hypot(...detected.points[i].map((v, axis) => v - landmarks[i][axis])) < 4, 'correct Graf landmark roles');
const stretched = decodeGrafHeatmaps(heat, 128, 96, size);
for (let i = 0; i < 5; i++) for (let axis = 0; axis < 2; axis++)
  check(Math.abs(stretched.points[i][axis] - detected.points[i][axis] * [2, 1.5][axis]) < 1e-10, 'native aspect coordinates');
check(!('head' in detected), 'the model does not invent H endpoints');
const weak = heat.map(v => v * 0.01);
throws(() => decodeGrafHeatmaps(weak, size, size, size), /No usable/);
throws(() => decodeGrafHeatmaps(new Float32Array(3 * size * size), size, size, size), /No usable/);
const missing = heat.slice(); missing.fill(0, size * size, 2 * size * size);
throws(() => decodeGrafHeatmaps(missing, size, size, size), /No usable/);
const nonFinite = heat.slice(); nonFinite[2] = NaN;
throws(() => decodeGrafHeatmaps(nonFinite, size, size, size), /Non-finite/);
throws(() => decodeGrafHeatmaps(heat.subarray(1), size, size, size), /Expected three/);
throws(() => decodeGrafHeatmaps(heat, 0, size, size), /Invalid/);
const sparse = new Float32Array(3 * size * size); sparse[10] = 1;
throws(() => decodeGrafHeatmaps(sparse, size, size, size), /Insufficient/);
console.log(`Keypoint controls: ${checks} checks passed.`);
