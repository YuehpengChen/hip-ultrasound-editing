/** Queue only the latest head edit; never generate intermediate drag positions. */
export function createHeadEditRunner({run, canRun, delay = 250,
  setTimer = setTimeout, clearTimer = clearTimeout}) {
  let timer = null, pending = false, held = false;
  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function schedule() {
    stopTimer();
    if (!pending || held) return;
    timer = setTimer(() => {
      timer = null;
      if (!pending || held || !canRun()) return;
      pending = false;
      void run();
    }, delay);
  }
  return {
    isPending() { return pending; },
    request() { pending = true; schedule(); },
    hold() { held = true; stopTimer(); },
    release() { held = false; schedule(); },
    cancel() { pending = false; stopTimer(); },
  };
}

/** Full-frame derived centers; a crop origin change is not itself an f edit. */
export function headEditSignature(prepared, box) {
  const head = prepared?.head;
  if (!prepared?.headLayers || !head || !(head.radius > 0) || !box) return null;
  return JSON.stringify([
    ...head.sourceCenter.map((v, i) => v + box[i]),
    ...head.targetCenter.map((v, i) => v + box[i]), head.radius,
  ]);
}
