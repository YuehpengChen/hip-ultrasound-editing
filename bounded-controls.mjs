import {cropBox, grafAngles, headFromEndpoints, solveTargetKeypoints, validateTargetPoints} from './geometry.mjs';
import {targetHeadEndpoints} from './head-controls.mjs';

// These are software interaction limits, not clinically validated ranges.
const ALPHA_MIN = 30, ALPHA_MAX = 84, BETA_MIN = 0.1, BETA_MAX = 89.9;
const EPSILON = 1e-7;
const finitePoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const copyPoints = points => points.map(point => point.slice());
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function insideBox(point, box) {
  return point[0] >= box[0] - EPSILON && point[0] <= box[2] - 1 + EPSILON &&
    point[1] >= box[1] - EPSILON && point[1] <= box[3] - 1 + EPSILON;
}

function insideP4Range(initial, point) {
  return insideBox(point, initial.box) &&
    distance(point, initial.rangeP4.center) <= initial.rangeP4.radius + EPSILON;
}

function insideP5Range(initial, point) {
  return insideBox(point, initial.box) &&
    distance(point, initial.rangeP5.center) <= initial.rangeP5.radius + EPSILON;
}

/** Capture source annotation once; no mutable target or image output is stored. */
export function captureInitialGeometry(points, headEndpoints = null, width = 256, height = 256) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 256 || height < 256) {
    throw new RangeError('The initial image must be at least 256 pixels on both axes.');
  }
  const angles = grafAngles(points), sourcePoints = copyPoints(points);
  const box = cropBox(sourcePoints, width, height);
  if (!insideBox(sourcePoints[3], box)) {
    throw new RangeError('Initial p4 must be inside the fixed 256 × 256 editing region.');
  }
  if (!insideBox(sourcePoints[4], box)) {
    throw new RangeError('Initial p5 must be inside the fixed 256 × 256 editing region.');
  }
  const head = headFromEndpoints(headEndpoints);
  if (head && !(head.radius > 0)) throw new RangeError('Initial H endpoints must be distinct.');
  const sourceCenter = head?.center.slice() ?? null;
  if (sourceCenter && !insideBox(sourceCenter, box)) {
    throw new RangeError('Initial f must be inside the fixed 256 × 256 editing region.');
  }
  const radius = head?.radius ?? 0;
  const headRangeRadius = sourceCenter ? 1.1 * Math.max(0, Math.min(radius * 0.5,
    sourceCenter[0] - box[0], box[2] - 1 - sourceCenter[0],
    sourceCenter[1] - box[1], box[3] - 1 - sourceCenter[1])) : 0;
  return deepFreeze({
    points: sourcePoints, sourcePoints,
    headEndpoints: head ? copyPoints(headEndpoints) : null,
    width, height, box, angles, sourceAngles: angles,
    sourceCenter, f: sourceCenter, headRadius: radius, radius,
    rangeP4: {center: sourcePoints[3].slice(), radius: 0.8 * distance(sourcePoints[3], sourcePoints[4]), box: box.slice()},
    rangeP5: {center: sourcePoints[4].slice(), radius: 0.8 * distance(sourcePoints[3], sourcePoints[4]), box: box.slice()},
    rangeHead: sourceCenter ? {center: sourceCenter.slice(), radius: headRangeRadius, box: box.slice()} : null,
  });
}

/** Absolute f* request, measured from the initial f, not a previous handle. */
export function boundTargetCenter(initial, requested) {
  if (!finitePoint(requested)) throw new TypeError('Target f* must be a finite [x, y] coordinate.');
  if (!initial.rangeHead) throw new RangeError('Target f* requires an initial H annotation.');
  const {center, radius} = initial.rangeHead;
  const length = distance(requested, center), scale = length > radius && length > 0 ? radius / length : 1;
  const result = center.map((value, axis) => value + (requested[axis] - value) * scale);
  return [clamp(result[0], initial.box[0], initial.box[2] - 1),
    clamp(result[1], initial.box[1], initial.box[3] - 1)];
}

/** Rebuild H1/H2 from the initial diameter for every absolute target center. */
export function headHandlesAtCenter(initial, center) {
  const bounded = boundTargetCenter(initial, center);
  return targetHeadEndpoints(initial.headEndpoints, bounded);
}

function angleCandidates(minimum, maximum, preferred, additional = null) {
  const values = [];
  for (let value = Math.round(minimum * 10); value <= Math.round(maximum * 10); value++) values.push(value / 10);
  for (const value of [preferred, additional]) {
    if (Number.isFinite(value) && value >= minimum && value <= maximum && !values.includes(value)) values.push(value);
  }
  values.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
  return values;
}

function solved(initial, alpha, beta) {
  return solveTargetKeypoints(initial.points, alpha, beta);
}

function nearestFeasibleBeta(initial, alpha, beta) {
  const requested = solved(initial, alpha, beta);
  // p4 depends only on alpha. Skip its infeasible angles before a beta scan.
  if (!insideP4Range(initial, requested[3])) return null;
  if (insideP5Range(initial, requested[4])) return {points: requested, alpha, beta};
  for (const candidate of angleCandidates(BETA_MIN, BETA_MAX, beta, initial.angles.beta)) {
    const points = solved(initial, alpha, candidate);
    if (insideP5Range(initial, points[4])) return {points, alpha, beta: candidate};
  }
  return null;
}

function validateRequest(alpha, beta) {
  if (!Number.isFinite(alpha) || (beta !== null && !Number.isFinite(beta))) {
    throw new TypeError('Target angles must be finite numbers.');
  }
}

/** Original length-preserving construction inside both fixed point ranges. */
export function targetPointsForRequest(initial, alpha, beta = null) {
  validateRequest(alpha, beta);
  const requestedBeta = beta ?? initial.angles.beta;
  // The zero-edit case must retain exact source coordinates and angles.
  if (Math.abs(alpha - initial.angles.alpha) <= EPSILON &&
      Math.abs(requestedBeta - initial.angles.beta) <= EPSILON) {
    return {points: copyPoints(initial.points), alpha: initial.angles.alpha,
      beta: initial.angles.beta, limited: false};
  }
  const requestedAlpha = alpha;
  alpha = clamp(alpha, ALPHA_MIN, ALPHA_MAX);
  beta = clamp(requestedBeta, BETA_MIN, BETA_MAX);
  let result = nearestFeasibleBeta(initial, alpha, beta);
  if (!result) {
    for (const candidate of angleCandidates(ALPHA_MIN, ALPHA_MAX, alpha, initial.angles.alpha)) {
      result = nearestFeasibleBeta(initial, candidate, beta);
      if (result) break;
    }
  }
  if (!result) throw new RangeError('No target is reachable inside the initial p4/p5 editing ranges and fixed crop.');
  return {...result, limited: Math.abs(result.alpha - requestedAlpha) > EPSILON ||
    Math.abs(result.beta - requestedBeta) > EPSILON};
}

export const boundedTargetPoints = targetPointsForRequest;

/** A direct p4/p5 drag stays in its initial circle and the fixed native crop. */
export function boundTargetPoint(initial, index, requested) {
  if (![3, 4].includes(index) || !finitePoint(requested)) {
    throw new TypeError('A direct p4/p5 target requires its point index and finite coordinates.');
  }
  const range = index === 3 ? initial.rangeP4 : initial.rangeP5;
  const length = distance(requested, range.center);
  const scale = length > range.radius && length > 0 ? range.radius / length : 1;
  const result = range.center.map((value, axis) => value + (requested[axis] - value) * scale);
  // The box is convex and contains the circle center, so this also stays in the
  // circle. Neither the center nor radius depends on earlier target controls.
  return [clamp(result[0], initial.box[0], initial.box[2] - 1),
    clamp(result[1], initial.box[1], initial.box[3] - 1)];
}

/**
 * Direct pointer controls are separate from canonical numerical angle inputs.
 * Only the dragged target moves. In particular moving p4 does not translate p5
 * or project either segment back to its initial length.
 */
export function directTargetPoints(initial, index, cursor, currentPoints = initial.points) {
  const points = validateTargetPoints(initial.points, currentPoints);
  const bounded = boundTargetPoint(initial, index, cursor);
  points[index] = bounded;
  const measured = grafAngles(points); // Reject coincident roof landmarks.
  return {points, ...measured, limited: distance(bounded, cursor) > EPSILON};
}

function closestP5AtAlpha(initial, alpha, cursor, currentBeta) {
  if (!insideP4Range(initial, solved(initial, alpha, currentBeta)[3])) return null;
  let best = null, bestDistance = Infinity;
  for (const beta of angleCandidates(BETA_MIN, BETA_MAX, currentBeta, initial.angles.beta)) {
    const points = solved(initial, alpha, beta);
    if (!insideP5Range(initial, points[4])) continue;
    const error = distance(points[4], cursor);
    if (error < bestDistance - EPSILON) {best = {points, alpha, beta}; bestDistance = error;}
  }
  return best;
}

/** A drag requests an angle; it never replaces an initial source landmark. */
export function anglesForPointer(initial, index, cursor, currentAlpha, currentBeta = null) {
  if (![3, 4].includes(index) || !finitePoint(cursor)) {
    throw new TypeError('A target p4/p5 drag requires its point index and finite coordinates.');
  }
  validateRequest(currentAlpha, currentBeta);
  const beta = clamp(currentBeta ?? initial.angles.beta, BETA_MIN, BETA_MAX);
  const alpha = clamp(currentAlpha, ALPHA_MIN, ALPHA_MAX);
  let result = null;
  if (index === 4) {
    result = closestP5AtAlpha(initial, alpha, cursor, beta);
    if (!result) {
      for (const candidate of angleCandidates(ALPHA_MIN, ALPHA_MAX, alpha, initial.angles.alpha)) {
        result = closestP5AtAlpha(initial, candidate, cursor, beta);
        if (result) break;
      }
    }
  } else {
    const candidates = angleCandidates(ALPHA_MIN, ALPHA_MAX, alpha, initial.angles.alpha)
      .map(candidate => ({alpha: candidate, error: distance(solved(initial, candidate, beta)[3], cursor)}))
      .sort((a, b) => a.error - b.error || Math.abs(a.alpha - alpha) - Math.abs(b.alpha - alpha));
    for (const candidate of candidates) {
      result = nearestFeasibleBeta(initial, candidate.alpha, beta);
      if (result) break;
    }
  }
  if (!result) throw new RangeError('No target is reachable inside the initial p4/p5 editing ranges and fixed crop.');
  // Reuse the identity policy if the original angle pair was selected.
  const resolved = targetPointsForRequest(initial, result.alpha, result.beta);
  return {...resolved, limited: distance(resolved.points[index], cursor) > EPSILON};
}
