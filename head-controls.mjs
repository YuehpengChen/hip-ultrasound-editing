import {headCenter} from './landmark-controls.mjs';

const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

/** Rigid handles retain the annotated source diameter; no resize is introduced. */
export function targetHeadEndpoints(sourceHead, targetCenter) {
  const center = headCenter(sourceHead);
  if (!center || !validPoint(targetCenter)) return null;
  const delta = targetCenter.map((value, axis) => value - center[axis]);
  return sourceHead.map(point => point.map((value, axis) => value + delta[axis]));
}

/** Drag either target handle and move the pair by the same displacement. */
export function moveTargetHead(endpoints, index, point) {
  if (!headCenter(endpoints) || ![0, 1].includes(index) || !validPoint(point)) {
    throw new TypeError('A target H handle requires two finite endpoints and a finite destination.');
  }
  const delta = point.map((value, axis) => value - endpoints[index][axis]);
  return endpoints.map(endpoint => endpoint.map((value, axis) => value + delta[axis]));
}
