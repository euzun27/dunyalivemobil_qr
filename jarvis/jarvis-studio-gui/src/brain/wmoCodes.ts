/**
 * WMO weather-code → [text, glyph]. Shared by tools/http.ts (spoken text only) and
 * platform/ambient.ts (text + HUD glyph). Port of weather.py's `_WMO` table.
 */
export const WMO: Record<number, [string, string]> = {
  0: ["clear", "☀"],
  1: ["mainly clear", "🌤"],
  2: ["partly cloudy", "⛅"],
  3: ["overcast", "☁"],
  45: ["fog", "🌫"],
  48: ["rime fog", "🌫"],
  51: ["light drizzle", "🌦"],
  53: ["drizzle", "🌦"],
  55: ["dense drizzle", "🌧"],
  61: ["light rain", "🌦"],
  63: ["rain", "🌧"],
  65: ["heavy rain", "🌧"],
  66: ["freezing rain", "🌧"],
  67: ["freezing rain", "🌧"],
  71: ["light snow", "🌨"],
  73: ["snow", "🌨"],
  75: ["heavy snow", "❄"],
  77: ["snow grains", "🌨"],
  80: ["showers", "🌦"],
  81: ["showers", "🌧"],
  82: ["violent showers", "⛈"],
  85: ["snow showers", "🌨"],
  86: ["snow showers", "🌨"],
  95: ["thunderstorm", "⛈"],
  96: ["thunderstorm", "⛈"],
  99: ["thunderstorm", "⛈"],
};

/** [text, glyph] for a WMO weather code, or a placeholder pair if unknown. */
export function wmo(code: unknown): [string, string] {
  const n = Number(code);
  return Number.isFinite(n) && WMO[n] ? WMO[n] : ["—", "•"];
}

/** DUNYATEK: Turkish condition text for the HUD Weather panel. */
const TR: Record<string, string> = {
  clear: "açık",
  "mainly clear": "çoğunlukla açık",
  "partly cloudy": "parçalı bulutlu",
  overcast: "kapalı",
  fog: "sisli",
  "rime fog": "kırağılı sis",
  "light drizzle": "hafif çisenti",
  drizzle: "çisenti",
  "dense drizzle": "yoğun çisenti",
  "light rain": "hafif yağmur",
  rain: "yağmurlu",
  "heavy rain": "şiddetli yağmur",
  "freezing rain": "dondurucu yağmur",
  "light snow": "hafif kar",
  snow: "karlı",
  "heavy snow": "yoğun kar",
  "snow grains": "kar taneleri",
  showers: "sağanak",
  "violent showers": "kuvvetli sağanak",
  "snow showers": "kar sağanağı",
  thunderstorm: "gök gürültülü fırtına",
};

export function wmoTr(code: unknown): [string, string] {
  const [text, glyph] = wmo(code);
  return [TR[text] ?? text, glyph];
}
