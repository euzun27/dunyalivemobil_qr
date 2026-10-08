/* KameraKatmani.jsx - PC telefon kamerasindan kare istediginde HUD'un ustunde acilan katman.
   Cekim sirasinda canli kamera goruntusu, kare alininca o fotograf tam ekran durur; avatar
   (video modundaysa) sag ust kosede kamera klibini oynatir. Cevap bitince ya da azami sure
   dolunca (kameraDurumu.ts Bakis) kapanir; dokununca da kapanir. Kamera akisini acip kapatan
   phoneCamera.ts'dir: bu katman yalnizca gosterir. Body'ye portal ile eklenir: HUD'un
   olceklenen kapsayicisindan etkilenmez. */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { VideoAvatar } from "./VideoAvatar.jsx";
import { abone, anlik, bakis, kameraKapandi } from "./kameraDurumu";

export function KameraKatmani({ status = "idle", muted = false, avatar = true }) {
  const { akis, foto } = useSyncExternalStore(abone, anlik);
  const videoRef = useRef(null);
  const live = useRef(status);
  useEffect(() => {
    live.current = status;
  });

  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== akis) {
      v.srcObject = akis;
      if (akis) void v.play().catch(() => {});
    }
  }, [akis]);

  // Cevap bitince katmani kapat (Bakis'i avatarla ayni kurallarla izler).
  useEffect(() => {
    if (!akis && !foto) return undefined;
    const t = setInterval(() => {
      if (!bakis.aktif(Date.now() / 1000, live.current === "speaking")) kameraKapandi();
    }, 250);
    return () => clearInterval(t);
  }, [akis, foto]);

  if (!akis && !foto) return null;
  const kapat = () => {
    bakis.bitir();
    kameraKapandi();
  };
  return createPortal(
    <div className="kamera-katmani" onClick={kapat} role="dialog" aria-label="Kamera görüntüsü">
      {akis ? (
        <video ref={videoRef} className="kamera-katmani__goruntu" muted playsInline autoPlay />
      ) : (
        <img className="kamera-katmani__goruntu" src={foto} alt="Kameradan alınan kare" />
      )}
      {avatar && (
        <div className="kamera-katmani__avatar">
          <VideoAvatar status={status} muted={muted} width={120} />
        </div>
      )}
    </div>,
    document.body,
  );
}
