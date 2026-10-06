/**
 * DUNYATEK video avatari (telefon) - saf mantik.
 *
 * Masaustundeki core/video_avatar.py ile ayni davranis: bekleme / dusunme / konusma / kamera
 * klipleri, poz eslestirmeli ~0.4 sn yumusak gecisler. Telefonda klipleri <video>
 * oynatir; bu dosya yalnizca "ne zaman hangi klip, nasil karistir" kararini verir
 * (DOM'suz, test edilebilir).
 *
 * Pozlar (public/avatar/pozlar.json): her karede "referans -> kare" afin donusumu,
 * 360x540 olceginde.
 */

export type Klip = "bekleme" | "dusunme" | "konusma" | "kamera";
/** 2x3 afin donusum, satirlar: [[a, c, e], [b, d, f]]  (x' = a*x + c*y + e, y' = b*x + d*y + f) */
export type Afin = [[number, number, number], [number, number, number]];

export const FPS = 25;
export const GECIS_SN = 0.4;
export const POZ_GENISLIK = 360;
export const POZ_YUKSEKLIK = 540;

/** Konusma her zaman onde; sonra kamera bakisi (telefon kamerasi istendi), sonra dusunme. */
export function hedefKlip(status: string, muted = false, bakiyor = false): Klip {
  if (status === "speaking" && !muted) return "konusma";
  if (bakiyor) return "kamera";
  if (status === "thinking") return "dusunme";
  return "bekleme";
}

export function yumusak(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

export const BIRIM: Afin = [
  [1, 0, 0],
  [0, 1, 0],
];

function carp(p: Afin, q: Afin): Afin {
  // (p o q) 3x3 olarak
  return [
    [
      p[0][0] * q[0][0] + p[0][1] * q[1][0],
      p[0][0] * q[0][1] + p[0][1] * q[1][1],
      p[0][0] * q[0][2] + p[0][1] * q[1][2] + p[0][2],
    ],
    [
      p[1][0] * q[0][0] + p[1][1] * q[1][0],
      p[1][0] * q[0][1] + p[1][1] * q[1][1],
      p[1][0] * q[0][2] + p[1][1] * q[1][2] + p[1][2],
    ],
  ];
}

export function ters(m: Afin): Afin {
  const [[a, c, e], [b, d, f]] = m;
  const det = a * d - b * c;
  const k = Math.abs(det) < 1e-12 ? 0 : 1 / det;
  const ia = d * k, ic = -c * k, ib = -b * k, id = a * k;
  return [
    [ia, ic, -(ia * e + ic * f)],
    [ib, id, -(ib * e + id * f)],
  ];
}

/** B karesini A'nin bas pozuna oturtan ornekleme matrisi: Wb o Wa^-1. */
export function esle(wa: Afin, wb: Afin): Afin {
  return carp(wb, ters(wa));
}

/** Ornekleme matrisi M'yi gecis ilerledikce (a: 0 -> 1) birim matrise yaklastirir. */
export function karisikMatris(m: Afin, a: number): Afin {
  const t = Math.min(1, Math.max(0, a));
  return [
    [m[0][0] + (1 - m[0][0]) * t, m[0][1] * (1 - t), m[0][2] * (1 - t)],
    [m[1][0] * (1 - t), m[1][1] + (1 - m[1][1]) * t, m[1][2] * (1 - t)],
  ];
}

/** Bir klipte saniyeye karsilik gelen kare (poz dizisinin sinirlari icinde). */
export function kareNo(zaman: number, uzunluk: number): number {
  return Math.min(Math.max(0, uzunluk - 1), Math.max(0, Math.floor(zaman * FPS)));
}

export interface SlotDurum {
  klip: Klip | null;
  zaman: number; // saniye
  sure: number; // saniye (bilinmiyorsa 0)
  hazir: boolean; // ilk kare cizilebilir mi
}

export interface Eylem {
  /** Bu slota bu klibi bastan yukle ve oynat. */
  baslat?: { slot: number; klip: Klip };
  /** Gecis bitti: bu slot artik kullanilmiyor, durdurulabilir. */
  durdur?: number;
  /** Gecis suruyor: yeni slotun karisim orani (0..1); null = gecis yok. */
  karisim: number | null;
}

/** Iki <video> slotu ile kesintisiz gecis: biri gorunurken digeri hazirlanir. */
export class GecisYoneticisi {
  aktif = 0;
  private gecisBas: number | null = null;
  private bekleyen: Klip | null = null;
  constructor(readonly gecisSn = GECIS_SN) {}

  get gelen(): number {
    return 1 - this.aktif;
  }

  adim(simdi: number, hedef: Klip, slotlar: [SlotDurum, SlotDurum]): Eylem {
    if (this.gecisBas !== null) {
      const t = (simdi - this.gecisBas) / this.gecisSn;
      if (t >= 1) {
        const eski = this.aktif;
        this.aktif = this.gelen;
        this.gecisBas = null;
        return { durdur: eski, karisim: null };
      }
      return { karisim: yumusak(t) };
    }
    const a = slotlar[this.aktif];
    const sonaYakin = a.sure > 0 && a.sure - a.zaman < this.gecisSn + 0.05;
    const gerekli = a.klip === null ? true : hedef !== a.klip || sonaYakin;
    if (this.bekleyen !== null) {
      if (hedef === a.klip && !sonaYakin) {
        // hazirlanan klibe artik gerek yok (or. cok kisa bir cevap bitti): iptal
        this.bekleyen = null;
        return { durdur: this.gelen, karisim: null };
      }
      if (this.bekleyen !== hedef && hedef !== a.klip) {
        this.bekleyen = hedef; // hazirlanirken hedef degisti: yenisini iste
        return { baslat: { slot: this.gelen, klip: hedef }, karisim: null };
      }
      const g = slotlar[this.gelen];
      if (g.hazir && g.klip === this.bekleyen) {
        this.bekleyen = null;
        if (a.klip === null) {
          // ilk acilis: gecis yok, dogrudan goster
          this.aktif = this.gelen;
          return { karisim: null };
        }
        this.gecisBas = simdi;
        return { karisim: 0 };
      }
      return { karisim: null };
    }
    if (gerekli) {
      this.bekleyen = hedef;
      return { baslat: { slot: this.gelen, klip: hedef }, karisim: null };
    }
    return { karisim: null };
  }
}
