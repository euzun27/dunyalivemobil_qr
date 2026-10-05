import { describe, it, expect } from "vitest";
import {
  INDICATOR_TEXT,
  captureFrame,
  errorMessage,
  fitSize,
  handleCameraRequest,
  splitDataUrl,
  type CameraResult,
  type Frame,
} from "./phoneCamera";

// ── sahte DOM ve kamera ──
function fakeEnv(opts: { fail?: string; w?: number; h?: number } = {}) {
  const body: unknown[] = [];
  const stopped: string[] = [];
  const el = (tag: string) => {
    const node: Record<string, unknown> = {
      tag,
      style: {},
      setAttribute: () => {},
      remove: () => body.splice(body.indexOf(node), 1),
    };
    if (tag === "video") {
      Object.assign(node, { play: async () => {}, videoWidth: opts.w ?? 1920, videoHeight: opts.h ?? 1080 });
    }
    if (tag === "canvas") {
      Object.assign(node, {
        getContext: () => ({ drawImage: () => {} }),
        toDataURL: (t: string) => `data:${t};base64,QUJD`,
      });
    }
    return node;
  };
  const doc = {
    createElement: el,
    body: { appendChild: (n: unknown) => body.push(n) },
  } as unknown as Document;
  const md = {
    getUserMedia: async () => {
      if (opts.fail) throw Object.assign(new Error("x"), { name: opts.fail });
      return { getTracks: () => [{ stop: () => stopped.push("video") }] };
    },
  } as unknown as MediaDevices;
  return { doc, md, body, stopped };
}

describe("yardimcilar", () => {
  it("fitSize uzun kenari sinirlar, orani korur, kucugu buyutmez", () => {
    expect(fitSize(1920, 1080)).toEqual({ w: 1280, h: 720 });
    expect(fitSize(1080, 1920)).toEqual({ w: 720, h: 1280 });
    expect(fitSize(640, 480)).toEqual({ w: 640, h: 480 });
    expect(fitSize(0, 480)).toEqual({ w: 0, h: 0 });
  });

  it("splitDataUrl", () => {
    expect(splitDataUrl("data:image/jpeg;base64,QUJD")).toEqual({ mime: "image/jpeg", data: "QUJD" });
    expect(splitDataUrl("data:,")).toBe(null);
  });

  it("errorMessage Turkce nedenler", () => {
    expect(errorMessage({ name: "NotAllowedError" })).toBe("Kamera izni verilmedi.");
    expect(errorMessage({ name: "NotFoundError" })).toBe("Telefonda kamera bulunamadı.");
    expect(errorMessage(null)).toBe("Kare çekilemedi.");
  });
});

describe("captureFrame", () => {
  it("tek kare ceker, kamerayi kapatir, uyariyi kaldirir", async () => {
    const env = fakeEnv();
    let uyariVardi = false;
    const md = {
      getUserMedia: async (c: MediaStreamConstraints) => {
        uyariVardi = env.body.length === 1;
        expect((c.video as MediaTrackConstraints).facingMode).toEqual({ ideal: "environment" });
        return env.md.getUserMedia(c);
      },
    } as unknown as MediaDevices;
    const f = await captureFrame(md, env.doc);
    expect(f).toEqual({ mime: "image/jpeg", data: "QUJD" });
    expect(uyariVardi).toBe(true);
    expect(env.body.length).toBe(0);
    expect(env.stopped).toEqual(["video"]);
  });

  it("izin yoksa hata verir ama uyari yine kalkar", async () => {
    const env = fakeEnv({ fail: "NotAllowedError" });
    let hata: unknown = null;
    try {
      await captureFrame(env.md, env.doc);
    } catch (e) {
      hata = e;
    }
    expect(errorMessage(hata)).toBe("Kamera izni verilmedi.");
    expect(env.body.length).toBe(0);
  });

  it("goruntu bossa kamera yine kapanir", async () => {
    const env = fakeEnv({ w: 0, h: 0 });
    let hata = false;
    try {
      await captureFrame(env.md, env.doc);
    } catch {
      hata = true;
    }
    expect(hata).toBe(true);
    expect(env.stopped).toEqual(["video"]);
    expect(env.body.length).toBe(0);
  });
});

describe("handleCameraRequest", () => {
  const ok = async (): Promise<Frame> => ({ mime: "image/jpeg", data: "QUJD" });

  it("basarili cevap ayni id ile doner", async () => {
    const giden: CameraResult[] = [];
    await handleCameraRequest({ type: "camera_capture", id: "a1" }, (r) => giden.push(r), ok);
    expect(giden).toEqual([{ type: "camera_result", id: "a1", ok: true, mime: "image/jpeg", data: "QUJD" }]);
  });

  it("hata ve zaman asimi ok:false ve neden ile doner", async () => {
    const giden: CameraResult[] = [];
    const izinsiz = async (): Promise<Frame> => {
      throw Object.assign(new Error("x"), { name: "NotAllowedError" });
    };
    await handleCameraRequest({ type: "camera_capture", id: "b" }, (r) => giden.push(r), izinsiz);
    const asili = () => new Promise<Frame>(() => {});
    await handleCameraRequest({ type: "camera_capture", id: "c" }, (r) => giden.push(r), asili, 20);
    expect(giden.map((r) => (r.ok ? "ok" : r.summary))).toEqual([
      "Kamera izni verilmedi.",
      "Kamera zamanında açılamadı.",
    ]);
  });

  it("ayni anda ikinci istek mesgul cevabi alir", async () => {
    const giden: CameraResult[] = [];
    let bitir: (f: Frame) => void = () => {};
    const yavas = () => new Promise<Frame>((r) => (bitir = r));
    const ilk = handleCameraRequest({ type: "camera_capture", id: "1" }, (r) => giden.push(r), yavas);
    await handleCameraRequest({ type: "camera_capture", id: "2" }, (r) => giden.push(r), ok);
    bitir({ mime: "image/jpeg", data: "QUJD" });
    await ilk;
    expect(giden.map((r) => `${r.id}:${r.ok ? "ok" : r.summary}`)).toEqual([
      "2:Kamera şu an meşgul.",
      "1:ok",
    ]);
  });

  it("gecersiz istekler yok sayilir", async () => {
    const giden: CameraResult[] = [];
    for (const m of [null, {}, { type: "camera_capture" }, { type: "send_sms", id: "x" }]) {
      await handleCameraRequest(m, (r) => giden.push(r), ok);
    }
    expect(giden.length).toBe(0);
    expect(INDICATOR_TEXT).toContain("DUNYATEK");
  });
});
