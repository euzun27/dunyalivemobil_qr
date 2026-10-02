/**
 * DUNYATEK holografik insan yuzu - masaustundeki core/avatar.py (HoloAvatar) portu.
 *
 * Yuz geometrisi faceMesh.json'dan gelir (MediaPipe canonical face, Apache-2.0; kafatasi,
 * boyun ve animasyon agirliklari DUNYATEK core/avatar_mesh.py ile uretildi). Sabitler,
 * formuller ve cizim sirasi masaustuyle ayni tutuldu; boylece iki ekran ayni yuzu gosterir.
 *
 * Telefona ozgu tek ek: KonusmaZarfi. Telefon PC'nin ses seviyesini (henuz) almadigi icin
 * konusurken hece ritminde dogal bir agiz hareketi uretir. Ileride gercek seviye gelirse
 * HoloFace.step()'e dogrudan o verilir.
 */

export type RGB = readonly [number, number, number];

export interface FaceMesh {
  nVerts: number;
  nFaces: number;
  verts: number[];
  normals: number[];
  faces: number[];
  edges: number[];
  faceGroup: number[];
  jaw: number[];
  brow: number[];
  lips: number[];
  fade: number[];
  lipCentre: number[];
  landmarks: Record<string, number[]>;
  span: number[];
  jawMax: number;
  jawPivot: number[];
}

export interface FaceColors {
  primary: RGB;
  accent: RGB;
  bg: RGB;
}

export interface StepInput {
  amp: number; // 0..1 ses seviyesi
  speaking: boolean;
  muted: boolean;
  state: string; // LISTENING | THINKING | SLEEPING | ... (masaustuyle ayni adlar)
}

type Rand = () => number;

// ── masaustuyle ayni sabitler (core/avatar.py) ──
const CAM_D = 4.6;
const BUCKETS = 4;
const MIN_ALPHA = 0.05;
const LUT_N = 192;
const BROW_LIFT = 0.14;
const TAU_OPEN = 0.022;
const TAU_SHUT = 0.012;
const TAU_REST = 0.055;
const MIC_FLOOR = 0.14;

export function rate(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** `col`, `a` (0-255) opakliginda `bg` uzerine onceden karistirilmis, tamamen opak renk. */
export function blend(bg: RGB, col: RGB, a: number): string {
  const f = clamp(a / 255, 0, 1);
  const c = (i: number) => Math.trunc(bg[i] + (col[i] - bg[i]) * f);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

/** `col`, `a` (0-255) opakliginda. */
export function rgba(col: RGB, a: number): string {
  return `rgba(${col[0]},${col[1]},${col[2]},${(clamp(a, 0, 255) / 255).toFixed(3)})`;
}

export class HoloFace {
  readonly span: number;
  private readonly m: FaceMesh;
  private readonly rand: Rand;
  private readonly n: number;
  private readonly v: Float32Array; // pozlanmis koseler
  private readonly pn: Float32Array; // pozlanmis normaller
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly lipUp: number[];
  private lutKey = "";
  private lut: string[] = [];

  // animasyon durumu (avatar.py ile ayni adlar, ayni baslangic degerleri)
  private t = 0;
  private sway = 0;
  private yaw = 0;
  private pitch = 0;
  mouth = 0;
  private glow = 0;
  private scan = -1.6;
  blink = 0;
  private blinkAt = 3;
  private ampSlow = 0;
  private expr = 0;
  private exprTgt = 0;
  private exprAt = 0;
  private brow = 0;
  private emph = 0;
  private gaze = [0, 0];
  private gazeTgt = [0, 0];
  private gazeAt = 0;
  private gazeBias = [0, 0];
  private biasTgt = [0, 0];
  private biasAt = 0;
  lids = 1;
  private browBias = 0;

  constructor(mesh: FaceMesh, rand: Rand = Math.random) {
    this.m = mesh;
    this.rand = rand;
    this.n = mesh.nVerts;
    this.v = new Float32Array(this.n * 3);
    this.pn = new Float32Array(this.n * 3);
    this.xs = new Float32Array(this.n);
    this.ys = new Float32Array(this.n);
    const lipsIn = mesh.landmarks.lips_in;
    this.lipUp = [...lipsIn.slice(10), lipsIn[0]];
    this.span = mesh.span[0] - mesh.span[1];
  }

  private uniform(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }

  // ── animasyon ──
  private mouthStep(dt: number, amp: number, live: boolean): void {
    const gated = Math.max(0, (amp - MIC_FLOOR) / (1 - MIC_FLOOR));
    const drive = gated ** 0.6;
    const target = live ? Math.min(1, drive) : 0;
    const tau = target > this.mouth ? TAU_OPEN : live ? TAU_SHUT : TAU_REST;
    this.mouth += (target - this.mouth) * rate(dt, tau);
    if (this.mouth < 0.002) this.mouth = 0;
  }

  step(dtIn: number, inp: StepInput): void {
    const dt = clamp(dtIn, 0.001, 0.1);
    this.t += dt;
    const t = this.t;
    const amp = clamp(inp.amp, 0, 1);
    const live = inp.speaking && !inp.muted;

    const speed = (inp.muted ? 0.55 : 1) * (live ? 1.25 : 1);
    this.sway += dt * speed;
    const s = this.sway;
    this.yaw = 0.26 * Math.sin(s * 0.31) + 0.09 * Math.sin(s * 0.73 + 1.3);
    this.pitch = 0.06 * Math.sin(s * 0.23 + 0.7) + 0.024 * Math.sin(s * 0.61);

    this.mouthStep(dt, amp, live);

    this.emph += (this.mouth - this.emph) * rate(dt, this.mouth > this.emph ? 0.055 : 0.32);
    this.pitch -= this.emph * 0.028;
    this.yaw += 0.018 * Math.sin(t * 1.7) * this.emph;

    const env = live ? amp : 0;
    this.ampSlow += (env - this.ampSlow) * rate(dt, env > this.ampSlow ? 0.16 : 0.36);

    if (live) {
      if (t >= this.exprAt) {
        this.exprTgt = this.uniform(-0.35, 1.0);
        this.exprAt = t + 1.1 + 2.0 * this.rand();
      }
    } else {
      this.exprTgt = 0;
      this.exprAt = t + 0.8;
    }
    this.expr += (this.exprTgt - this.expr) * 0.075;

    const browT = 0.55 * this.ampSlow + 0.6 * this.expr + this.browBias;
    this.brow += (clamp(browT, -0.4, 1.2) - this.brow) * 0.2;

    const st = (inp.state || "").toUpperCase();
    const thinking = st === "THINKING" || st === "PROCESSING";
    const asleep = st === "SLEEPING" || st === "STANDBY" || st === "OFFLINE";
    let browBias: number;
    let lidTgt: number;
    if (thinking) {
      if (t >= this.biasAt) {
        this.biasTgt = [
          (this.rand() < 0.5 ? -1 : 1) * this.uniform(0.45, 0.8),
          this.uniform(0.25, 0.55),
        ];
        this.biasAt = t + 1.4 + 1.6 * this.rand();
      }
      browBias = -0.28;
      lidTgt = 0.94;
    } else if (asleep) {
      this.biasTgt = [0, -0.25];
      browBias = -0.05;
      lidTgt = 0.22;
    } else {
      this.biasTgt = [0, 0];
      this.biasAt = 0;
      browBias = st === "LISTENING" ? 0.1 : 0;
      lidTgt = 1;
    }
    for (const i of [0, 1]) this.gazeBias[i] += (this.biasTgt[i] - this.gazeBias[i]) * 0.06;
    this.lids += (lidTgt - this.lids) * 0.08;
    this.browBias += (browBias - this.browBias) * 0.06;

    if (t >= this.gazeAt) {
      const reach = live ? 0.9 : thinking ? 0.35 : 0.55;
      this.gazeTgt = [this.uniform(-1, 1) * reach, this.uniform(-1, 1) * reach * 0.55];
      if (live) this.gazeAt = t + 0.55 + 1.7 * this.rand();
      else if (thinking) this.gazeAt = t + 1.8 + 2.4 * this.rand();
      else this.gazeAt = t + 1.3 + 2.8 * this.rand();
    }
    for (const i of [0, 1]) {
      const tgt = clamp(this.gazeTgt[i] + this.gazeBias[i], -1, 1);
      this.gaze[i] += (tgt - this.gaze[i]) * 0.3;
    }

    const glowT = inp.muted ? 0 : amp;
    this.glow += (glowT - this.glow) * (glowT > this.glow ? 0.35 : 0.1);

    this.scan += dt * (0.55 + 1.5 * this.glow);
    if (this.scan > 1.35) this.scan = -1.75;

    if (this.blink > 0) {
      this.blink = Math.max(0, this.blink - dt * 8.5);
    } else if (t >= this.blinkAt) {
      if (asleep) {
        this.blinkAt = t + 6;
      } else {
        this.blink = 1;
        this.blinkAt = t + (thinking ? 5.5 : 3.4) + 3.1 * this.rand();
      }
    }
  }

  // ── pozlama: cene, kas, bas donusu (avatar.py _pose) ──
  private pose(): void {
    const { v, pn, m, n } = this;
    v.set(m.verts);
    if (this.brow > 0.004 || this.brow < -0.004) {
      const lift = this.brow * BROW_LIFT;
      for (let i = 0; i < n; i++) v[i * 3 + 1] += m.brow[i] * lift;
    }
    if (this.mouth > 0.004) {
      const [, py, pz] = m.jawPivot;
      for (let i = 0; i < n; i++) {
        const w = m.jaw[i];
        if (w === 0) continue;
        const ang = w * this.mouth * m.jawMax;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const dy = v[i * 3 + 1] - py;
        const dz = v[i * 3 + 2] - pz;
        v[i * 3 + 1] = py + dy * ca - dz * sa;
        v[i * 3 + 2] = pz + dy * sa + dz * ca;
      }
    }
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const r0 = [cy, 0, sy];
    const r1 = [sp * sy, cp, -sp * cy];
    const r2 = [-cp * sy, sp, cp * cy];
    for (let i = 0; i < n; i++) {
      const x = v[i * 3];
      const y = v[i * 3 + 1];
      const z = v[i * 3 + 2];
      v[i * 3] = r0[0] * x + r0[1] * y + r0[2] * z;
      v[i * 3 + 1] = r1[0] * x + r1[1] * y + r1[2] * z;
      v[i * 3 + 2] = r2[0] * x + r2[1] * y + r2[2] * z;
      const nx = m.normals[i * 3];
      const ny = m.normals[i * 3 + 1];
      const nz = m.normals[i * 3 + 2];
      pn[i * 3] = r0[0] * nx + r0[1] * ny + r0[2] * nz;
      pn[i * 3 + 1] = r1[0] * nx + r1[1] * ny + r1[2] * nz;
      pn[i * 3 + 2] = r2[0] * nx + r2[1] * ny + r2[2] * nz;
    }
  }

  /** Test icin: pozlanmis kose (x, y, z). */
  posedVertex(i: number): [number, number, number] {
    this.pose();
    return [this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]];
  }

  private surfaceLut(bg: RGB, primary: RGB): string[] {
    const key = `${bg.join(",")}|${primary.join(",")}`;
    if (key !== this.lutKey) {
      this.lut = Array.from({ length: LUT_N }, (_, i) =>
        blend(bg, primary, (255 * (i + 0.5)) / LUT_N),
      );
      this.lutKey = key;
    }
    return this.lut;
  }

  /** Yuzu (cx, cy) bas merkezinde cizer; r = basin yari yuksekligi (px).
   *  auraMax: halenin en fazla yaricapi (cizim alanindan tasip kare kenar olusturmasin). */
  paint(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    col: FaceColors,
    auraMax = Infinity,
  ): void {
    const { primary, accent, bg } = col;
    const amp = this.glow;
    this.pose();

    // aura
    const ar = Math.min(r * 1.95, auraMax);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, ar);
    g.addColorStop(0, rgba(primary, 34 + 66 * amp));
    g.addColorStop(0.38, rgba(primary, 20 + 40 * amp));
    g.addColorStop(1, rgba(primary, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, ar, 0, Math.PI * 2);
    ctx.fill();

    // izdusum
    const { v, xs, ys, n } = this;
    for (let i = 0; i < n; i++) {
      const w = Math.max(CAM_D - v[i * 3 + 2], 0.35);
      const k = (CAM_D / w) * r;
      xs[i] = cx + v[i * 3] * k;
      ys[i] = cy - v[i * 3 + 1] * k;
    }

    this.paintSurface(ctx, primary, bg, amp);
    this.paintWire(ctx, primary, bg, amp);
    this.paintFeatures(ctx, primary, accent, bg, amp);
  }

  private paintSurface(ctx: CanvasRenderingContext2D, primary: RGB, bg: RGB, amp: number): void {
    const { v, pn, xs, ys, m } = this;
    const f = m.faces;
    const nf = m.nFaces;
    const vis: number[] = [];
    const key = new Float32Array(nf);
    const shade = new Int16Array(nf);
    for (let t = 0; t < nf; t++) {
      const a = f[t * 3];
      const b = f[t * 3 + 1];
      const c = f[t * 3 + 2];
      const e1x = v[b * 3] - v[a * 3];
      const e1y = v[b * 3 + 1] - v[a * 3 + 1];
      const e1z = v[b * 3 + 2] - v[a * 3 + 2];
      const e2x = v[c * 3] - v[a * 3];
      const e2y = v[c * 3 + 1] - v[a * 3 + 1];
      const e2z = v[c * 3 + 2] - v[a * 3 + 2];
      let fx = e1y * e2z - e1z * e2y;
      let fy = e1z * e2x - e1x * e2z;
      let fz = e1x * e2y - e1y * e2x;
      const len = Math.max(Math.hypot(fx, fy, fz), 1e-9);
      fx /= len;
      fy /= len;
      fz /= len;
      // disariya yonlendir: koselerin (insa sirasinda yonlenmis) normalleriyle hemfikir olsun
      const rx = pn[a * 3] + pn[b * 3] + pn[c * 3];
      const ry = pn[a * 3 + 1] + pn[b * 3 + 1] + pn[c * 3 + 1];
      const rz = pn[a * 3 + 2] + pn[b * 3 + 2] + pn[c * 3 + 2];
      const sg = Math.sign(fx * rx + fy * ry + fz * rz);
      fx *= sg;
      fy *= sg;
      fz *= sg;
      const area = Math.abs(
        (xs[b] - xs[a]) * (ys[c] - ys[a]) - (xs[c] - xs[a]) * (ys[b] - ys[a]),
      );
      if (!(fz > 0.015 && area > 0.4)) continue;
      const fres = clamp(1 - fz, 0, 2) ** 1.7;
      const lam = clamp(fx * -0.55 + fy * 0.5 + fz * 0.52, 0, 1);
      let bright = 0.26 + 0.2 * fres + 0.66 * lam ** 1.05;
      bright *= (m.fade[a] + m.fade[b] + m.fade[c]) / 3;
      bright *= 0.88 + 0.24 * amp;
      shade[t] = clamp(Math.trunc(bright * LUT_N), 0, LUT_N - 1);
      key[t] = m.faceGroup[t] * 1000 + (v[a * 3 + 2] + v[b * 3 + 2] + v[c * 3 + 2]) / 3;
      vis.push(t);
    }
    vis.sort((p, q) => key[p] - key[q]); // uzaktan yakina; boyun bastan once
    const lut = this.surfaceLut(bg, primary);
    ctx.lineJoin = "round";
    ctx.lineWidth = 0.6; // komsu ucgenler arasindaki kil cizgisi bosluklarini kapatir
    for (const t of vis) {
      const a = f[t * 3];
      const b = f[t * 3 + 1];
      const c = f[t * 3 + 2];
      const color = lut[shade[t]];
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(xs[a], ys[a]);
      ctx.lineTo(xs[b], ys[b]);
      ctx.lineTo(xs[c], ys[c]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  private paintWire(ctx: CanvasRenderingContext2D, primary: RGB, bg: RGB, amp: number): void {
    const { v, pn, xs, ys, m, n } = this;
    const va = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const nz = pn[i * 3 + 2];
      const front = nz > -0.05 ? 1 : 0;
      const fres = Math.abs(1 - Math.abs(nz)) ** 1.5;
      let a = front ? 0.1 + 0.42 * fres : 0;
      a += 0.3 * Math.exp(-(((v[i * 3 + 1] - this.scan) / 0.13) ** 2)) * front;
      va[i] = a * m.fade[i] * (0.8 + 0.45 * amp);
    }
    const skin = blendRgb(bg, primary, 132);
    const ne = m.edges.length / 2;
    const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
    for (let e = 0; e < ne; e++) {
      const p = m.edges[e * 2];
      const q = m.edges[e * 2 + 1];
      const ea = 0.5 * (va[p] + va[q]);
      if (ea <= MIN_ALPHA) continue;
      buckets[clamp(Math.trunc(ea * BUCKETS), 0, BUCKETS - 1)].push(p, q);
    }
    ctx.lineWidth = 1;
    for (let b = 0; b < BUCKETS; b++) {
      const seg = buckets[b];
      if (!seg.length) continue;
      const a = 255 * Math.min(1, (b + 0.5) / BUCKETS);
      ctx.strokeStyle = blend(skin, primary, a * 0.75);
      ctx.beginPath();
      for (let i = 0; i < seg.length; i += 2) {
        ctx.moveTo(xs[seg[i]], ys[seg[i]]);
        ctx.lineTo(xs[seg[i + 1]], ys[seg[i + 1]]);
      }
      ctx.stroke();
    }
  }

  private ringPath(ctx: CanvasRenderingContext2D, idx: number[], close: boolean, ys2?: number[]) {
    ctx.beginPath();
    idx.forEach((k, j) => {
      const y = ys2 ? ys2[j] : this.ys[k];
      if (j === 0) ctx.moveTo(this.xs[k], y);
      else ctx.lineTo(this.xs[k], y);
    });
    if (close) ctx.closePath();
  }

  private paintFeatures(
    ctx: CanvasRenderingContext2D,
    primary: RGB,
    accent: RGB,
    bg: RGB,
    amp: number,
  ): void {
    const face = Math.max(0, Math.cos(this.yaw) * Math.cos(this.pitch)) ** 2;
    if (face < 0.02) return;
    const lm = this.m.landmarks;
    const { xs, ys } = this;
    // masaustuyle ayni: kapaklari yalnizca kirpma kapatir (lids hesaplanir ama cizimde kullanilmaz)
    const vis = 1 - this.blink;

    for (const key of ["eye_l", "eye_r"]) {
      const idx = lm[key];
      const midY = idx.reduce((s, k) => s + ys[k], 0) / idx.length;
      const ey = idx.map((k) => (vis < 0.999 ? midY + (ys[k] - midY) * Math.max(0.04, vis) : ys[k]));
      ctx.fillStyle = blend(bg, primary, 22); // goz cukuru golgesi
      this.ringPath(ctx, idx, true, ey);
      ctx.fill();
      ctx.strokeStyle = rgba(primary, 210 * face); // kapak cizgisi
      ctx.lineWidth = 1.3;
      ctx.stroke();
      if (vis > 0.35) {
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        idx.forEach((k, j) => {
          x0 = Math.min(x0, xs[k]);
          x1 = Math.max(x1, xs[k]);
          y0 = Math.min(y0, ey[j]);
          y1 = Math.max(y1, ey[j]);
        });
        const w = x1 - x0;
        const h = y1 - y0;
        const gx = (x0 + x1) / 2 + this.gaze[0] * w * 0.16;
        const gy = (y0 + y1) / 2 + this.gaze[1] * h * 0.2;
        const rad = Math.min(h * 0.62, w * 0.2);
        ctx.fillStyle = rgba(accent, (70 + 60 * amp) * face * vis); // iris
        ctx.beginPath();
        ctx.ellipse(gx, gy, Math.max(rad, 0.1), Math.max(rad * vis, 0.1), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(accent, 245 * face * vis); // gozbebegi
        ctx.beginPath();
        ctx.ellipse(gx, gy, Math.max(rad * 0.42, 0.1), Math.max(rad * 0.42 * vis, 0.1), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // kaslar
    ctx.strokeStyle = rgba(primary, 150 * face);
    ctx.lineWidth = 1.7;
    for (const key of ["brow_l", "brow_r"]) {
      this.ringPath(ctx, lm[key], false);
      ctx.stroke();
    }

    // agiz
    const inner = lm.lips_in;
    let iy0 = Infinity;
    let iy1 = -Infinity;
    for (const k of inner) {
      iy0 = Math.min(iy0, ys[k]);
      iy1 = Math.max(iy1, ys[k]);
    }
    const openH = iy1 - iy0;
    if (this.mouth > 0.02) {
      ctx.fillStyle = blend(bg, primary, 16 + 26 * this.mouth); // agiz bosluğu
      this.ringPath(ctx, inner, true);
      ctx.fill();
      // ust disler: ust dudaktan sarkan parlak serit
      const th = openH * 0.3;
      const up = this.lipUp;
      ctx.fillStyle = blend(bg, primary, 150 + 60 * this.mouth);
      ctx.beginPath();
      up.forEach((k, j) => (j === 0 ? ctx.moveTo(xs[k], ys[k]) : ctx.lineTo(xs[k], ys[k])));
      for (let j = up.length - 1; j >= 0; j--) ctx.lineTo(xs[up[j]], ys[up[j]] + th);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(accent, 40 * this.mouth * face); // bogaz ısıltısı
      this.ringPath(ctx, inner, true);
      ctx.fill();
    }
    ctx.strokeStyle = rgba(primary, (150 + 70 * this.mouth) * face); // dudak kenari
    ctx.lineWidth = 1.3;
    this.ringPath(ctx, inner, true);
    ctx.stroke();
    ctx.strokeStyle = rgba(primary, 110 * face);
    ctx.lineWidth = 1.1;
    this.ringPath(ctx, lm.lips_out, true);
    ctx.stroke();
  }
}

function blendRgb(bg: RGB, col: RGB, a: number): RGB {
  const f = clamp(a / 255, 0, 1);
  return [
    Math.trunc(bg[0] + (col[0] - bg[0]) * f),
    Math.trunc(bg[1] + (col[1] - bg[1]) * f),
    Math.trunc(bg[2] + (col[2] - bg[2]) * f),
  ];
}

/**
 * Konusma zarfi: PC'nin ses seviyesi yokken konusurken hece ritminde (yaklasik 4-6 hece/sn)
 * acilip kapanan, ara sira kisa duraklar veren 0..1 seviye uretir. Sessizken 0.
 */
export class KonusmaZarfi {
  private kalan = 0;
  private sure = 0.2;
  private tepe = 0;
  private readonly rand: Rand;

  constructor(rand: Rand = Math.random) {
    this.rand = rand;
  }

  next(dt: number, speaking: boolean): number {
    if (!speaking) {
      this.kalan = 0;
      return 0;
    }
    this.kalan -= dt;
    if (this.kalan <= 0) {
      if (this.rand() < 0.15) {
        this.sure = 0.15 + 0.25 * this.rand(); // kelime arasi durak
        this.tepe = 0;
      } else {
        this.sure = 0.12 + 0.16 * this.rand(); // bir hece
        this.tepe = 0.45 + 0.55 * this.rand();
      }
      this.kalan = this.sure;
    }
    const faz = clamp(1 - this.kalan / this.sure, 0, 1);
    return this.tepe * Math.sin(Math.PI * faz) ** 0.8;
  }
}
