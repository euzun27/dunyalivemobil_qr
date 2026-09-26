import { lazy, Suspense, useState } from "react";
import ModalPanel from "./ModalPanel";
import Icon from "./Icon";
import { useSimplePc } from "../hooks/useSimplePc";

const QrScanner = lazy(() => import("./QrScanner"));

/* DUNYATEK - Basit Uzak PC eslestirme.
 * PC'nin zaten sahip oldugu /login + /ws API'sini kullanir. Karmasik imzali kimlik
 * ve WebRTC ekran paylasimi burada yok - sadece komut gonderme/eslesme.
 */

const STATE_META = {
  idle: { label: "Eslesmedi", color: "#7a8aa0" },
  connecting: { label: "Baglaniyor...", color: "#e0a800" },
  online: { label: "Cevrimici", color: "#36d399" },
  offline: { label: "Cevrimdisi - yeniden deneniyor", color: "#f06a4d" },
  unauthorized: { label: "Anahtar gecersiz", color: "#f0455a" },
};

function parsePairingUrl(text) {
  try {
    const url = new URL(text.trim());
    const key = url.searchParams.get("key");
    if (!key) return null;
    return {
      host: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      secure: url.protocol === "https:",
      key,
    };
  } catch {
    return null;
  }
}

export default function MobileRemotePC({ onClose }) {
  const { config, state, pair, unpair, sendCommand } = useSimplePc();
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
        "Baglanilamadi - anahtarin suresi dolmus olabilir, PC'de yeni anahtar alip tekrar deneyin.",
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
          DUNYATEK'e telefonunuzdan komut gonderin. PC'de Ayarlar - Uzaktan Erisim ekranindaki
          kodu okutun veya baglanti adresini elle girin.
        </div>
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
          http://192.168.1.45:8001/auto-login?key=XXXXXX):
        </div>
        <input
          className="settings-model-id"
          type="text"
          placeholder="http://192.168.1.45:8001/auto-login?key=..."
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
          <div className="settings-hint">DUNYATEK'e bir komut gonderin:</div>
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
