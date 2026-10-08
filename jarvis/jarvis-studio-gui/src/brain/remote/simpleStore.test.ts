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
