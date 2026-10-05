/* HudPanels.jsx — all the ringing data panels + chat & OCR overlays.
   Ported from jarvis-hud/hud-panels.jsx and wired to LIVE backend data
   (telemetry / weather / netinfo / schedule / messages) passed in as props.
   Exports each panel (shared values live in hudConstants.js)  */

import { useState, useEffect, useRef, memo } from "react";
import { IS_MOBILE } from "../hooks/useAssistant";
import {
  CornerBox,
  RadialGauge,
  MiniRadial,
  SegBar,
  Sparkline,
  TickStrip,
  DataRow,
} from "./HudGauges";
import { Waveform } from "./HudCore";
import ResponseRenderer from "../components/ResponseRenderer";
import Icon from "../components/Icon";
import StateMessage from "../components/StateMessage";
import Sheet, { ActionRow, Field, Group, HeaderButton, Toggle } from "../components/Sheet";
import { STATUS_META } from "./hudConstants";

// Coerce a telemetry field to a finite number (→0). A partial frame missing
// cpu/ram/disk would otherwise blow up `d.cpu.toFixed(...)` and crash the panel
// — the gpu/net reads already use `?? 0`, so this just makes the rest consistent.
const n0 = (x) => (Number.isFinite(x) ? x : Number.isFinite(+x) ? +x : 0);

/* ───────── live clock ───────── */
function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ───────── rolling history of a live value (for real sparklines) ───────── */
function useHistory(value, points = 46) {
  const [hist, setHist] = useState(() => Array(points).fill(0));
  // Adjust state during render when the input changes (React's documented pattern)
  // instead of in an effect, which rendered every tick twice.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setHist((h) => [...h.slice(1), Number.isFinite(value) ? value : 0]);
  }
  return hist;
}

export function ClockPanel() {
  const now = useClock();
  const hh = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const ss = String(now.getSeconds()).padStart(2, "0");
  const date = now.toLocaleDateString("tr-TR", { weekday: "long", month: "long", day: "numeric" });
  const yr = now.getFullYear();
  return (
    <div className="clock">
      <div className="clock-main">
        <span className="clock-hh">{hh}</span>
        <span className="clock-ss">{ss}</span>
      </div>
      <div className="clock-date">
        {date} · {yr}
      </div>
      {IS_MOBILE ? <MonthCalendar now={now} /> : <TickStrip count={46} />}
    </div>
  );
}

/* ───────── DUNYATEK: small Turkish month calendar under the clock (phone) ───────── */
const TR_DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
function MonthCalendar({ now }) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = now.getDate();
  const first = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  const title = now.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
  return (
    <div className="mcal" aria-label={title}>
      <div className="mcal-title">{title}</div>
      <div className="mcal-grid">
        {TR_DAYS.map((d) => (
          <span key={d} className="mcal-dow">
            {d}
          </span>
        ))}
        {cells.map((d, i) => (
          <span
            key={i}
            className={`mcal-d${d === today ? " mcal-d--today" : ""}${i % 7 >= 5 ? " mcal-d--we" : ""}`}
          >
            {d || ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────── status + waveform ───────── */
export function StatusPanel({ status, rgb }) {
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  return (
    <div className="statp">
      <div className="statp-row">
        <span
          className="statp-dot"
          style={{ background: meta.col, boxShadow: `0 0 12px ${meta.col}` }}
        />
        <span className="statp-label" style={{ color: meta.col }}>
          {meta.label}
        </span>
      </div>
      <Waveform status={status} bars={42} height={44} rgb={rgb} />
    </div>
  );
}

/* ───────── system stats (radials) ───────── */
export function SysStatsPanel({ d, collapsible, open, onToggle }) {
  if (IS_MOBILE) {
    const batt = d.batteryPct ?? 0;
    const battSub =
      d.batteryPct == null
        ? "VERİ YOK"
        : d.charging
          ? `ŞARJ OLUYOR${d.remaining ? ` · ${d.remaining}` : ""}`
          : d.remaining || `${Math.round(batt)}%`;
    const tempVal = d.temp != null ? Math.min(100, Math.max(0, (d.temp - 20) * 2)) : 0;
    const tempSub = d.temp != null ? `${n0(d.temp).toFixed(0)}°C` : "VERİ YOK";
    const ramUsed = d.ramTotalGb ? Math.round((n0(d.ram) / 100) * d.ramTotalGb * 10) / 10 : null;
    const ramSub =
      ramUsed != null && d.ramTotalGb
        ? `${ramUsed} / ${Math.round(d.ramTotalGb)} GB`
        : `%${n0(d.ram).toFixed(0)} dolu`;
    const diskSub = d.diskTotalGb
      ? `${Math.round(n0(d.diskUsedGb))} / ${Math.round(n0(d.diskTotalGb))} GB`
      : `%${n0(d.disk).toFixed(0)} dolu`;
    const netSub =
      d.down > 0
        ? `${fmtMbps(d.down)} Mbps`
        : d.ping > 0
          ? `${d.ping} ms RTT`
          : d.linkLabel || "ÇEVRİMİÇİ";
    return (
      <CornerBox
        title="Telefon"
        code="CİHAZ"
        slot="sysstats"
        collapsible={collapsible}
        open={open}
        onToggle={onToggle}
      >
        <div className="sys-grid">
          <RadialGauge value={tempVal} label="SICAKLIK" size={106} sub={tempSub} />
          <RadialGauge value={d.ram} label="BELLEK" size={106} sub={ramSub} />
        </div>
        <div className="sys-mini">
          <MiniRadial value={batt} label="PİL" size={60} sub={battSub} />
          <MiniRadial value={d.disk} label="DEPO" size={60} sub={diskSub} />
          <MiniRadial value={d.net} label="AĞ" size={60} sub={netSub} />
        </div>
        <p className="sys-mobile-note">
          {d.batteryPct != null
            ? `Pil: ${battSub}`
            : "Bu telefonun canlı bellek, depolama ve ağ bilgileri."}
        </p>
      </CornerBox>
    );
  }
  const tempSub = d.temp != null ? `${n0(d.temp).toFixed(0)}°C` : `%${n0(d.cpu).toFixed(0)} yük`;
  const ramSub = d.ramTotalGb
    ? `${Math.round((n0(d.ram) / 100) * d.ramTotalGb * 10) / 10} / ${Math.round(d.ramTotalGb)} GB`
    : `%${n0(d.ram).toFixed(0)} dolu`;
  return (
    <CornerBox
      title="Sistem"
      code="SYS·01"
      slot="sysstats"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="sys-grid">
        <RadialGauge value={d.cpu} label="CPU" size={106} sub={tempSub} />
        <RadialGauge value={d.ram} label="BELLEK" size={106} sub={ramSub} />
      </div>
      <div className="sys-mini">
        <MiniRadial
          value={d.gpu ?? 0}
          label="GPU"
          size={60}
          sub={d.gpuName || `${n0(d.gpu ?? 0)}%`}
        />
        <MiniRadial
          value={d.diskActivity ?? 0}
          label="DİSK"
          size={60}
          sub={
            d.diskTotalGb
              ? `${Math.round(n0(d.diskUsedGb))} / ${Math.round(n0(d.diskTotalGb))} GB`
              : `%${n0(d.disk).toFixed(0)} dolu`
          }
        />
        <MiniRadial
          value={d.net ?? 0}
          label="AĞ"
          size={60}
          sub={d.down > 0 ? `${fmtMbps(d.down)} Mbps` : d.linkLabel || "ÇEVRİMİÇİ"}
        />
      </div>
    </CornerBox>
  );
}

/* ───────── power / battery ───────── */
export function PowerPanel({ d, collapsible, open, onToggle }) {
  const pct = d.batteryPct;
  const hasBattery = pct != null;
  const shown = hasBattery ? pct : 0;
  const label = !hasBattery ? "PİL" : d.charging ? "ŞARJDA" : "PİL";
  return (
    <CornerBox
      title="Güç"
      code="PİL"
      slot="power"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="pwr">
        <RadialGauge value={shown} label={label} size={96} unit="%" />
        <div className="pwr-meta">
          <DataRow k="KAYNAK" v={!hasBattery ? "BİLİNMİYOR" : d.charging ? "ŞARJ" : "PİL"} accent />
          <DataRow k="DURUM" v={!hasBattery ? "—" : d.charging ? "ŞARJ OLUYOR" : "KULLANIMDA"} />
          <DataRow k="KALAN" v={d.remaining || "—"} />
          <DataRow k="SEVİYE" v={hasBattery ? `%${Math.round(pct)}` : "—"} accent />
        </div>
      </div>
      {hasBattery && <SegBar value={shown} segs={18} label="DOLULUK" />}
    </CornerBox>
  );
}

/* ───────── weather ───────── */
const DEFAULT_WEATHER = {
  temp: null,
  condition: "—",
  location: "KONUM ALINIYOR…",
  humidity: null,
  wind: "—",
  aqi: null,
  hours: [],
};
export function WeatherPanel({ weather, collapsible, open, onToggle }) {
  const w = weather || DEFAULT_WEATHER;
  return (
    <CornerBox
      title="Hava Durumu"
      code="KONUM"
      slot="weather"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="wx-now">
        <span className="wx-temp">{w.temp != null ? `${Math.round(w.temp)}°` : "—"}</span>
        <div className="wx-meta">
          <span className="wx-cond">{(w.condition || "—").toLocaleUpperCase("tr-TR")}</span>
          <span className="wx-loc">{(w.location || "—").toLocaleUpperCase("tr-TR")}</span>
        </div>
      </div>
      <div className="wx-stats">
        <DataRow k="NEM" v={w.humidity != null ? `%${Math.round(w.humidity)}` : "—"} />
        <DataRow k="RÜZGAR" v={w.wind || "—"} />
        {w.aqi != null && <DataRow k="AQI" v={`${w.aqi}`} accent />}
      </div>
      {w.hours?.length > 0 && (
        <div className="wx-hours">
          {w.hours.slice(0, 6).map((h, i) => (
            <div key={i} className="wx-h">
              <span className="wx-h-t">{h.t}</span>
              <span className="wx-h-i">{h.i}</span>
              <span className="wx-h-c">{h.c != null ? `${Math.round(n0(h.c))}°` : "—"}</span>
            </div>
          ))}
        </div>
      )}
    </CornerBox>
  );
}

/* ───────── network / connectivity ───────── */
// Live throughput: 1-decimal under 10 Mbps so background/idle traffic is still
// visible instead of rounding to a dead "0"; whole numbers once it's busy.
const fmtMbps = (v) => (v == null ? "0.0" : v < 10 ? v.toFixed(1) : v.toFixed(0));

export function NetworkPanel({ d, netInfo, collapsible, open, onToggle }) {
  const n = netInfo || {};
  const downHist = useHistory(d.down);
  return (
    <CornerBox
      title="Ağ"
      code="BAĞLANTI"
      slot="network"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="net-rates">
        <div className="net-rate">
          <span className="net-arrow">▼</span>
          <span className="net-num">{fmtMbps(d.down)}</span>
          <span className="net-u">Mbps İNDİRME</span>
        </div>
        <div className="net-rate">
          <span className="net-arrow up">▲</span>
          <span className="net-num">{fmtMbps(d.up)}</span>
          <span className="net-u">Mbps YÜKLEME</span>
        </div>
      </div>
      <Sparkline points={42} height={34} data={downHist} />
      <div className="net-meta">
        <DataRow k="GECİKME" v={d.ping ? `${d.ping} ms` : "—"} accent />
        <DataRow k="BAĞLANTI" v={d.linkLabel || (d.down > 0 ? "AKTİF" : "—")} />
        <DataRow k="İNTERNET IP" v={n.publicIp || "—"} />
        <DataRow k="KONUM" v={n.location || "—"} />
      </div>
    </CornerBox>
  );
}

/* ───────── schedule / agenda (editable) ───────── */
export function SchedulePanel({ items, collapsible, open, onToggle, runAction }) {
  const list = items || [];
  const editable = typeof runAction === "function";

  const addItem = () => {
    const task = window.prompt("Yeni ajanda maddesi — ne yapılacak?");
    if (!task || !task.trim()) return;
    const time = (window.prompt("Saat kaçta? (örn. 09:00 — yoksa boş bırakın)") || "").trim();
    runAction({ type: "schedule", do: "add", day: "today", time, task: task.trim() });
  };
  const editItem = (it) => {
    const task = (window.prompt("Maddeyi düzenle:", it.task) || "").trim();
    const time = (window.prompt("Saati düzenle (örn. 09:00):", it.time || "") || "").trim();
    if (!task && !time) return;
    runAction({
      type: "schedule",
      do: "edit",
      day: "today",
      match: it.task,
      new_task: task || it.task,
      new_time: time || it.time,
    });
  };
  const removeItem = (it) =>
    runAction({ type: "schedule", do: "remove", day: "today", match: it.task });

  return (
    <CornerBox
      title="Ajanda"
      code="BUGÜN"
      slot="schedule"
      collapsible={collapsible}
      open={open}
      onToggle={onToggle}
    >
      <div className="sch">
        {list.length === 0 ? (
          <StateMessage variant="empty" icon="calendar" title="Bugün için plan yok">
            DUNYATEK&apos;e bir hatırlatma söyleyin, burada görünsün.
          </StateMessage>
        ) : (
          list.map((it, i) => (
            <div key={i} className={`sch-row ${it.now ? "now" : ""} ${it.done ? "done" : ""}`}>
              <span className="sch-t">{it.time}</span>
              <span className="sch-track">
                <span className="sch-dot" />
              </span>
              <span className="sch-task">{it.task}</span>
              {it.duration && <span className="sch-dur">{it.duration}</span>}
              {editable && (
                <span className="sch-edit">
                  <button title="Düzenle" onClick={() => editItem(it)}>
                    ✎
                  </button>
                  <button title="Sil" onClick={() => removeItem(it)}>
                    ✕
                  </button>
                </span>
              )}
            </div>
          ))
        )}
      </div>
      {editable && (
        <button className="sch-add" onClick={addItem}>
          ＋ Madde ekle
        </button>
      )}
    </CornerBox>
  );
}

/* ───────── command log — JARVIS's mini "terminal" (collapsible) ───────── */
/** Two taps to clear: the first arms it, the second (within a few seconds) clears. */
function ClearLogButton({ onClear }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`term-clear ${armed ? "term-clear--armed" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onClear();
      }}
      onBlur={() => setArmed(false)}
    >
      <Icon name="trash" size={14} />
      {armed ? "Silinsin mi?" : "Temizle"}
    </button>
  );
}

export function TerminalPanel({ commands = [], onClear, open, onToggle }) {
  const bodyRef = useRef(null);
  const [expanded, setExpanded] = useState(null); // index of the line shown in full
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [commands, open]);
  const fmtTime = (ts) => {
    try {
      return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };
  return (
    <CornerBox
      title="İşlem Kaydı"
      code="KAYIT"
      slot="terminal"
      collapsible
      open={open}
      onToggle={onToggle}
      action={open && onClear && commands.length > 0 ? <ClearLogButton onClear={onClear} /> : null}
    >
      <div className="term" ref={bodyRef}>
        {commands.length === 0 && (
          <StateMessage variant="empty" icon="terminal" title="Henüz işlem yok">
            DUNYATEK&apos;in sizin için yaptığı her işlem burada listelenir.
          </StateMessage>
        )}
        {commands.map((c, i) => (
          <button
            type="button"
            key={i}
            className={`term-line ${c.ok === false ? "term-err" : ""} ${expanded === i ? "term-line--open" : ""}`}
            onClick={() => setExpanded(expanded === i ? null : i)}
            aria-expanded={c.message ? expanded === i : undefined}
          >
            <span className="term-head">
              <span
                className="term-prompt"
                aria-label={c.ok === false ? "Başarısız" : "Tamamlandı"}
              >
                {c.ok === false ? "✗" : "›"}
              </span>
              <span className="term-cmd">
                {c.type}
                {c.target ? ` ${c.target}` : ""}
              </span>
              <span className="term-t">{fmtTime(c.ts)}</span>
            </span>
            {c.message && <span className="term-out">{c.message}</span>}
          </button>
        ))}
      </div>
    </CornerBox>
  );
}

/* ───────── bottom dock launcher (replaces the quick-actions grid) ───────── */
export function DockBar({
  onOpenSkills,
  onOpenCaps,
  onOpenPower,
  onOpenMemory,
  onOpenChat,
  chatCount = 0,
}) {
  const items = [
    { l: "ARAÇLAR", i: "sparkle", on: onOpenSkills },
    { l: "HAFIZA", i: "memory", on: onOpenMemory },
    { l: IS_MOBILE ? "YARDIM" : "YETENEKLER", i: "help", on: onOpenCaps },
    { l: IS_MOBILE ? "CİHAZ" : "GÜÇ", i: "power", on: onOpenPower },
  ];
  return (
    <div className="dock" data-slot="dock">
      {items.map((it) => (
        <button key={it.l} className="dock-btn" onClick={it.on}>
          <span className="dock-i">
            <Icon name={it.i} size={18} />
          </span>
          <span className="dock-l">{it.l}</span>
        </button>
      ))}
      <button className="dock-btn dock-btn--chat" onClick={onOpenChat}>
        <span className="dock-i">
          <Icon name="chat" size={18} />
        </span>
        <span className="dock-l">SOHBET</span>
        {chatCount > 0 && <span className="dock-badge">{chatCount}</span>}
      </button>
    </div>
  );
}

/* ───────── Skills — quick tools, with their results shown in place ───────── */
export function SkillsOverlay({
  open,
  onClose,
  recordings = {},
  runAction,
  allowedDirs = [],
  onSaveDirs,
}) {
  const [qrText, setQrText] = useState("");
  const [qr, setQr] = useState(null); // {imageUrl, text}
  const [clip, setClip] = useState(null); // ToolResult
  const [dirPath, setDirPath] = useState("");
  const [newDir, setNewDir] = useState("");

  // The phone's runAction resolves to the tool's result; the desktop's is
  // fire-and-forget (the backend shows the outcome itself), so close there.
  const run = async (spec) => {
    const r = await runAction(spec);
    if (r === undefined) onClose();
    return r;
  };
  const makeQr = async () => {
    const t = qrText.trim();
    if (!t) return;
    const r = await run({ type: "qr_code", text: t });
    if (r?.ok && r.data?.imageUrl) setQr({ imageUrl: r.data.imageUrl, text: t });
  };
  const listDir = () => dirPath.trim() && run({ type: "list_dir", path: dirPath.trim() });
  const addDir = () => {
    const d = newDir.trim().replace(/^["']|["']$/g, "");
    if (d && !allowedDirs.includes(d)) onSaveDirs([...allowedDirs, d]);
    setNewDir("");
  };

  return (
    <Sheet open={open} title="Araçlar" onClose={onClose}>
      <div className="sp-sheet">
        <Group title="QR kod">
          <Field hint="Kodu tarayan herkes bu bağlantıya veya metne ulaşır.">
            <div className="sp-inline">
              <input
                className="sp-input"
                value={qrText}
                placeholder="Bağlantı veya metin"
                onChange={(e) => setQrText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && makeQr()}
                aria-label="QR kod içeriği"
              />
              <button type="button" className="sp-btn" onClick={makeQr} disabled={!qrText.trim()}>
                Oluştur
              </button>
            </div>
          </Field>
          {qr && (
            <div className="sp-field skill-qr">
              <img src={qr.imageUrl} alt={`${qr.text} için QR kod`} width="200" height="200" />
              <span className="sp-desc">{qr.text}</span>
            </div>
          )}
        </Group>

        {IS_MOBILE && (
          <Group title="Pano">
            <ActionRow
              icon="clipboard"
              title="Panoyu oku"
              desc="En son kopyaladığınız şeyi gösterir."
              onClick={async () => setClip(await run({ type: "clipboard" }))}
            />
            {clip && (
              <div className="sp-field">
                <span className={`sp-desc ${clip.ok === false ? "skill-err" : "skill-out"}`}>
                  {clip.summary}
                </span>
              </div>
            )}
          </Group>
        )}

        {!IS_MOBILE && (
          <>
            <Group title="Kayıt">
              {[
                ["audio", "Mikrofon"],
                ["video", "Web kamerası"],
                ["screen", "Ekran"],
              ].map(([media, label]) => (
                <Toggle
                  key={media}
                  label={label}
                  checked={Boolean(recordings[media])}
                  onChange={(on) => runAction({ type: "record", media, do: on ? "start" : "stop" })}
                />
              ))}
              <div className="sp-field">
                <span className="sp-desc">
                  Siz kapatana kadar sürer. DUNYATEK kayıt klasörünüze kaydedilir.
                </span>
              </div>
            </Group>
            <Group title="Hızlı araçlar">
              <ActionRow
                icon="camera"
                title="Ekran görüntüsü al"
                onClick={() => run({ type: "screenshot" })}
              />
              <Field label="Onaylı bir klasörü listele">
                <div className="sp-inline">
                  <input
                    className="sp-input sp-mono"
                    value={dirPath}
                    placeholder="C:\Users\siz\Belgeler"
                    onChange={(e) => setDirPath(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && listDir()}
                  />
                  <button
                    type="button"
                    className="sp-btn"
                    disabled={!dirPath.trim()}
                    onClick={listDir}
                  >
                    Listele
                  </button>
                </div>
              </Field>
            </Group>
            <Group title="DUNYATEK'in okuyabileceği klasörler">
              <Field hint="Bu klasörleri listeleyebilir ve içindeki dosyaları her seferinde size sorarak okuyabilir. Hiçbir şeyi çalıştıramaz, yazamaz, taşıyamaz veya silemez.">
                <div className="dirlist">
                  {allowedDirs.length === 0 && (
                    <StateMessage variant="empty" icon="folder" title="Henüz klasör yok">
                      DUNYATEK’in dosyalarını okuyabilmesi için bir klasör ekleyin.
                    </StateMessage>
                  )}
                  {allowedDirs.map((d) => (
                    <div key={d} className="dirlist-row">
                      <span className="dirlist-path" title={d}>
                        {d}
                      </span>
                      <button
                        className="dirlist-rm"
                        aria-label={`${d} klasörünü kaldır`}
                        onClick={() => onSaveDirs(allowedDirs.filter((x) => x !== d))}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="sp-inline">
                  <input
                    className="sp-input sp-mono"
                    value={newDir}
                    placeholder="C:\Users\siz\Belgeler"
                    onChange={(e) => setNewDir(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addDir()}
                  />
                  <button type="button" className="sp-btn" onClick={addDir}>
                    Ekle
                  </button>
                </div>
              </Field>
            </Group>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ───────── Capabilities — what to ask, with examples that fill the chat box ───────── */
// `say` is an example request. Tapping it puts it in the chat box to edit or send,
// never sends straight away: "Remind me at 6 pm" would really set a reminder.
const MOBILE_CAPABILITIES = [
  {
    group: "Konuşma ve hafıza",
    items: [
      { t: "Soruları yanıtlar, konuları açıklar", say: "Isı pompası nasıl çalışır, kısaca anlat" },
      { t: "Söylediklerinizi hatırlar", say: "Benim hakkımda neleri hatırlıyorsun?" },
      { t: "İstediğinizi unutur", say: "Doğum günümü unut" },
      {
        t: "Kısa ve doğal sohbet",
        note: "Üstteki konuşma balonu düğmesiyle sohbet modunu açın.",
      },
    ],
  },
  {
    group: "WhatsApp",
    items: [
      {
        t: "Mesaj taslağı hazırlar",
        say: "Ahmet Bey’e cihazının hazır olduğunu bildiren WhatsApp mesajı taslağı hazırla",
        note: "Taslak size okunur; siz “evet” demeden gönderilmez.",
      },
      { t: "Gelen mesajları özetler", say: "Bugün WhatsApp’tan gelen mesajları özetle" },
    ],
  },
  {
    group: "Servis kayıtları",
    items: [
      { t: "Yeni servis kaydı açar", say: "Mehmet Bey’in yazıcısı için yeni servis kaydı aç" },
      { t: "Açık kayıtları okur", say: "Açık servis kayıtlarını oku" },
    ],
  },
  {
    group: "Yenilemeler",
    items: [
      {
        t: "Domain, hosting, SSL ve lisans tarihlerini takip eder",
        say: "Bu ay yenilemesi gelen müşteriler kimler?",
        note: "Süresi yaklaşanlar için 30, 15, 7 ve 1 gün kala uyarır.",
      },
    ],
  },
  {
    group: "Sosyal medya",
    items: [
      {
        t: "Instagram, Facebook ve YouTube özeti",
        say: "Sosyal medya hesaplarımızın bu haftaki özetini ver",
      },
      {
        t: "Paylaşım taslağı hazırlar",
        say: "Yeni kampanya için Instagram gönderisi taslağı hazırla",
        note: "Yayın onayı yalnızca Yönetim Paneli’nden verilir.",
      },
    ],
  },
  {
    group: "SMS",
    items: [
      {
        t: "Telefonunuzun hattından SMS gönderir",
        say: "Ayşe Hanım’a yarınki randevuyu hatırlatan SMS taslağı hazırla",
        note: "Taslak okunur; onayınızdan sonra bu telefonun hattından gider.",
      },
    ],
  },
  {
    group: "Kamera",
    items: [
      {
        t: "Telefon kamerasıyla bakar",
        say: "Telefonun kamerasına bak, bu cihazın modeli ne?",
        note: "Bilgisayardaki DUNYATEK telefonun kamerasından tek kare alır.",
      },
    ],
  },
  {
    group: "Bilgisayarınız",
    items: [
      {
        t: "Bilgisayarda görev çalıştırır",
        say: "Bilgisayarda Not Defteri’ni aç",
        note: "Üstteki ekran düğmesiyle bilgisayarı eşleştirin. Eşleşince yazdıklarınız ve sesiniz bilgisayardaki DUNYATEK’e gider.",
      },
      { t: "Canlı sesli görüşme", note: "Bilgisayar ekranından mikrofon düğmesine dokunun." },
    ],
  },
  {
    group: "Bu telefonda",
    items: [
      { t: "Uygulama ve site açar", say: "YouTube’u aç" },
      {
        t: "Başka uygulamalarda iş yapar",
        say: "Spotify’ı aç ve lofi müzik çal",
        note: "Cihaz bölümünden uygulama kontrolünü açın.",
      },
      { t: "Ses düzeyini ayarlar", say: "Sesi yüzde 30 yap" },
      { t: "Hava durumu ve haberler", say: "Yarın yağmur yağacak mı?" },
      { t: "Yakındaki yerler ve yol tarifi", say: "Yakınımdaki eczaneyi bul" },
      { t: "Gerçek alarmlı hatırlatıcılar", say: "Akşam 6’da annemi aramamı hatırlat" },
      { t: "Saat uygulamasında zamanlayıcı", say: "10 dakikalık zamanlayıcı kur" },
      { t: "Günlük gündem", say: "Bugün gündemimde neler var?" },
      { t: "Ana ekranı yeniden düzenler", say: "Vurgu rengini kehribar yap" },
    ],
  },
];

const CAPABILITIES = [
  {
    group: "Conversation",
    items: [
      "Answer questions, explain, advise",
      "Render charts, tables, schedules and flowcharts",
      "Translate text, typed or from the camera",
      "Talk by wake word, Ctrl+Space, always-on listening, native voice, or chat",
      "Conversation mode: short, natural back-and-forth",
      "Speak with a British neural voice (offline Piper, or ElevenLabs)",
      "Attach an image or document in chat and ask about it",
    ],
  },
  {
    group: "Memory",
    items: [
      "Remember durable facts about you across sessions",
      "Recall recent conversation context",
      "Forget facts on request",
    ],
  },
  {
    group: "Your computer",
    items: [
      "Open and close apps and folders",
      "Search the web and open links",
      "Volume up and down, exact volume, mute, media keys",
      "Lock the screen",
      "Read your clipboard on request",
    ],
  },
  {
    group: "Web browser",
    items: [
      "Autopilot: give a whole task, like “play lofi on YouTube”, and it clicks and types until it's done",
      "You hear the outcome, not the steps",
      "Reads and summarises a page",
    ],
  },
  {
    group: "Desktop autopilot",
    items: [
      "Drives desktop apps by their named controls (asks once)",
      "Focuses or launches the right window itself",
      "Kill switch: slam the mouse into the top-left corner, press Stop, or say “disarm”",
    ],
  },
  { group: "Power (asks first)", items: ["Shut down, restart, sleep, hibernate, log off"] },
  {
    group: "Create and capture",
    items: [
      "Screenshots and QR codes",
      "Generate images (needs a Gemini key)",
      "Record audio, webcam or screen until you stop",
      "Make PDFs from text, and open files it created",
    ],
  },
  {
    group: "Read",
    items: [
      "Read and summarise PDFs",
      "List approved folders and read approved text files (asks first)",
      "Look at your screen and answer questions about it",
    ],
  },
  {
    group: "Out in the world",
    items: [
      "Current weather and a multi-day forecast",
      "Nearby places: food, cafés, pharmacies, ATMs, fuel",
      "Directions and travel time",
      "Latest news headlines by topic",
    ],
  },
  {
    group: "Clock, reminders and routines",
    items: [
      "Alarms and timers in your Clock app",
      "One-off reminders (agenda plus a real alarm)",
      "Recurring routines and spoken briefings",
      "Manage your daily agenda",
    ],
  },
  {
    group: "Learns and adapts",
    items: [
      "Playbooks: named multi-step recipes you teach it",
      "Restyle the HUD: colour, background, density",
      "Show, hide or rearrange panels by voice",
    ],
  },
  { group: "Apps", items: ["Spotify: play, pause, next, previous, play a song"] },
];

export function CapabilitiesOverlay({ open, onClose, onTry }) {
  const caps = IS_MOBILE ? MOBILE_CAPABILITIES : CAPABILITIES;
  return (
    <Sheet open={open} title="Yetenekler" onClose={onClose}>
      <div className="sp-sheet">
        <p className="sp-lede">
          Sesli ya da yazılı, kendi cümlelerinizle isteyin.
          {onTry && IS_MOBILE
            ? " Bir örneğe dokunursanız sohbet kutusuna yazılır; göndermeden önce düzenleyebilirsiniz."
            : ""}
        </p>
        {caps.map((c) => (
          <Group key={c.group} title={c.group}>
            {c.items.map((it) => {
              const item = typeof it === "string" ? { t: it } : it;
              const body = (
                <>
                  <span className="sp-label">{item.t}</span>
                  {item.say && <span className="cap-say">“{item.say}”</span>}
                  {item.note && <span className="sp-desc">{item.note}</span>}
                </>
              );
              return item.say && onTry ? (
                <button
                  type="button"
                  key={item.t}
                  className="sp-field cap-row"
                  onClick={() => onTry(item.say)}
                  aria-label={`${item.t}. Örnek: ${item.say}`}
                >
                  <span className="cap-text">{body}</span>
                  <Icon name="chat" size={18} className="cap-go" />
                </button>
              ) : (
                <div key={item.t} className="sp-field cap-row">
                  <span className="cap-text">{body}</span>
                </div>
              );
            })}
          </Group>
        ))}
      </div>
    </Sheet>
  );
}

/* ───────── Memory overlay — everything JARVIS has stored, with forget ─────────
   Port of the desktop's MemoryOverlay. The phone has no "learned routines" tab:
   verified workflows live in the Playbooks list with their status. */
const MEM_KINDS = [
  {
    key: "facts",
    kind: "fact",
    label: "Hakkınızda",
    color: "var(--ac)",
    note: "DUNYATEK her cevaptan önce bunları okur.",
  },
  {
    key: "playbooks",
    kind: "playbook",
    label: "Senaryolar",
    color: "#6ee7a8",
    note: "DUNYATEK'e öğrettiğiniz senaryolar. Bir senaryo, üç kez doğrulanmış başarıdan sonra kendi kendine çalışır.",
  },
  {
    key: "conversations",
    kind: "conversation",
    label: "Kayıtlı sohbetler",
    color: "#8fa9bd",
    note: "Geçmiş sohbetler. Kaldığınız yerden devam etmek için birini açın.",
  },
];
const PLAYBOOK_STATUS = {
  draft: "Taslak",
  candidate: "Öğreniliyor",
  promoted: "Doğrulandı",
  disabled: "Devre dışı",
};

const memTitle = (key, x) =>
  key === "facts" ? x.text : key === "conversations" ? x.title : x.name;

function memDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function MemoryOverlay({
  open,
  onClose,
  memory,
  currentCount = 0,
  onRemember,
  onForget,
  onOpenConversation,
  onOpenChat,
}) {
  const [tab, setTab] = useState("facts");
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState(null); // id awaiting its confirming second tap
  const [focus, setFocus] = useState(null); // id picked on the timeline
  const mainRef = useRef(null);
  const m = memory || {};
  const lists = {
    facts: [...(m.facts || [])].reverse(),
    playbooks: m.playbooks || [],
    conversations: m.conversations || [],
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Scroll only the list pane — scrollIntoView would also scroll the HUD's
  // overflow:hidden ancestors and shift the whole stage sideways.
  useEffect(() => {
    const main = mainRef.current;
    const el = focus && main?.querySelector(`[data-mem="${CSS.escape(focus)}"]`);
    if (main && el) {
      main.scrollTo({ top: el.offsetTop - main.clientHeight / 3, behavior: "smooth" });
    }
  }, [focus, tab]);

  // Timeline: every dated memory as a tick between the oldest one and now.
  const now = m.now || 0; // set by listMemory (render must stay pure)
  const dated = MEM_KINDS.flatMap((k) => lists[k.key].filter((x) => x.ts).map((x) => ({ x, k })));
  const t0 = Math.min(now - 86400000, ...dated.map((d) => d.x.ts));
  const at = (ts) => `${((ts - t0) / (now - t0)) * 100}%`;

  const pick = (key) => {
    setTab(key);
    setFocus(null);
    setArmed(null);
    mainRef.current?.scrollTo(0, 0);
  };
  const forgetBtn = (kind, id, label = "Unut") => (
    <button
      type="button"
      className={`memx-forget ${armed === id ? "is-armed" : ""}`}
      onClick={() => {
        if (armed !== id) return setArmed(id);
        setArmed(null);
        onForget(kind, id);
      }}
      onBlur={() => armed === id && setArmed(null)}
    >
      {armed === id ? "Onayla" : label}
    </button>
  );
  const remember = (e) => {
    e.preventDefault();
    if (draft.trim()) {
      onRemember(draft.trim());
      setDraft("");
    }
  };
  const row = (id) => ({ "data-mem": id, className: focus === id ? "is-focus" : "" });
  const cur = MEM_KINDS.find((k) => k.key === tab);
  const list = lists[tab];

  return (
    <div className={`memx ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="memx-scrim" onClick={onClose} />
      <section className="memx-panel" role="dialog" aria-label="Hafıza">
        <header className="memx-hd">
          <div className="memx-hd-txt">
            <span className="memx-kicker">HAFIZA</span>
            <h2 className="memx-title">DUNYATEK’in bildikleri</h2>
            <p className="memx-loc">Yalnızca bu telefonda saklanır.</p>
          </div>
          <button className="memx-close" onClick={onClose} aria-label="Hafızayı kapat">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="memx-tl" aria-hidden="true">
          <div className="memx-tl-track">
            {dated.map(({ x, k }) => (
              <button
                key={`${k.key}-${x.id}`}
                tabIndex={-1}
                className="memx-tick"
                style={{ left: at(x.ts), "--kc": k.color }}
                title={`${k.label} · ${memDate(x.ts)} — ${memTitle(k.key, x)}`}
                onClick={() => {
                  setTab(k.key);
                  setFocus(x.id);
                  setArmed(null);
                }}
              />
            ))}
          </div>
          <div className="memx-tl-axis">
            <span>{memDate(t0)}</span>
            <span>Bugün</span>
          </div>
        </div>

        <div className="memx-body">
          <nav className="memx-nav" aria-label="Hafıza bölümleri">
            {MEM_KINDS.map((k) => (
              <button
                key={k.key}
                className={`memx-navbtn ${tab === k.key ? "is-on" : ""}`}
                aria-current={tab === k.key}
                onClick={() => pick(k.key)}
                style={{ "--kc": k.color }}
              >
                <span className="memx-sw" />
                <span className="memx-navl">{k.label}</span>
                <span className="memx-count">{memory ? lists[k.key].length : "–"}</span>
              </button>
            ))}
            <p className="memx-navnote">Unutma işlemi kalıcıdır. “Bunu unut…” da diyebilirsiniz.</p>
          </nav>

          <div className="memx-main" ref={mainRef}>
            <div className="memx-sec-hd">
              <h3>{cur.label}</h3>
              <p>{cur.note}</p>
            </div>

            {tab === "facts" && (
              <form className="memx-add" onSubmit={remember}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="Yeni bilgi"
                  placeholder="DUNYATEK'in her zaman bilmesi gereken bir şey — ör. Vejetaryenim"
                  maxLength={300}
                />
                <button type="submit" disabled={!draft.trim()}>
                  Hatırla
                </button>
              </form>
            )}

            {tab === "conversations" && currentCount > 0 && (
              <div className="memx-row memx-row--current">
                <span className="memx-text">Bu sohbet</span>
                <span className="memx-meta">{currentCount} mesaj</span>
                <button type="button" className="memx-open" onClick={onOpenChat}>
                  Aç
                </button>
              </div>
            )}

            {!memory && <p className="memx-empty">Hafıza okunuyor…</p>}
            {memory && list.length === 0 && (
              <p className="memx-empty">
                {
                  {
                    facts:
                      "Henüz bir şey yok. DUNYATEK'e “şunu hatırla…” deyin ya da yukarıdan ekleyin.",
                    playbooks:
                      "Henüz senaryo yok. “… adlı bir senaryo öğren” diyerek öğretebilirsiniz.",
                    conversations:
                      "Kayıtlı sohbet yok. Yeni bir sohbet başlattığınızda mevcut sohbet buraya kaydedilir.",
                  }[tab]
                }
              </p>
            )}

            <ul className="memx-list">
              {tab === "facts" &&
                list.map((f) => (
                  <li key={f.id} {...row(f.id)}>
                    <div className="memx-row">
                      <span className="memx-text">{f.text}</span>
                      <span className="memx-meta">{memDate(f.ts)}</span>
                      {forgetBtn("fact", f.id)}
                    </div>
                  </li>
                ))}

              {tab === "playbooks" &&
                list.map((p) => (
                  <li key={p.id} {...row(p.id)}>
                    <div className="memx-card">
                      <div className="memx-row">
                        <span className="memx-name">{p.name}</span>
                        <span className="memx-badge">{PLAYBOOK_STATUS[p.status] || p.status}</span>
                        <span className="memx-meta">{memDate(p.ts)}</span>
                        {forgetBtn("playbook", p.id, "Kaldır")}
                      </div>
                      {p.triggers.length > 0 && (
                        <div className="memx-trig">
                          <span>Şunu dediğinizde</span>
                          {p.triggers.map((t) => (
                            <em key={t}>{t}</em>
                          ))}
                        </div>
                      )}
                      {p.steps && <p className="memx-steps">{p.steps}</p>}
                    </div>
                  </li>
                ))}

              {tab === "conversations" &&
                list.map((c) => (
                  <li key={c.id} {...row(c.id)}>
                    <div className="memx-row">
                      <span className="memx-text">{c.title}</span>
                      <span className="memx-meta">
                        {c.count} mesaj · {memDate(c.ts)}
                      </span>
                      {forgetBtn("conversation", c.id, "Sil")}
                      <button
                        type="button"
                        className="memx-open"
                        onClick={() => onOpenConversation(c.id)}
                      >
                        Aç
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ───────── Device (phone) / Power (desktop) ───────── */
/** "WIFI" / "4G" / "OFFLINE" … from deviceTelemetry → a readout for the Wi-Fi row. */
function networkReadout(label) {
  if (!label) return null;
  if (label === "WIFI") return { text: "Wi-Fi bağlı", tone: "on" };
  if (/^[2-5]G$/.test(label)) return { text: `${label} bağlı`, tone: "on" };
  if (label === "OFFLINE") return { text: "Çevrimdışı", tone: "warn" };
  return null;
}

export function PowerOverlay({ open, onClose, runAction, d = {} }) {
  const [note, setNote] = useState(null); // result of an action that stays in the sheet
  // Rows that open an Android settings screen leave JARVIS — close first.
  const openSettings = (target) => {
    onClose();
    runAction({ type: "system", target });
  };
  const power = (command) => {
    onClose();
    runAction({ type: "power", command });
  };

  if (!IS_MOBILE) {
    return (
      <Sheet open={open} title="Güç" onClose={onClose}>
        <div className="sp-sheet">
          <Group title="Bu bilgisayar">
            <ActionRow icon="lock" title="Kilitle" onClick={() => power("lock")} />
            <ActionRow icon="moon" title="Uyku" onClick={() => power("sleep")} />
          </Group>
          <Group title="Çalıştırmadan önce sorar">
            <ActionRow icon="restart" title="Yeniden başlat" onClick={() => power("restart")} />
            <ActionRow
              icon="moon"
              title="Hazırda beklet"
              desc="Oturumunuzu kaydeder, ardından kapatır."
              onClick={() => power("hibernate")}
            />
            <ActionRow icon="logout" title="Oturumu kapat" onClick={() => power("logoff")} />
            <ActionRow
              icon="power"
              title="Bilgisayarı kapat"
              danger
              onClick={() => power("shutdown")}
            />
          </Group>
        </div>
      </Sheet>
    );
  }

  const net = networkReadout(d.linkLabel);
  const pct = d.batteryPct;
  const battery =
    pct == null
      ? null
      : {
          text: `%${Math.round(pct)}${d.charging ? ", şarj oluyor" : ""}`,
          tone: pct < 20 && !d.charging ? "warn" : "on",
        };

  return (
    <Sheet open={open} title="Cihaz" onClose={onClose}>
      <div className="sp-sheet">
        <Group title="Bağlantılar">
          <ActionRow
            icon="wifi"
            title="Wi-Fi"
            readout={net?.text}
            tone={net?.tone}
            leaves
            onClick={() => openSettings("wifi")}
          />
          <ActionRow
            icon="bluetooth"
            title="Bluetooth"
            leaves
            onClick={() => openSettings("bluetooth")}
          />
        </Group>
        <Group title="Ses">
          <ActionRow
            icon="volumeOff"
            title="Medyayı sessize al"
            desc="Müzik ve video sesini sıfıra indirir. Aramalar ve alarmlar yine çalar."
            onClick={async () => setNote(await runAction({ type: "power", command: "mute" }))}
          />
          {note?.summary && (
            <div className="sp-field">
              <span className={`sp-desc ${note.ok === false ? "skill-err" : "skill-out"}`}>
                {note.summary}
              </span>
            </div>
          )}
          <ActionRow
            icon="volume"
            title="Ses ayarları"
            leaves
            onClick={() => openSettings("sound")}
          />
        </Group>
        <Group title="Pil">
          <ActionRow
            icon="battery"
            title="Pil ayarları"
            readout={battery?.text}
            tone={battery?.tone}
            leaves
            onClick={() => openSettings("battery")}
          />
        </Group>
        <Group title="Telefon">
          <ActionRow
            icon="hand"
            title="Uygulama kontrolü"
            desc="DUNYATEK'in diğer uygulamalarda dokunup yazmasını sağlar. Erişilebilirlik ayarlarında DUNYATEK'i açın."
            leaves
            onClick={() => {
              onClose();
              runAction({ type: "open_a11y_settings" });
            }}
          />
          <ActionRow
            icon="settings"
            title="Tüm ayarlar"
            leaves
            onClick={() => openSettings("settings")}
          />
        </Group>
        <p className="sp-desc sp-sheet-note">
          Android, uygulamaların telefonu kapatmasına veya yeniden başlatmasına izin vermez.
        </p>
      </div>
    </Sheet>
  );
}

/* ───────── Conversation ───────── */
// One message, memoized: during streaming only the live message's object identity
// changes (useWebSocket replaces just that entry), so finalized messages skip both
// re-render and ResponseRenderer's re-parse. runAction is a stable useCallback.
const ChatMessage = memo(function ChatMessage({ m, runAction }) {
  const user = m.role === "user";
  return (
    <div className={`cv-msg cv-msg--${user ? "user" : "jarvis"}`}>
      <span className="sp-sr">{user ? "Siz:" : "DUNYATEK:"}</span>
      <div className="cv-bubble">
        {user ? (
          m.text
        ) : (
          <ResponseRenderer text={m.text} actions={m.actions} runAction={runAction} />
        )}
      </div>
    </div>
  );
});

// Relative "time ago" for the history list (ts is epoch seconds).
function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "az önce";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? "dün" : `${d} gün önce`;
  return `${Math.floor(d / 7)} hf önce`;
}

const STARTERS = IS_MOBILE
  ? ["Bugün hava nasıl?", "Bugün ajandamda ne var?", "YouTube'u aç", "Gündemde neler var?"]
  : ["Bugün hava nasıl?", "Ajandamı özetle", "Ekran görüntüsü al", "Gündemde neler var?"];

export function ChatOverlay({
  open,
  onClose,
  status,
  messages = [],
  onSend,
  onStop,
  onUpload,
  runAction,
  conversations = [],
  onNewChat,
  onOpenConversation,
  onDeleteConversation,
  onRefreshConversations,
  onClearConversations,
  prefill, // {text, n}: text to drop into the box (from Capabilities); n makes repeats count
}) {
  const [draft, setDraft] = useState("");
  const [histOpen, setHistOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  // A Capabilities example lands in the box, ready to edit or send. Adjusted while
  // rendering (not in an effect) so the box never paints with the old draft first.
  const [seenPrefill, setSeenPrefill] = useState(prefill);
  if (prefill !== seenPrefill) {
    setSeenPrefill(prefill);
    if (prefill?.text) {
      setDraft(prefill.text);
      setHistOpen(false);
    }
  }
  useEffect(() => {
    if (open && prefill?.text) inputRef.current?.focus();
  }, [open, prefill]);

  const startNewChat = () => {
    onNewChat?.();
    setHistOpen(false);
  };
  const showHistory = () => {
    setConfirmClear(false);
    onRefreshConversations?.();
    setHistOpen(true);
  };
  const openConv = (id) => {
    onOpenConversation?.(id);
    setHistOpen(false);
  };
  // Two taps so a stray one can't wipe the whole archive.
  const clearAll = () => {
    if (!confirmClear) return setConfirmClear(true);
    onClearConversations?.();
    setConfirmClear(false);
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    if (file && onUpload) onUpload(file, draft.trim());
    setDraft("");
    e.target.value = ""; // allow re-selecting the same file
  };

  // Keep the newest message in view.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, status, open, histOpen]);

  const send = (text = draft) => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setDraft("");
  };

  // Mid-reply (thinking/working, or a message still streaming): Stop replaces Send.
  const busy = status === "thinking" || status === "working" || messages.some((m) => m.streaming);

  if (histOpen) {
    return (
      <Sheet
        open={open}
        title="Geçmiş"
        onClose={onClose}
        onBack={() => setHistOpen(false)}
        backLabel="Sohbet"
      >
        <div className="sp-sheet">
          <h2 className="sp-page-title">Geçmiş</h2>
          <button type="button" className="sp-btn cv-newchat" onClick={startNewChat}>
            <Icon name="plus" size={16} />
            Yeni sohbet
          </button>
          {conversations.length === 0 ? (
            <StateMessage variant="empty" icon="history" title="Henüz kayıtlı sohbet yok">
              Yeni bir sohbet başlattığınızda mevcut sohbet buraya kaydedilir.
            </StateMessage>
          ) : (
            <Group title="Kayıtlı sohbetler">
              {conversations.map((c) => (
                <div key={c.id} className="sp-field cv-hist-row">
                  <button type="button" className="cv-hist-open" onClick={() => openConv(c.id)}>
                    <span className="sp-label">{c.title}</span>
                    <span className="sp-desc">
                      {timeAgo(c.ts)}
                      {c.count ? `, ${c.count} mesaj` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="cv-hist-del"
                    aria-label={`“${c.title}” sohbetini sil`}
                    title="Sil"
                    onClick={() => onDeleteConversation?.(c.id)}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              ))}
            </Group>
          )}
          {conversations.length > 0 && (
            <button
              type="button"
              className={`sp-btn sp-btn--quiet cv-clearall ${confirmClear ? "is-armed" : ""}`}
              onClick={clearAll}
              onBlur={() => setConfirmClear(false)}
            >
              {confirmClear ? "Tümünü silmek için tekrar dokunun" : "Tüm kayıtlı sohbetleri sil"}
            </button>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      title="Sohbet"
      onClose={onClose}
      className="sp--chat"
      bodyRef={bodyRef}
      actions={
        <>
          <HeaderButton icon="history" label="Sohbet geçmişi" onClick={showHistory} />
          <HeaderButton
            icon="plus"
            label="Yeni sohbet (bu sohbet kaydedilir)"
            onClick={startNewChat}
          />
        </>
      }
      footer={
        <div className="cv-compose">
          {onUpload && !IS_MOBILE && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf,.txt,.md,.csv,.json,.log"
                onChange={pickFile}
                hidden
              />
              <button
                type="button"
                className="cv-attach"
                aria-label="Görsel veya belge ekle"
                title="Görsel veya belge ekle"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="paperclip" size={20} />
              </button>
            </>
          )}
          <input
            ref={inputRef}
            className="sp-input cv-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="DUNYATEK'e yazın"
            aria-label="DUNYATEK'e yazın"
          />
          {busy && onStop ? (
            <button
              type="button"
              className="cv-send cv-send--stop"
              aria-label="Durdur"
              onClick={onStop}
            >
              <Icon name="stop" size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="cv-send"
              aria-label="Gönder"
              disabled={!draft.trim()}
              onClick={() => send()}
            >
              <Icon name="send" size={19} />
            </button>
          )}
        </div>
      }
    >
      <div className="cv" aria-live="polite">
        {messages.length === 0 ? (
          <div className="cv-empty">
            <p className="cv-empty-title">DUNYATEK’e her şeyi sorabilirsiniz</p>
            <p className="sp-desc">Aşağıya yazın, mikrofona dokunun ya da “Hey Jarvis” deyin.</p>
            <div className="cv-starters">
              {STARTERS.map((t) => (
                <button key={t} type="button" className="cv-starter" onClick={() => setDraft(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <ChatMessage key={m.id} m={m} runAction={runAction} />)
        )}
        {status === "thinking" && (
          <div className="cv-msg cv-msg--jarvis">
            <span className="sp-sr">DUNYATEK düşünüyor</span>
            <div className="cv-typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
