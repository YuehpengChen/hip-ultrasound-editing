import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { grafAngles, prepareEdit, runPreparedEdit } from './geometry.mjs';
import { headCenter } from './landmark-controls.mjs';
import { targetHeadEndpoints, moveTargetHead } from './head-controls.mjs';

let assertions = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  assertions++;
};
const ok = (condition, message) => {
  assert.ok(condition, message);
  assertions++;
};
const digest = values => createHash('sha256')
  .update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength))
  .digest('hex');

function fixture() {
  const points = [[50, 20], [50, 90], [70, 80], [140, 140], [200, 125]];
  const image = Uint8Array.from({ length: 256 * 256 }, (_, index) => {
    const x = index % 256, y = Math.floor(index / 256);
    return (x * 13 + y * 7 + (x ^ y) * 3) % 256;
  });
  const headEndpoints = [[140, 120], [180, 170]];
  const angles = grafAngles(points);
  return { image, points, headEndpoints, targetAlpha: angles.alpha, targetBeta: angles.beta };
}

function samePrepared(actual, expected, message) {
  for (const key of ['original', 'mask', 'geometry', 'sourcePoints', 'targetPoints',
    'sourceAngles', 'targetAlpha', 'targetBeta', 'same', 'head', 'headLayers', 'refineEnabled']) {
    equal(actual[key], expected[key], `${message}: ${key}`);
  }
}

// Frozen before the optional target-center control was added. The default path
// must preserve the deployed angle-derived preprocessing bit for bit.
{
  const input = fixture();
  input.targetAlpha += 8;
  const prepared = prepareEdit(input);
  const arrays = { original: prepared.original, mask: prepared.mask,
    geometry: prepared.geometry, translated: prepared.headLayers.translated,
    weight: prepared.headLayers.weight, roofKeep: prepared.headLayers.roofKeep,
    seam: prepared.headLayers.seam };
  const expected = {
    original: 'b579541c6ce0a0f48f1983833552f974f8737e8d372167ac05333127cfddfa98',
    mask: '739c27cfa6b2c3348beb336f4a77a1a5a642308198fb9c5c028c4ef356c30e60',
    geometry: '9d00be890f37c8b81db6ae853c4a45de94d67801908bce09f3093d2f558cd62e',
    translated: '43ff2ccef3d2530fb6d06314eb04e4ff00be0a7f47d27dd15e7de727d2fe57ef',
    weight: 'e12b355095ab37a1924586f1196886302c46c2c3d3a8bbce8208377aa28caf86',
    roofKeep: '9f12228394dfec35f2e2e5dd062f086684d71e9b9795012c5704f573f83d3e49',
    seam: 'eb076340efcdbdd9506725501b01b566f38c4e6c2a50e6f5c7d8f337f90dc4ec',
  };
  for (const [name, values] of Object.entries(arrays)) {
    equal(digest(values), expected[name], `default ${name} is numerically unchanged`);
  }
  samePrepared(prepareEdit({ ...input, targetHeadCenter: null }), prepared,
    'null override retains the angle-derived behavior');
  samePrepared(prepareEdit({ ...input, targetHeadCenter: prepared.head.targetCenter.slice() }),
    prepared, 'explicit angle-derived center gives the same numerical result');
}

// A target center is independent of the fixed source H and may move the head
// without changing either requested angle. f and the source radius stay fixed.
{
  const input = fixture(), before = structuredClone(input);
  const targetHeadCenter = [182, 134];
  const prepared = prepareEdit({ ...input, targetHeadCenter });
  equal(prepared.head.sourceCenter, [160, 145], 'source f comes from original source H');
  equal(prepared.head.targetCenter, [182, 134], 'f* matches the explicit target center');
  equal(prepared.head.delta, [22, -11], 'delta is f* minus original f');
  equal(prepared.headLayers.delta, [22, -11], 'rigid translation uses the explicit delta');
  equal(prepared.head.radius, Math.hypot(40, 50) / 2, 'source diameter is unchanged');
  equal(prepared.sourcePoints, input.points, 'source landmarks stay fixed');
  equal(prepared.targetPoints, input.points, 'same-angle head movement keeps roof landmarks fixed');
  equal(input, before, 'preparation does not mutate the input image or landmarks');
  equal(targetHeadCenter, [182, 134], 'preparation does not mutate the caller target center');
  equal(prepared.same, false, 'same angles do not bypass a nonzero head translation');
  equal(prepared.refineEnabled, true, 'same-angle head movement enables boundary refinement');

  const expectedTranslation = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const sx = Math.max(0, Math.min(255, x - 22));
    const sy = Math.max(0, Math.min(255, y + 11));
    expectedTranslation[y * 256 + x] = prepared.original[sy * 256 + sx];
  }
  equal(prepared.headLayers.translated, expectedTranslation,
    'all translated pixels use the exact rigid shift and canonical edge clamp');
  equal(prepared.geometry, prepareEdit(input).geometry,
    'eight geometry channels retain the same requested roof geometry');
  ok(digest(prepared.mask) !== digest(prepareEdit(input).mask),
    'the edit mask includes the independently requested target head region');

  const calls = [];
  const result = await runPreparedEdit(prepared, async request => {
    calls.push(request);
    return request.image.slice();
  });
  equal(calls.length, 2, 'same-angle head movement calls both generator stages');
  equal(result.generatorCalls, 2, 'reported generator calls match the actual two-stage operation');
  equal(calls[0].image, prepared.original, 'first stage uses the untouched source crop');
  equal(calls[1].image, result.firstPass, 'second stage uses the first translated composite');
  equal(calls[1].mask, prepared.headLayers.seam, 'second stage uses the boundary refinement seam');
  ok(result.image.some((value, index) => value !== prepared.original[index]),
    'same-angle explicit translation changes the resulting image');
  equal(input, before, 'running the edit does not mutate the input image or landmarks');

  targetHeadCenter[0] = 220;
  targetHeadCenter[1] = 200;
  equal(prepared.head.targetCenter, [182, 134], 'prepared f* does not alias the caller target array');
}

// Identity remains fast when there is neither an angle change nor an effective
// head translation. Disabling H ignores a valid explicit override entirely.
{
  const input = fixture();
  const identity = prepareEdit({ ...input, targetHeadCenter: [160, 145] });
  equal(identity.same, true, 'an explicit zero displacement remains identity');
  const result = await runPreparedEdit(identity, () => {
    throw new Error('An identity edit must not invoke the generator.');
  });
  equal(result.image, identity.original, 'identity returns the original pixels');
  equal(result.generatorCalls, 0, 'identity makes zero generator calls');

  for (const angleOffset of [0, 8]) {
    const baseInput = { ...input, targetAlpha: input.targetAlpha + angleOffset, headShift: false };
    samePrepared(prepareEdit({ ...baseInput, targetHeadCenter: [182, 134] }),
      prepareEdit(baseInput), `disabled H ignores the override at angle offset ${angleOffset}`);
  }
  const disabled = prepareEdit({ ...input, headShift: false, targetHeadCenter: [182, 134] });
  const disabledResult = await runPreparedEdit(disabled, () => {
    throw new Error('A disabled same-angle head edit must not invoke the generator.');
  });
  equal(disabledResult.generatorCalls, 0, 'disabled H and unchanged angles retain the identity shortcut');

  const absent = prepareEdit({ ...input, headEndpoints: null });
  equal(absent.head, null, 'H absent produces no source or target head geometry');
  equal(absent.headLayers, null, 'H absent produces no translated head layer');
  equal(absent.same, true, 'H absent and same angles remain identity');
  equal((await runPreparedEdit(absent, () => {
    throw new Error('An H-absent identity edit must not invoke the generator.');
  })).generatorCalls, 0, 'H-absent identity makes zero generator calls');

  const absentAngleEdit = prepareEdit({ ...input, headEndpoints: null,
    targetAlpha: input.targetAlpha + 8 });
  equal(absentAngleEdit.same, false, 'H-absent angle changes still run the original editing operation');
  equal(absentAngleEdit.headLayers, null, 'H-absent angle changes do not invent a head translation');
  equal(absentAngleEdit.refineEnabled, false, 'H-absent angle changes do not enable head refinement');
  let absentCalls = 0;
  const absentAngleResult = await runPreparedEdit(absentAngleEdit, async request => {
    absentCalls++;
    return request.image.slice();
  });
  equal(absentCalls, 1, 'H-absent angle editing retains one generator call');
  equal(absentAngleResult.generatorCalls, 1, 'H-absent angle editing reports one generator call');
}

// Refinement remains optional even when the independently requested head center
// changes at fixed angles; the first translated composite still runs.
{
  const prepared = prepareEdit({ ...fixture(), targetHeadCenter: [182, 134], headRefine: false });
  equal(prepared.same, false, 'head translation alone is not identity when refinement is off');
  equal(prepared.refineEnabled, false, 'headRefine=false suppresses only the second stage');
  let calls = 0;
  const result = await runPreparedEdit(prepared, async request => {
    calls++;
    return request.image.slice();
  });
  equal(calls, 1, 'translation without refinement makes one generator call');
  equal(result.generatorCalls, 1, 'one-stage translation reports one generator call');
  ok(result.image.some((value, index) => value !== prepared.original[index]),
    'head translation still changes pixels without refinement');
}

// A target center must be a complete, finite coordinate pair and have an actual
// source H. Reject invalid input even when the H operation is switched off.
{
  for (const targetHeadCenter of [[], [160], [160, 145, 0], [NaN, 145],
    [160, Infinity], ['160', 145], { x: 160, y: 145 }]) {
    for (const headShift of [true, false]) {
      assert.throws(() => prepareEdit({ ...fixture(), targetHeadCenter, headShift }),
        `invalid target center is rejected with headShift=${headShift}`);
      assertions++;
    }
  }
  for (const headShift of [true, false]) {
    assert.throws(() => prepareEdit({ ...fixture(), headEndpoints: null,
      targetHeadCenter: [182, 134], headShift }),
    `a target center without source H is rejected with headShift=${headShift}`);
    assertions++;
  }
}

// Target H handles are a rigid translation of source H, not a resized or newly
// annotated head. Both numerical input and pointer drag use these same helpers.
{
  const source = [[140, 120], [180, 170]], targetCenter = [182, 134];
  const sourceBefore = structuredClone(source), centerBefore = targetCenter.slice();
  const target = targetHeadEndpoints(source, targetCenter);
  equal(target, [[162, 109], [202, 159]], 'target handles translate the source diameter to f*');
  equal(headCenter(target), targetCenter, 'target handle midpoint is the prescribed f*');
  equal(source, sourceBefore, 'constructing target handles leaves source H unchanged');
  equal(targetCenter, centerBefore, 'constructing target handles leaves the requested center unchanged');
  equal(target[1].map((value, axis) => value - target[0][axis]), [40, 50],
    'target handles preserve the source diameter vector');
  equal(Math.hypot(target[1][0] - target[0][0], target[1][1] - target[0][1]) / 2,
    Math.hypot(40, 50) / 2, 'target handles preserve the source radius');
  ok(target !== source && target[0] !== source[0] && target[1] !== source[1],
    'constructed target endpoints have independent arrays');

  for (const index of [0, 1]) {
    const endpoints = targetHeadEndpoints(source, targetCenter), before = structuredClone(endpoints);
    const point = endpoints[index].map((value, axis) => value + [15, -9][axis]);
    const pointBefore = point.slice(), moved = moveTargetHead(endpoints, index, point);
    equal(moved[index], point, `H${index + 1}* follows its selected handle destination exactly`);
    equal(moved[1 - index], before[1 - index].map((value, axis) => value + [15, -9][axis]),
      `dragging H${index + 1}* moves the other handle by the same displacement`);
    equal(headCenter(moved), [197, 125], `f* follows displacement of H${index + 1}*`);
    equal(moved[1].map((value, axis) => value - moved[0][axis]), [40, 50],
      `dragging H${index + 1}* preserves diameter vector and orientation`);
    equal(Math.hypot(moved[1][0] - moved[0][0], moved[1][1] - moved[0][1]) / 2,
      Math.hypot(40, 50) / 2, `dragging H${index + 1}* preserves radius`);
    equal(endpoints, before, `dragging H${index + 1}* does not mutate the previous controls`);
    equal(point, pointBefore, `dragging H${index + 1}* does not mutate the destination point`);
    equal(source, sourceBefore, `dragging H${index + 1}* does not mutate source H`);
    ok(moved !== endpoints && moved[0] !== endpoints[0] && moved[1] !== endpoints[1],
      `dragging H${index + 1}* produces independent endpoint arrays`);

    const restored = moveTargetHead(moved, index, before[index]);
    equal(restored, before, `moving H${index + 1}* back restores the previous target exactly`);
    const prepared = prepareEdit({ ...fixture(), targetHeadCenter: headCenter(moved) });
    equal(prepared.head.targetCenter, [197, 125], `H${index + 1}* midpoint reaches the runtime f*`);
    equal(prepared.head.delta, [37, -20], `H${index + 1}* displacement is measured from original source f`);
    equal(prepared.head.sourceCenter, [160, 145], `H${index + 1}* retains the original source f`);
  }

  for (const invalidHead of [null, [], [[140, 120]], [[140, 120], [NaN, 170]]]) {
    equal(targetHeadEndpoints(invalidHead, targetCenter), null, 'incomplete source H cannot create target handles');
    assert.throws(() => moveTargetHead(invalidHead, 0, [182, 134]), TypeError,
      'incomplete target H cannot be dragged');
    assertions++;
  }
  for (const invalidCenter of [null, [], [182], [182, 134, 1], [Infinity, 134]]) {
    equal(targetHeadEndpoints(source, invalidCenter), null, 'invalid target center cannot create target handles');
  }
  for (const invalidIndex of [-1, 2, 0.5, NaN, '0']) {
    assert.throws(() => moveTargetHead(target, invalidIndex, [182, 134]), TypeError,
      'only an actual target endpoint index can be dragged');
    assertions++;
  }
  for (const invalidPoint of [null, [], [182], [182, 134, 1], [NaN, 134], ['182', 134]]) {
    assert.throws(() => moveTargetHead(target, 0, invalidPoint), TypeError,
      'target handle destinations require a finite coordinate pair');
    assertions++;
  }
}

console.log(`Target head translation: ${assertions} assertions passed.`);
