import { useMemo, useState } from "react";

/* ANDROID FORK first-run setup — key entry.
 * Two paths: Vertex AI (Service Account JSON) or Free API Keys (Groq/Gemini). */
export default function MobileOnboarding({ sysInfo, onSave }) {
  const [mode, setMode] = useState("vertex"); // "vertex" | "keys"
  const [vertexSaJson, setVertexSaJson] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [touched, setTouched] = useState(false);

  const hasGroq = groqKey.trim() || sysInfo.has_groq_key;
  const hasGemini = geminiKey.trim() || sysInfo.has_gemini_key;
  const hasVertex = vertexSaJson.trim() || sysInfo.has_vertex_sa;

  const project = useMemo(() => {
    try {
      return JSON.parse(vertexSaJson).project_id || "";
    } catch {
      return "";
    }
  }, [vertexSaJson]);

  // Either free key is enough — gating on Groq alone locked gemini-only users out.
  const canFinish = mode === "vertex" ? hasVertex : hasGroq || hasGemini;

  const finish = () => {
    setTouched(true);
    if (!canFinish) return;

    const cfg = {};
    if (mode === "vertex") {
      cfg.provider_mode = "vertex";
      if (vertexSaJson.trim()) cfg.vertex_sa_json = vertexSaJson.trim();
      // Optional Groq key: Vertex handles chat, but a Groq key makes voice/wake-word
      // use Whisper Large v3 Turbo (preferred over Vertex Chirp when present).
      if (groqKey.trim()) cfg.groq_api_key = groqKey.trim();
    } else {
      // Auto: route each request across whichever of these keys fits it best.
      cfg.provider_mode = "auto";
      if (groqKey.trim()) cfg.groq_api_key = groqKey.trim();
      if (geminiKey.trim()) cfg.gemini_api_key = geminiKey.trim();
    }
    onSave(cfg);
  };

  return (
    <div className="onboard-overlay">
      <div className="onboard-panel" role="dialog" aria-label="DUNYATEK'e hoş geldiniz">
        <div className="onboard-hd">
          <span className="onboard-kicker">İLK KURULUM</span>
          <h2>DUNYATEK’e hoş geldiniz</h2>
          <p className="onboard-sub">
            DUNYATEK'i yapay zekâ sağlayıcınıza bağlayın. Anahtarlar yalnızca bu cihazda kalır.
          </p>
        </div>

        <div className="onboard-mode-toggle">
          <button
            className={`onboard-mode-btn${mode === "vertex" ? " onboard-mode-btn--active" : ""}`}
            onClick={() => setMode("vertex")}
          >
            Vertex AI (300 $ kredi)
          </button>
          <button
            className={`onboard-mode-btn${mode === "keys" ? " onboard-mode-btn--active" : ""}`}
            onClick={() => setMode("keys")}
          >
            Ücretsiz API anahtarları
          </button>
        </div>

        {mode === "vertex" ? (
          <div className="onboard-sec">
            <label>
              Hizmet hesabı JSON’u (önerilen){" "}
              {sysInfo.has_vertex_sa && <span className="onboard-ok">✓ ayarlı</span>}
            </label>
            <textarea
              value={vertexSaJson}
              onChange={(e) => setVertexSaJson(e.target.value)}
              placeholder="JSON dosyasının tüm içeriğini buraya yapıştırın..."
            />
            {project && (
              <div className="onboard-ok" style={{ marginTop: 8 }}>
                ✓ Proje: {project}
              </div>
            )}
            <div className="onboard-hint">
              Gemini sohbeti ve Cloud Speech-to-Text (Chirp) için Google Cloud’un 300 $’lık ücretsiz
              deneme kredinizi kullanır.
            </div>

            <label style={{ marginTop: 16 }}>
              Groq API anahtarları (isteğe bağlı — daha iyi ses){" "}
              {sysInfo.has_groq_key && <span className="onboard-ok">✓ ayarlı</span>}
            </label>
            <textarea
              className="onboard-keys"
              rows={2}
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_…  (console.groq.com/keys — her satıra bir tane)"
              autoComplete="off"
            />
            <div className="onboard-hint">
              İsteğe bağlı. Sesli giriş ve “Hey Jarvis” için Whisper Large v3 Turbo ekler
              (girildiğinde Vertex Chirp yerine kullanılır). Sohbet yine Vertex Gemini üzerinde
              çalışır. Ücretsiz katman sınırları anahtar başınadır — her satıra bir tane olmak üzere
              birkaç anahtar yapıştırın, sırayla kullanırım.
            </div>
          </div>
        ) : (
          <>
            <div className="onboard-sec">
              <label>
                Groq API anahtarları (zorunlu){" "}
                {sysInfo.has_groq_key && <span className="onboard-ok">✓ ayarlı</span>}
              </label>
              <textarea
                className="onboard-keys"
                rows={2}
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder="gsk_…  (console.groq.com/keys — her satıra bir tane)"
                autoComplete="off"
              />
              <div className="onboard-hint">
                Whisper Large v3 Turbo ile sesli girişi ve “Hey Jarvis”i, ücretsiz katmanda da Groq
                sohbet modellerini çalıştırır. Ücretsiz katman sınırları anahtar başına sayılır —
                her satıra bir tane olmak üzere elinizdeki tüm anahtarları yapıştırın; kullanım
                sınırına takılmak yerine aralarında geçiş yaparım.
              </div>
            </div>

            <div className="onboard-sec">
              <label>
                Google Gemini API anahtarları (isteğe bağlı){" "}
                {sysInfo.has_gemini_key && <span className="onboard-ok">✓ ayarlı</span>}
              </label>
              <textarea
                className="onboard-keys"
                rows={2}
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIza…  (aistudio.google.com — her satıra bir tane)"
                autoComplete="off"
              />
              <div className="onboard-hint">
                İsteğe bağlı — Ayarlar’da Gemini ücretsiz katman modellerini açar. Burada da birden
                fazla anahtar girebilirsiniz. Ses her zaman Groq Whisper kullanır.
              </div>
            </div>
          </>
        )}

        {touched && !canFinish && (
          <div className="onboard-warn">
            {mode === "vertex"
              ? "Devam etmek için geçerli bir hizmet hesabı JSON’u yapıştırın."
              : "Devam etmek için Groq veya Gemini API anahtarınızı ekleyin."}
          </div>
        )}

        <button
          className="onboard-go"
          disabled={!canFinish}
          onClick={finish}
          style={{ marginTop: 20 }}
        >
          DUNYATEK'i Başlat →
        </button>
      </div>
    </div>
  );
}
