const finitePoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const pointCopy = (point, label) => {
  if (!finitePoint(point)) throw new TypeError(`${label} must be a finite [x, y] coordinate.`);
  return point.slice();
};
const dragIndex = index => {
  if (!Number.isInteger(index) || index < 0 || index > 7)
    throw new RangeError('Drag index must be an integer from 0 to 7.');
};
const validPointerId = pointerId => {
  if (!Number.isSafeInteger(pointerId) || pointerId < 0)
    throw new TypeError('Pointer ID must be a nonnegative safe integer.');
};

/** Pick only an existing marker; clicking elsewhere must not edit a selected point. */
export function pickDragPoint({point, points, sourceCenter = null, targetCenter = null, scale = 1, locked = []} = {}) {
  if (!finitePoint(point) || !Array.isArray(points) || !Number.isFinite(scale) || scale <= 0) return null;
  const isLocked = index => Array.isArray(locked) && locked.includes(index);
  const distance = candidate => finitePoint(candidate)
    ? Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) : Infinity;
  // The editable inner f* marker wins when it initially overlaps the fixed f.
  if (!isLocked(7) && distance(targetCenter) <= 3.5 * scale) return 7;
  if (distance(sourceCenter) <= 7 * scale) return null;
  let nearest = null, best = 7 * scale;
  for (let index = 0; index < 7; index++) {
    const candidateDistance = distance(points[index]);
    if (candidateDistance <= best) {nearest = index; best = candidateDistance;}
  }
  return nearest === null || isLocked(nearest) ? null : nearest;
}

/** Capture the marker and pointer origins without moving the marker on pointerdown. */
export function startPointDrag({index, origin, pointer, client, pointerId} = {}) {
  dragIndex(index);
  validPointerId(pointerId);
  return {
    index,
    origin: pointCopy(origin, 'Marker origin'),
    pointerStart: pointCopy(pointer, 'Pointer origin'),
    clientStart: pointCopy(client, 'Client origin'),
    pointerId,
    moved: false,
  };
}

/** Apply absolute displacement after an intentional 3 CSS-pixel drag. */
export function advancePointDrag(gesture, {pointer, client, pointerId, width, height} = {}) {
  if (!gesture || typeof gesture !== 'object') throw new TypeError('A point drag gesture is required.');
  dragIndex(gesture.index);
  validPointerId(gesture.pointerId);
  if (pointerId !== gesture.pointerId) return null;
  const origin = pointCopy(gesture.origin, 'Marker origin');
  const pointerStart = pointCopy(gesture.pointerStart, 'Pointer origin');
  const clientStart = pointCopy(gesture.clientStart, 'Client origin');
  pointCopy(pointer, 'Pointer position');
  pointCopy(client, 'Client position');
  if (typeof gesture.moved !== 'boolean') throw new TypeError('Gesture moved state must be boolean.');
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1)
    throw new RangeError('Image width and height must be positive integers.');
  if (!gesture.moved && Math.hypot(client[0] - clientStart[0], client[1] - clientStart[1]) < 3) return null;
  return {
    gesture: {index: gesture.index, origin, pointerStart, clientStart, pointerId, moved: true},
    point: origin.map((value, axis) => Math.max(0, Math.min((axis ? height : width) - 1, value + pointer[axis] - pointerStart[axis]))),
  };
}
