import assert from 'node:assert/strict';
import {
  LOCKED_COLOR,
  EDITABLE_COLOR,
  isFixedSourcePoint,
  isLockedSourcePoint,
  headCenter,
  resolveSourcePointerTarget,
} from './landmark-controls.mjs';
import {grafAngles,solveTargetKeypoints} from './geometry.mjs';

const initialPoints = () => [[10, 10], [40, 10], [10, 40], [70, 70], [100, 70]];
const initialHead = () => [[150, 110], [150, 150]];
let assertions = 0;
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}
function resolve(points, head, point, selectedIndex = 3, threshold = 5) {
  return resolveSourcePointerTarget({ points, head, point, selectedIndex, threshold });
}
function applyResolvedClick(points, head, point, selectedIndex) {
  const index = resolve(points, head, point, selectedIndex);
  if (index !== null) (index < 5 ? points : head)[index < 5 ? index : index - 5] = point.slice();
  return index;
}

assert.equal(typeof LOCKED_COLOR, 'string');
assert.equal(typeof EDITABLE_COLOR, 'string');
assert.notEqual(LOCKED_COLOR, EDITABLE_COLOR, 'locked and editable controls need distinct colors');
assertions += 3;

// Fixed source landmarks can be placed once, but an existing fixed landmark
// must not resolve to a draggable control or a selected-control fallback.
for (const index of [0, 1, 2, 4]) {
  const points = initialPoints(), head = initialHead();
  equal(isFixedSourcePoint(index), true, `p${index + 1} coordinate fields are fixed`);
  equal(isLockedSourcePoint(index, points), true, `placed p${index + 1} is locked`);
  equal(resolve(points, head, points[index], 4), null, `hit on p${index + 1} blocks fallback`);
  equal(resolve(points, head, [200, 200], index), null, `selected p${index + 1} cannot move`);
  points[index] = null;
  equal(isLockedSourcePoint(index, points), false, `empty p${index + 1} can be placed`);
  equal(applyResolvedClick(points, head, [200, 200], index), index, `first p${index + 1} placement resolves`);
  equal(points[index], [200, 200], `first p${index + 1} placement updates its slot`);
  equal(isLockedSourcePoint(index, points), true, `p${index + 1} locks immediately after placement`);
  equal(resolve(points, head, [210, 210], index), null, `placed p${index + 1} cannot be moved afterward`);
}

// p4, H1 and H2 remain editable; an actual nearby editable hit wins over
// the selected landmark, including when that selected landmark is fixed.
for (const index of [3, 5, 6]) {
  const points = initialPoints(), head = initialHead();
  const point = (index < 5 ? points : head)[index < 5 ? index : index - 5];
  equal(isLockedSourcePoint(index, points), false, `source index ${index} remains editable`);
  equal(resolve(points, head, point, 0), index, `editable hit ${index} wins over selected fixed point`);
  equal(resolve(points, head, [200, 200], index), index, `editable index ${index} supports selected fallback`);
}

// f is a derived midpoint, not an eighth editable slot. Clicking f must not
// alter whichever source point happens to be selected.
{
  const points = initialPoints(), head = initialHead();
  equal(headCenter(head), [150, 130], 'f is the H1/H2 midpoint');
  for (const selectedIndex of [0, 3, 4, 5, 6]) {
    const before = structuredClone({ points, head });
    equal(applyResolvedClick(points, head, [150, 130], selectedIndex), null, `f blocks selected index ${selectedIndex}`);
    equal({ points, head }, before, `clicking f does not move index ${selectedIndex}`);
  }
  equal(resolve(points, head, [152, 132], 3), null, 'f hit area also blocks fallback');
}

// A locked hit has priority even if an editable landmark overlaps its hit area.
{
  const points = initialPoints(), head = initialHead();
  points[3] = [11, 11];
  equal(resolve(points, head, [11, 11], 4), null, 'fixed marker blocks an overlapping editable hit');
  points[3] = [99, 69];
  equal(resolve(points, head, [99, 69], 3), null, 'p5 blocks an overlapping editable p4 hit');
  head[0] = [150, 129];
  head[1] = [150, 131];
  equal(resolve(points, head, [150, 129], 4), null, 'f blocks an overlapping H endpoint hit');
}

// Locking the source annotation must not disable the manuscript's angle-driven
// target p5 construction or change the source coordinates.
{
  const points = initialPoints(), before = structuredClone(points), source = grafAngles(points);
  const target = solveTargetKeypoints(points, 65, source.beta);
  equal(points, before, 'target construction retains the locked source p5');
  equal(isLockedSourcePoint(4, points), true, 'source p5 remains locked after target construction');
  equal(target[4].every((value, axis) => Math.abs((value - target[3][axis]) - (points[4][axis] - points[3][axis])) < 1e-10), true, 'preserved beta reattaches the cartilage segment to target p4');
  equal(target[4].some((value, axis) => value !== points[4][axis]), true, 'target p5 moves automatically with target p4');
  const betaTarget = solveTargetKeypoints(points, 65, 30);
  equal(Math.abs(grafAngles(betaTarget).beta - 30) < 1e-10, true, 'beta requests continue to construct target p5');
}

// f must be recalculated from current H endpoints, with no stale midpoint.
{
  const points = initialPoints(), head = initialHead();
  equal(applyResolvedClick(points, head, [160, 110], 5), 5, 'H1 can move');
  equal(headCenter(head), [155, 130], 'f follows moved H1');
  equal(applyResolvedClick(points, head, [180, 160], 6), 6, 'H2 can move');
  equal(headCenter(head), [170, 135], 'f follows moved H2');
  equal(resolve(points, head, [170, 135], 3), null, 'new f position is locked');
  equal(resolve(points, head, [150, 130], 3), 3, 'old f position no longer blocks editable fallback');
}

{
  const points = Array(5).fill(null), head = Array(2).fill(null);
  equal(headCenter(head), null, 'empty H has no f');
  head[0] = [150, 110];
  equal(headCenter(head), null, 'one H endpoint has no f');
  equal(resolve(points, head, [150, 130], 0), 0, 'incomplete H does not create a locked f hit');
  for (const selectedIndex of [-1, 7, NaN]) {
    equal(resolve(points, head, [200, 200], selectedIndex), null, 'invalid selected index is rejected');
  }
}

{
  const points = initialPoints(), head = initialHead(), before = structuredClone({ points, head });
  resolve(points, head, [200, 200], 3);
  headCenter(head);
  equal({ points, head }, before, 'control helpers do not mutate landmark geometry');
}

console.log(`Landmark controls: ${assertions} assertions passed.`);
