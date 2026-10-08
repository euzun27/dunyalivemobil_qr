import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  Bakis,
  abone,
  akisAcildi,
  anlik,
  bakis,
  bakisBasla,
  kameraKapandi,
  kareAlindi,
} from "./kameraDurumu";

describe("Bakis (masaustundeki video_avatar.Bakis ile ayni)", () => {
  it("cevap konusulup bitince kapanir", () => {
    const b = new Bakis(20);
    expect(b.aktif(0, false)).toBe(false);
    b.basla(0);
    expect(b.aktif(1, false)).toBe(true);
    expect(b.aktif(2, true)).toBe(true);
    expect(b.aktif(3, false)).toBe(false);
    expect(b.aktif(4, false)).toBe(false);
  });

  it("cagri aninda suren konusma sayilmaz", () => {
    const b = new Bakis(20);
    b.basla(0);
    expect(b.aktif(0.1, true)).toBe(true);
    expect(b.aktif(0.5, false)).toBe(true);
    expect(b.aktif(2, true)).toBe(true);
    expect(b.aktif(3, false)).toBe(false);
  });

  it("zaman asimi ve bitir", () => {
    const b = new Bakis(5);
    b.basla(0);
    expect(b.aktif(4, false)).toBe(true);
    expect(b.aktif(6, false)).toBe(false);
    b.basla(10);
    b.bitir();
    expect(b.aktif(10.5, false)).toBe(false);
  });
});

describe("ortak kamera durumu", () => {
  it("akis -> foto -> kapanir; dinleyiciler haberdar olur", () => {
    let n = 0;
    const birak = abone(() => n++);
    bakisBasla(100);
    expect(bakis.aktif(100.1, false)).toBe(true);
    const akis = {} as MediaStream;
    akisAcildi(akis);
    expect(anlik().akis).toBe(akis);
    kareAlindi("data:image/jpeg;base64,QQ==");
    expect(anlik()).toEqual({ akis: null, foto: "data:image/jpeg;base64,QQ==" });
    kameraKapandi();
    expect(anlik()).toEqual({ akis: null, foto: null });
    birak();
    const once = n;
    kareAlindi("x");
    expect(n).toBe(once);
    kameraKapandi();
    bakis.bitir();
  });
});

describe("kamera klibi telefon paketinde", () => {
  it("pozlar.json kamera klibini iceriyor ve dosyasi var", () => {
    const kok = resolve(__dirname, "../../public/avatar");
    const meta = JSON.parse(readFileSync(resolve(kok, "pozlar.json"), "utf-8"));
    expect(Object.keys(meta.klipler).sort()).toEqual([
      "bekleme",
      "dusunme",
      "kamera",
      "konusma",
      "sozkesme",
    ]);
    expect(meta.klipler.kamera.poz.length).toBe(240);
    expect(existsSync(resolve(kok, meta.klipler.kamera.dosya))).toBe(true);
    // soz kesilince oynayan klip (74 kare, ~3 sn)
    expect(meta.klipler.sozkesme.poz.length).toBe(74);
    expect(existsSync(resolve(kok, meta.klipler.sozkesme.dosya))).toBe(true);
  });
});
