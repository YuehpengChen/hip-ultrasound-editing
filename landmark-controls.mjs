export const LOCKED_COLOR = '#f1b64a';
export const EDITABLE_COLOR = '#42b5e5';

const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

export function isLockedSourcePoint(index, points) {
  return Number.isInteger(index) && index >= 0 && index < 3 && validPoint(points[index]);
}

export function headCenter(head) {
  if (!head || head.length !== 2 || !head.every(validPoint)) return null;
  return [(head[0][0] + head[1][0]) / 2, (head[0][1] + head[1][1]) / 2];
}

export function resolveSourcePointerTarget({points, head, point, selectedIndex, threshold}) {
  if (!validPoint(point) || !Number.isFinite(threshold) || threshold <= 0) return null;
  const hit = p => validPoint(p) && Math.hypot(p[0] - point[0], p[1] - point[1]) <= threshold;
  if (points.slice(0, 3).some(hit) || hit(headCenter(head))) return null;
  const all = [...points, ...head];
  const nearby = all.findIndex((p, index) => !isLockedSourcePoint(index, points) && hit(p));
  if (nearby >= 0) return nearby;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 6 || isLockedSourcePoint(selectedIndex, points)) return null;
  return selectedIndex;
}
