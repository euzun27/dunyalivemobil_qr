import { useEffect, useState } from "react";
import "./setup-progress.css";

// First-run setup screen: the installer bundles the runtime components (browser
// engine, speech model, neural voice), but if one is ever missing/corrupt JARVIS
// re-fetches it here. Driven by the backend's `setup_progress` websocket events
// (see provisioning.py). `onRepair` re-runs setup for any failed component.
export default function SetupProgress({ progress, onRepair }) {
  const [dismissed, setDismissed] = useState(false);
  const [retried, setRetried] = useState(false);

  const order = progress?.order || [];
  const items = progress?.items || {};
  const anyError = order.some((k) => items[k]?.status === "error");

  // Linger a beat after a CLEAN completion, then fade out. A completion WITH errors
  // stays put so the user can read it and hit Retry — never auto-dismissed.
  useEffect(() => {
    if (!progress?.complete || anyError) return;
    const t = setTimeout(() => setDismissed(true), 1900);
    return () => clearTimeout(t);
  }, [progress, progress?.complete, anyError]);

  // Each new progress frame: un-dismiss unless it's a clean finish, and clear the
  // "retrying…" affordance once a fresh run streams again. Done during render.
  const [seenProgress, setSeenProgress] = useState(progress);
  if (progress !== seenProgress) {
    setSeenProgress(progress);
    if (progress && !(progress.complete && !anyError)) setDismissed(false);
    if (progress && !progress.complete) setRetried(false);
  }

  if (!progress || dismissed) return null;

  const total = progress.total || order.length || 1;
  const done = order.filter((k) => {
    const st = items[k]?.status;
    return st === "done" || st === "error";
  }).length;
  const pct = progress.complete ? 100 : Math.round((done / total) * 100);
  const failed = order.filter((k) => items[k]?.status === "error");
  const showRetry = progress.complete && anyError && !!onRepair;

  const handleRetry = () => {
    if (onRepair) onRepair();
    setRetried(true);
  };

  return (
    <div className="setup-overlay">
      <div className="setup-card" role="status" aria-label="İlk kurulum">
        <div className="setup-ring" aria-hidden="true">
          <span className="setup-ring-core" />
        </div>
        <div className="setup-kicker">{anyError ? "KURULUM — İŞLEM GEREKLİ" : "İLK KURULUM"}</div>
        <div className="setup-title">DUNYATEK başlatılıyor</div>
        <div className="setup-sub">
          {anyError
            ? "Bir bileşen kurulamadı efendim. Diğerleri hazır — eksik olanı aşağıdan yeniden deneyin."
            : "Birkaç tek seferlik bileşen hazırlanıyor. Bu işlem yalnızca bir kez yapılır."}
        </div>

        <ul className="setup-list">
          {order.map((k) => {
            const it = items[k] || {};
            return (
              <li key={k} className={`setup-row setup-row--${it.status}`}>
                <span className="setup-row-icon" aria-hidden="true">
                  {it.status === "done" ? (
                    "✓"
                  ) : it.status === "error" ? (
                    "!"
                  ) : (
                    <span className="setup-spinner" />
                  )}
                </span>
                <span className="setup-row-label">{it.label || k}</span>
                <span className="setup-row-status">
                  {it.status === "downloading"
                    ? "indiriliyor…"
                    : it.status === "done"
                      ? "hazır"
                      : it.status === "error"
                        ? "başarısız"
                        : "sırada"}
                </span>
              </li>
            );
          })}
        </ul>

        {anyError && failed.some((k) => items[k]?.error) && (
          <div className="setup-error-detail">
            {failed.map((k) => items[k]?.error).filter(Boolean)[0]}
          </div>
        )}

        <div className="setup-bar">
          <div className="setup-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="setup-foot">
          {progress.complete
            ? anyError
              ? `${failed.length} bileşenin kurulması gerekiyor`
              : "Her şey hazır efendim."
            : `${total} bileşenden ${done} tanesi hazır`}
        </div>

        {showRetry && (
          <button className="setup-retry" onClick={handleRetry} disabled={retried}>
            {retried ? "Yeniden deneniyor…" : "Kurulumu yeniden dene"}
          </button>
        )}
      </div>
    </div>
  );
}
