import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error simpleStore düz JS, tür bildirimi yok
import { simplePcStore } from "./simpleStore";

describe("simplePcStore.pair", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("eşleşme başarısızsa hatanın ayrıntısını gösterir", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Load failed"))));
    const ok = await simplePcStore.pair({
      host: "192.168.1.45",
      port: 8002,
      secure: false,
      key: "ABC123",
      extraHosts: ["100.118.18.114"],
    });
    expect(ok).toBe(false);
    expect(simplePcStore.getSnapshot().lastError).toBe("192.168.1.45: Load failed");
  });
});

describe("simplePcStore.pair — yeni bilgisayara geçiş", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("farklı bir PC'nin QR'ı okununca eşleşme başarısız olsa bile eski PC'ye geri dönmez", async () => {
    // Telefon daha önce .45 (canlı PC) ile eşleşmiş; kayıt localStorage'da duruyor.
    const kayit = {
      "dunyatek_simple_pc_v1": JSON.stringify({
        host: "192.168.1.45",
        port: 8002,
        secure: false,
        hosts: ["192.168.1.45", "100.118.18.114"],
        deviceToken: "eski-token",
      }),
    } as Record<string, string | null>;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => kayit[k] ?? null,
      setItem: (k: string, v: string) => {
        kayit[k] = v;
      },
      removeItem: (k: string) => {
        kayit[k] = null;
      },
    });
    // Yeni PC yanıt veriyor (reachability GET fulfill olur) ama /login POST başarısız
    // (ör. anahtar süresi dolmuş): res.ok = false.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) })),
    );
    vi.resetModules();
    // @ts-expect-error simpleStore düz JS, tür bildirimi yok
    const { simplePcStore: store } = await import("./simpleStore");
    expect(store.paired).toBe(true); // başta .45 eşleşmiş

    const ok = await store.pair({
      host: "192.168.1.106", // yeni PC — farklı bilgisayar
      port: 8002,
      secure: false,
      key: "YENIKEY",
      extraHosts: ["100.67.85.92"],
    });

    expect(ok).toBe(false);
    // Kritik: eski .45 eşleşmesi silindi; arka plan artık sessizce oraya bağlanmayacak.
    expect(store.getSnapshot().config).toBe(null);
    expect(store.paired).toBe(false);
  });
});
