/* MobileHome.jsx — telefonun ilk ekrani (yalnizca telefonda).
   Ustten alta: sesle dagilip birlesen noktali DUNYATEK yuzu, DUNYATEK yazisi,
   durum + ses dalgasi (DINLIYORUM…), buyuk saat, Turkce tarih, haftalik takvim
   seridi, bugunun ilk ajanda maddesi + hava durumu ozeti, www.dunyatek.com. */

import { useEffect, useState } from "react";
import { DotFace } from "./DotFace";
import { Waveform } from "./HudCore";
import { STATUS_META } from "./hudConstants";

const GUNLER_KISA = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function faceSize() {
  if (typeof window === "undefined") return 280;
  return Math.max(220, Math.min(320, window.innerWidth - 60));
}

export function MobileHome({ status = "idle", rgb, schedule, weather }) {
  const now = useNow();
  const [size, setSize] = useState(faceSize);
  useEffect(() => {
    const onR = () => setSize(faceSize());
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  const meta = STATUS_META[status] ?? STATUS_META.idle;
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const tarih = now.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
  const gun = now.toLocaleDateString("tr-TR", { weekday: "long" });

  // Pazartesiden baslayan bu haftanin 7 gunu
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const items = Array.isArray(schedule) ? schedule.filter((it) => it && !it.done) : [];
  const next = items[0];
  const w = weather || null;

  return (
    <section className="mhome" data-slot="core">
      <DotFace status={status} size={size} rgb={rgb} />

      <h1 className="mhome-brand">DÜNYATEK</h1>
      <div className="mhome-tag">YAPAY ZEKÂ ASİSTANI</div>

      <div className="mhome-status">
        <span
          className="mhome-dot"
          style={{ background: meta.col, boxShadow: `0 0 10px ${meta.col}` }}
        />
        <span style={{ color: meta.col }}>{meta.label}</span>
      </div>
      <Waveform status={status} bars={38} height={40} rgb={rgb} />

      <div className="mhome-clock" aria-label={`Saat ${hh}:${mm}`}>
        <span className="mhome-hm">
          {hh}
          <span className="mhome-colon">:</span>
          {mm}
        </span>
        <span className="mhome-ss">{ss}</span>
      </div>
      <div className="mhome-date">
        {tarih} · <span className="mhome-day">{gun}</span>
      </div>

      <div className="mhome-week" role="list" aria-label="Bu hafta">
        {week.map((d) => {
          const today = d.toDateString() === now.toDateString();
          return (
            <div
              key={d.toDateString()}
              role="listitem"
              className={`mhome-wd${today ? " is-today" : ""}`}
            >
              <span className="mhome-wd-n">{GUNLER_KISA[d.getDay()]}</span>
              <span className="mhome-wd-d">{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      <div className="mhome-cards">
        <div className="mhome-mini">
          <span className="mhome-mini-k">AJANDA</span>
          {next ? (
            <span className="mhome-mini-v">
              {next.time ? <b>{next.time}</b> : null} {next.task}
              {items.length > 1 ? <em> +{items.length - 1}</em> : null}
            </span>
          ) : (
            <span className="mhome-mini-v mhome-mini-muted">Bugün boş</span>
          )}
        </div>
        <div className="mhome-mini">
          <span className="mhome-mini-k">HAVA</span>
          {w && w.temp != null ? (
            <span className="mhome-mini-v">
              <b>{Math.round(w.temp)}°</b> {w.condition}
              {w.location && w.location !== "—" ? <em> · {w.location}</em> : null}
            </span>
          ) : (
            <span className="mhome-mini-v mhome-mini-muted">Konum alınıyor…</span>
          )}
        </div>
      </div>

      <div className="mhome-web">www.dunyatek.com</div>
    </section>
  );
}
