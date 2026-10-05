import { useState } from "react";
import StateMessage from "./StateMessage";
import ModalPanel from "./ModalPanel";
import { stepIcon } from "../hooks/agentActivity";

const STATUS = {
  accepted: { label: "kabul edildi", cls: "activity-pill--run" },
  queued: { label: "sırada", cls: "activity-pill--run" },
  recovering: { label: "kurtarılıyor…", cls: "activity-pill--run" },
  planning: { label: "planlanıyor…", cls: "activity-pill--run" },
  policy_check: { label: "politika denetimi…", cls: "activity-pill--run" },
  executing: { label: "yürütülüyor…", cls: "activity-pill--run" },
  verifying: { label: "doğrulanıyor…", cls: "activity-pill--run" },
  waiting_for_unlock: { label: "kilit açılması bekleniyor", cls: "activity-pill--wait" },
  waiting_for_approval: { label: "onay gerekiyor", cls: "activity-pill--wait" },
  suspended: { label: "güvenle askıya alındı", cls: "activity-pill--wait" },
  cancelling: { label: "durduruluyor…", cls: "activity-pill--fail" },
  cancelled: { label: "iptal edildi", cls: "activity-pill--fail" },
  succeeded: { label: "doğrulandı ✓", cls: "activity-pill--ok" },
  running: { label: "çalışıyor…", cls: "activity-pill--run" },
  done: { label: "tamamlandı ✓", cls: "activity-pill--ok" },
  failed: { label: "başarısız ✕", cls: "activity-pill--fail" },
  stopped: { label: "durduruldu", cls: "activity-pill--fail" },
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "done", "stopped"]);
const ACTUATING = new Set([
  "accepted",
  "queued",
  "recovering",
  "planning",
  "policy_check",
  "executing",
  "verifying",
  "running",
  "cancelling",
]);

function taskIcon(task) {
  if (task.kind === "phone" || task.source === "phone") return "TEL";
  if (task.kind === "browser") return "WEB";
  return "PC";
}

function printable(value) {
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  } catch {
    return String(value || "");
  }
}

function planLines(plan) {
  if (!Array.isArray(plan)) return [];
  return plan.map((step, index) => {
    if (typeof step === "string") return step;
    if (!step || typeof step !== "object") return `Adım ${index + 1}`;
    return step.description || step.action || step.type || step.step_id || `Adım ${index + 1}`;
  });
}

function approvalExpiry(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export default function AgentActivity({ tasks, onClose, onClear, onStopTask, onStopAll }) {
  const [zoom, setZoom] = useState(null);
  const ordered = [...(tasks || [])].sort(
    (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0),
  );
  const hasActive = ordered.some((task) => ACTUATING.has(task.status));

  return (
    <ModalPanel
      title="Görev Merkezi"
      onClose={onClose}
      className="activity-panel"
      actions={
        <div className="activity-hdr-actions">
          {hasActive && onStopAll && (
            <button className="activity-stop-all" onClick={onStopAll}>
              TÜMÜNÜ DURDUR
            </button>
          )}
          {ordered.length > 0 && (
            <button className="activity-clear" onClick={onClear}>
              Bitenleri temizle
            </button>
          )}
        </div>
      }
    >
      <>
        {ordered.length === 0 ? (
          <StateMessage variant="empty" icon="inbox" title="Henüz görev yok">
            DUNYATEK’e verdiğiniz bilgisayar ve telefon işleri; canlı ilerleme, kurtarma ayrıntıları
            ve doğrulamada kullanılan kanıtlarla birlikte burada görünür.
          </StateMessage>
        ) : (
          <div className="activity-list">
            {ordered.map((task) => {
              const status = STATUS[task.status] || STATUS.running;
              const plan = planLines(task.plan);
              const canStop = !TERMINAL.has(task.status);
              return (
                <article key={task.id} className="activity-task">
                  <div className="activity-task-hd">
                    <span className="activity-task-ico">{taskIcon(task)}</span>
                    <span className="activity-task-goal">{task.goal || "DUNYATEK görevi"}</span>
                    <span className={`activity-pill ${status.cls}`}>{status.label}</span>
                    {canStop && onStopTask && (
                      <button
                        className="activity-task-stop"
                        onClick={() => onStopTask(task.id)}
                        aria-label={`Durdur: ${task.goal || "görev"}`}
                      >
                        Durdur
                      </button>
                    )}
                  </div>

                  <div className="activity-meta">
                    <span>
                      {task.source === "phone" || task.kind === "phone"
                        ? "Bu telefonda"
                        : "Windows bilgisayar"}
                    </span>
                    {Number.isFinite(Number(task.currentStep)) && Number(task.currentStep) > 0 && (
                      <span>
                        Adım {task.currentStep}
                        {plan.length ? ` / ${plan.length}` : ""}
                      </span>
                    )}
                    {task.risk && <span>{task.risk}</span>}
                  </div>

                  {task.recoveryInfo && (
                    <div className="activity-notice activity-notice--recovery">
                      Kurtarma: {task.recoveryInfo}
                    </div>
                  )}
                  {task.retryInfo && (
                    <div className="activity-notice">Yeniden deneme: {task.retryInfo}</div>
                  )}
                  {task.waitingReason && (
                    <div className="activity-notice activity-notice--waiting">
                      Bekleniyor: {task.waitingReason}
                    </div>
                  )}

                  {task.approval && (
                    <div className="activity-approval" role="status">
                      <div className="activity-approval-title">
                        {task.approval.risk || "R2"} onayı gerekiyor
                      </div>
                      {task.approval.action && <div>İşlem: {task.approval.action}</div>}
                      {task.approval.target && <div>Hedef: {task.approval.target}</div>}
                      {task.approval.consequence && <div>Sonuç: {task.approval.consequence}</div>}
                      {task.approval.expiresAt && (
                        <div>Geçerlilik sonu: {approvalExpiry(task.approval.expiresAt)}</div>
                      )}
                      <div className="activity-approval-note">
                        Yalnızca bilgi amaçlıdır — bu işlemi güvenilir bilgisayarda onaylayın.
                      </div>
                    </div>
                  )}

                  {plan.length > 0 && (
                    <ol className="activity-plan" aria-label="Mevcut plan">
                      {plan.map((line, index) => (
                        <li
                          key={`${index}:${line}`}
                          className={
                            index < Number(task.currentStep || 0) ? "activity-plan--done" : ""
                          }
                        >
                          {line}
                        </li>
                      ))}
                    </ol>
                  )}

                  {task.summary && task.status !== "running" && (
                    <div className="activity-summary">{task.summary}</div>
                  )}
                  {task.proof && (
                    <div className="activity-proof">
                      <span>Doğrulama kanıtı</span>
                      {printable(task.proof)}
                    </div>
                  )}

                  <div className="activity-timeline">
                    {(task.items || []).map((item, index) =>
                      item.kind === "shot" ? (
                        <img
                          key={item.receiptKey || index}
                          className="activity-shot"
                          src={item.image}
                          alt="Görev kanıtı ekran görüntüsü"
                          loading="lazy"
                          onClick={() => setZoom(item.image)}
                        />
                      ) : (
                        <div
                          key={item.receiptKey || index}
                          className={`activity-step${item.ok === false ? " activity-step--fail" : ""}`}
                        >
                          <span className="activity-step-ico">{stepIcon(item.line)}</span>
                          <span className="activity-step-txt">{item.line}</span>
                        </div>
                      ),
                    )}
                    {ACTUATING.has(task.status) && (
                      <div className="activity-step activity-step--live">
                        <span className="activity-step-ico">⏳</span>
                        <span className="activity-step-txt">
                          {task.status === "verifying"
                            ? "son koşullar denetleniyor ve kanıt toplanıyor…"
                            : task.status === "cancelling"
                              ? "kontrol yetkisi geri alınıyor…"
                              : "son doğrulanan kontrol noktasından devam ediliyor…"}
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="activity-foot">
          Görevler arayüz yenilense ve bağlantı kopsa da korunur. DUNYATEK başarıyı yalnızca
          doğrulamadan sonra bildirir. İmzalı cihaz onayları kullanılabilir olana kadar onay
          kartları salt okunurdur.
        </div>

        {zoom && (
          <div
            className="activity-lightbox"
            onClick={(event) => {
              event.stopPropagation();
              setZoom(null);
            }}
          >
            <img src={zoom} alt="Görev kanıtı" onClick={(event) => event.stopPropagation()} />
            <button
              className="activity-lightbox-x"
              onClick={(event) => {
                event.stopPropagation();
                setZoom(null);
              }}
              aria-label="Kanıt önizlemesini kapat"
            >
              ✕
            </button>
          </div>
        )}
      </>
    </ModalPanel>
  );
}
