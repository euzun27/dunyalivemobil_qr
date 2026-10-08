import { describe, expect, it } from "vitest";
// @ts-expect-error simplePc düz JS, tür bildirimi yok
import { sesKesMesaji } from "./simplePc.js";

describe("sesKesMesaji", () => {
  it("PC'nin kes mesajini tanir", () => {
    expect(sesKesMesaji('{"type":"kes"}')).toBe(true);
  });
  it("baska metinleri yok sayar", () => {
    expect(sesKesMesaji('{"type":"sys"}')).toBe(false);
    expect(sesKesMesaji("kes")).toBe(false);
    expect(sesKesMesaji("null")).toBe(false);
  });
});

describe("pcMesaji / iosMu", () => {
  it("merhaba mesajini okur", async () => {
    // @ts-expect-error simplePc düz JS, tür bildirimi yok
    const { pcMesaji } = await import("./simplePc.js");
    expect(pcMesaji('{"type":"merhaba","kes":true}')).toEqual({ type: "merhaba", kes: true });
    expect(pcMesaji("[1]")).toBe(null);
    expect(pcMesaji("bozuk")).toBe(null);
  });
  it("iPhone'u tanir, Android'i tanimaz", async () => {
    // @ts-expect-error simplePc düz JS, tür bildirimi yok
    const { iosMu } = await import("./simplePc.js");
    expect(iosMu("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(iosMu("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", { maxTouchPoints: 5 })).toBe(true);
    expect(iosMu("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", { maxTouchPoints: 0 })).toBe(false);
    expect(iosMu("Mozilla/5.0 (Linux; Android 14; SM-S918B) wv")).toBe(false);
  });
});
