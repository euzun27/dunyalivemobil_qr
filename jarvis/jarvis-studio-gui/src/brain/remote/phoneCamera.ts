/**
 * DUNYATEK - telefon kamerasindan tek kare (PC'deki asistan "kameraya bak" dediginde).
 *
 * PC  -> telefon : {type:"camera_capture", id, facing:"environment"}
 * tel -> PC      : {type:"camera_result", id, ok:true, mime:"image/jpeg", data:<base64>}
 *                  {type:"camera_result", id, ok:false, summary:"neden"}
 * Surekli goruntu YOK: her istekte arka kamera acilir, tek kare cekilir, kamera HEMEN kapanir.
 * Cekim suresince ekranin ustunde gorunur bir uyari durur. Kare cihaza kaydedilmez.
 * PC tarafi: dunya_live core/telefon_kamera.py (ayni mesaj sozlesmesi).
 */

export const MAX_SIDE = 1280;
export const JPEG_QUALITY = 0.82;
export const WARMUP_MS = 700; // pozlama/odak otursun
export const CAPTURE_TIMEOUT_MS = 10000;
export const INDICATOR_TEXT = "\u{1F4F7} DUNYATEK kameraya bak\u0131yor";

export interface CameraRequest {
  type: "camera_capture";
  id: string;
  facing?: string;
}

export type CameraResult =
  | { type: "camera_result"; id: string; ok: true; mime: string; data: string }
  | { type: "camera_result"; id: string; ok: false; summary: string };

export interface Frame {
  mime: string;
  data: string; // base64 (on eki yok)
}

/** Kamera hatalarini kullaniciya soylenebilecek Turkce nedenlere cevirir. */
export function errorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Kamera izni verilmedi.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Telefonda kamera bulunamadi.";
  if (name === "NotReadableError" || name === "AbortError")
    return "Kamera baska bir uygulama tarafindan kullaniliyor.";
  if (name === "TimeoutError") return "Kamera zamaninda acilamadi.";
  return "Kare cekilemedi.";
}

/** Uzun-kenari `maxSide`'i asmayacak sekilde olcek (en-boy orani korunur). */
export function fitSize(w: number, h: number, maxSide = MAX_SIDE): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** "data:image/jpeg;base64,XXXX" -> {mime, data} */
export function splitDataUrl(url: string): Frame | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url);
  return m ? { mime: m[1].toLowerCase(), data: m[2] } : null;
}

function showIndicator(doc: Document): () => void {
  const el = doc.createElement("div");
  el.textContent = INDICATOR_TEXT;
  el.setAttribute("role", "status");
  el.style.cssText =
    "position:fixed;top:calc(env(safe-area-inset-top,0px) + 12px);left:50%;" +
    "transform:translateX(-50%);z-index:2147483647;padding:8px 14px;border-radius:999px;" +
    "background:rgba(255,45,85,.92);color:#fff;font:600 14px system-ui,sans-serif;" +
    "box-shadow:0 2px 12px rgba(0,0,0,.4);pointer-events:none";
  doc.body.appendChild(el);
  return () => el.remove();
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Arka kameradan tek kare; kamera her durumda kapatilir. */
export async function captureFrame(
  md: MediaDevices = navigator.mediaDevices,
  doc: Document = document,
): Promise<Frame> {
  const hide = showIndicator(doc);
  let stream: MediaStream | null = null;
  try {
    if (!md?.getUserMedia) throw Object.assign(new Error("no camera"), { name: "NotFoundError" });
    stream = await md.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: MAX_SIDE },
        height: { ideal: 960 },
      },
    });
    const video = doc.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await wait(WARMUP_MS);
    const { w, h } = fitSize(video.videoWidth, video.videoHeight);
    if (!w || !h) throw Object.assign(new Error("empty frame"), { name: "NotReadableError" });
    const canvas = doc.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(video, 0, 0, w, h);
    video.srcObject = null;
    const frame = splitDataUrl(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    if (!frame) throw new Error("encode failed");
    return frame;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    hide();
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

let busy = false;

/** PC'den gelen camera_capture istegini karsilar; cevabi `send` ile yollar. Asla firlatmaz. */
export async function handleCameraRequest(
  msg: unknown,
  send: (r: CameraResult) => unknown,
  capture: () => Promise<Frame> = () => captureFrame(),
  timeoutMs = CAPTURE_TIMEOUT_MS,
): Promise<void> {
  const req = msg as Partial<CameraRequest> | null;
  const id = typeof req?.id === "string" ? req.id : "";
  if (!id || req?.type !== "camera_capture") return;
  if (busy) {
    send({ type: "camera_result", id, ok: false, summary: "Kamera su an mesgul." });
    return;
  }
  busy = true;
  try {
    const f = await withTimeout(capture(), timeoutMs);
    send({ type: "camera_result", id, ok: true, mime: f.mime, data: f.data });
  } catch (e) {
    send({ type: "camera_result", id, ok: false, summary: errorMessage(e) });
  } finally {
    busy = false;
  }
}
