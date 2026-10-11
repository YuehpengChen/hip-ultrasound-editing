import assert from 'node:assert/strict';
import {pickDragPoint, startPointDrag, advancePointDrag} from './point-drag-controls.mjs';

let checks = 0;
const equal = (actual, expected, message) => {assert.deepEqual(actual, expected, message); checks++;};
const check = (value, message) => {assert.ok(value, message); checks++;};
const throws = (fn, error, message) => {assert.throws(fn, error, message); checks++;};
const points = [[0, 0], [20, 20], [40, 40], [60, 60], [80, 80], [100, 100], [120, 120]];
const pick = options => pickDragPoint({points, ...options});

equal(pick({point: [200, 200]}), null, 'blank image click cannot edit the selected point');
equal(pickDragPoint(), null, 'missing pick coordinates are safely ignored');
equal(pick({point: [NaN, 0]}), null, 'non-finite pick coordinate is ignored');
equal(pick({point: [0, 0], scale: 0}), null, 'invalid display scale is ignored');
for (let index = 0; index < 7; index++) {
  equal(pick({point: points[index]}), index, 'existing zero-valued and nonzero markers can be picked');
  equal(pick({point: points[index], locked: [index]}), null, 'locked marker cannot be picked');
}
equal(pick({point: [66.9, 60]}), 3, 'marker edge can begin a drag');
equal(pick({point: [67.1, 60]}), null, 'outside marker hit area cannot begin a drag');
equal(pick({point: [74, 60], scale: 2}), 3, 'marker hit radius scales to native coordinates');
equal(pick({point: [74.1, 60], scale: 2}), null, 'scaled marker radius stays bounded');
equal(pick({point: [60, 60], sourceCenter: [60, 60]}), null, 'fixed f shields overlapping other marker');
equal(pick({point: [60, 60], sourceCenter: [60, 60], targetCenter: [60, 60]}), 7, 'f* takes priority over fixed f');
equal(pick({point: [63.5, 60], sourceCenter: [60, 60], targetCenter: [60, 60]}), 7, 'f* hit radius is inclusive');
equal(pick({point: [63.6, 60], sourceCenter: [60, 60], targetCenter: [60, 60]}), null, 'fixed f outer marker remains noneditable');
equal(pick({point: [60, 60], sourceCenter: [60, 60], targetCenter: [60, 60], locked: [7]}), null, 'locked f* cannot bypass fixed f');
equal(pick({point: [6, 0], sourceCenter: [0, 0], targetCenter: [0, 0]}), null, 'zero-valued fixed f shields outer marker');
equal(pick({point: [0, 0], sourceCenter: [0, 0], targetCenter: [0, 0]}), 7, 'zero-valued overlapping f* is editable');
equal(pickDragPoint({point: [0, 0], points: [null, undefined, [NaN, 0], [0, Infinity], [0], 'point', [0, 0]]}), 6, 'malformed marker entries are ignored');
equal(pickDragPoint({point: [1, 0], points: [[0, 0], [2, 0]], locked: [1]}), null, 'closest locked marker shields tied markers');

const source = [60, 60], pointer = [66, 60], client = [200, 200];
const gesture = startPointDrag({index: 3, origin: source, pointer, client, pointerId: 11});
equal(gesture, {index: 3, origin: [60, 60], pointerStart: [66, 60], clientStart: [200, 200], pointerId: 11, moved: false}, 'pointerdown captures origin without snapping marker');
check(gesture.origin !== source && gesture.pointerStart !== pointer && gesture.clientStart !== client, 'gesture coordinates are independent copies');
const unchangedGesture = structuredClone(gesture);
const move = (options = {}, current = gesture) => advancePointDrag(current, {
  pointer: [66, 60], client: [200, 200], pointerId: 11, width: 256, height: 256, ...options,
});
equal(move(), null, 'pointerdown and stationary click do not edit');
equal(move({pointer: [68.99, 60], client: [202.99, 200]}), null, 'small pointer jitter does not edit');
equal(move({pointer: [68, 62], client: [202, 202]}), null, 'diagonal jitter below threshold does not edit');
equal(move({pointer: [90, 60], client: [202.9, 200]}), null, 'threshold is CSS distance even at magnified native displacement');
const atThreshold = move({pointer: [69, 60], client: [203, 200]});
equal(atThreshold.point, [63, 60], 'three CSS pixels intentionally starts marker-relative drag');
equal(atThreshold.gesture.moved, true, 'intentional drag activates gesture');
equal(gesture, unchangedGesture, 'starting gesture remains unchanged');
equal(source, [60, 60], 'source marker remains unchanged');
equal(pointer, [66, 60], 'source pointer remains unchanged');
equal(client, [200, 200], 'source client coordinate remains unchanged');
equal(move({pointer: [76, 65], client: [205, 202.5]}).point, [70, 65], 'edge drag does not snap origin to pointer');
equal(move({pointer: [76, 65], client: [210, 205]}).point, [70, 65], 'same native displacement is independent of CSS display scale');
equal(move({pointer: [66.5, 60], client: [200.5, 200]}, atThreshold.gesture).point, [60.5, 60], 'activated drag continues after returning inside jitter threshold');
equal(move({}, atThreshold.gesture).point, [60, 60], 'activated drag can return exactly to marker origin');
equal(move({pointerId: 12, pointer: [90, 90], client: [220, 220]}), null, 'another pointer cannot affect gesture');
equal(advancePointDrag(gesture, {pointerId: 12}), null, 'wrong pointer is ignored before unrelated event values');
equal(move({pointer: [-100, -100], client: [100, 100]}).point, [0, 0], 'drag clamps to image top-left');
equal(move({pointer: [1000, 1000], client: [500, 500]}).point, [255, 255], 'drag clamps to image bottom-right');
equal(move({pointer: [1000, 1000], client: [500, 500], width: 1, height: 1}).point, [0, 0], 'one-pixel image has a valid fixed extent');
equal(move({pointer: [90, 72], client: [220, 212]}, atThreshold.gesture).point, [84, 72], 'successive events use initial displacement rather than accumulating');
equal(move({pointer: [90, 72], client: [220, 212]}).point, [84, 72], 'absolute replay returns identical destination');
const independent = move({pointer: [69, 60], client: [203, 200]});
independent.gesture.origin[0] = 900;
independent.gesture.pointerStart[0] = 900;
independent.gesture.clientStart[0] = 900;
equal(gesture, unchangedGesture, 'returned gesture cannot mutate source gesture');

for (let index = 0; index <= 7; index++)
  equal(startPointDrag({index, origin: [0, 0], pointer: [0, 0], client: [0, 0], pointerId: 0}).index, index, 'all valid marker indices and zero pointer ID accepted');
for (const index of [-1, 8, 2.5, NaN, Infinity, '3', undefined])
  throws(() => startPointDrag({index, origin: [0, 0], pointer: [0, 0], client: [0, 0], pointerId: 1}), RangeError, 'invalid marker index rejected');
for (const key of ['origin', 'pointer', 'client']) for (const invalid of [null, undefined, [0], [0, 0, 0], [NaN, 0], [0, Infinity], '0,0'])
  throws(() => startPointDrag({index: 3, origin: [0, 0], pointer: [0, 0], client: [0, 0], pointerId: 1, [key]: invalid}), TypeError, 'malformed start coordinate rejected');
for (const pointerId of [-1, NaN, Infinity, 1.2, '1', undefined])
  throws(() => startPointDrag({index: 3, origin: [0, 0], pointer: [0, 0], client: [0, 0], pointerId}), TypeError, 'malformed pointer identity rejected');
for (const axis of ['width', 'height']) for (const invalid of [0, -1, 0.5, NaN, Infinity, '256', undefined])
  throws(() => move({[axis]: invalid}), RangeError, 'invalid image dimensions rejected');
throws(() => advancePointDrag(null, {}), TypeError, 'missing drag gesture rejected');
throws(() => move({pointer: [NaN, 0]}), TypeError, 'malformed move coordinate rejected');
throws(() => move({client: [0, Infinity]}), TypeError, 'malformed CSS coordinate rejected');
throws(() => move({}, {...gesture, moved: 1}), TypeError, 'malformed moved state rejected');
equal(gesture, unchangedGesture, 'validation failures do not mutate gesture');

console.log(`Point drag controls: ${checks} checks passed.`);
