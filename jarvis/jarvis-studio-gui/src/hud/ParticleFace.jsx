/* ParticleFace.jsx — DUNYATEK's face on the phone home screen.

   A human face drawn as a cloud of glowing points (features brighter, the skin a
   faint mesh), slowly turning in 3D. It listens and talks with the live PC voice
   call: the user's voice (mic) and DUNYATEK's voice (speaker) push the points
   apart, and they spring back together into the face — "dağılıp birleşen yüz".
   DUNYATEK's own voice also opens the mouth. Without a live call it breathes on
   its own, driven by the HUD status. Canvas only, capped at 30 fps. */

import { useEffect, useRef } from "react";
import { simplePcStore } from "../brain/remote/simpleStore";

const LIFT = -0.26; // shift the bust up so the shoulders fit the canvas
const STATUS_ENERGY = {
  idle: 0.05,
  listening: 0.18,
  thinking: 0.28,
  speaking: 0.35,
  working: 0.25,
};

/* ── face model (unit space: x right, y down, z toward viewer) ── */
function buildFace() {
  const pts = []; // {x,y,z,kind,mouth}  kind: 0 skin, 1 feature, 2 iris, 4 pupil
  const lines = []; // feature polylines: arrays of point indices
  const rnd = mulberry(20260927);

  // Depth of the head surface at (x,y): an ellipsoid with a nose bump.
  const depth = (x, y) => {
    const e = 1 - (x / 0.82) ** 2 - ((y + 0.02) / 1.12) ** 2;
    let z = Math.sqrt(Math.max(0, e)) * 0.75;
    z += 0.22 * Math.exp(-((x / 0.09) ** 2 + ((y - 0.08) / 0.22) ** 2)); // nose
    z -= 0.07 * Math.exp(-(((Math.abs(x) - 0.3) / 0.13) ** 2 + ((y + 0.12) / 0.07) ** 2)); // eye sockets
    return z;
  };
  const add = (x, y, kind, mouth = 0) => {
    pts.push({ x, y, z: depth(x, y), kind, mouth });
    return pts.length - 1;
  };
  const curve = (fn, n, kind, mouth = 0) => {
    const idx = [];
    for (let i = 0; i <= n; i++) {
      const [x, y] = fn(i / n);
      idx.push(add(x, y, kind, mouth));
    }
    lines.push(idx);
    return idx;
  };

  // Head outline, narrowing into the jaw and chin.
  curve(
    (u) => {
      const t = u * Math.PI * 2;
      const y = -Math.cos(t) * 1.05 - 0.02;
      const taper = y > 0 ? 1 - 0.3 * (y / 1.05) ** 2 : 1;
      return [Math.sin(t) * 0.78 * taper, y];
    },
    90,
    1,
  );
  // Ears (small arcs on the sides).
  for (const s of [-1, 1]) {
    curve((u) => [s * (0.79 + 0.07 * Math.sin(u * Math.PI)), -0.2 + u * 0.36], 10, 1);
  }
  // Eyebrows.
  for (const s of [-1, 1]) {
    curve((u) => [s * (0.13 + u * 0.34), -0.3 - 0.05 * Math.sin(u * Math.PI) + u * 0.02], 14, 1);
  }
  // Eyes: almond lids + iris ring + pupil.
  for (const s of [-1, 1]) {
    const cx = s * 0.3;
    const cy = -0.13;
    curve((u) => [cx - 0.12 + u * 0.24, cy - 0.065 * Math.sin(u * Math.PI)], 12, 1);
    curve((u) => [cx - 0.12 + u * 0.24, cy + 0.045 * Math.sin(u * Math.PI)], 10, 1);
    curve(
      (u) => [cx + 0.036 * Math.cos(u * Math.PI * 2), cy + 0.036 * Math.sin(u * Math.PI * 2)],
      8,
      2,
    );
    add(cx, cy, 4); // pupil: the brightest point
  }
  // Nose: bridge, tip and nostrils.
  curve((u) => [-0.045 + 0.01 * u, -0.1 + u * 0.3], 10, 1);
  curve((u) => [-0.13 + u * 0.26, 0.23 + 0.04 * Math.sin(u * Math.PI)], 14, 1);
  for (const s of [-1, 1]) {
    curve((u) => [s * (0.05 + 0.05 * u), 0.2 - 0.03 * Math.sin(u * Math.PI)], 5, 1);
  }
  // Lips. `mouth`: +1 moves down when the mouth opens, 0.5 the middle line.
  const my = 0.5;
  curve(
    (u) => [
      -0.23 + u * 0.46,
      my -
        0.035 -
        0.025 * Math.sin(u * Math.PI) +
        0.018 * Math.cos(u * Math.PI * 4) * Math.sin(u * Math.PI),
    ],
    20,
    1,
    0,
  );
  curve((u) => [-0.23 + u * 0.46, my + 0.005 * Math.sin(u * Math.PI)], 20, 1, 0.5);
  curve((u) => [-0.23 + u * 0.46, my + 0.075 * Math.sin(u * Math.PI)], 20, 1, 1);
  // Cheekbones / smile lines.
  for (const s of [-1, 1]) {
    curve((u) => [s * (0.17 + 0.07 * u), 0.3 + u * 0.18], 8, 0);
  }

  // Neck and shoulders, so it reads as a person at a glance.
  for (const s of [-1, 1]) {
    curve((u) => [s * (0.3 - 0.03 * Math.sin(u * Math.PI)), 0.86 + u * 0.44], 10, 1);
    curve((u) => [s * (0.3 + u * 0.9), 1.3 + 0.22 * Math.sin(u * Math.PI * 0.5) ** 1.5], 18, 1);
  }
  curve((u) => [-0.3 + u * 0.6, 1.3 + 0.1 * Math.sin(u * Math.PI)], 12, 0); // collar

  // Skin: points spread inside the face, denser toward the centre.
  const skinStart = pts.length;
  let tries = 0;
  while (pts.length - skinStart < 240 && tries < 20000) {
    tries++;
    const x = (rnd() * 2 - 1) * 0.76;
    const y = (rnd() * 2 - 1) * 1.02 - 0.02;
    const taper = y > 0 ? 1 - 0.3 * (y / 1.05) ** 2 : 1;
    if ((x / (0.76 * taper)) ** 2 + ((y + 0.02) / 1.02) ** 2 > 1) continue;
    const mouthZone = Math.abs(x) < 0.26 && y > 0.43 && y < 0.6;
    const jaw = y > 0.52 ? 1 : 0;
    add(x, y, 0, mouthZone ? 0.5 : jaw ? 0.35 * Math.min(1, (y - 0.52) / 0.3 + 0.4) : 0);
  }
  const skinEnd = pts.length;

  // Mesh: each skin point links to its 2 nearest skin neighbours.
  const mesh = [];
  for (let i = skinStart; i < skinEnd; i++) {
    let a = -1;
    let b = -1;
    let da = 1e9;
    let db = 1e9;
    for (let j = skinStart; j < skinEnd; j++) {
      if (j === i) continue;
      const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2;
      if (d < da) {
        b = a;
        db = da;
        a = j;
        da = d;
      } else if (d < db) {
        b = j;
        db = d;
      }
    }
    if (a > i) mesh.push([i, a]);
    if (b > i && db < 0.02) mesh.push([i, b]);
  }

  // Each point gets a scatter direction (outward, a little random).
  for (const p of pts) {
    const ang = Math.atan2(p.y, p.x) + (rnd() - 0.5) * 1.6;
    const mag = 0.5 + rnd();
    p.dx = Math.cos(ang) * mag;
    p.dy = Math.sin(ang) * mag;
    p.dz = (rnd() - 0.5) * 1.2;
    p.phase = rnd() * Math.PI * 2;
  }
  return { pts, lines, mesh };
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let FACE = null;

export default function ParticleFace({ status = "idle", size = 300, rgb = [0, 229, 140] }) {
  const cvs = useRef(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  const [R, G, B] = rgb;

  useEffect(() => {
    const canvas = cvs.current;
    if (!canvas) return undefined;
    if (!FACE) FACE = buildFace();
    const { pts, lines, mesh } = FACE;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = size;
    const H = Math.round(size * 1.08);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // Screen-space state per point: position + velocity. Start scattered so the
    // face assembles itself when the screen opens.
    const pos = pts.map(() => ({
      x: W / 2 + (Math.random() - 0.5) * W * 1.4,
      y: H / 2 + (Math.random() - 0.5) * H * 1.4,
      vx: 0,
      vy: 0,
    }));
    const sx = new Float32Array(pts.length);
    const sy = new Float32Array(pts.length);
    const sa = new Float32Array(pts.length);
    let mic = 0;
    let out = 0;
    let mouth = 0;
    let lastLevel = 0;
    let burst = 0;
    let raf = 0;
    let last = -Infinity;
    const t0 = performance.now();
    const col = (a) => `rgba(${R},${G},${B},${a})`;
    const hot = (a) =>
      `rgba(${Math.min(255, R + 150)},${Math.min(255, G + 90)},${Math.min(255, B + 120)},${a})`;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return; // ~30 fps
      last = now;
      if (document.hidden) return;
      const t = (now - t0) / 1000;

      // Levels: live call audio when present, else a gentle status-driven pulse.
      const lv = simplePcStore.levels();
      mic += ((lv.mic || 0) - mic) * (lv.mic > mic ? 0.5 : 0.12);
      out += ((lv.out || 0) - out) * (lv.out > out ? 0.55 : 0.15);
      const base = STATUS_ENERGY[statusRef.current] ?? 0.05;
      const breath = 0.5 + 0.5 * Math.sin(t * 0.9);
      const level = Math.max(mic * 0.9, out, base * breath);
      // A sudden rise in loudness kicks the points apart; they then re-form.
      if (level - lastLevel > 0.12) burst = Math.min(1.4, burst + (level - lastLevel) * 2.2);
      lastLevel = level;
      burst *= 0.9;
      // Every ~9 s of silence, a slow scatter-and-return so the face stays alive.
      const idleWave = Math.max(0, Math.sin(t * 0.7)) ** 24 * 0.9;
      mouth += (Math.min(1, out * 1.6) - mouth) * 0.35;

      const yaw = Math.sin(t * 0.35) * 0.32 + Math.sin(t * 0.13) * 0.1;
      const pitch = Math.sin(t * 0.27) * 0.08;
      const cy = Math.cos(yaw);
      const syw = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      const scale = W * 0.34;
      const cx0 = W / 2;
      const cy0 = H / 2;
      // Quiet = a crisp face; only real sound (or the idle wave) pulls it apart.
      const spread = Math.max(0, level - 0.06) * 0.6 + burst * 0.5 + idleWave;

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let x = p.x;
        let y = p.y + p.mouth * mouth * 0.13;
        let z = p.z;
        // Scatter along the point's own direction; features hold on a bit tighter.
        const hold = p.kind === 0 ? 1 : 0.7;
        const k = spread * hold * (0.8 + 0.4 * Math.sin(t * 2 + p.phase));
        x += p.dx * k;
        y += p.dy * k;
        z += p.dz * k;
        // rotate (yaw around y, then pitch around x) + perspective
        const rx = x * cy + z * syw;
        const rz = -x * syw + z * cy;
        const ry = y * cp - rz * sp;
        const rz2 = y * sp + rz * cp;
        const persp = 3.2 / (3.2 - rz2);
        const tx = cx0 + rx * scale * persp;
        const ty = cy0 + (ry + LIFT) * scale * persp;
        // spring toward the target
        const q = pos[i];
        q.vx = (q.vx + (tx - q.x) * 0.16) * 0.74;
        q.vy = (q.vy + (ty - q.y) * 0.16) * 0.74;
        q.x += q.vx;
        q.y += q.vy;
        sx[i] = q.x;
        sy[i] = q.y;
        sa[i] = Math.max(0.15, Math.min(1, 0.55 + rz2 * 0.6)); // nearer = brighter
      }

      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";

      // Mesh + feature lines fade out as the face scatters, then knit back.
      const knit = Math.max(0, 1 - spread * 1.4);
      if (knit > 0.02) {
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = col(0.08 * knit);
        ctx.beginPath();
        for (const [a, b] of mesh) {
          ctx.moveTo(sx[a], sy[a]);
          ctx.lineTo(sx[b], sy[b]);
        }
        ctx.stroke();
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = col(0.45 * knit);
        ctx.beginPath();
        for (const ln of lines) {
          ctx.moveTo(sx[ln[0]], sy[ln[0]]);
          for (let j = 1; j < ln.length; j++) ctx.lineTo(sx[ln[j]], sy[ln[j]]);
        }
        ctx.stroke();
      }

      for (let i = 0; i < pts.length; i++) {
        const kind = pts[i].kind;
        const a = sa[i];
        const r = kind === 4 ? 2.6 : kind === 2 ? 1.3 : kind === 1 ? 1.4 : 1;
        ctx.fillStyle = kind >= 2 && kind !== 3 ? hot(0.95 * a) : col((kind === 0 ? 0.4 : 0.9) * a);
        ctx.beginPath();
        ctx.arc(sx[i], sy[i], r + level * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, R, G, B]);

  return (
    <div className="pface" style={{ width: size, height: Math.round(size * 1.08) }}>
      <div className="pface-glow" />
      <canvas
        ref={cvs}
        style={{ width: size, height: Math.round(size * 1.08) }}
        aria-label="DUNYATEK"
        role="img"
      />
    </div>
  );
}
