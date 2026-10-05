// Customize.jsx — edit the home-screen HUD (accent, background, density, which
// panels show, and their order). Sends partial screen-config patches; the backend
// persists them and broadcasts the full new config back, so JARVIS and the user
// edit the same live state. Mirrors the named themes in actions/__init__.py.

import ModalPanel from "./ModalPanel";
import { IS_MOBILE } from "../hooks/useAssistant";

const THEMES = {
  cyan: ["#00e5ff", "#6fe9ff", [0, 229, 255]],
  blue: ["#3b82f6", "#93c5fd", [59, 130, 246]],
  amber: ["#ffb648", "#ffd591", [255, 182, 72]],
  gold: ["#ffd24a", "#ffe89a", [255, 210, 74]],
  red: ["#ff4d57", "#ff9197", [255, 77, 87]],
  green: ["#22e39a", "#8bf0cb", [34, 227, 154]],
  purple: ["#a872ff", "#cdaaff", [168, 114, 255]],
  magenta: ["#ff5cf0", "#ffa9f6", [255, 92, 240]],
  pink: ["#ff77c8", "#ffb3e0", [255, 119, 200]],
  orange: ["#ff8a3d", "#ffbb85", [255, 138, 61]],
  white: ["#e8f4ff", "#ffffff", [232, 244, 255]],
};

const THEME_LABELS = {
  cyan: "Camgöbeği",
  blue: "Mavi",
  amber: "Kehribar",
  gold: "Altın",
  red: "Kırmızı",
  green: "Yeşil",
  purple: "Mor",
  magenta: "Macenta",
  pink: "Pembe",
  orange: "Turuncu",
  white: "Beyaz",
};

const BACKGROUNDS = ["grid", "solid", "aurora", "minimal"];
const BACKGROUND_LABELS = {
  grid: "Izgara",
  solid: "Düz",
  aurora: "Aurora",
  minimal: "Sade",
};
const DENSITY_LABELS = { normal: "Normal", compact: "Sıkı" };
const PANEL_LABELS = {
  system: "Sistem",
  power: "Güç",
  agenda: "Gündem",
  weather: "Hava durumu",
  network: "Ağ",
  terminal: "Terminal",
};

export default function Customize({ screen, onClose, onPatch }) {
  const s = screen || {};
  const panels = s.panels || {};
  const order = s.order || {
    left: ["system", "power", "agenda"],
    right: ["weather", "network", "terminal"],
  };
  const accent = (s.accent || "#00e5ff").toLowerCase();
  const background = s.background || "grid";
  const density = s.density || "normal";
  const core = s.core || (IS_MOBILE ? "video" : "emblem"); // HudApp ile ayni varsayilan

  return (
    <ModalPanel title="Ekranı Özelleştir" onClose={onClose}>
      {/* DUNYATEK: merkez gorunum - amblem ya da insan yuzu */}
      <div className="settings-sec">
        <label>Merkez</label>
        <div className="cz-row">
          {[
            ["emblem", "DUNYATEK amblemi"],
            ["video", "DUNYATEK avatar\u0131"],
            ["face", "\u0130nsan y\u00fcz\u00fc"],
            ["particle", "Par\u00e7ac\u0131k y\u00fcz\u00fc"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`cz-chip ${core === key ? "cz-chip--on" : ""}`}
              onClick={() => onPatch({ core: key })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent colour */}
      <div className="settings-sec">
        <label>Vurgu rengi</label>
        <div className="cz-swatches">
          {Object.entries(THEMES).map(([name, [a, a2, rgb]]) => (
            <button
              key={name}
              className={`cz-swatch ${accent === a.toLowerCase() ? "cz-swatch--on" : ""}`}
              style={{ background: a }}
              title={THEME_LABELS[name] || name}
              onClick={() => onPatch({ accent: a, accent2: a2, rgb })}
            />
          ))}
        </div>
      </div>

      {/* Background */}
      <div className="settings-sec">
        <label>Arka plan</label>
        <div className="cz-row">
          {BACKGROUNDS.map((bg) => (
            <button
              key={bg}
              className={`cz-chip ${background === bg ? "cz-chip--on" : ""}`}
              onClick={() => onPatch({ background: bg })}
            >
              {BACKGROUND_LABELS[bg] || bg}
            </button>
          ))}
        </div>
      </div>

      {/* Density */}
      <div className="settings-sec">
        <label>Yoğunluk</label>
        <div className="cz-row">
          {["normal", "compact"].map((d) => (
            <button
              key={d}
              className={`cz-chip ${density === d ? "cz-chip--on" : ""}`}
              onClick={() => onPatch({ density: d })}
            >
              {DENSITY_LABELS[d] || d}
            </button>
          ))}
        </div>
      </div>

      {/* Panels: show/hide + reorder within each rail, move across rails */}
      <div className="settings-sec">
        <label>Paneller ve yerleşim</label>
        {["left", "right"].map((rail) => (
          <div key={rail} className="cz-rail">
            <div className="cz-rail-hd">{rail === "left" ? "Sol sütun" : "Sağ sütun"}</div>
            {(order[rail] || []).map((key, i) => {
              const visible = panels[key] !== false;
              const arr = order[rail] || [];
              return (
                <div key={key} className="cz-panel-row">
                  <button
                    className={`cz-eye ${visible ? "cz-eye--on" : ""}`}
                    title={visible ? "Gizle" : "Göster"}
                    onClick={() => onPatch({ panels: { [key]: !visible } })}
                  >
                    {visible ? "👁" : "🚫"}
                  </button>
                  <span className="cz-panel-name">{PANEL_LABELS[key] || key}</span>
                  <span className="cz-panel-ctrls">
                    <button
                      disabled={i === 0}
                      onClick={() => onPatch({ move: { panel: key, direction: "up" } })}
                      title="Yukarı taşı"
                      aria-label="Yukarı taşı"
                    >
                      ▲
                    </button>
                    <button
                      disabled={i === arr.length - 1}
                      onClick={() => onPatch({ move: { panel: key, direction: "down" } })}
                      title="Aşağı taşı"
                      aria-label="Aşağı taşı"
                    >
                      ▼
                    </button>
                    <button
                      title="Diğer sütuna taşı"
                      onClick={() =>
                        onPatch({
                          move: { panel: key, direction: rail === "left" ? "right" : "left" },
                        })
                      }
                    >
                      {rail === "left" ? "→" : "←"}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="settings-sec cz-actions">
        <button className="cz-reset" onClick={() => onPatch({ reset: true })}>
          Varsayılanlara sıfırla
        </button>
        <span className="cz-hint">
          İpucu: DUNYATEK’e doğrudan da söyleyebilirsiniz — “ekranı kehribar rengi yap”, “hava
          durumu panelini gizle”.
        </span>
      </div>
    </ModalPanel>
  );
}
