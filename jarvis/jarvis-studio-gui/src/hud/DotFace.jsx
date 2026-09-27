/* DotFace.jsx — telefonun ana ekranindaki DUNYATEK yuzu.
   PC'deki holografik kafanin ayni noktalari (dunyatekHead.js) kanvasta nokta nokta
   cizilir. Ses geldikce noktalar disari dogru dagilir, ses kesilince yeniden
   birlesip yuzu olusturur; DUNYATEK konusurken cenesi sesle acilir.
   Ses seviyesi: canli sesli gorusmede simplePc.voiceLevel (gercek mikrofon /
   hoparlor seviyesi); o yoksa durum (dinliyor / konusuyor) uzerinden yumusak bir
   taklit seviye. */

import { useEffect, useRef } from "react";
import { HEAD_POINTS, HEAD_EDGES, JAW_PIVOT, JAW_MAX } from "./dunyatekHead";
import { voiceLevel } from "../brain/remote/simplePc";

const N = HEAD_POINTS.length / 5;
const CAM_D = 4.6;
const FRAME_MS = 1000 / 30;

// Her nokta icin sabit bir dagilma yonu + mesafe (her acilista ayni gorunsun diye
// basit bir sayi ureteci).
function makeScatter() {
  let s = 20260927;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const x = HEAD_POINTS[i * 5] / 1000;
    const y = HEAD_POINTS[i * 5 + 1] / 1000;
    const z = HEAD_POINTS[i * 5 + 2] / 1000;
    // Yuzeyden disari (merkezden uzaga) + biraz rastgele sapma
    let dx = x + (rnd() - 0.5) * 0.9;
    let dy = y + 0.1 + (rnd() - 0.5) * 0.9;
    let dz = z + (rnd() - 0.5) * 0.9;
    const l = Math.hypot(dx, dy, dz) || 1;
    out[i * 4] = dx / l;
    out[i * 4 + 1] = dy / l;
    out[i * 4 + 2] = dz / l;
    out[i * 4 + 3] = 0.35 + rnd() * 0.9; // ne kadar uzaga
  }
  return out;
}
const SCATTER = makeScatter();

const MOODS = {
  idle: { level: 0.0, sway: 0.18 },
  listening: { level: 0.25, sway: 0.28 },
  thinking: { level: 0.12, sway: 0.1 },
  working: { level: 0.12, sway: 0.1 },
  speaking: { level: 0.45, sway: 0.3 },
};

export function DotFace({ status = "idle", size = 280, rgb = [0, 229, 255] }) {
  const cvs = useRef(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [R0, G0, B0] = rgb;

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const proj = new Float32Array(N * 3); // ekran x, y, derinlik
    let raf = 0;
    let t0 = null;
    let last = -Infinity;
    let disp = 1.2; // acilista dagilmis baslar, sonra yuz olusur
    let jaw = 0;
    let lvlSmooth = 0;

    const rgba = (a) => `rgba(${R0},${G0},${B0},${a})`;

    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (ts - last < FRAME_MS) return;
      const dt = Math.min(0.1, (ts - last) / 1000);
      last = ts;
      if (t0 == null) t0 = ts;
      const t = (ts - t0) / 1000;
      const st = statusRef.current;
      const mood = MOODS[st] ?? MOODS.idle;

      // ── ses seviyesi ──
      const fresh = Date.now() - voiceLevel.t < 300;
      let real = 0;
      if (fresh)
        real = st === "speaking" ? voiceLevel.spk : Math.max(voiceLevel.mic, voiceLevel.spk);
      // Canli ses yoksa: duruma gore dalgalanan taklit seviye
      const fake =
        mood.level *
        (0.55 + 0.45 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.3)) *
        (st === "speaking" ? 1 : 0.8);
      const lvl = fresh ? Math.min(1, real * 1.6) : Math.max(0, fake);
      lvlSmooth += (lvl - lvlSmooth) * (1 - Math.exp(-dt / (lvl > lvlSmooth ? 0.05 : 0.25)));

      // Dagilma: ses yukseldikce disari, sessizlikte yavasca birlesir
      const target = Math.min(0.6, 0.55 * Math.pow(lvlSmooth, 1.6)) + 0.015 * (1 + Math.sin(t * 0.9));
      disp += (target - disp) * (1 - Math.exp(-dt / (target > disp ? 0.08 : 0.55)));
      // Cene: sadece DUNYATEK konusurken
      const jawT = st === "speaking" ? Math.min(1, lvlSmooth * 2.2) : 0;
      jaw += (jawT - jaw) * (1 - Math.exp(-dt / 0.04));

      // ── bas hareketi ──
      const yaw = Math.sin(t * 0.45) * mood.sway + Math.sin(t * 1.7) * 0.03 * lvlSmooth;
      const pitch = -0.06 + Math.sin(t * 0.31) * 0.05;
      const cy_ = Math.cos(yaw),
        sy_ = Math.sin(yaw),
        cp = Math.cos(pitch),
        sp = Math.sin(pitch);
      const ja = jaw * JAW_MAX * 2.2;
      const cj = Math.cos(ja),
        sj = Math.sin(ja);

      const scale = size * 0.33;
      const cx = size / 2,
        cyc = size * 0.47;
      for (let i = 0; i < N; i++) {
        const b = i * 5;
        let x = HEAD_POINTS[b] / 1000;
        let y = HEAD_POINTS[b + 1] / 1000;
        let z = HEAD_POINTS[b + 2] / 1000;
        const jw = HEAD_POINTS[b + 3] / 100;
        if (jw > 0 && ja > 0) {
          const dy = y - JAW_PIVOT[1],
            dz = z - JAW_PIVOT[2];
          const a = jw;
          const ny = dy * cj - dz * sj,
            nz = dy * sj + dz * cj;
          y = y + (JAW_PIVOT[1] + ny - y) * a;
          z = z + (JAW_PIVOT[2] + nz - z) * a;
        }
        // dagilma (hafif girdapla)
        const k = disp * SCATTER[i * 4 + 3];
        if (k > 0.001) {
          const sw = k * 0.6;
          x += SCATTER[i * 4] * k + Math.sin(t * 1.3 + i) * 0.02 * sw;
          y += SCATTER[i * 4 + 1] * k + Math.cos(t * 1.1 + i * 0.7) * 0.02 * sw;
          z += SCATTER[i * 4 + 2] * k;
        }
        // dondur (yaw sonra pitch)
        const x1 = x * cy_ + z * sy_;
        const z1 = -x * sy_ + z * cy_;
        const y2 = y * cp - z1 * sp;
        const z2 = y * sp + z1 * cp;
        const f = CAM_D / (CAM_D - z2);
        proj[i * 3] = cx + x1 * f * scale;
        proj[i * 3 + 1] = cyc - y2 * f * scale;
        proj[i * 3 + 2] = z2;
      }

      ctx.clearRect(0, 0, size, size);

      // arka hale
      const halo = ctx.createRadialGradient(cx, cyc, size * 0.05, cx, cyc, size * 0.5);
      halo.addColorStop(0, rgba(0.1 + 0.18 * lvlSmooth));
      halo.addColorStop(1, rgba(0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);

      // dis cember: donen nokta halkasi + ses cubuklari
      const R = size * 0.47;
      ctx.save();
      ctx.translate(cx, size / 2);
      const bars = 72;
      for (let i = 0; i < bars; i++) {
        const a = (i / bars) * Math.PI * 2 + t * 0.15;
        const wob = 0.5 + 0.5 * Math.sin(i * 1.7 + t * 6);
        const len = 2 + lvlSmooth * 16 * wob;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
        ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(0.18 + 0.5 * lvlSmooth * wob);
        ctx.stroke();
      }
      ctx.restore();

      // ince tel cizgiler: yuz toplandiginda gorunur, dagilinca kaybolur
      const wireA = Math.max(0, 0.16 - disp * 0.5);
      if (wireA > 0.005) {
        ctx.beginPath();
        for (let e = 0; e < HEAD_EDGES.length; e += 2) {
          const a = HEAD_EDGES[e],
            b = HEAD_EDGES[e + 1];
          if (proj[a * 3 + 2] < -0.1 && proj[b * 3 + 2] < -0.1) continue; // arka yuz
          ctx.moveTo(proj[a * 3], proj[a * 3 + 1]);
          ctx.lineTo(proj[b * 3], proj[b * 3 + 1]);
        }
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = rgba(wireA);
        ctx.stroke();
      }

      // noktalar: one bakanlar parlak, arkadakiler soluk
      for (let i = 0; i < N; i++) {
        const z = proj[i * 3 + 2];
        const fade = HEAD_POINTS[i * 5 + 4] / 100;
        const front = Math.max(0, Math.min(1, (z + 0.7) / 1.3));
        const a = (0.12 + 0.88 * front) * fade * (1 - Math.min(0.5, disp * 0.35));
        if (a < 0.03) continue;
        const r = 0.7 + 1.3 * front + 0.6 * lvlSmooth;
        ctx.fillStyle = rgba(a);
        ctx.fillRect(proj[i * 3] - r / 2, proj[i * 3 + 1] - r / 2, r, r);
      }
    }

    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [size, R0, G0, B0]);

  return (
    <canvas
      ref={cvs}
      className="dotface"
      style={{
        width: size,
        height: size,
        display: "block",
        margin: "0 auto",
        filter: `drop-shadow(0 0 4px rgba(${R0},${G0},${B0},0.8))`,
      }}
      aria-label="DÜNYATEK"
      role="img"
    />
  );
}
