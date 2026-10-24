import { describe, expect, it } from '@jest/globals';

import {
  DEFAULT_MAX_GEOFENCE_ACCURACY,
  evaluateGeofence,
} from '../geofence/geofence';
import type { GeoLocation, GeoPoint, GeofenceZone } from '../geofence/geofence';
import { defaultPolicy } from '../policy/defaultPolicy';
import { evaluatePolicy } from '../policy/evaluate';

const EARTH_RADIUS = 6371008.8;
const METERS_PER_DEGREE = (EARTH_RADIUS * Math.PI) / 180;
const CENTER: GeoPoint = { lat: 37.5665, lng: 126.978 };

/** A point offset from CENTER by east and north meters. */
function at(east: number, north: number, origin: GeoPoint = CENTER): GeoPoint {
  return {
    lat: origin.lat + north / METERS_PER_DEGREE,
    lng:
      origin.lng +
      east / (METERS_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180)),
  };
}

function location(east: number, north: number, accuracy = 10): GeoLocation {
  return { ...at(east, north), accuracy };
}

/** An axis-aligned square of the given half size in meters, centered on CENTER offset by east/north. */
function square(
  kind: GeofenceZone['kind'],
  halfSize: number,
  east = 0,
  north = 0
): GeofenceZone {
  return {
    kind,
    polygon: [
      at(east - halfSize, north - halfSize),
      at(east + halfSize, north - halfSize),
      at(east + halfSize, north + halfSize),
      at(east - halfSize, north + halfSize),
    ],
  };
}

const PASS = { id: 'GEOFENCE', verdict: 'PASS', score: 1, confidence: 1 };
const WARN = { id: 'GEOFENCE', verdict: 'WARN', score: 0.5, confidence: 1 };
const FAIL = { id: 'GEOFENCE', verdict: 'FAIL', score: 0, confidence: 1 };

describe('evaluateGeofence', () => {
  it('reports an unchecked WARN without a location', () => {
    expect(evaluateGeofence(undefined, [square('allowed', 100)])).toEqual({
      id: 'GEOFENCE',
      verdict: 'WARN',
      score: 0,
      confidence: 0,
    });
  });

  it('passes without zones', () => {
    expect(evaluateGeofence(location(0, 0), [])).toEqual(PASS);
  });

  it('passes inside an allowed zone farther than the accuracy from its boundary', () => {
    expect(evaluateGeofence(location(0, 0), [square('allowed', 100)])).toEqual(
      PASS
    );
    expect(evaluateGeofence(location(85, 0), [square('allowed', 100)])).toEqual(
      PASS
    );
  });

  it('fails outside every allowed zone farther than the accuracy', () => {
    expect(
      evaluateGeofence(location(150, 0), [square('allowed', 100)])
    ).toEqual(FAIL);
  });

  it('warns when an allowed boundary is within the accuracy', () => {
    const zones = [square('allowed', 100)];
    expect(evaluateGeofence(location(95, 0), zones)).toEqual(WARN);
    expect(evaluateGeofence(location(105, 0), zones)).toEqual(WARN);
    // A corner: 5 m east and 5 m north of it is about 7.07 m away.
    expect(evaluateGeofence(location(105, 105), zones)).toEqual(WARN);
    expect(evaluateGeofence(location(108, 108), zones)).toEqual(FAIL);
  });

  it('passes when the location is inside one of several allowed zones', () => {
    const zones = [square('allowed', 50, 500, 0), square('allowed', 50)];
    expect(evaluateGeofence(location(0, 0), zones)).toEqual(PASS);
  });

  it('fails inside a prohibited zone, even inside an allowed zone', () => {
    const zones = [square('allowed', 500), square('prohibited', 50)];
    expect(evaluateGeofence(location(0, 0), zones)).toEqual(FAIL);
    expect(
      evaluateGeofence(location(0, 0), [square('prohibited', 50)])
    ).toEqual(FAIL);
  });

  it('warns when a prohibited boundary is within the accuracy', () => {
    const zones = [square('allowed', 500), square('prohibited', 50)];
    expect(evaluateGeofence(location(55, 0), zones)).toEqual(WARN);
    expect(evaluateGeofence(location(45, 0), zones)).toEqual(WARN);
    expect(evaluateGeofence(location(70, 0), zones)).toEqual(PASS);
  });

  it('prefers a definite allowed FAIL over prohibited uncertainty', () => {
    const zones = [square('allowed', 50), square('prohibited', 50, 200, 0)];
    expect(evaluateGeofence(location(145, 0), zones)).toEqual(FAIL);
  });

  it('treats a location on a boundary with accuracy 0 as uncertain', () => {
    const zone: GeofenceZone = {
      kind: 'allowed',
      polygon: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
        { lat: 1, lng: 1 },
        { lat: 1, lng: 0 },
      ],
    };
    expect(evaluateGeofence({ lat: 0.5, lng: 0, accuracy: 0 }, [zone])).toEqual(
      WARN
    );
    expect(
      evaluateGeofence({ lat: 0.5, lng: 0.5, accuracy: 0 }, [zone])
    ).toEqual(PASS);
  });

  it('uses the even-odd rule for a concave polygon', () => {
    // An L shape: the 100 m square minus its north-east quadrant.
    const zone: GeofenceZone = {
      kind: 'allowed',
      polygon: [
        at(-100, -100),
        at(100, -100),
        at(100, 0),
        at(0, 0),
        at(0, 100),
        at(-100, 100),
      ],
    };
    expect(evaluateGeofence(location(-50, 50), [zone])).toEqual(PASS);
    expect(evaluateGeofence(location(50, 50), [zone])).toEqual(FAIL);
  });

  it('accepts a closed ring whose last vertex repeats the first', () => {
    const open = square('allowed', 100);
    const closed: GeofenceZone = {
      kind: 'allowed',
      polygon: [...open.polygon, open.polygon[0]!],
    };
    for (const point of [location(0, 0), location(95, 0), location(150, 0)]) {
      expect(evaluateGeofence(point, [closed])).toEqual(
        evaluateGeofence(point, [open])
      );
    }
  });

  it('handles a zone that crosses the antimeridian', () => {
    const zone: GeofenceZone = {
      kind: 'allowed',
      polygon: [
        { lat: -0.01, lng: 179.99 },
        { lat: -0.01, lng: -179.99 },
        { lat: 0.01, lng: -179.99 },
        { lat: 0.01, lng: 179.99 },
      ],
    };
    expect(
      evaluateGeofence({ lat: 0, lng: 180, accuracy: 10 }, [zone])
    ).toEqual(PASS);
    expect(
      evaluateGeofence({ lat: 0, lng: -179.995, accuracy: 10 }, [zone])
    ).toEqual(PASS);
    expect(
      evaluateGeofence({ lat: 0, lng: 179.9, accuracy: 10 }, [zone])
    ).toEqual(FAIL);
  });

  it('keeps a small zone on the opposite meridian outside', () => {
    const zone: GeofenceZone = {
      kind: 'allowed',
      polygon: [
        { lat: -0.01, lng: 179.99 },
        { lat: -0.01, lng: -179.99 },
        { lat: 0.01, lng: -179.99 },
        { lat: 0.01, lng: 179.99 },
      ],
    };
    expect(evaluateGeofence({ lat: 0, lng: 0, accuracy: 10 }, [zone])).toEqual(
      FAIL
    );
    const newYork = { lat: 40.71, lng: -74, accuracy: 10 };
    const prohibited: GeofenceZone = {
      kind: 'prohibited',
      polygon: [
        { lat: 40.7, lng: 105.99 },
        { lat: 40.7, lng: 106.01 },
        { lat: 40.72, lng: 106.01 },
        { lat: 40.72, lng: 105.99 },
      ],
    };
    expect(evaluateGeofence(newYork, [prohibited])).toEqual(PASS);
  });

  it('reports an unchecked WARN when the accuracy exceeds maxAccuracy', () => {
    expect(DEFAULT_MAX_GEOFENCE_ACCURACY).toBe(50);
    const zones = [square('prohibited', 1000)];
    const unchecked = {
      id: 'GEOFENCE',
      verdict: 'WARN',
      score: 0,
      confidence: 0,
    };
    expect(evaluateGeofence(location(0, 0, 50), zones)).toEqual(FAIL);
    expect(evaluateGeofence(location(0, 0, 50.5), zones)).toEqual(unchecked);
    expect(
      evaluateGeofence(location(0, 0, 3000), zones, { maxAccuracy: 5000 })
    ).toEqual(WARN);
    expect(
      evaluateGeofence(location(0, 0, 3000), zones, { maxAccuracy: Infinity })
    ).toEqual(WARN);
    expect(
      evaluatePolicy(
        [evaluateGeofence(location(0, 0, 3000), zones)],
        defaultPolicy
      ).verdict
    ).toBe('FAIL');
    for (const maxAccuracy of [-1, Number.NaN]) {
      expect(() =>
        evaluateGeofence(location(0, 0), zones, { maxAccuracy })
      ).toThrow(RangeError);
    }
    for (const maxAccuracy of ['invalid', '10', true]) {
      expect(() =>
        evaluateGeofence(location(0, 0, 3000), zones, {
          maxAccuracy: maxAccuracy as unknown as number,
        })
      ).toThrow(RangeError);
    }
  });

  it('rejects invalid locations and zones', () => {
    const zone = square('allowed', 100);
    for (const bad of [
      { lat: 90.1, lng: 0, accuracy: 1 },
      { lat: 0, lng: -180.1, accuracy: 1 },
      { lat: Number.NaN, lng: 0, accuracy: 1 },
      { lat: 0, lng: 0, accuracy: -1 },
      { lat: 0, lng: 0, accuracy: Infinity },
    ]) {
      expect(() => evaluateGeofence(bad, [zone])).toThrow(RangeError);
    }
    const point = location(0, 0);
    expect(() =>
      evaluateGeofence(point, [
        { kind: 'allowed', polygon: zone.polygon.slice(0, 2) },
      ])
    ).toThrow(RangeError);
    expect(() =>
      evaluateGeofence(point, [
        {
          kind: 'allowed',
          polygon: [...zone.polygon.slice(1), { lat: 0, lng: 200 }],
        },
      ])
    ).toThrow(RangeError);
    expect(() =>
      evaluateGeofence(point, [
        { kind: 'other' as GeofenceZone['kind'], polygon: zone.polygon },
      ])
    ).toThrow(RangeError);
    const holed = [...zone.polygon];
    delete holed[1];
    for (const polygon of [
      holed,
      [zone.polygon[0], null, zone.polygon[2], zone.polygon[3]],
      'not an array',
    ]) {
      expect(() =>
        evaluateGeofence(point, [
          { kind: 'allowed', polygon: polygon as GeofenceZone['polygon'] },
        ])
      ).toThrow(RangeError);
    }
    // eslint-disable-next-line no-sparse-arrays
    expect(() => evaluateGeofence(point, [, zone] as GeofenceZone[])).toThrow(
      RangeError
    );
    // Invalid zones are rejected even without a location.
    expect(() =>
      evaluateGeofence(undefined, [{ kind: 'allowed', polygon: [] }])
    ).toThrow(RangeError);
  });

  it('does not mutate its input', () => {
    const point = location(95, 0);
    const zones = [square('allowed', 100), square('prohibited', 10)];
    const before = JSON.stringify({ point, zones });
    evaluateGeofence(point, zones);
    expect(JSON.stringify({ point, zones })).toBe(before);
  });

  it('feeds evaluatePolicy so that only a definite or unchecked result hard-fails by default', () => {
    const zones = [square('allowed', 100)];
    const verdict = (point: GeoLocation | undefined) =>
      evaluatePolicy([evaluateGeofence(point, zones)], defaultPolicy).verdict;
    expect(verdict(location(0, 0))).toBe('PASS');
    expect(verdict(location(95, 0))).toBe('WARN');
    expect(verdict(location(150, 0))).toBe('FAIL');
    expect(verdict(undefined)).toBe('FAIL');
  });
});
