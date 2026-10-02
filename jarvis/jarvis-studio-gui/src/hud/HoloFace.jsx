/* HoloFace.jsx - HUD merkezinde DUNYATEK insan yuzu (masaustu core/avatar.py ile ayni yuz).
   Durum (dinliyor / dusunuyor / konusuyor) ve renk degisiklikleri animasyonu sifirlamaz:
   motor bir kez kurulur, guncel degerler her karede bir ref'ten okunur.
   Pil: en fazla 30 kare/sn; uygulama arka plandayken cizim tamamen durur. */

import { useEffect, useRef } from "react";
import mesh from "./faceMesh.json";
import { HoloFace as FaceEngine, KonusmaZarfi } from "./holoFace";

const STATE = { listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING", idle: "" };
const EYES = [0, 255, 136]; // masaustundeki yesil goz
const MUTED = [255, 45, 85]; // masaustundeki "MUTED" kirmizisi
const BG = [5, 8, 12];
const FRAME_MS = 1000 / 30;

export function HoloFace({ status = "idle", muted = false, size = 232, rgb = [0, 229, 255] }) {
  const canvasRef = useRef(null);
  const live = useRef({ status, muted, rgb });
  useEffect(() => {
    live.current = { status, muted, rgb }; // cizim sirasinda degil, cizimden sonra guncelle
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const face = new FaceEngine(mesh);
    const zarf = new KonusmaZarfi();
    const r = size * 0.396; // bas tepesinden boyun ucuna alani doldurur
    const cy = size / 2 - 0.161 * r;
    let raf = 0;
    let last = 0;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) {
        last = 0;
        return;
      }
      if (last && now - last < FRAME_MS) return;
      const dt = last ? (now - last) / 1000 : FRAME_MS / 1000;
      last = now;
      const s = live.current;
      const speaking = s.status === "speaking";
      face.step(dt, {
        amp: zarf.next(dt, speaking && !s.muted),
        speaking,
        muted: s.muted,
        state: STATE[s.status] ?? "",
      });
      ctx.clearRect(0, 0, size, size);
      face.paint(
        ctx,
        size / 2,
        cy,
        r,
        { primary: s.muted ? MUTED : s.rgb, accent: s.muted ? MUTED : EYES, bg: BG },
        size / 2,
      );
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <div className="reactor holo-face" style={{ width: size, height: size }}>
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden="true" />
    </div>
  );
}
