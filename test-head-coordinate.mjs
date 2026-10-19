import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RUNTIME, grafAngles, headFromEndpoints, signedHeadAxes, solveTargetHead,
  prepareEdit, runPreparedEdit} from './geometry.mjs';

let assertions = 0;
const equal = (actual, expected, message) => {assert.deepEqual(actual, expected, message); assertions++;};
const ok = (condition, message) => {assert.ok(condition, message); assertions++;};
const near = (actual, expected, message, tolerance = 2e-11) =>
  ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: actual ${actual}, expected ${expected}`);
const pointNear = (actual, expected, message) => {
  near(actual[0], expected[0], `${message} x`);
  near(actual[1], expected[1], `${message} y`);
};
const throws = (fn, error, message) => {assert.throws(fn, error, message); assertions++;};
const clone = value => structuredClone(value);

// Analytic fixture, not fitted from runtime output: baseline length 100,
// lateral points left, and depth points from p3 toward the source head side.
const points = [[0, 0], [100, 0], [60, 50], [20, 10], [90, -20]];
const above = [70, 25], below = [70, 75];
equal(RUNTIME.headSlopeLateral, -0.0124, 'lateral coefficient');
equal(RUNTIME.headSlopeDepth, -0.0131, 'direct four-decimal pooled depth coefficient');
near(grafAngles(points).alpha, 45, 'analytic source alpha');

for (const [center, depthY] of [[above, -1], [below, 1]]) {
  const originalPoints = clone(points), originalCenter = center.slice();
  const axes = signedHeadAxes(points, center);
  pointNear(axes.lateral, [-1, 0], 'source lateral axis');
  pointNear(axes.depth, [0, depthY], 'source head-side depth axis');
  near(axes.length, 100, 'unmodified baseline length');
  near(Math.hypot(...axes.lateral), 1, 'lateral unit norm');
  near(Math.hypot(...axes.depth), 1, 'depth unit norm');
  near(axes.lateral[0] * axes.depth[0] + axes.lateral[1] * axes.depth[1], 0, 'orthogonal axes');
  for (const offset of [-10, 0, 10, 30]) {
    const target = solveTargetHead(points, center, 45 + offset);
    // Coefficient projections are independently known from the axis-aligned fixture.
    pointNear(target, [center[0] + 1.24 * offset, center[1] - 1.31 * depthY * offset],
      `head side ${depthY}, delta alpha ${offset}`);
    near((target[0] - center[0]) * -1 / 100, -0.0124 * offset, 'lateral regression projection');
    near((target[1] - center[1]) * depthY / 100, -0.0131 * offset, 'depth regression projection');
  }
  equal(points, originalPoints, 'head solver does not mutate source landmarks');
  equal(center, originalCenter, 'head solver does not mutate source f');
}

// A blanket reversal fails the below-p3 fixture. A target crossing p3 must not
// redefine depth using the target or previous result instead of original f.
pointNear(solveTargetHead(points, above, 75), [107.2, 64.3], 'cross-p3 edit retains original depth');
pointNear(solveTargetHead(points, above, 35), [57.6, 11.9], 'later negative request still starts at source');
pointNear(solveTargetHead(points, above, 55), [82.4, 38.1], 'repeated request is path independent');
const reversedBaseline = clone(points);
[reversedBaseline[0], reversedBaseline[1]] = [reversedBaseline[1], reversedBaseline[0]];
pointNear(solveTargetHead(reversedBaseline, above, 55), [82.4, 38.1], 'baseline endpoint order does not reverse motion');
const headA = headFromEndpoints([[70, 15], [70, 35]]);
const headB = headFromEndpoints([[70, 35], [70, 15]]);
equal(headA, headB, 'H endpoint order preserves source center and radius');
pointNear(solveTargetHead(points, headA.center, 55), [82.4, 38.1], 'H midpoint drives the source frame');

// Euclidean coordinate changes preserve the physical displacement. The
// nonzero head-side projection avoids the explicitly conventional zero tie.
for (const [name, transform] of [
  ['translation', p => [p[0] + 143, p[1] + 87]],
  ['scale', p => [p[0] * 2.5, p[1] * 2.5]],
  ['quarter turn', p => [-p[1], p[0]]],
  ['reflection', p => [-p[0], p[1]]],
  ['rotation', p => [p[0] * Math.cos(0.37) - p[1] * Math.sin(0.37),
    p[0] * Math.sin(0.37) + p[1] * Math.cos(0.37)]],
]) {
  for (const [center, expected] of [[above, [82.4, 38.1]], [below, [82.4, 61.9]]]) {
    const moved = points.map(transform), movedCenter = transform(center);
    pointNear(solveTargetHead(moved, movedCenter, 55), transform(expected), `${name}: mapped target`);
  }
}

// Missing H is a genuine bypass. Invalid observed geometry must not invent an
// orientation. The exact zero projection convention is >= 0, as in the fit.
equal(solveTargetHead(points, null, 55), null, 'missing H returns no target');
equal(solveTargetHead(points, undefined, 55), null, 'undefined H returns no target');
pointNear(signedHeadAxes(points, [70, 50]).depth, [0, -1], 'zero head projection chooses the unflipped perpendicular');
for (const center of [null, [], [70], [70, 25, 1], [NaN, 25], [70, Infinity], ['70', 25]]) {
  throws(() => signedHeadAxes(points, center), TypeError, 'invalid source head rejected');
}
for (const malformed of [null, [], points.slice(0, 4), [null, ...points.slice(1)],
  [[NaN, 0], ...points.slice(1)]]) {
  throws(() => signedHeadAxes(malformed, above), TypeError, 'invalid source landmarks rejected');
}
for (const distance of [0, 5e-10]) {
  const degenerate = clone(points); degenerate[1] = [distance, 0];
  throws(() => signedHeadAxes(degenerate, above), RangeError, 'degenerate baseline rejected');
}

// Integration uses only a deterministic identity generator callback, not
// ONNX inference or patient data. Source pixels and coordinates stay fixed.
const shift = p => [p[0] + 60, p[1] + 80];
const localPoints = points.map(shift), sourceCenter = shift(above);
const image = Uint8Array.from({length: 256 * 256}, (_, i) => (i * 13 + Math.floor(i / 256) * 17) % 256);
const input = {image, points: localPoints, headEndpoints: [[130, 95], [130, 115]], targetAlpha: 55};
const snapshot = clone(input);
const prepared = prepareEdit(input);
pointNear(prepared.head.sourceCenter, [130, 105], 'prepared f is source H midpoint');
pointNear(prepared.head.targetCenter, [142.4, 118.1], 'prepared automatic target uses corrected frame');
pointNear(prepared.headLayers.delta, [12.4, 13.1], 'texture lookup gets the corrected displacement');

const disabled = prepareEdit({...input, headShift: false});
pointNear(disabled.head.targetCenter, [142.4, 118.1], 'H off retains the automatic target for mask construction');
equal(disabled.headLayers, null, 'H off creates no translated texture');
equal(disabled.refineEnabled, false, 'H off creates no head-refinement pass');
const absent = prepareEdit({...input, headEndpoints: null});
equal(absent.head, null, 'missing H has no head geometry');
equal(absent.headLayers, null, 'missing H has no head translation');
ok(disabled.mask.some((value, index) => value !== absent.mask[index]),
  'H-off and missing-H mask behavior remains distinct');
equal(disabled.geometry, absent.geometry, 'eight roof channels remain independent of H');
for (const [operation, expectedCalls] of [[prepared, 2], [disabled, 1], [absent, 1]]) {
  let calls = 0;
  const result = await runPreparedEdit(operation, async request => {calls++; return request.image.slice();});
  equal(calls, expectedCalls, 'stage count preserves head/refinement semantics');
  equal(result.generatorCalls, expectedCalls, 'reported stage count');
}
const identity = prepareEdit({...input, targetAlpha: 45});
equal(identity.same, true, 'zero alpha change with unchanged beta is identity');
equal((await runPreparedEdit(identity, () => {throw new Error('Identity called generator');})).generatorCalls,
  0, 'identity bypasses generation');
const manual = prepareEdit({...input, targetHeadCenter: [111, 119]});
pointNear(manual.head.targetCenter, [111, 119], 'explicit head target remains authoritative');
pointNear(manual.head.sourceCenter, sourceCenter, 'manual override keeps original f');
pointNear(manual.head.delta, [-19, 14], 'manual delta remains absolute from original f');
equal(input, snapshot, 'all preparation and callback runs preserve caller data');

// Direct targets may reverse the target roof's lateral direction. They affect
// requested alpha, never the frame anchored on the original source landmarks.
const direct = clone(localPoints); direct[3] = shift([100, 70]);
const directBefore = clone(direct);
const directPrepared = prepareEdit({...input, targetAlpha: 1, targetPoints: direct});
const directAlpha = Math.atan2(20, 40) * 180 / Math.PI;
near(directPrepared.targetAlpha, directAlpha, 'direct target alpha comes from actual target geometry');
pointNear(directPrepared.head.targetCenter,
  [130 + 1.24 * (directAlpha - 45), 105 + 1.31 * (directAlpha - 45)],
  'direct target keeps the original, not target, lateral/depth frame');
equal(directPrepared.sourcePoints, localPoints, 'direct target keeps all source landmarks');
equal(direct, directBefore, 'direct target is not mutated');

// All runtime import paths are cache-busted together so an old browser module
// cannot silently supply a different automatic-head equation after deployment.
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const version = '20261020-source-head-frame';
ok(read('./index.html').includes(`app.mjs?v=${version}`), 'HTML requests current app');
ok(read('./app.mjs').includes(`geometry.mjs?v=${version}`), 'app requests current geometry');
ok(read('./app.mjs').includes(`bounded-controls.mjs?v=${version}`), 'app requests current bound helpers');
ok(read('./bounded-controls.mjs').includes(`geometry.mjs?v=${version}`), 'bound helpers use the same current geometry');
ok(read('./.github/workflows/pages.yml').includes('node test-head-coordinate.mjs'), 'deployment runs this regression test');

console.log(`Source-fixed head coordinates: ${assertions} assertions passed.`);
