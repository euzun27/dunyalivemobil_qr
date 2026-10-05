/* Ambient context — ANDROID FORK: live data for the Weather + Network HUD panels.
 *
 * On desktop these come from the Python backend (weather.py / telemetry.get_net_info).
 * On the phone we resolve them ourselves through the Tauri HTTP plugin (httpClient):
 *   - location + public IP  ← ipwho.is  (keyless, one call gives coords + city + IP)
 *   - weather               ← Open-Meteo (keyless)
 *
 * Both feed the SAME panel shapes the desktop hook produces, so HudPanels renders them
 * unchanged. Everything is best-effort and non-throwing — a failure just leaves the
 * panel on its idle placeholder.
 */

import { getJson } from "../tools/httpClient";
import { ipGeoLookup } from "../tools/location";
import { wmo, wmoTr } from "../wmoCodes";

export interface NetInfo {
  publicIp: string;
  location: string;
}

export interface AmbientLocation {
  lat: number;
  lon: number;
  place: string;
  publicIp: string;
}

export interface PanelWeather {
  temp: number | null;
  condition: string;
  location: string;
  humidity: number | null;
  wind: string;
  aqi: number | null;
  hours: Array<{ t: string; i: string; c: number | null }>;
}

// DUNYATEK: the phone's own GPS fix (pushed by App's geolocation watcher). IP
// geolocation puts the phone in the ISP's city (e.g. Kahramanmaraş instead of
// Gaziantep), so weather follows the GPS whenever it is available.
let gps: { lat: number; lon: number } | null = null;
let gpsPlace: { lat: number; lon: number; name: string } | null = null;
const gpsListeners = new Set<() => void>();

function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (a.lat - b.lat) * 111;
  const dLon = (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** New GPS fix from the device. Listeners (the weather refresher) fire only when the
 * phone actually moved (>2 km) or on the first fix. */
export function setAmbientGps(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const first = !gps;
  const moved = gps ? kmBetween(gps, { lat, lon }) > 2 : true;
  gps = { lat, lon };
  if (first || moved) gpsListeners.forEach((fn) => fn());
}

export function onAmbientGps(fn: () => void): () => void {
  gpsListeners.add(fn);
  return () => gpsListeners.delete(fn);
}

/** Turkish place name for the GPS fix (OpenStreetMap reverse geocoding, cached). */
async function gpsPlaceName(lat: number, lon: number): Promise<string> {
  if (gpsPlace && kmBetween(gpsPlace, { lat, lon }) < 2) return gpsPlace.name;
  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?" +
      new URLSearchParams({
        lat: String(lat),
        lon: String(lon),
        format: "jsonv2",
        zoom: "10",
        "accept-language": "tr",
      }).toString();
    const r = await getJson<{ address?: Record<string, string> }>(url, { timeoutMs: 8000 });
    const a = r.address ?? {};
    const town = a.town || a.city_district || a.district || a.county || a.suburb || "";
    const city = a.province || a.city || a.state || "";
    const name = [town, city].filter((x, i, arr) => x && arr.indexOf(x) === i).join(", ");
    gpsPlace = { lat, lon, name };
    return name;
  } catch {
    return "";
  }
}

/** Location + public IP. Coordinates come from the phone's GPS when known, otherwise
 * from IP geolocation (two providers via tools/location.ts, so one being rate-limited
 * doesn't blank the panels). */
export async function resolveAmbientLocation(): Promise<AmbientLocation | null> {
  const r = await ipGeoLookup();
  if (gps) {
    const place = (await gpsPlaceName(gps.lat, gps.lon)) || r?.place || "";
    return { lat: gps.lat, lon: gps.lon, place, publicIp: r?.ip || "" };
  }
  return r ? { lat: r.lat, lon: r.lon, place: r.place, publicIp: r.ip } : null;
}

/** The Network panel's data (public IP + resolved city). */
export function netInfoFrom(loc: AmbientLocation | null): NetInfo {
  return {
    publicIp: loc?.publicIp || "",
    location: loc?.place || "",
  };
}

interface OpenMeteo {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    time?: string;
  };
  hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[] };
}

/** Current conditions + next-hours strip for the Weather panel. */
export async function fetchPanelWeather(loc: AmbientLocation): Promise<PanelWeather | null> {
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
      hourly: "temperature_2m,weather_code",
      forecast_days: "2",
      timezone: "auto",
      wind_speed_unit: "kmh",
    }).toString();

  let d: OpenMeteo;
  try {
    d = await getJson<OpenMeteo>(url, { timeoutMs: 8000 });
  } catch {
    return null;
  }
  const cur = d.current ?? {};
  const [cond] = wmoTr(cur.weather_code);

  // Next 6 hours starting at the current hour.
  const hours: PanelWeather["hours"] = [];
  const times = d.hourly?.time ?? [];
  const temps = d.hourly?.temperature_2m ?? [];
  const codes = d.hourly?.weather_code ?? [];
  const nowIso = (cur.time ?? "").slice(0, 13); // "YYYY-MM-DDTHH"
  let start = times.findIndex((t) => t.slice(0, 13) === nowIso);
  if (start < 0) start = 0;
  for (let i = start; i < times.length && hours.length < 6; i += 1) {
    const hh = times[i].slice(11, 16); // "HH:MM"
    const [, icon] = wmo(codes[i]);
    hours.push({ t: hh, i: icon, c: typeof temps[i] === "number" ? temps[i] : null });
  }

  return {
    temp: typeof cur.temperature_2m === "number" ? cur.temperature_2m : null,
    condition: cond,
    location: loc.place || "—",
    humidity: typeof cur.relative_humidity_2m === "number" ? cur.relative_humidity_2m : null,
    wind: typeof cur.wind_speed_10m === "number" ? `${Math.round(cur.wind_speed_10m)} km/sa` : "—",
    aqi: null,
    hours,
  };
}
