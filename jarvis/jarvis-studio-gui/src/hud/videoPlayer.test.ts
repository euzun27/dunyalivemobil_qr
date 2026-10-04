import { describe, it, expect } from "vitest";
import {
  BIRIM,
  GECIS_SN,
  GecisYoneticisi,
  esle,
  hedefKlip,
  karisikMatris,
  kareNo,
  ters,
  yumusak,
  type Afin,
  type Klip,
  type SlotDurum,
} from "./videoPlayer";

const yakin = (a: Afin, b: Afin) =>
  a.every((r, i) => r.every((v, j) => Math.abs(v - b[i][j]) < 1e-6));

describe("yardimcilar", () => {
  it("hedefKlip", () => {
    expect(hedefKlip("speaking")).toBe("konusma");
    expect(hedefKlip("speaking", true)).toBe("bekleme");
    expect(hedefKlip("thinking")).toBe("dusunme");
    expect(hedefKlip("listening")).toBe("bekleme");
    expect(hedefKlip("idle")).toBe("bekleme");
  });

  it("yumusak", () => {
    expect(yumusak(0)).toBe(0);
    expect(Math.abs(yumusak(1) - 1) < 1e-12).toBe(true);
    expect(yumusak(-1)).toBe(0);
  });

  it("ters ve esle", () => {
    const A: Afin = [
      [1.02, 0.01, 3],
      [-0.01, 1.02, -5],
    ];
    expect(yakin(esle(A, A), BIRIM)).toBe(true);
    expect(yakin(esle(BIRIM, A), A)).toBe(true);
    const I = esle(ters(A), ters(A));
    expect(yakin(I, BIRIM)).toBe(true);
  });

  it("karisikMatris uclarda dogru", () => {
    const M: Afin = [
      [1.1, 0.2, 7],
      [0.1, 0.9, -4],
    ];
    expect(yakin(karisikMatris(M, 0), M)).toBe(true);
    expect(yakin(karisikMatris(M, 1), BIRIM)).toBe(true);
  });

  it("kareNo sinirlar icinde", () => {
    expect(kareNo(0, 75)).toBe(0);
    expect(kareNo(1, 75)).toBe(25);
    expect(kareNo(99, 75)).toBe(74);
    expect(kareNo(-1, 75)).toBe(0);
  });
});

/** Sahte iki slot: baslat edilen klip `hazirlik` sn sonra hazir olur, sonra oynar. */
function simulasyon(sureler: Record<Klip, number>, hazirlik = 0.1) {
  const yon = new GecisYoneticisi();
  const slot = [0, 1].map(() => ({ klip: null as Klip | null, bas: 0 }));
  let t = 0;
  const durum = (i: number, simdi: number): SlotDurum => {
    const s = slot[i];
    const z = s.klip ? Math.max(0, simdi - s.bas - hazirlik) : 0;
    return { klip: s.klip, zaman: z, sure: s.klip ? sureler[s.klip] : 0, hazir: !!s.klip && simdi - s.bas >= hazirlik };
  };
  const log: string[] = [];
  const ilerle = (sn: number, hedef: Klip) => {
    for (let k = 0; k < Math.round(sn * 30); k++) {
      t += 1 / 30;
      const e = yon.adim(t, hedef, [durum(0, t), durum(1, t)]);
      if (e.baslat) {
        slot[e.baslat.slot] = { klip: e.baslat.klip, bas: t };
        log.push(`baslat:${e.baslat.klip}`);
      }
      if (e.durdur !== undefined) log.push(`bitti`);
    }
  };
  const gorunen = () => slot[yon.aktif].klip;
  return { yon, ilerle, gorunen, log };
}

describe("GecisYoneticisi", () => {
  const sureler = { bekleme: 3, dusunme: 5, konusma: 11.9 };

  it("ilk acilista gecissiz baslar, durum degisince gecis yapar", () => {
    const s = simulasyon(sureler);
    s.ilerle(0.5, "bekleme");
    expect(s.gorunen()).toBe("bekleme");
    expect(s.log).toEqual(["baslat:bekleme"]); // ilk acilis: "bitti" yok
    s.ilerle(1, "konusma");
    expect(s.gorunen()).toBe("konusma");
    expect(s.log.slice(1)).toEqual(["baslat:konusma", "bitti"]);
  });

  it("gecis yaklasik GECIS_SN surer ve karisim yalnizca artar", () => {
    const yon = new GecisYoneticisi();
    const hazir = (k: Klip): SlotDurum => ({ klip: k, zaman: 0.5, sure: 5, hazir: true });
    // ilk acilis
    yon.adim(0, "bekleme", [hazir("bekleme"), hazir("bekleme")]);
    yon.adim(0.03, "bekleme", [hazir("bekleme"), hazir("bekleme")]);
    const a = yon.aktif;
    const slots = (): [SlotDurum, SlotDurum] =>
      a === 0 ? [hazir("bekleme"), hazir("konusma")] : [hazir("konusma"), hazir("bekleme")];
    expect(yon.adim(1, "konusma", slots()).baslat?.klip).toBe("konusma");
    const k: number[] = [];
    for (let t = 1.03; t < 1.03 + GECIS_SN + 0.1; t += 1 / 30) {
      const e = yon.adim(t, "konusma", slots());
      if (e.karisim !== null) k.push(e.karisim);
      if (e.durdur !== undefined) break;
    }
    expect(k.length).toBeGreaterThan(8);
    expect(k.every((v, i) => i === 0 || v >= k[i - 1])).toBe(true);
  });

  it("klip sonunda kendi basina doner (dongu)", () => {
    const s = simulasyon(sureler);
    s.ilerle(0.5, "bekleme");
    s.ilerle(3.2, "bekleme"); // 3 sn'lik klibin sonu
    expect(s.log.filter((x) => x === "baslat:bekleme").length).toBe(2);
    expect(s.gorunen()).toBe("bekleme");
  });

  it("hazirlanan klibe gerek kalmazsa iptal edilir (kisa cevap)", () => {
    const s = simulasyon(sureler, 0.3); // yavas hazirlanan video
    s.ilerle(0.6, "bekleme");
    s.ilerle(0.1, "konusma"); // konusma istendi, henuz hazir degil
    s.ilerle(1, "bekleme"); // cevap bitti
    expect(s.gorunen()).toBe("bekleme");
    expect(s.log).toContain("bitti"); // gelen slot durduruldu
    expect(s.log.filter((x) => x === "baslat:konusma").length).toBe(1);
  });
});
