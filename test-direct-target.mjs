import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {captureInitialGeometry, boundTargetPoint, directTargetPoints,
  targetPointsForRequest} from './bounded-controls.mjs';
import {grafAngles, geometryCondition, hipMask, prepareEdit,
  runPreparedEdit, solveTargetKeypoints, validateTargetPoints} from './geometry.mjs';

let assertions = 0;
const equal = (actual, expected, message) => {assert.deepEqual(actual, expected, message); assertions++;};
const ok = (condition, message) => {assert.ok(condition, message); assertions++;};
const throws = (fn, error, message) => {assert.throws(fn, error, message); assertions++;};
const near = (actual, expected, message, tolerance = 1e-6) => ok(Math.abs(actual - expected) <= tolerance, message);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const digest = values => createHash('sha256')
  .update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)).digest('hex');
const samples = JSON.parse(readFileSync(new URL('./samples/samples.json', import.meta.url)));
const clone = value => structuredClone(value);

function assertBounded(initial, index, point, message) {
  const range = index === 3 ? initial.rangeP4 : initial.rangeP5;
  ok(distance(point, range.center) <= range.radius + 1e-6, `${message}: initial point-centered circle`);
  ok(point[0] >= initial.box[0] && point[0] <= initial.box[2] - 1 &&
    point[1] >= initial.box[1] && point[1] <= initial.box[3] - 1, `${message}: fixed crop`);
}

for (const sample of samples) {
  const initial = captureInitialGeometry(sample.points, sample.headEndpoints, sample.width, sample.height);
  const snapshot = JSON.stringify(initial), original = clone(sample.points);
  equal(initial.rangeP5.center, original[4], `${sample.id}: p5 range is centered on initial p5`);
  near(initial.rangeP5.radius, 0.8 * distance(original[3], original[4]), `${sample.id}: p5 radius is source-defined`);
  ok(Object.isFrozen(initial.rangeP5) && Object.isFrozen(initial.rangeP5.center), `${sample.id}: p5 range is immutable`);

  const p4Request = original[3].map((value, axis) => value + [8, -4][axis]);
  const p4 = directTargetPoints(initial, 3, p4Request);
  equal(p4.points[3], p4Request, `${sample.id}: direct p4 follows native pointer without length projection`);
  equal(p4.points[4], original[4], `${sample.id}: moving p4 keeps p5 at its current absolute position`);
  equal(p4.points.slice(0, 3), original.slice(0, 3), `${sample.id}: source p1-3 remain fixed`);
  ok(Math.abs(distance(p4.points[2], p4.points[3]) - distance(original[2], original[3])) > 0.01,
    `${sample.id}: p4 drag can change bony roof length`);
  ok(Math.abs(distance(p4.points[3], p4.points[4]) - distance(original[3], original[4])) > 0.01,
    `${sample.id}: p4 drag can change cartilage roof length`);
  equal({alpha: p4.alpha, beta: p4.beta}, grafAngles(p4.points), `${sample.id}: p4 angles measured from actual direct geometry`);
  assertBounded(initial, 3, p4.points[3], `${sample.id}: p4 drag`);

  const p5Request = original[4].map((value, axis) => value + [10, 5][axis]);
  const p5 = directTargetPoints(initial, 4, p5Request, p4.points);
  equal(p5.points[4], p5Request, `${sample.id}: direct p5 follows native pointer without length projection`);
  equal(p5.points[3], p4.points[3], `${sample.id}: p5 drag leaves current p4 unchanged`);
  equal(p5.points.slice(0, 3), original.slice(0, 3), `${sample.id}: p5 drag keeps p1-3 fixed`);
  ok(Math.abs(distance(p5.points[3], p5.points[4]) - distance(p4.points[3], p4.points[4])) > 0.01,
    `${sample.id}: p5 drag can change cartilage roof length`);
  near(p5.alpha, p4.alpha, `${sample.id}: p5 drag cannot change bony roof angle`);
  assertBounded(initial, 4, p5.points[4], `${sample.id}: p5 drag`);
  equal(p4.points[4], original[4], `${sample.id}: successive edits do not mutate earlier targets`);

  for (const index of [3, 4]) {
    for (const request of [[-10000, -10000], [10000, 10000], original[index]]) {
      const bounded = boundTargetPoint(initial, index, request);
      assertBounded(initial, index, bounded, `${sample.id}: bounded p${index + 1}`);
      const result = directTargetPoints(initial, index, request);
      equal(result.points[index], bounded, `${sample.id}: direct operation uses fixed initial range`);
      equal(result.points[7 - index], original[7 - index], `${sample.id}: other roof point stays fixed`);
      equal(result.points.slice(0, 3), original.slice(0, 3), `${sample.id}: far drag keeps anchors fixed`);
    }
  }
  const replay = directTargetPoints(initial, 4, p5Request, p4.points);
  directTargetPoints(initial, 4, [-10000, -10000], p4.points);
  equal(directTargetPoints(initial, 4, p5Request, p4.points), replay, `${sample.id}: absolute requested target replay is path independent`);
  equal(JSON.stringify(initial), snapshot, `${sample.id}: all initial points, crop and circles remain unchanged`);
  equal(sample.points, original, `${sample.id}: caller's source annotation remains unchanged`);

  // Numeric angle inputs remain a separate, source-defined length-preserving
  // construction even though direct dragging now permits changing lengths.
  const numeric = targetPointsForRequest(initial, initial.angles.alpha + 5, initial.angles.beta);
  equal(numeric.points, solveTargetKeypoints(initial.points, numeric.alpha, numeric.beta), `${sample.id}: numerical angle solver unchanged`);
  near(distance(numeric.points[3], numeric.points[2]), distance(original[3], original[2]), `${sample.id}: numerical bony roof length unchanged`);
  near(distance(numeric.points[4], numeric.points[3]), distance(original[4], original[3]), `${sample.id}: numerical cartilage roof length unchanged`);
}

{
  const sample = samples[0], initial = captureInitialGeometry(sample.points, sample.headEndpoints, sample.width, sample.height);
  const local = point => point.map((value, axis) => value - initial.box[axis]);
  const points = initial.points.map(local), headEndpoints = initial.headEndpoints.map(local);
  const image = Uint8Array.from({length: 256 * 256}, (_, index) => (index * 13 + Math.floor(index / 256) * 17) % 256);
  const sourceBefore = clone(points), imageBefore = image.slice();
  const targetPoints = clone(points);
  // Extend cartilage along exactly the same line: alpha and beta do not change,
  // but its endpoint and line heatmaps really do change.
  targetPoints[4] = points[4].map((value, axis) => value + 0.4 * (value - points[3][axis]));
  const targetBefore = clone(targetPoints), measured = grafAngles(targetPoints);
  near(measured.alpha, initial.angles.alpha, 'length-only direct target preserves alpha');
  near(measured.beta, initial.angles.beta, 'length-only direct target preserves beta');
  const input = {image, points, headEndpoints, targetAlpha: 0, targetBeta: 0, targetPoints};
  const prepared = prepareEdit(input);
  equal(prepared.targetPoints, targetPoints, 'direct targets are not reconstructed through fixed-length angle solver');
  equal(prepared.targetAlpha, measured.alpha, 'direct target overrides supplied alpha using actual angle');
  equal(prepared.targetBeta, measured.beta, 'direct target overrides supplied beta using actual angle');
  equal(prepared.sourcePoints, points, 'runtime uses unchanged initial source points');
  equal(prepared.same, false, 'same-angle length-only target cannot bypass GAN');
  equal(prepared.geometry, geometryCondition(256, 256, targetPoints, prepared.head.targetCenter, prepared.head.radius, 8),
    'all eight geometry channels encode the genuine direct target points');
  equal(prepared.mask, hipMask(256, 256, points, [0, 0], [targetPoints],
    [prepared.head.sourceCenter, prepared.head.targetCenter], prepared.head.radius), 'mask construction receives actual direct target');
  const identity = prepareEdit({image, points, headEndpoints, targetAlpha: initial.angles.alpha, targetBeta: initial.angles.beta});
  ok(digest(prepared.geometry) !== digest(identity.geometry), 'length-only edit changes the actual model geometry tensor');
  const calls = [];
  const result = await runPreparedEdit(prepared, async request => {calls.push(request); return request.image.slice();});
  equal(calls.length, 2, 'length-only direct edit with H keeps both genuine runtime generator stages');
  equal(result.generatorCalls, 2, 'runtime call count reflects direct target edit');
  equal(calls[0].image, prepared.original, 'direct first input remains the original grayscale source crop');
  equal(calls[1].image, result.firstPass, 'direct second input is current-run first composite, not previous result');
  equal(calls[0].geometry, prepared.geometry, 'first stage consumes actual target geometry');
  equal(calls[1].geometry, prepared.geometry, 'refinement consumes the same actual target geometry');
  equal(points, sourceBefore, 'direct preparation and execution never replace source points');
  equal(image, imageBefore, 'direct preparation and execution never replace source pixels');
  equal(targetPoints, targetBefore, 'direct preparation leaves caller target unchanged');
  targetPoints[4][0] += 10;
  equal(prepared.targetPoints, targetBefore, 'prepared targets never alias mutable UI target points');

  const absent = prepareEdit({...input, targetPoints: targetBefore, headEndpoints: null});
  equal(absent.same, false, 'H-absent length-only target still invokes image editing');
  equal((await runPreparedEdit(absent, async request => request.image.slice())).generatorCalls, 1,
    'H-absent direct edit invokes the one-stage original image editing path');

  const directIdentity = prepareEdit({...input, targetPoints: clone(points)});
  equal(directIdentity.same, true, 'explicit zero point displacement retains exact identity');
  equal((await runPreparedEdit(directIdentity, () => {throw new Error('Identity must not call GAN.');})).generatorCalls, 0,
    'zero direct edit performs no generator call');
  const headOnly = prepareEdit({...input, targetPoints: clone(points), targetHeadCenter: prepared.head.sourceCenter.map((value, axis) => value + [5, -3][axis])});
  equal(headOnly.same, false, 'explicit unchanged roof still permits manual H-only translation');
  equal(headOnly.head.delta, [5, -3], 'H remains measured relative to original source center');
  const tiny = clone(points); tiny[4][0] += 1e-8;
  equal(prepareEdit({...input, targetPoints: tiny}).same, false, 'finite nonzero direct displacement is not hidden by an angle tolerance');

  for (const invalid of [null, [], [1, 2], Array(5).fill(null),
    [[NaN, 0], ...points.slice(1)], [...points.slice(0, 4), [0, Infinity]]]) {
    throws(() => validateTargetPoints(points, invalid), TypeError, 'invalid direct target shape/coordinates rejected');
  }
  const movedAnchor = clone(points); movedAnchor[2][0] += 1;
  throws(() => prepareEdit({...input, targetPoints: movedAnchor}), RangeError, 'direct target cannot move fixed p3');
  const coincident = clone(points); coincident[4] = coincident[3].slice();
  throws(() => prepareEdit({...input, targetPoints: coincident}), RangeError, 'zero-length direct cartilage rejected rather than fabricated');
  for (const badIndex of [-1, 0, 2, 5, '3']) {
    throws(() => boundTargetPoint(initial, badIndex, [100, 100]), TypeError, 'only direct p4 and p5 can be bounded');
  }
  for (const badPoint of [null, [], [100], [NaN, 100], [100, Infinity], ['100', 100]]) {
    throws(() => directTargetPoints(initial, 3, badPoint), TypeError, 'direct pointer requires finite native coordinates');
  }
}

{
  const initial = captureInitialGeometry([[10, 10], [80, 10], [150, 210], [250, 200], [245, 120]], null, 256, 256);
  for (const index of [3, 4]) {
    assertBounded(initial, index, boundTargetPoint(initial, index, [10000, 10000]), `edge p${index + 1} circle/crop intersection`);
  }
  near(initial.rangeP5.radius, 0.8 * Math.hypot(5, 80), 'range policy does not invent a minimum radius');
  throws(() => captureInitialGeometry([[10, 10], [80, 10], [150, 210], [250, 200], [250, 200]], null, 256, 256),
    RangeError, 'invalid zero-length original segment cannot fabricate an editing circle');
}

console.log(`Direct bounded targets: ${assertions} assertions passed.`);
