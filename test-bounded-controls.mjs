import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {grafAngles, prepareEdit, solveTargetKeypoints} from './geometry.mjs';
import {headCenter} from './landmark-controls.mjs';
import {captureInitialGeometry, boundTargetCenter, headHandlesAtCenter,
  targetPointsForRequest, boundedTargetPoints, anglesForPointer} from './bounded-controls.mjs';

let assertions = 0;
const equal = (actual, expected, message) => {assert.deepEqual(actual, expected, message); assertions++;};
const ok = (condition, message) => {assert.ok(condition, message); assertions++;};
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (actual, expected, message, tolerance = 1e-6) => ok(Math.abs(actual - expected) <= tolerance, message);
const samples = JSON.parse(readFileSync(new URL('./samples/samples.json', import.meta.url)));

function assertRange(initial, point, range, message) {
  ok(distance(point, range.center) <= range.radius + 1e-6, `${message}: initial circle`);
  assertCrop(initial, point, message);
}

function assertCrop(initial, point, message) {
  ok(point[0] >= initial.box[0] - 1e-6 && point[0] <= initial.box[2] - 1 + 1e-6 &&
    point[1] >= initial.box[1] - 1e-6 && point[1] <= initial.box[3] - 1 + 1e-6, `${message}: fixed crop`);
}

function assertCanonical(initial, result, message) {
  assertRange(initial, result.points[3], initial.rangeP4, `${message}: p4`);
  assertRange(initial, result.points[4], initial.rangeP5, `${message}: p5`);
  equal(result.points.slice(0, 3), initial.points.slice(0, 3), `${message}: baseline and p3 preserved`);
  near(distance(result.points[3], result.points[2]), distance(initial.points[3], initial.points[2]), `${message}: bony roof length`);
  near(distance(result.points[4], result.points[3]), distance(initial.points[4], initial.points[3]), `${message}: cartilage roof length`);
  const measured = grafAngles(result.points);
  near(measured.alpha, result.alpha, `${message}: requested alpha`);
  near(measured.beta, result.beta, `${message}: requested beta`);
  equal(result.points, solveTargetKeypoints(initial.points, result.alpha, result.beta), `${message}: canonical source branch`);
}

for (const sample of samples) {
  const points = structuredClone(sample.points), head = structuredClone(sample.headEndpoints);
  const before = structuredClone({points, head});
  const initial = captureInitialGeometry(points, head, sample.width, sample.height);
  const snapshot = JSON.stringify(initial);
  equal({points, head}, before, `${sample.id}: capture leaves callers unchanged`);
  for (const value of [initial, initial.points, ...initial.points, initial.headEndpoints,
    ...initial.headEndpoints, initial.box, initial.angles, initial.rangeP4, initial.rangeP4.center,
    initial.rangeP5, initial.rangeP5.center,
    initial.rangeHead, initial.rangeHead.center]) ok(Object.isFrozen(value), `${sample.id}: deeply frozen`);
  points[4][0] += 500; head[0][0] -= 500;
  equal(initial.points, before.points, `${sample.id}: points snapshot independent`);
  equal(initial.headEndpoints, before.head, `${sample.id}: source H snapshot independent`);
  equal(initial.rangeP4.center, before.points[3], `${sample.id}: blue circle is centered at initial p4`);
  near(initial.rangeP4.radius, 0.8 * distance(before.points[3], before.points[4]), `${sample.id}: blue radius reduced by 20 percent`);
  equal(initial.rangeP5.center, before.points[4], `${sample.id}: independent p5 circle uses initial p5`);
  near(initial.rangeP5.radius, initial.rangeP4.radius, `${sample.id}: p5 circle uses the same initial segment-based radius`);
  equal(initial.f, headCenter(before.head), `${sample.id}: fixed source f is the initial H midpoint`);
  equal(initial.rangeHead.center, initial.f, `${sample.id}: yellow circle is centered at fixed initial f`);
  equal(initial.rangeHead.radius, initial.rangeP4.radius, `${sample.id}: yellow and p4 blue circle radii match exactly`);
  equal(initial.rangeHead.radius, initial.rangeP5.radius, `${sample.id}: yellow and p5 blue circle radii match exactly`);
  const previousHeadRange = Math.min(initial.headRadius * 0.5,
    initial.f[0] - initial.box[0], initial.box[2] - 1 - initial.f[0],
    initial.f[1] - initial.box[1], initial.box[3] - 1 - initial.f[1]) * 1.1;
  const availableHeadDirections = [
    {axis: 0, sign: -1, space: initial.f[0] - initial.box[0]},
    {axis: 0, sign: 1, space: initial.box[2] - 1 - initial.f[0]},
    {axis: 1, sign: -1, space: initial.f[1] - initial.box[1]},
    {axis: 1, sign: 1, space: initial.box[3] - 1 - initial.f[1]},
  ].sort((a, b) => b.space - a.space);
  const inwardRequest = initial.f.slice(), inward = availableHeadDirections[0];
  inwardRequest[inward.axis] += inward.sign * initial.rangeHead.radius;
  const enlargedHeadTarget = boundTargetCenter(initial, inwardRequest);
  near(distance(enlargedHeadTarget, initial.f), initial.rangeHead.radius, `${sample.id}: enlarged yellow radius reachable inside crop`);
  ok(distance(enlargedHeadTarget, initial.f) > previousHeadRange, `${sample.id}: expanded yellow region permits movement beyond the previous capped radius`);
  assertRange(initial, enlargedHeadTarget, initial.rangeHead, `${sample.id}: expanded f* movement`);
  assert.throws(() => {initial.points[4][0] += 1;}, TypeError); assertions++;

  const identity = targetPointsForRequest(initial, initial.angles.alpha, null);
  equal(identity.points, initial.points, `${sample.id}: identity coordinates exact`);
  equal(identity.alpha, initial.angles.alpha, `${sample.id}: identity alpha exact`);
  equal(identity.beta, initial.angles.beta, `${sample.id}: identity beta exact`);
  equal(identity.limited, false, `${sample.id}: identity not limited`);
  ok(identity.points !== initial.points && identity.points[0] !== initial.points[0], `${sample.id}: return does not alias source`);
  equal(boundedTargetPoints(initial, initial.angles.alpha, null), identity, `${sample.id}: public alias`);
  const betaRequest = Math.min(89.9, initial.angles.beta + 5);
  const betaOnly = targetPointsForRequest(initial, initial.angles.alpha, betaRequest);
  near(betaOnly.alpha, initial.angles.alpha, `${sample.id}: feasible beta edit preserves alpha`);
  for (let axis = 0; axis < 2; axis++) near(betaOnly.points[3][axis], initial.points[3][axis], `${sample.id}: beta-only p4 unchanged axis ${axis}`);
  const betaPointer = anglesForPointer(initial, 4, betaOnly.points[4], initial.angles.alpha, initial.angles.beta);
  near(betaPointer.alpha, initial.angles.alpha, `${sample.id}: feasible p5 pointer preserves alpha`);
  for (let axis = 0; axis < 2; axis++) near(betaPointer.points[3][axis], initial.points[3][axis], `${sample.id}: p5 pointer preserves p4 axis ${axis}`);

  // Some targets are inside the crop but outside the new p5-centered circle.
  // Both numerical beta inputs and the legacy angle pointer must obey it.
  for (const requestedBeta of [0.1, 89.9]) {
    const raw = solveTargetKeypoints(initial.points, initial.angles.alpha, requestedBeta);
    if (distance(raw[4], initial.rangeP5.center) <= initial.rangeP5.radius) continue;
    const numeric = targetPointsForRequest(initial, initial.angles.alpha, requestedBeta);
    ok(numeric.limited, `${sample.id}: numerical beta beyond p5 circle is limited`);
    near(numeric.alpha, initial.angles.alpha, `${sample.id}: p5-circle beta fallback preserves feasible alpha`);
    assertRange(initial, numeric.points[4], initial.rangeP5, `${sample.id}: numerical p5 range`);
    const pointer = anglesForPointer(initial, 4, raw[4], initial.angles.alpha, initial.angles.beta);
    ok(pointer.limited, `${sample.id}: legacy angle pointer beyond p5 circle is limited`);
    assertRange(initial, pointer.points[4], initial.rangeP5, `${sample.id}: legacy pointer p5 range`);
  }

  for (const alpha of [30, 35, initial.angles.alpha, 60, 75, 84, -100, 300]) {
    for (const beta of [0.1, 20, initial.angles.beta, 89.9, -100, 300]) {
      const result = targetPointsForRequest(initial, alpha, beta);
      assertCanonical(initial, result, `${sample.id}: numeric ${alpha}/${beta}`);
    }
  }
  const finalRequest = [initial.angles.alpha + 4, initial.angles.beta + 3];
  const direct = targetPointsForRequest(initial, ...finalRequest);
  targetPointsForRequest(initial, 30, 89.9);
  targetPointsForRequest(initial, 84, 0.1);
  equal(targetPointsForRequest(initial, ...finalRequest), direct, `${sample.id}: landmark replay is path independent`);
  const directPointer = anglesForPointer(initial, 3, direct.points[3], initial.angles.alpha, initial.angles.beta);
  anglesForPointer(initial, 4, [0, 0], 84, 0.1);
  equal(anglesForPointer(initial, 3, direct.points[3], initial.angles.alpha, initial.angles.beta), directPointer, `${sample.id}: pointer replay uses fixed initial range`);

  // p5 is the coupled cartilage tip, not the blue-circle-controlled landmark.
  // Its original position is already outside the smaller p4-centered circle.
  ok(distance(identity.points[4], initial.rangeP4.center) > initial.rangeP4.radius,
    `${sample.id}: p5 may lie outside the p4 circle`);

  for (const request of [initial.f, [initial.f[0] + 5, initial.f[1] - 4], [-10000, -10000], [10000, 10000]]) {
    const bounded = boundTargetCenter(initial, request), handles = headHandlesAtCenter(initial, request);
    assertRange(initial, bounded, initial.rangeHead, `${sample.id}: f* ${request}`);
    for (let axis = 0; axis < 2; axis++) near(headCenter(handles)[axis], bounded[axis], `${sample.id}: H midpoint is f* axis ${axis}`);
    for (let axis = 0; axis < 2; axis++) {
      near(handles[1][axis] - handles[0][axis], initial.headEndpoints[1][axis] - initial.headEndpoints[0][axis], `${sample.id}: rigid diameter axis ${axis}`);
      near(handles[0][axis] - initial.headEndpoints[0][axis], bounded[axis] - initial.f[axis], `${sample.id}: absolute H displacement axis ${axis}`);
    }
  }
  const request = [initial.f[0] - 6, initial.f[1] + 7];
  const directHead = headHandlesAtCenter(initial, request);
  headHandlesAtCenter(initial, [initial.f[0] + 1000, initial.f[1] - 1000]);
  equal(headHandlesAtCenter(initial, request), directHead, `${sample.id}: H replay is path independent`);
  const cropPoints = initial.points.map(point => point.map((value, axis) => value - initial.box[axis]));
  const cropHead = initial.headEndpoints.map(point => point.map((value, axis) => value - initial.box[axis]));
  const absoluteTarget = boundTargetCenter(initial, request), localTarget = absoluteTarget.map((value, axis) => value - initial.box[axis]);
  const originalGray = new Uint8Array(256 * 256).map((_, index) => index % 256);
  const imageBefore = originalGray.slice();
  const prepared = prepareEdit({image: originalGray, points: cropPoints, headEndpoints: cropHead,
    targetAlpha: initial.angles.alpha, targetBeta: initial.angles.beta, targetHeadCenter: localTarget});
  for (let axis = 0; axis < 2; axis++) near(prepared.head.delta[axis], absoluteTarget[axis] - initial.f[axis], `${sample.id}: runtime delta from initial f`);
  equal(originalGray, imageBefore, `${sample.id}: preparation keeps initial grayscale unchanged`);
  ok(!prepared.same && prepared.refineEnabled, `${sample.id}: nonzero fixed-angle H runs translation/refinement`);

  for (const index of [3, 4]) {
    for (const cursor of [initial.points[index], [0, 0], [sample.width - 1, sample.height - 1],
      [initial.points[index][0] + 15, initial.points[index][1] - 15]]) {
      assertCanonical(initial, anglesForPointer(initial, index, cursor, initial.angles.alpha, initial.angles.beta), `${sample.id}: pointer ${index}/${cursor}`);
    }
  }
  equal(initial.rangeHead.center, headCenter(before.head), `${sample.id}: controls never recenter the yellow range`);
  equal(initial.rangeHead.radius, 0.8 * distance(before.points[3], before.points[4]), `${sample.id}: controls never resize the yellow range`);
  equal(initial.rangeHead.radius, initial.rangeP4.radius, `${sample.id}: controls preserve exact yellow/p4 radius equality`);
  equal(initial.rangeHead.radius, initial.rangeP5.radius, `${sample.id}: controls preserve exact yellow/p5 radius equality`);
  equal(JSON.stringify(initial), snapshot, `${sample.id}: every control leaves all initial geometry/ranges fixed`);
}

{
  // A short initial cartilage segment creates a small p4 editing circle.
  // Beta cannot repair a p4 range violation, so fallback must constrain alpha.
  const initial = captureInitialGeometry([[10, 10], [80, 10], [100, 150], [170, 80], [171, 79]], null, 256, 256);
  const far = targetPointsForRequest(initial, 84, 45);
  ok(far.limited && far.alpha < 84, 'infeasible alpha falls back to a feasible initial-source construction');
  assertCanonical(initial, far, 'joint alpha/beta limitation');
  for (const index of [3, 4]) {
    const cursor = solveTargetKeypoints(initial.points, 84, 45)[index];
    const result = anglesForPointer(initial, index, cursor, 84, 45);
    assertCanonical(initial, result, `joint pointer limitation ${index}`);
  }
  const edge = captureInitialGeometry(initial.points, [[254, 120], [256, 120]], 256, 256);
  equal(edge.rangeHead.radius, edge.rangeP4.radius, 'source f at crop edge retains the same radius as p4');
  equal(edge.rangeHead.radius, edge.rangeP5.radius, 'source f at crop edge retains the same radius as p5');
  ok(edge.rangeHead.radius > 0, 'source f at crop edge does not collapse the yellow range');
  const inward = boundTargetCenter(edge, [edge.f[0] - edge.rangeHead.radius, edge.f[1]]);
  near(distance(inward, edge.f), edge.rangeHead.radius, 'source f at crop edge can move inward to the yellow boundary');
  ok(inward[0] < edge.f[0], 'source f at right crop edge permits inward movement');
  assertRange(edge, inward, edge.rangeHead, 'crop-edge inward f*');
  equal(boundTargetCenter(edge, [edge.f[0] + 100, edge.f[1]]), edge.f, 'outward request is clipped to the fixed crop edge');
  const diagonal = boundTargetCenter(edge, [edge.f[0] + 100, edge.f[1] + 100]);
  equal(diagonal[0], edge.box[2] - 1, 'diagonal outward f* stays on the original crop edge');
  ok(diagonal[1] > edge.f[1], 'diagonal outward request still permits its in-crop component');
  assertRange(edge, diagonal, edge.rangeHead, 'crop-edge diagonal f*');
  equal(edge.rangeHead.center, edge.f, 'crop clipping never moves the initial yellow center');
  equal(edge.rangeHead.radius, edge.rangeP4.radius, 'crop clipping never shrinks the shared yellow radius');
}

{
  const sample = samples[0], initial = captureInitialGeometry(sample.points, null, sample.width, sample.height);
  equal(initial.rangeHead, null, 'H absent has no head range');
  equal(initial.f, null, 'H absent has no source f');
  assertCanonical(initial, targetPointsForRequest(initial, 70, 45), 'H absent still supports bounded p4 and p5');
  for (const fn of [boundTargetCenter, headHandlesAtCenter]) {
    assert.throws(() => fn(initial, [100, 100]), RangeError, 'H absent cannot invent target f*'); assertions++;
  }
  const complete = captureInitialGeometry(sample.points, sample.headEndpoints, sample.width, sample.height);
  equal(complete.rangeP4, initial.rangeP4, 'adding initial H does not change initial p4 range');
  equal(complete.rangeP5, initial.rangeP5, 'adding initial H does not change initial p5 range');
  for (const invalid of [[NaN, 0], [0, Infinity], [0], ['0', 0], null]) {
    assert.throws(() => boundTargetCenter(complete, invalid), TypeError, 'target f* must be physically finite'); assertions++;
    assert.throws(() => anglesForPointer(complete, 4, invalid, 60, 45), TypeError, 'pointer must be physically finite'); assertions++;
  }
  assert.throws(() => captureInitialGeometry(sample.points, [[0, 0], [1, 1]], sample.width, sample.height), RangeError, 'outside-crop initial H is rejected instead of silently moving source f'); assertions++;
  assert.throws(() => captureInitialGeometry(sample.points, [[400, 300], [400, 300]], sample.width, sample.height), RangeError, 'zero initial diameter is rejected'); assertions++;
  assert.throws(() => targetPointsForRequest(complete, NaN, 60), TypeError); assertions++;
  assert.throws(() => targetPointsForRequest(complete, 60, Infinity), TypeError); assertions++;
  assert.throws(() => anglesForPointer(complete, 2, [100, 100], 60, 45), TypeError); assertions++;
}

console.log(`Immutable bounded controls: ${assertions} assertions passed.`);
