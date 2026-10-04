/** Maps provider abstraction (Google Maps/Places by default; Mapbox can implement the same port). */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  formattedAddress: string;
  location: LatLng;
  placeId: string;
}

export interface MapsProvider {
  readonly name: string;
  geocode(address: string, opts?: { region?: string; language?: string }): Promise<GeocodeResult[]>;
  autocomplete(input: string, opts: { sessionToken: string; near?: LatLng; language?: string }): Promise<{ description: string; placeId: string }[]>;
  drivingDistanceKm(from: LatLng, to: LatLng): Promise<number>;
}

const EARTH_RADIUS_KM = 6371.0088;
export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function nearest<T extends { latitude: number | null; longitude: number | null }>(origin: LatLng, items: readonly T[], limit = 5): (T & { distanceKm: number })[] {
  return items
    .filter((i): i is T & { latitude: number; longitude: number } => i.latitude !== null && i.longitude !== null)
    .map((i) => ({ ...i, distanceKm: haversineKm(origin, { lat: i.latitude, lng: i.longitude }) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

export type DeliveryPricing =
  | { mode: "FLAT_ZONES"; zones: { maxKm: number; feeMinor: number }[] }
  | { mode: "PER_KM"; baseFeeMinor: number; perKmMinor: number; maxKm: number };

/** Delivery fee from a branch; null when out of range. Distance rounded up to whole km. */
export function deliveryFee(distanceKm: number, pricing: DeliveryPricing): number | null {
  const km = Math.ceil(distanceKm);
  if (pricing.mode === "FLAT_ZONES") {
    const zone = [...pricing.zones].sort((a, b) => a.maxKm - b.maxKm).find((z) => km <= z.maxKm);
    return zone ? zone.feeMinor : null;
  }
  if (km > pricing.maxKm) return null;
  return pricing.baseFeeMinor + km * pricing.perKmMinor;
}

/** Google Maps Platform implementation (server-side key; never exposed to clients). */
export class GoogleMapsProvider implements MapsProvider {
  readonly name = "google";
  constructor(private readonly apiKey: string) {}

  private async get(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(`https://maps.googleapis.com/maps/api/${path}`);
    for (const [k, v] of Object.entries({ ...params, key: this.apiKey })) url.searchParams.set(k, v);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Maps HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, unknown>;
    if (json.status !== "OK" && json.status !== "ZERO_RESULTS") throw new Error(`Google Maps status ${String(json.status)}`);
    return json;
  }

  async geocode(address: string, opts: { region?: string; language?: string } = {}) {
    const json = await this.get("geocode/json", { address, ...(opts.region ? { region: opts.region } : {}), ...(opts.language ? { language: opts.language } : {}) });
    return ((json.results as { formatted_address: string; place_id: string; geometry: { location: LatLng } }[]) ?? []).map((r) => ({
      formattedAddress: r.formatted_address, placeId: r.place_id, location: r.geometry.location,
    }));
  }

  async autocomplete(input: string, opts: { sessionToken: string; near?: LatLng; language?: string }) {
    const json = await this.get("place/autocomplete/json", {
      input, sessiontoken: opts.sessionToken,
      ...(opts.near ? { location: `${opts.near.lat},${opts.near.lng}`, radius: "50000" } : {}),
      ...(opts.language ? { language: opts.language } : {}),
    });
    return ((json.predictions as { description: string; place_id: string }[]) ?? []).map((p) => ({ description: p.description, placeId: p.place_id }));
  }

  async drivingDistanceKm(from: LatLng, to: LatLng) {
    const json = await this.get("distancematrix/json", { origins: `${from.lat},${from.lng}`, destinations: `${to.lat},${to.lng}`, mode: "driving" });
    const el = (json.rows as { elements: { status: string; distance?: { value: number } }[] }[])?.[0]?.elements?.[0];
    if (!el || el.status !== "OK" || !el.distance) throw new Error("No driving route");
    return el.distance.value / 1000;
  }
}
