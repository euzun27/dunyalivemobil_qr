/**
 * Telefonda soz kesme: DUNYATEK telefonda konusurken kullanici araya girerse telefon
 * PC'yi beklemeden kendi sesini susturur (uzaktan baglantida gidis-donus gecikmesi
 * olmadan) ve PC'ye {"type":"kes"} gonderir.
 *
 * Karar PC'deki core/echo.py BargeIn ile ayni: asistan konusurken mikrofonun tipik
 * (medyan) seviyesi olculur; kullanicinin sesi bunun 2 kati ve en az 0.30 ise oy verir,
 * son 8 parcada (64 ms'lik) 5 oy olunca keser.
 */

export const LOUD_MIN = 0.3;
export const LOUD_RATIO = 2.0;
export const PENCERE = 8;
export const OY = 5;
const GECMIS = 48;
const LEVEL_FLOOR = 60;
const LEVEL_FULL = 2600;

/** 16-bit PCM parcasinin 0..1 seviyesi (PC'deki _pcm_level ile ayni olcek). */
export function pcmSeviye(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let t = 0;
  for (let i = 0; i < pcm.length; i++) t += pcm[i] * pcm[i];
  const rms = Math.sqrt(t / pcm.length);
  if (rms <= LEVEL_FLOOR) return 0;
  return Math.min(1, (rms - LEVEL_FLOOR) / (LEVEL_FULL - LEVEL_FLOOR));
}

function medyan(d: number[]): number {
  const s = [...d].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class SozKesme {
  private oylar: boolean[] = [];
  private seviyeler: number[] = [];

  /** Asistan konusmuyor: oylari sil (odanin yanki seviyesi bilgisi kalir). */
  reset(): void {
    this.oylar = [];
  }

  /** Asistan konusurken her mikrofon parcasi icin; true donerse ses kesilmeli. */
  feed(seviye: number): boolean {
    const beklenen = this.seviyeler.length >= 6 ? medyan(this.seviyeler) : 0;
    const oy =
      this.seviyeler.length >= 6 && seviye >= LOUD_MIN && seviye >= beklenen * LOUD_RATIO;
    this.oylar = [...this.oylar, oy].slice(-PENCERE);
    // Kullanicinin kendi sesi yanki olcumunu sisirmesin.
    if (!oy) this.seviyeler = [...this.seviyeler, seviye].slice(-GECMIS);
    if (this.oylar.filter(Boolean).length >= OY) {
      this.oylar = [];
      return true;
    }
    return false;
  }
}
