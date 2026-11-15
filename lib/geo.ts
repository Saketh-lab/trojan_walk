export type LatLng = { lat: number; lng: number };

const R = 6371008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing a -> b in degrees, 0-360 clockwise from north. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `distM` metres from `from` along `bearingDeg`. */
export function destination(from: LatLng, bearingDeg: number, distM: number): LatLng {
  const d = distM / R;
  const br = rad(bearingDeg);
  const lat1 = rad(from.lat);
  const lng1 = rad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 =
    lng1 +
    Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: ((deg(lng2) + 540) % 360) - 180 };
}

/** Smallest angle between two bearings, 0-180. */
export function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function withinGeofence(p: LatLng, center: LatLng, radiusM = 40): boolean {
  return haversine(p, center) < radiusM;
}

export const MIN_MOVE_M = 5;
/** Heading goes back to null after this long without a >=5 m move. */
export const STILL_AFTER_MS = 10_000;

/**
 * Heading from the last two fixes that are at least 5 m apart (GPS fires ~1 Hz, so
 * consecutive raw fixes are usually closer than that). Null while the user is still.
 */
export class HeadingTracker {
  private anchor: LatLng | null = null;
  private heading: number | null = null;
  private movedAt = 0;

  update(p: LatLng, now = Date.now()): void {
    if (!this.anchor) {
      this.anchor = p;
      return;
    }
    if (haversine(this.anchor, p) >= MIN_MOVE_M) {
      this.heading = bearing(this.anchor, p);
      this.anchor = p;
      this.movedAt = now;
    }
  }

  current(now = Date.now()): number | null {
    if (this.heading === null || now - this.movedAt > STILL_AFTER_MS) return null;
    return Math.round(this.heading);
  }

  reset(): void {
    this.anchor = null;
    this.heading = null;
    this.movedAt = 0;
  }
}
