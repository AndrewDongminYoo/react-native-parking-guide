import type { RuleResult } from '../types';

export interface GeoPoint {
  /** WGS 84 latitude in degrees, in [-90, 90]. */
  readonly lat: number;
  /** WGS 84 longitude in degrees, in [-180, 180]. */
  readonly lng: number;
}

export interface GeoLocation extends GeoPoint {
  /** Horizontal accuracy radius in meters; finite and >= 0. */
  readonly accuracy: number;
}

export type GeofenceZoneKind = 'allowed' | 'prohibited';

export interface GeofenceZone {
  readonly kind: GeofenceZoneKind;
  /** At least 3 vertices; the ring closes implicitly and uses the even-odd rule. */
  readonly polygon: readonly GeoPoint[];
}

export interface GeofenceOptions {
  /**
   * A location whose `accuracy` is greater than this many meters is not evaluated (unchecked result).
   * A number that is not NaN and is >= 0; `Infinity` disables the limit. Default: `DEFAULT_MAX_GEOFENCE_ACCURACY` (50).
   */
  readonly maxAccuracy?: number;
}

export const DEFAULT_MAX_GEOFENCE_ACCURACY = 50;

type ZoneState = 'inside' | 'outside' | 'uncertain';

/** Mean Earth radius in meters (IUGG). */
const EARTH_RADIUS = 6371008.8;
const METERS_PER_DEGREE = (EARTH_RADIUS * Math.PI) / 180;

function validatePoint(point: GeoPoint): void {
  if (
    typeof point !== 'object' ||
    point === null ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  ) {
    throw new RangeError(
      'Latitude must be in [-90, 90] and longitude in [-180, 180].'
    );
  }
}

function validateZone(zone: GeofenceZone): void {
  if (
    typeof zone !== 'object' ||
    zone === null ||
    (zone.kind !== 'allowed' && zone.kind !== 'prohibited')
  ) {
    throw new RangeError(
      "Geofence zone kind must be 'allowed' or 'prohibited'."
    );
  }
  if (!Array.isArray(zone.polygon) || zone.polygon.length < 3) {
    throw new RangeError('Geofence polygons must have at least 3 vertices.');
  }
  // for...of visits every index, so sparse array holes are rejected.
  for (const vertex of zone.polygon) {
    validatePoint(vertex);
  }
}

/** Wraps a longitude difference into [-180, 180). */
function wrapLng(delta: number): number {
  return ((((delta + 180) % 360) + 360) % 360) - 180;
}

/**
 * Projects a ring to east/north meters on a plane tangent at the origin. Longitudes are unwrapped along the ring so
 * it stays continuous across ±180°, then the ring is shifted by a multiple of 360° to the copy nearest the origin.
 */
function projectRing(
  origin: GeoPoint,
  ring: readonly GeoPoint[]
): [number, number][] {
  const deltas: number[] = [];
  let previous = 0;
  ring.forEach((point, index) => {
    previous =
      index === 0
        ? wrapLng(point.lng - origin.lng)
        : previous + wrapLng(point.lng - ring[index - 1]!.lng);
    deltas.push(previous);
  });
  const center = (Math.min(...deltas) + Math.max(...deltas)) / 2;
  const shift = center - wrapLng(center);
  const metersPerDegreeLng =
    METERS_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180);
  return ring.map((point, index) => [
    (deltas[index]! - shift) * metersPerDegreeLng,
    (point.lat - origin.lat) * METERS_PER_DEGREE,
  ]);
}

/** Distance from the origin to the segment a-b. */
function distanceToSegment(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared));
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}

function zoneState(location: GeoLocation, zone: GeofenceZone): ZoneState {
  const vertices = projectRing(location, zone.polygon);
  let inside = false;
  let boundaryDistance = Infinity;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[j]!;
    const b = vertices[i]!;
    // Even-odd ray cast from the origin toward +east.
    if (a[1] > 0 !== b[1] > 0) {
      const crossing = a[0] - (a[1] * (b[0] - a[0])) / (b[1] - a[1]);
      if (crossing > 0) {
        inside = !inside;
      }
    }
    boundaryDistance = Math.min(boundaryDistance, distanceToSegment(a, b));
  }
  if (boundaryDistance <= location.accuracy) {
    return 'uncertain';
  }
  return inside ? 'inside' : 'outside';
}

/**
 * Pure, deterministic `GEOFENCE` rule from a caller-supplied location and zones.
 * See the README section "Geofence" for the decision rules.
 */
export function evaluateGeofence(
  location: GeoLocation | undefined,
  zones: readonly GeofenceZone[],
  options: GeofenceOptions = {}
): RuleResult {
  const maxAccuracy = options.maxAccuracy ?? DEFAULT_MAX_GEOFENCE_ACCURACY;
  if (
    typeof maxAccuracy !== 'number' ||
    Number.isNaN(maxAccuracy) ||
    maxAccuracy < 0
  ) {
    throw new RangeError('maxAccuracy must be a number >= 0 (not NaN).');
  }
  if (!Array.isArray(zones)) {
    throw new RangeError('Geofence zones must be an array.');
  }
  for (const zone of zones) {
    validateZone(zone);
  }
  if (location !== undefined) {
    validatePoint(location);
    if (!Number.isFinite(location.accuracy) || location.accuracy < 0) {
      throw new RangeError('Location accuracy must be finite and >= 0.');
    }
  }
  if (!location || location.accuracy > maxAccuracy) {
    return { id: 'GEOFENCE', verdict: 'WARN', score: 0, confidence: 0 };
  }

  const allowed: ZoneState[] = [];
  const prohibited: ZoneState[] = [];
  for (const zone of zones) {
    (zone.kind === 'allowed' ? allowed : prohibited).push(
      zoneState(location, zone)
    );
  }
  if (
    prohibited.includes('inside') ||
    (allowed.length > 0 && allowed.every((state) => state === 'outside'))
  ) {
    return { id: 'GEOFENCE', verdict: 'FAIL', score: 0, confidence: 1 };
  }
  if (
    prohibited.includes('uncertain') ||
    (allowed.length > 0 && !allowed.includes('inside'))
  ) {
    return { id: 'GEOFENCE', verdict: 'WARN', score: 0.5, confidence: 1 };
  }
  return { id: 'GEOFENCE', verdict: 'PASS', score: 1, confidence: 1 };
}
