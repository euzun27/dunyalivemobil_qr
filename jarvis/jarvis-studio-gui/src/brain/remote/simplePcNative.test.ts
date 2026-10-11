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
  let depo: Record<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { userAgent: IPHONE, maxTouchPoints: 5 });
    depo = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => depo[k] ?? null,
      setItem: (k: string, v: string) => {
        depo[k] = v;
      },
      removeItem: (k: string) => {
        delete depo[k];
      },
    });
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

  it("soket acilmazsa 10 sn sonra nedeniyle vazgecer", async () => {
    durum = { ...durum, open: false };
    const c = await istemci();
    const p = c.startVoice();
    const beklenti = expect(p).rejects.toThrow("10 sn");
    await vi.advanceTimersByTimeAsync(10500);
    await beklenti;
    expect(c.voiceActive).toBe(false);
  });

  it("acilmadan kapanirsa yerel motorun nedenini gosterir", async () => {
    durum = { ...durum, open: false, closed: true, error: "Bağlantı kurulamadı: zaman aşımı" };
    const c = await istemci();
    const p = c.startVoice();
    const beklenti = expect(p).rejects.toThrow("Bağlantı kurulamadı: zaman aşımı");
    await vi.advanceTimersByTimeAsync(300);
    await beklenti;
  });

  it("duzgun hatada cokme isareti kalmaz", async () => {
    durum = { ...durum, open: false, closed: true, error: "x" };
    const c = await istemci();
    const p = c.startVoice();
    const b = expect(p).rejects.toThrow("x");
    await vi.advanceTimersByTimeAsync(300);
    await b;
    expect(depo.dunyatek_yerel_ses_deneniyor).toBeUndefined();
  });

  it("motor baslamazsa nedenini gosterir", async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === "plugin:phone|voice_start"
        ? { ok: false, summary: "Ses başlatılamadı: -10875" }
        : { ok: true },
    );
    const c = await istemci();
    await expect(c.startVoice()).rejects.toThrow("-10875");
  });

  it("izin hatasini web yoluna dusmeden gosterir", async () => {
    invokeMock.mockImplementation(async () => {
      throw "phone.voice_start not allowed. Permissions associated with this command: phone:allow-voice-start";
    });
    const c = await istemci();
    await expect(c.startVoice()).rejects.toThrow("not allowed");
  });

  it("15 sn sorunsuz calisinca cokme isaretini kaldirir", async () => {
    const c = await istemci();
    const p = c.startVoice();
    await vi.advanceTimersByTimeAsync(250);
    expect(await p).toBe(true);
    expect(depo.dunyatek_yerel_ses_deneniyor).toBeTruthy();
    await vi.advanceTimersByTimeAsync(15000);
    expect(depo.dunyatek_yerel_ses_deneniyor).toBeUndefined();
  });

  it("onceki acilista motor uygulamayi kapattiysa web yoluna duser", async () => {
    depo.dunyatek_yerel_ses_deneniyor = "1"; // cokmeden once konan isaret kalmis
    const gum = vi.fn(async () => {
      throw new Error("web yolu");
    });
    vi.stubGlobal("navigator", {
      userAgent: IPHONE,
      maxTouchPoints: 5,
      mediaDevices: { getUserMedia: gum },
    });
    const c = await istemci();
    await expect(c.startVoice()).rejects.toThrow("web yolu");
    expect(invokeMock).not.toHaveBeenCalledWith("plugin:phone|voice_start", expect.anything());
    expect(depo.dunyatek_yerel_ses_coktu_2).toBeTruthy();
  });
});
