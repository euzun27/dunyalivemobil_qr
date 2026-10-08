/** QR tarama (QrScanner.jsx) icin yardimcilar - DOM'suz, test edilebilir. */

/** jsQR'a verilecek kare boyutu: uzun kenar en fazla `enFazla` piksel (QR icin yeterli, hizli). */
export function qrTaramaBoyutu(w: number, h: number, enFazla = 640): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const k = Math.min(1, enFazla / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
