import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { qrTaramaBoyutu } from "./qrTarama";

/* ANDROID FORK — Camera QR scanner for Remote PC pairing.
 *
 * Opens the back camera, decodes frames with jsQR (pure JS, no native plugin needed —
 * the WebView's own getUserMedia works here exactly like it already does for the mic.
 * The OS-permission half is handled by Tauri's generated RustWebChromeClient
 * onPermissionRequest — there is no requestCameraPermission plugin command).
 * Calls onResult(text) once with the first decoded QR payload, or onCancel() if the
 * user backs out or the camera can't be used.
 */

export default function QrScanner({ onResult, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    // DUNYATEK: hizli okuma. Varsa telefonun yerlesik QR okuyucusu (BarcodeDetector);
    // yoksa jsQR kucultulmus karede ve yalnizca normal (ters cevrilmemis) desenle calisir.
    // Tam cozunurlukte her karede iki kez taramak eski telefonlarda saniyeler surebiliyordu.
    let detector = null;
    try {
      if ("BarcodeDetector" in window) detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch {
      detector = null;
    }
    let mesgul = false;
    const bulundu = (text) => {
      doneRef.current = true;
      stop();
      onResult(text);
    };

    const scanLoop = async () => {
      if (cancelled || doneRef.current) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.videoWidth && !mesgul) {
        mesgul = true;
        try {
          if (detector) {
            const kodlar = await detector.detect(v).catch(() => {
              detector = null; // desteklenmiyor: jsQR'a gec
              return [];
            });
            const text = kodlar.find((k) => k.rawValue)?.rawValue;
            if (text && !cancelled && !doneRef.current) return bulundu(text);
          } else {
            const { w, h } = qrTaramaBoyutu(v.videoWidth, v.videoHeight);
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, w, h);
            const frame = ctx.getImageData(0, 0, w, h);
            const code = jsQR(frame.data, w, h, { inversionAttempts: "dontInvert" });
            if (code?.data) return bulundu(code.data);
          }
        } finally {
          mesgul = false;
        }
      }
      if (!cancelled && !doneRef.current) rafRef.current = requestAnimationFrame(scanLoop);
    };

    (async () => {
      try {
        // No explicit pre-flight: `plugin:phone|request_camera_permission` never
        // existed in ANY layer (not in PhonePlugin.kt, not in the Rust commands, not
        // in build.rs COMMANDS), so the invoke always rejected with "command not
        // found" and the catch swallowed it — the comment claiming it "resolves
        // ok:false" was simply wrong.
        //
        // Nothing is lost by dropping it: getUserMedia below triggers the WebView's
        // onPermissionRequest, and Tauri's generated RustWebChromeClient already
        // requests the OS-level CAMERA grant from there.
        const stream = await navigator.mediaDevices.getUserMedia({
          // 1280x720 yeter; surekli odak varsa yakin QR hemen netlesir.
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            advanced: [{ focusMode: "continuous" }],
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        rafRef.current = requestAnimationFrame(scanLoop);
      } catch (e) {
        setError(
          "Kamera açılamadı — Android Ayarları'nda DUNYATEK'e kamera izni verildiğini kontrol edin ya da bilgileri elle girin. (" +
            (e?.message || e) +
            ")",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 290, // above the settings-overlay (270) this replaces on screen
        background: "#000",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "rgba(10,16,26,0.9)",
        }}
      >
        <span style={{ color: "#8fd0ff", fontWeight: 700 }}>Bilgisayarınızdaki kodu tarayın</span>
        <button className="settings-x" onClick={onCancel} aria-label="Kapat">
          ✕
        </button>
      </div>

      <div style={{ position: "relative", flex: 1 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {!error && (
          <div
            style={{
              position: "absolute",
              inset: "18%",
              border: "3px solid #6fb4ff",
              borderRadius: 16,
              boxShadow: "0 0 0 999px rgba(0,0,0,0.35)",
              pointerEvents: "none",
            }}
          />
        )}
        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              color: "#ffb3b3",
              textAlign: "center",
              background: "rgba(0,0,0,0.7)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ padding: 16, color: "#9fb2c8", fontSize: 13, textAlign: "center" }}>
        Kameranızı bilgisayarınızdaki DUNYATEK penceresinde gösterilen koda doğrultun.
      </div>
    </div>
  );
}
