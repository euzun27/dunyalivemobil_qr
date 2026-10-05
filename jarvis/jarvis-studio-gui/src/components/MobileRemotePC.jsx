import { lazy, Suspense, useState } from "react";
import ModalPanel from "./ModalPanel";
import Icon from "./Icon";
import { useSimplePc } from "../hooks/useSimplePc";
import { PC_APP_PORT } from "../brain/remote/simplePc";

const QrScanner = lazy(() => import("./QrScanner"));

/* DUNYATEK - Basit Uzak PC eslestirme.
 * PC'nin zaten sahip oldugu /login + /ws API'sini kullanir. Karmasik imzali kimlik
 * ve WebRTC ekran paylasimi burada yok - sadece komut gonderme/eslesme.
 */

const STATE_META = {
  idle: { label: "Eşleşmedi", color: "#7a8aa0" },
  connecting: { label: "Bağlanıyor...", color: "#e0a800" },
  online: { label: "Çevrimiçi", color: "#36d399" },
  offline: { label: "Bilgisayara ulaşılamıyor", color: "#f06a4d" },
  unauthorized: {
    label: "Bilgisayar bu telefonu tanımıyor — QR kodu yeniden okutun",
    color: "#f0455a",
  },
};

function parsePairingUrl(text) {
  try {
    const url = new URL(text.trim());
    const key = url.searchParams.get("key");
    if (!key) return null;
    // QR, panelin HTTPS adresini (8000) tasir; uygulama ayni PC'ye duz HTTP portundan baglanir.
    // ts: PC'nin Tailscale adres(ler)i - telefon ayni Wi-Fi'da degilken de eslessin.
    const extraHosts = (url.searchParams.get("ts") || "").split(",").filter(Boolean);
    return { host: url.hostname, port: PC_APP_PORT, secure: false, key, extraHosts };
  } catch {
    return null;
  }
}

export default function MobileRemotePC({ onClose }) {
  const {
    config,
    state,
    messages,
    voice,
    pair,
    unpair,
    reconnect,
    lastError,
    sendCommand,
    startVoice,
    stopVoice,
  } = useSimplePc();
  const [voiceError, setVoiceError] = useState("");
  const [voiceStarting, setVoiceStarting] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [pairing, setPairing] = useState(false);
  const [command, setCommand] = useState("");
  const [manualUrl, setManualUrl] = useState("");

  const paired = Boolean(config?.host);
  const online = state === "online";
  const meta = STATE_META[state] || STATE_META.idle;

  const tryPair = async (rawText) => {
    const parsed = parsePairingUrl(rawText);
    if (!parsed) {
      setScanError(
        "Bu kod bir DUNYATEK eşleştirme kodu değil — bilgisayardaki Remote Access ekranındaki kodu okutun.",
      );
      return;
    }
    setScanError("");
    setPairing(true);
    const ok = await pair(parsed);
    setPairing(false);
    if (!ok) {
      setScanError(
        "Bağlanılamadı — bilgisayarda DUNYATEK açık mı? Anahtarın süresi dolmuş olabilir; bilgisayarda Remote Control’e yeniden basıp yeni kodu okutun.",
      );
    }
  };

  const handleScanned = (text) => {
    setScanning(false);
    tryPair(text);
  };

  const handleManualSubmit = () => {
    if (!manualUrl.trim()) return;
    tryPair(manualUrl);
  };

  const handleSendCommand = () => {
    if (!command.trim()) return;
    sendCommand(command.trim());
    setCommand("");
  };

  const toggleVoice = async () => {
    setVoiceError("");
    if (voice) {
      stopVoice();
      return;
    }
    setVoiceStarting(true);
    try {
      const ok = await startVoice();
      if (!ok)
        setVoiceError(
          "Ses bağlantısı kurulamadı — bilgisayardaki programın açık olduğundan emin olun.",
        );
    } catch (e) {
      setVoiceError(
        e?.name === "NotAllowedError"
          ? "Mikrofon izni verilmedi — telefon ayarlarından DUNYATEK için mikrofona izin verin."
          : "Mikrofon açılamadı: " + (e?.message || e),
      );
    } finally {
      setVoiceStarting(false);
    }
  };

  // PC'den gelen konusma kayitlari (siz / DUNYATEK)
  const chat = (messages || []).filter((m) => m?.type === "log" && m.text).slice(-8);

  if (scanning) {
    return (
      <Suspense fallback={<ModalPanel title="Kod taranıyor">Kamera açılıyor...</ModalPanel>}>
        <QrScanner onResult={handleScanned} onCancel={() => setScanning(false)} />
      </Suspense>
    );
  }

  return (
    <ModalPanel title="Uzak Bilgisayar" onClose={onClose}>
      <div className="settings-sec">
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}
        >
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: meta.color,
              boxShadow: `0 0 8px ${meta.color}`,
            }}
          />
          <span>{paired ? meta.label : "Bilgisayar eşleşmedi"}</span>
          {paired && (
            <span style={{ marginLeft: "auto", opacity: 0.6, fontWeight: 400 }}>
              {config.host}:{config.port}
            </span>
          )}
        </div>
        <div className="settings-hint">
          Bir kez QR kodu okutun; sonra bu ekranı her açtığınızda bilgisayara kendiliğinden
          bağlanır. Evden/dışarıdan bağlanmak için bilgisayarda ve telefonda Tailscale açık olmalı.
        </div>
        {paired && state !== "online" && lastError && (
          <div className="settings-hint" style={{ opacity: 0.7, fontSize: 11 }}>
            Ayrıntı: {lastError} — 5 saniyede bir kendiliğinden yeniden deneniyor.
          </div>
        )}
        {paired && config?.deviceToken && state !== "online" && state !== "connecting" && (
          <button className="settings-save" style={{ marginTop: 8 }} onClick={() => reconnect()}>
            Yeniden bağlan
          </button>
        )}
      </div>

      <div className="settings-sec">
        <button
          className="settings-save"
          onClick={() => {
            setScanError("");
            setScanning(true);
          }}
          disabled={pairing}
        >
          <Icon name="camera" size={16} />{" "}
          {paired ? "Kodu yeniden tara" : "Bilgisayardaki kodu tara"}
        </button>

        <div className="settings-hint" style={{ marginTop: 8 }}>
          Ya da bağlantı adresini elle yapıştırın (örnek:
          https://192.168.1.45:8000/auto-login?key=XXXXXX):
        </div>
        <input
          className="settings-model-id"
          type="text"
          placeholder="https://192.168.1.45:8000/auto-login?key=..."
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          style={{ marginTop: 6 }}
        />
        <button
          className="settings-save"
          style={{ marginTop: 8 }}
          onClick={handleManualSubmit}
          disabled={pairing || !manualUrl.trim()}
        >
          Bağlan
        </button>

        {scanError && <div className="settings-warn">{scanError}</div>}
        {pairing && <div className="settings-hint">Bağlanılıyor...</div>}
      </div>

      {paired && online && (
        <div className="settings-sec">
          <button
            className="settings-save"
            onClick={toggleVoice}
            disabled={voiceStarting}
            style={{
              padding: "18px 12px",
              fontSize: 17,
              background: voice ? "#f0455a" : undefined,
            }}
          >
            {voiceStarting
              ? "Mikrofon açılıyor..."
              : voice
                ? "Konuşmayı bitir"
                : "Konuş (bilgisayarla sesli görüşme)"}
          </button>
          <div className="settings-hint" style={{ marginTop: 6 }}>
            {voice
              ? "Canlı görüşme açık — konuşun, DUNYATEK’in yanıtını telefondan duyacaksınız."
              : "Görüşme kapalı. Yeniden başlatmak için düğmeye basın."}
          </div>
          {voiceError && <div className="settings-warn">{voiceError}</div>}
          {chat.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>
              {chat.map((m, i) => (
                <div key={i} style={{ marginTop: 4 }}>
                  <strong>{m.speaker === "user" ? "Siz" : "DUNYATEK"}:</strong> {m.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {paired && online && (
        <div className="settings-sec">
          <div className="settings-hint">Ya da yazarak komut gönderin:</div>
          <input
            className="settings-model-id"
            type="text"
            placeholder="Örn: bugünkü haberleri özetle"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendCommand()}
            style={{ marginTop: 6 }}
          />
          <button className="settings-save" style={{ marginTop: 8 }} onClick={handleSendCommand}>
            Gönder
          </button>
        </div>
      )}

      {paired && (
        <button
          className="dirlist-addbtn"
          style={{ marginTop: 8 }}
          onClick={() => {
            unpair();
            onClose();
          }}
        >
          Bu bilgisayarla eşleşmeyi kaldır
        </button>
      )}
    </ModalPanel>
  );
}
