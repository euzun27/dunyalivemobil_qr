import { describe, expect, it } from "vitest";
import { SozKesme, pcmSeviye } from "./sozKesme";

const yankida = (b: SozKesme, s: number, n = 30) => Array.from({ length: n }, () => b.feed(s));

describe("SozKesme", () => {
  it("telefonun yanki engeli acikken kullanici sesi keser", () => {
    const b = new SozKesme();
    expect(yankida(b, 0.03).some(Boolean)).toBe(false);
    const sonuc = [0.7, 0.9, 0.2, 0.6, 0.8, 0.7].map((s) => b.feed(s));
    expect(sonuc[5]).toBe(true);
    expect(sonuc.slice(0, 5).some(Boolean)).toBe(false);
  });

  it("yuksek yanki ve tek tik kesmez", () => {
    expect(yankida(new SozKesme(), 0.45, 60).some(Boolean)).toBe(false);
    const b = new SozKesme();
    yankida(b, 0.03);
    expect([1, 0.9, 0, 0, 0, 0, 0, 0].map((s) => b.feed(s)).some(Boolean)).toBe(false);
  });

  it("ilk parcalarda (yanki olculmeden) kesmez", () => {
    const b = new SozKesme();
    expect([1, 1, 1, 1, 1].map((s) => b.feed(s)).some(Boolean)).toBe(false);
  });

  it("seviye PC ile ayni olcekte", () => {
    expect(pcmSeviye(new Int16Array(1024))).toBe(0);
    expect(pcmSeviye(new Int16Array(1024).fill(12000))).toBe(1);
    expect(pcmSeviye(new Int16Array(1024).fill(1330))).toBeCloseTo(0.5, 2);
  });
});

describe("Kesilme", () => {
  it("klibi bir kez, sure boyunca oynatir", async () => {
    const { Kesilme } = await import("./sozKesme");
    const k = new Kesilme(2.6);
    expect(k.aktif(0)).toBe(false);
    k.basla(10);
    expect(k.aktif(12.5)).toBe(true);
    expect(k.aktif(12.7)).toBe(false);
    expect(k.aktif(12.8)).toBe(false);
  });
});
