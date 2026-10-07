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
