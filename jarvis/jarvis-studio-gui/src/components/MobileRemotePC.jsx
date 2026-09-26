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
  idle: { label: "Eslesmedi", color: "#7a8aa0" },
  connecting: { label: "Baglaniyor...", color: "#e0a800" },
  online: { label: "Cevrimici", color: "#36d399" },
  offline: { label: "PC'ye ulasilamiyor", color: "#f06a4d" },
  unauthorized: { label: "PC bu telefonu tanimiyor - QR kodu yeniden okutun", color: "#f0455a" },
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
        "Bu kod DUNYATEK eslestirme kodu degil - PC'deki Remote Access ekranindaki kodu okutun.",
      );
      return;
    }
    setScanError("");
    setPairing(true);
    const ok = await pair(parsed);
    setPairing(false);
    if (!ok) {
      setScanError(
        "Baglanilamadi - PC'de DUNYATEK acik mi? Anahtarin suresi dolmus olabilir; PC'de Remote Control'e yeniden basip yeni kodu okutun.",
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
        setVoiceError("Ses baglantisi kurulamadi - PC programinin acik oldugundan emin olun.");
    } catch (e) {
      setVoiceError(
        e?.name === "NotAllowedError"
          ? "Mikrofon izni verilmedi - telefon ayarlarindan DUNYATEK icin mikrofona izin verin."
          : "Mikrofon acilamadi: " + (e?.message || e),
      );
    } finally {
      setVoiceStarting(false);
    }
  };

  // PC'den gelen konusma kayitlari (siz / DUNYATEK)
  const chat = (messages || []).filter((m) => m?.type === "log" && m.text).slice(-8);

  if (scanning) {
    return (
      <Suspense fallback={<ModalPanel title="Kod taraniyor">Kamera aciliyor...</ModalPanel>}>
        <QrScanner onResult={handleScanned} onCancel={() => setScanning(false)} />
      </Suspense>
    );
  }

  return (
    <ModalPanel title="Uzak PC" onClose={onClose}>
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
          <span>{paired ? meta.label : "PC eslesmedi"}</span>
          {paired && (
            <span style={{ marginLeft: "auto", opacity: 0.6, fontWeight: 400 }}>
              {config.host}:{config.port}
            </span>
          )}
        </div>
        <div className="settings-hint">
          Bir kez QR kodu okutun; sonra bu ekrani her actiginizda PC'ye kendiliginden baglanir.
          Evden/disaridan baglanmak icin PC'de ve telefonda Tailscale acik olmali.
        </div>
        {paired && state !== "online" && lastError && (
          <div className="settings-hint" style={{ opacity: 0.7, fontSize: 11 }}>
            Ayrinti: {lastError} - 5 sn'de bir kendiliginden yeniden deneniyor.
          </div>
        )}
        {paired && config?.deviceToken && state !== "online" && state !== "connecting" && (
          <button className="settings-save" style={{ marginTop: 8 }} onClick={() => reconnect()}>
            Yeniden baglan
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
          <Icon name="camera" size={16} /> {paired ? "Kodu yeniden tara" : "PC'deki kodu tara"}
        </button>

        <div className="settings-hint" style={{ marginTop: 8 }}>
          Ya da baglanti adresini elle yapistirin (ornek:
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
          Baglan
        </button>

        {scanError && <div className="settings-warn">{scanError}</div>}
        {pairing && <div className="settings-hint">Baglaniliyor...</div>}
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
              ? "Mikrofon aciliyor..."
              : voice
                ? "Konusmayi bitir"
                : "Konus (PC ile sesli gorus)"}
          </button>
          <div className="settings-hint" style={{ marginTop: 6 }}>
            {voice
              ? "Canli gorusme acik - konusun, DUNYATEK cevabi telefondan duyacaksiniz."
              : "Gorusme kapali. Tekrar baslatmak icin dugmeye basin."}
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
          <div className="settings-hint">Ya da yazarak komut gonderin:</div>
          <input
            className="settings-model-id"
            type="text"
            placeholder="Orn: bugunku haberleri ozetle"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendCommand()}
            style={{ marginTop: 6 }}
          />
          <button className="settings-save" style={{ marginTop: 8 }} onClick={handleSendCommand}>
            Gonder
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
          Bu PC eslesmesini kaldir
        </button>
      )}
    </ModalPanel>
  );
}
