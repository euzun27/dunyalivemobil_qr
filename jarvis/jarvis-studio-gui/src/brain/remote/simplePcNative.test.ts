import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";

async function istemci() {
  // @ts-expect-error simplePc düz JS, tür bildirimi yok
  const { SimplePC } = await import("./simplePc.js");
  const c = new SimplePC({ host: "100.64.0.1" });
  c.token = "a b";
  return c;
}

describe("iPhone yerel ses motoru", () => {
  let durum: Record<string, unknown>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { userAgent: IPHONE, maxTouchPoints: 5 });
    durum = {
      open: true,
      closed: false,
      gotAudio: false,
      playing: false,
      mic: 0.2,
      out: 0,
      sinceSentMs: 50,
      kesSeq: 0,
    };
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "plugin:phone|voice_start") return { ok: true, summary: "started" };
      if (cmd === "plugin:phone|voice_poll") return durum;
      return { ok: true };
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sesi yerel motorda baslatir, durumu sorar, kapaninca bitirir", async () => {
    const c = await istemci();
    const onEnd = vi.fn();
    const p = c.startVoice(onEnd);
    await vi.advanceTimersByTimeAsync(250);
    expect(await p).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("plugin:phone|voice_start", {
      url: "ws://100.64.0.1:8002/ws/phone-audio?token=a%20b&speaker=1",
    });
    expect(c.voiceHealthy()).toBe(true);
    expect(c.playing()).toBe(null); // PC'den henuz ses gelmedi
    expect(c.levels()).toEqual({ mic: 0.2, out: 0 });

    durum = { ...durum, gotAudio: true, playing: true, out: 0.5 };
    await vi.advanceTimersByTimeAsync(150);
    expect(c.playing()).toBe(true);
    expect(c.levels().out).toBe(0.5);

    durum = { ...durum, sinceSentMs: 5000 };
    await vi.advanceTimersByTimeAsync(150);
    expect(c.voiceHealthy()).toBe(false); // mikrofon sesi gitmiyor: yeniden baslatilir

    durum = { ...durum, open: false, closed: true };
    await vi.advanceTimersByTimeAsync(150);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(c.voiceActive).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("plugin:phone|voice_stop");
  });

  it("komut yoksa (eski surum) web yoluna duser", async () => {
    invokeMock.mockImplementation(async () => {
      throw new Error("No command voiceStart found");
    });
    const c = await istemci();
    const gum = vi.fn(async () => {
      throw new Error("web yolu");
    });
    vi.stubGlobal("navigator", {
      userAgent: IPHONE,
      maxTouchPoints: 5,
      mediaDevices: { getUserMedia: gum },
    });
    await expect(c.startVoice()).rejects.toThrow("web yolu");
    expect(gum).toHaveBeenCalled();
  });

  it("soket acilmazsa 10 sn sonra vazgecer", async () => {
    durum = { ...durum, open: false };
    const c = await istemci();
    const p = c.startVoice();
    await vi.advanceTimersByTimeAsync(10500);
    expect(await p).toBe(false);
    expect(c.voiceActive).toBe(false);
  });
});
