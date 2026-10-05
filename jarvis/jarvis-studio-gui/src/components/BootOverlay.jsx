import { useEffect, useRef, useState } from "react";
import "./setup-progress.css";

// Shown from app launch until the GUI first connects to the backend WebSocket.
// The frozen backend takes a moment to start (heavy imports) and, on first launch,
// downloads its components — so without this the window looks dead/"can't connect".
// Purely client-side: it needs no backend connection to render (that's the point).
export default function BootOverlay({ connected }) {
  const [secs, setSecs] = useState(0);
  const startRef = useRef(null);

  useEffect(() => {
    if (connected) return; // connected → unmount; nothing to time
    if (startRef.current == null) startRef.current = Date.now();
    const t = setInterval(() => {
      setSecs(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [connected]);

  if (connected) return null;

  const msg =
    secs < 12
      ? "Başlatılıyor, efendim…"
      : secs < 40
        ? "Hazırlık yapılıyor — ilk açılışta birkaç bileşen indirilir."
        : "Hâlâ başlatılıyor. Bu ekran kapanmazsa arka uç başlatılamamış olabilir.";

  return (
    <div className="setup-overlay">
      <div className="setup-card" role="status" aria-label="DUNYATEK başlatılıyor">
        <div className="setup-ring" aria-hidden="true">
          <span className="setup-ring-core" />
        </div>
        <div className="setup-kicker">BAŞLATILIYOR</div>
        <div className="setup-title">DUNYATEK</div>
        <div className="setup-sub">{msg}</div>
        <div className="setup-bar">
          <div className="setup-bar-fill setup-bar-fill--indet" />
        </div>
        {secs >= 40 && (
          <div className="setup-foot">
            Tanılama: DUNYATEK kurulum klasöründeki (<code>resources\jarvis-backend</code>){" "}
            <code>backend.log</code> dosyasını açın.
          </div>
        )}
      </div>
    </div>
  );
}
