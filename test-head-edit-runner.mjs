import assert from 'node:assert/strict';
import {createHeadEditRunner, headEditSignature} from './head-edit-runner.mjs';

let assertions = 0;
const equal = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  assertions++;
};

function fakeTimers() {
  let now = 0, nextId = 0;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, {callback, due: now + delay});
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.due <= end)
          .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.due;
        timers.delete(id);
        timer.callback();
      }
      now = end;
    },
    count() { return timers.size; },
  };
}

function fixture() {
  const clock = fakeTimers(), calls = [];
  const state = {latest: 'initial', allowed: true};
  const runner = createHeadEditRunner({
    run: () => calls.push(state.latest),
    canRun: () => state.allowed,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delay: 250,
  });
  return {clock, calls, state, runner};
}

// Holding a pointer never runs an intermediate position, even after a pause
// longer than the debounce interval. The latest position runs once on release.
{
  const {clock, calls, state, runner} = fixture();
  runner.hold();
  state.latest = 'first drag position';
  runner.request();
  clock.advance(5000);
  equal(calls, [], 'a held drag cannot run after a long pause');
  equal(clock.count(), 0, 'held edits do not leave a timer running');
  equal(runner.isPending(), true, 'held edit remains pending');
  state.latest = 'final drag position';
  runner.request();
  clock.advance(5000);
  equal(calls, [], 'multiple held positions never invoke the model');
  runner.release();
  clock.advance(249);
  equal(calls, [], 'release respects the debounce delay');
  clock.advance(1);
  equal(calls, ['final drag position'], 'release generates only the latest drag position');
  equal(runner.isPending(), false, 'successful dispatch consumes the pending edit');
  clock.advance(5000);
  runner.release();
  clock.advance(5000);
  equal(calls, ['final drag position'], 'release without an edit cannot repeat inference');
}

// A request scheduled before pointer capture must also wait for release.
{
  const {clock, calls, state, runner} = fixture();
  runner.request();
  clock.advance(100);
  runner.hold();
  clock.advance(1000);
  equal(calls, [], 'hold cancels an existing timer without discarding its edit');
  state.latest = 'position at release';
  runner.release();
  clock.advance(250);
  equal(calls, ['position at release'], 'release reads the current edit, not an old snapshot');
}

// Rapid committed edits coalesce, with the delay measured from the last edit.
{
  const {clock, calls, state, runner} = fixture();
  state.latest = 'first'; runner.request();
  clock.advance(100);
  state.latest = 'second'; runner.request();
  clock.advance(100);
  state.latest = 'third'; runner.request();
  equal(clock.count(), 1, 'rapid requests keep only one active timer');
  clock.advance(249);
  equal(calls, [], 'earlier deadlines cannot dispatch superseded edits');
  clock.advance(1);
  equal(calls, ['third'], 'only the last rapid request is generated');
}

// This mirrors app.changed(): validation cancels the previous timer, then
// carries an outstanding head edit into the newly prepared valid state.
// A no-op pointermove at the final position must not erase a pending drag.
{
  const {clock, calls, state, runner} = fixture();
  let currentSignature = 'source';
  function changed(nextSignature, {autoHead = true} = {}) {
    const previousHead = currentSignature, pendingHead = runner.isPending();
    runner.cancel();
    currentSignature = nextSignature;
    if (autoHead && nextSignature && (nextSignature !== previousHead || pendingHead)) {
      runner.request();
    }
  }
  runner.hold();
  state.latest = 'moved head';
  changed('moved');
  equal(runner.isPending(), true, 'a changed valid signature queues inference');
  changed('moved');
  equal(runner.isPending(), true, 'a final no-op retains pending inference');
  clock.advance(1000);
  equal(calls, [], 'no-op updates do not defeat the pointer hold');
  runner.release();
  clock.advance(250);
  equal(calls, ['moved head'], 'release after final no-op still generates the moved head');
  changed('moved');
  clock.advance(1000);
  equal(calls, ['moved head'], 'a no-op without a pending edit does not add an unnecessary run');

  state.latest = 'committed coordinate';
  changed('coordinate target');
  clock.advance(100);
  changed('coordinate target');
  equal(runner.isPending(), true, 'a committed no-op retains an already scheduled edit');
  clock.advance(250);
  equal(calls, ['moved head', 'committed coordinate'],
    'a no-op after release does not erase automatic coordinate inference');

  state.latest = 'invalid request';
  changed('another target');
  changed(null);
  equal(runner.isPending(), false, 'invalid preparation cancels a pending edit');
  clock.advance(1000);
  equal(calls, ['moved head', 'committed coordinate'],
    'invalid target cannot dispatch an earlier valid request');

  changed('old image target');
  state.latest = 'new image';
  changed('new image signature', {autoHead: false});
  equal(runner.isPending(), false, 'image replacement cancels pending inference');
  clock.advance(1000);
  equal(calls, ['moved head', 'committed coordinate'],
    'loading another image never auto-runs the previous request');
}

// Explicit cancellation handles invalid input, clear-H, and image replacement.
{
  const {clock, calls, runner} = fixture();
  runner.request();
  runner.cancel();
  equal(runner.isPending(), false, 'cancel discards an outstanding edit');
  equal(clock.count(), 0, 'cancel removes its timer');
  clock.advance(1000);
  equal(calls, [], 'cancelled edit cannot run later');
  runner.hold(); runner.request(); runner.cancel(); runner.release();
  clock.advance(1000);
  equal(calls, [], 'a cancelled held edit cannot reappear on release');
}

// A stale timer cannot bypass the current validity/busy guard. No polling or
// inference occurs while canRun is false; a later explicit event can reschedule.
{
  const {clock, calls, state, runner} = fixture();
  runner.request();
  state.allowed = false;
  clock.advance(250);
  equal(calls, [], 'canRun=false blocks dispatch');
  equal(clock.count(), 0, 'a blocked request does not busy-poll');
  equal(runner.isPending(), true, 'guarded request remains pending until cancelled or rescheduled');
  clock.advance(5000);
  equal(calls, [], 'elapsed time does not bypass a false guard');
  state.allowed = true; state.latest = 'valid again'; runner.release();
  clock.advance(250);
  equal(calls, ['valid again'], 'a later allowed event can dispatch the latest valid state');
}

// Signatures compare the actual full-frame f/f* and radius, not the arbitrary
// native crop origin. They intentionally contain no pixels or source IDs.
{
  const prepared = {headLayers: {}, head: {
    sourceCenter: [10, 20], targetCenter: [12, 24], radius: 30,
  }};
  const before = structuredClone(prepared), box = [100, 200, 356, 456];
  const signature = headEditSignature(prepared, box);
  equal(JSON.parse(signature), [110, 220, 112, 224, 30], 'signature uses full-frame source and target centers');
  equal(prepared, before, 'computing a signature never mutates geometry');
  equal(box, [100, 200, 356, 456], 'computing a signature never mutates the crop');
  const recropped = {headLayers: {}, head: {
    sourceCenter: [-15, -5], targetCenter: [-13, -1], radius: 30,
  }};
  equal(headEditSignature(recropped, [125, 225, 381, 481]), signature,
    'equivalent full-frame centers retain one signature after recropping');
  for (const [key, value] of [['sourceCenter', [11, 20]], ['targetCenter', [12, 25]], ['radius', 31]]) {
    const changed = structuredClone(prepared); changed.head[key] = value;
    equal(headEditSignature(changed, box) !== signature, true, `${key} changes are detected`);
  }
  for (const candidate of [null, {}, {head: prepared.head}, {headLayers: {}, head: null},
    {headLayers: {}, head: {...prepared.head, radius: 0}},
    {headLayers: {}, head: {...prepared.head, radius: -1}}]) {
    equal(headEditSignature(candidate, box), null, 'missing/disabled/degenerate H produces no signature');
  }
  equal(headEditSignature(prepared, null), null, 'a missing crop has no global signature');
}

console.log(`Head edit runner: ${assertions} assertions passed.`);
