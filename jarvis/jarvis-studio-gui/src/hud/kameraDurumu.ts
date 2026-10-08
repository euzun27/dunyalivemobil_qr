/**
 * DUNYATEK - telefon kamerasi ile avatar arasindaki ortak durum.
 *
 * PC "telefonun kamerasina bak" dediginde (phoneCamera.ts) avatar kamera klibini oynatir
 * ve HUD'un ustunde kamera katmani acilir: cekim sirasinda canli goruntu, kare alininca o
 * fotograf, en ustte kucuk avatar. Katman cevap bitince (ya da BAKIS_AZAMI_SN dolunca) kapanir.
 * Masaustundeki core/video_avatar.py Bakis sinifinin aynisi. DOM'suz, test edilebilir.
 */

export const BAKIS_AZAMI_SN = 20;

/** basla() ile acilir; susmus -> konusmus -> yeniden susmus olunca ya da azami sure dolunca kapanir. */
export class Bakis {
  t0: number | null = null;
  private sustu = false;
  private konustu = false;
  constructor(readonly azamiSn = BAKIS_AZAMI_SN) {}

  basla(simdi: number): void {
    this.t0 = simdi;
    this.sustu = false;
    this.konustu = false;
  }

  bitir(): void {
    this.t0 = null;
  }

  aktif(simdi: number, konusuyor: boolean): boolean {
    if (this.t0 === null) return false;
    if (konusuyor) {
      if (this.sustu) this.konustu = true;
    } else if (this.konustu) {
      this.t0 = null;
      return false;
    } else {
      this.sustu = true;
    }
    if (simdi - this.t0 > this.azamiSn) {
      this.t0 = null;
      return false;
    }
    return true;
  }
}

export interface KameraDurumu {
  akis: MediaStream | null; // cekim suruyor: canli goruntu
  foto: string | null; // cekilen kare (data URL)
}

export const bakis = new Bakis();
let durum: KameraDurumu = { akis: null, foto: null };
const dinleyiciler = new Set<() => void>();

const simdiSn = () => Date.now() / 1000;

function yay(yeni: Partial<KameraDurumu>): void {
  durum = { ...durum, ...yeni };
  dinleyiciler.forEach((f) => f());
}

/** PC'den kamera istegi geldi: avatar kamera klibine gecer. */
export function bakisBasla(simdi = simdiSn()): void {
  bakis.basla(simdi);
  yay({ akis: null, foto: null });
}

export function akisAcildi(akis: MediaStream): void {
  yay({ akis });
}

export function kareAlindi(foto: string): void {
  yay({ akis: null, foto });
}

/** Cekim basarisiz ya da katman kapandi. */
export function kameraKapandi(): void {
  if (durum.akis || durum.foto) yay({ akis: null, foto: null });
}

export function abone(f: () => void): () => void {
  dinleyiciler.add(f);
  return () => {
    dinleyiciler.delete(f);
  };
}

export function anlik(): KameraDurumu {
  return durum;
}
