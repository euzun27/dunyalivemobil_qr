import { useState, useEffect } from "react";
import { IS_MOBILE } from "../hooks/useAssistant";
import { getGrantedFolder, pickGrantedFolder, requestCalendarPermission } from "../brain/platform";
import { modelClassFor } from "../brain/modelPolicy";
import * as quota from "../brain/quota";
import Icon from "./Icon";
import StateMessage from "./StateMessage";
import { Field, Group, More, Toggle, WIDE_QUERY, Warn } from "./Sheet";
import { useAndroidBack } from "../hooks/useAndroidBack";

// Fallback model groups — used only until the backend's per-key discovery arrives
// via sysInfo.available_models (Phase 3), which lists ONLY models the active keys
// can actually serve (Vertex curated / Gemini-key / Groq / local Ollama). Kept
// deliberately tiny; the live discovered list supersedes it.
const FALLBACK_GROUPS = [
  {
    label: "Otomatik",
    opts: [{ value: "auto", label: "Otomatik — her istek için en iyi modeli seç" }],
  },
];

const MOBILE_FALLBACK_GROUPS = [
  {
    label: "Otomatik",
    opts: [{ value: "auto", label: "Otomatik — en iyi ücretsiz katman modelini seç" }],
  },
];

const TTS_OPTS = [
  { value: "piper", label: "Piper — çevrimdışı nöral ses, ücretsiz", short: "Piper" },
  {
    value: "elevenlabs",
    label: "ElevenLabs — premium bulut, anahtar gerekir",
    short: "ElevenLabs",
  },
  { value: "chirp", label: "Google Chirp 3 HD — GCP kredilerinizle", short: "Chirp 3 HD" },
  { value: "edge-tts", label: "Edge TTS — çevrimiçi", short: "Edge TTS" },
  { value: "pyttsx3", label: "pyttsx3 — çevrimdışı, robotik", short: "pyttsx3" },
  { value: "off", label: "Kapalı", short: "Kapalı" },
];

const PROVIDER_NAME = {
  auto: "Otomatik",
  vertex: "Vertex AI",
  gemini: "Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  nvidia: "NVIDIA NIM",
  mistral: "Mistral",
  offline: "Çevrimdışı",
};

const isGemini = (m) => /^(gemini|gemma)/i.test(m || "");

/* ── Building blocks (shared ones live in Sheet.jsx) ─────────────────────────── */

/** Two-click Remove for a saved key (the first click arms, the second deletes). */
function RemoveKey({ name, configured, onSave }) {
  const [armed, setArmed] = useState(false);
  if (!configured) return null;
  return (
    <button
      type="button"
      className={`key-remove ${armed ? "key-remove--armed" : ""}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onSave({ [name]: "" }); // an empty value deletes the stored secret
      }}
      onBlur={() => setArmed(false)}
      title="Kayıtlı bu anahtarı sil"
    >
      {armed ? "Kaldırmayı onayla" : "Kaldır"}
    </button>
  );
}

/** A secret: name, whether one is stored, and a write-only field to replace it. */
function KeyField({
  label,
  note,
  configured,
  status,
  value,
  onChange,
  placeholder,
  multiline,
  removeName,
  onSave,
}) {
  const Input = multiline ? "textarea" : "input";
  return (
    <div className="sp-field sp-key">
      <div className="sp-key-hd">
        <span className="sp-label">{label}</span>
        <span className={`sp-lamp ${configured ? "sp-lamp--on" : ""}`}>
          {status || (configured ? "Bağlı" : "Ayarlanmadı")}
        </span>
        {removeName && <RemoveKey name={removeName} configured={configured} onSave={onSave} />}
      </div>
      {note && <div className="sp-desc">{note}</div>}
      <Input
        className="sp-input sp-mono"
        type={multiline ? undefined : "password"}
        rows={multiline ? 2 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          configured ? "Kaydedildi. Değiştirmek için yeni bir anahtar yapıştırın" : placeholder
        }
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

/* ── Routing + quota readouts ──────────────────────────────────────────────── */

/**
 * Free-tier route health.
 *
 * JARVIS benches a model+key after a 429 and skips it until it recovers, which is
 * what stops the free tier dead-ending on rate limits. Without this panel that is
 * entirely invisible: "I've used up the free quota, back in about 4 minutes" is
 * unverifiable, and a route benched for a day off one bad window has no way back
 * short of re-saving your keys. Read-only apart from the reset.
 */
function QuotaPanel() {
  const [snap, setSnap] = useState(() => quota.snapshot());
  // Countdowns go stale on their own, so re-read while the panel is open.
  useEffect(() => {
    const t = setInterval(() => setSnap(quota.snapshot()), 5000);
    return () => clearInterval(t);
  }, []);

  const benched = snap.benched ?? [];
  const remaining = Object.entries(snap.remaining ?? {});

  const label = (s) => {
    if (s < 60) return `${s} sn`;
    if (s < 3600) return `${Math.round(s / 60)} dk`;
    if (s < 86400) return `${Math.round(s / 3600)} sa`;
    return "yarın";
  };

  return (
    <Group title="Kullanım sınırları">
      <div className="sp-field">
        {benched.length === 0 ? (
          <div className="sp-status">
            <span className="sp-lamp sp-lamp--on">Tüm yönlendirmeler kullanılabilir</span>
          </div>
        ) : (
          <>
            <div className="sp-status">
              <span className="sp-lamp sp-lamp--warn">
                {benched.length} yönlendirme kullanım sınırı nedeniyle dinleniyor
              </span>
              <button
                type="button"
                className="sp-btn sp-btn--quiet"
                onClick={() => {
                  quota.clear();
                  setSnap(quota.snapshot());
                }}
              >
                Tümünü temizle
              </button>
            </div>
            <div className="sp-table">
              {benched.map((b) => (
                <div className="quota-row" key={`${b.route}`}>
                  <span className="quota-route">{b.route.split("\u001f").join(" / ")}</span>
                  <span className="quota-eta">{label(b.secondsLeft)} sonra dönecek</span>
                </div>
              ))}
            </div>
          </>
        )}
        {remaining.length > 0 && (
          <div className="sp-desc">
            Bildirilen kalan:{" "}
            {remaining.map(([k, v]) => `${k.split("\u001f").pop()} ${v}`).join(", ")}
          </div>
        )}
        <More>
          Bir yönlendirme, tek bir anahtar üzerindeki tek bir modeldir. Kullanım sınırına takılınca
          DUNYATEK o yönlendirmeyi dinlendirir ve hata vermek yerine sıradakini kullanır. Temizlemek
          yalnızca sorunun nedenini giderdiyseniz işe yarar.
        </More>
      </div>
    </Group>
  );
}

/**
 * Smart routing (brain/modelRanker.ts). Every model the keys reach is ranked from
 * benchmarks (an LLM with Google Search only estimates the ones the catalog lacks);
 * each request goes to the weakest model that is still good enough, falling through
 * to the next on failure. Re-ranked on its own whenever a key is added or removed.
 */
const TIER_LABEL = { fast: "Hızlı", mid: "Günlük", flagship: "Üst düzey" };
const SOURCE_LABEL = { benchmark: "Kıyaslama", llm: "Tahmini", guess: "Puansız" };

function RoutingSection({ routing, onRerank }) {
  const r = routing || {};
  const models = r.models || [];
  const c = r.counts || {};
  return (
    <Group title="Model sıralaması">
      <div className="sp-field">
        <div className="sp-status">
          <span className={`sp-lamp ${models.length ? "sp-lamp--on" : ""}`}>
            {r.in_progress
              ? "Sıralanıyor…"
              : models.length
                ? `${models.length} model sıralandı`
                : "Henüz sıralanmadı"}
          </span>
          {onRerank && (
            <button
              type="button"
              className="sp-btn sp-btn--quiet"
              disabled={!!r.in_progress}
              onClick={onRerank}
              title="Tüm sağlayıcıların modellerini yeniden okuyun ve kıyaslama verisi olmayanları yeniden araştırın"
            >
              {r.in_progress ? "Sıralanıyor…" : "Yeniden sırala"}
            </button>
          )}
        </div>
        {/* The last ranking run's own outcome already carries the counts, so it
            replaces the computed summary instead of repeating it. */}
        {models.length === 0 && !r.in_progress ? (
          <div className="sp-desc">
            DUNYATEK modellerinizi görebildiği anda sıralar. O zamana kadar yerleşik Gemini ve Groq
            katmanlarını kullanır.
          </div>
        ) : (
          !r.in_progress && (
            <div className="sp-desc">
              {r.last_result ||
                `${models.length} modelden ${c.benchmark || 0} tanesi kıyaslamalarla puanlandı` +
                  (c.llm ? `, ${c.llm} tanesi tahmin edildi` : "") +
                  (c.guess ? `, ${c.guess} tanesi henüz puanlanmadı` : "") +
                  "."}
            </div>
          )
        )}
      </div>
      {models.length > 0 && (
        <div className="route-list">
          {models.map((m, i) => (
            <div className="route-row" key={`${m.provider}/${m.model}`} title={m.basis || ""}>
              <span className="route-n">{i + 1}</span>
              <span className="route-id">{m.model}</span>
              <span className={`route-tier route-tier--${m.tier}`}>
                {TIER_LABEL[m.tier] || m.tier}
              </span>
              <span className="route-score">{m.score}</span>
              <span className={`route-note route-src--${m.source}`}>
                {m.provider}, {(SOURCE_LABEL[m.source] || m.source).toLocaleLowerCase("tr")}
                {m.basis ? ` (${m.basis})` : ""}
                {!m.tools ? ". Yalnızca sohbet, araç çağırma yok" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="sp-field">
        <More>
          Her istek, onu karşılayabilecek en zayıf katmana gider: kısa sohbet Hızlı katmana, günlük
          komutlar Günlük katmana, zor akıl yürütme Üst düzey katmana. O model hata verirse ya da
          kullanım sınırına takılırsa sıradaki devralır; önce daha güçlü, sonra daha zayıf katmanlar
          denenir. Bir anahtar eklediğinizde ya da kaldırdığınızda sıralama kendiliğinden yenilenir.
          <br />
          <br />
          Puanlar Artificial Analysis Intelligence Index’ten gelir ({r.catalog || "kıyaslama"} anlık
          görüntüsü). Kapsamadığı modeller, Yeniden sırala’ya bastığınızda{" "}
          {r.estimated_by || "bir dil modeli"} tarafından Google Arama ile tahmin edilir.
        </More>
      </div>
    </Group>
  );
}

/* ── Settings ──────────────────────────────────────────────────────────────── */

export default function Settings({
  sysInfo,
  onClose,
  onSave,
  onSetLocation,
  onRefreshModels,
  onRerankModels,
  onRepairSetup,
}) {
  // Re-discover models when the panel opens so the dropdown is current (e.g. a
  // local Ollama model pulled since launch, or a key just added in another client).
  // Cheap — the backend skips the network when credentials are unchanged.
  useEffect(() => {
    onRefreshModels && onRefreshModels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per open, not per sysInfo change

  // ponytail: read once on open; resizing across the breakpoint mid-session keeps the first layout.
  const [wide] = useState(() => window.matchMedia?.(WIDE_QUERY).matches ?? false);
  const [page, setPage] = useState(wide ? "models" : null);

  // Android back: leave the page first, then close Settings.
  useAndroidBack(true, () => (!wide && page ? setPage(null) : onClose()));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prefer the backend's per-key discovered list; fall back to the curated set
  // until it lands. Both share the {label, opts:[{value,label}]} shape.
  const modelGroups =
    Array.isArray(sysInfo.available_models) && sysInfo.available_models.length
      ? sysInfo.available_models
      : IS_MOBILE
        ? MOBILE_FALLBACK_GROUPS
        : FALLBACK_GROUPS;
  const allValues = modelGroups.flatMap((g) =>
    g.opts.filter((o) => o.selectable !== false).map((o) => o.value),
  );
  // Local (Ollama) models discovered by the backend — the offline-mode picker.
  const localOpts = modelGroups.find((g) => /ollama|local/i.test(g.label))?.opts ?? [];
  // "" means no override, which the brain treats exactly like "auto".
  const [model, setModel] = useState((sysInfo.model_override ?? sysInfo.model) || "auto");
  // Provider EDITION: vertex | gemini | groq (| offline on desktop). Keep the
  // reported mode verbatim — coercing vertex→gemini silently kicked mobile users
  // off their Vertex AI (GCP credit) tier every time they saved Settings.
  const [providerMode, setProviderMode] = useState(
    sysInfo.provider_mode || (IS_MOBILE ? "auto" : "groq"),
  );
  const [wakeWordOn, setWakeWordOn] = useState(sysInfo.wake_word !== false);
  const [autoSwitch, setAutoSwitch] = useState(sysInfo.auto_switch_models !== false);
  const [offlineModel, setOfflineModel] = useState(sysInfo.offline_model ?? "");
  const [ollamaUrl, setOllamaUrl] = useState(sysInfo.ollama_url ?? "http://localhost:11434");
  const [locInput, setLocInput] = useState("");
  const [grantedFolder, setGrantedFolderState] = useState(() => getGrantedFolder());
  const chooseFolder = async () => {
    const res = await pickGrantedFolder();
    if (res.ok && res.folder) setGrantedFolderState(res.folder);
  };
  const pinnedLoc = sysInfo.manual_location; // {lat,lon,label} or null = automatic
  const pinLocation = () => {
    const p = locInput.trim();
    if (p && onSetLocation) {
      onSetLocation({ place: p });
      setLocInput("");
    }
  };
  const [tts, setTts] = useState(sysInfo.tts ?? "piper");
  const [dirs, setDirs] = useState(sysInfo.allowed_dirs ?? []);
  const [newDir, setNewDir] = useState("");
  const [storageDir, setStorageDir] = useState(sysInfo.storage_dir ?? "");
  const [vertexSaJson, setVertexSaJson] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [mistralKey, setMistralKey] = useState("");
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [mapsKey, setMapsKey] = useState("");
  const [sysAlerts, setSysAlerts] = useState(!!sysInfo.system_alerts);
  const [calendarSync, setCalendarSync] = useState(sysInfo.calendar_sync !== false);
  const [autopilotModel, setAutopilotModel] = useState(sysInfo.autopilot_model ?? "");
  const [autopilotThinking, setAutopilotThinking] = useState(
    (sysInfo.autopilot_thinking ?? -1) === 0 ? "off" : "dynamic",
  );
  const [autopilotVision, setAutopilotVision] = useState(sysInfo.autopilot_vision !== false);
  const [ovlEnabled, setOvlEnabled] = useState(sysInfo.overlay?.enabled !== false);
  const [ovlApps, setOvlApps] = useState(sysInfo.overlay?.apps ?? []);
  // Preserve whatever mode is in effect (it can be changed by voice via
  // set_overlay) so saving Settings doesn't silently reset it to "except".
  const [ovlMode] = useState(sysInfo.overlay?.mode ?? "except");
  const [newApp, setNewApp] = useState("");

  const addApp = () => {
    const a = newApp
      .trim()
      .toLowerCase()
      .replace(/\.exe$/, "");
    if (a && !ovlApps.includes(a)) setOvlApps([...ovlApps, a]);
    setNewApp("");
  };
  const removeApp = (a) => setOvlApps(ovlApps.filter((x) => x !== a));

  const addDir = () => {
    const d = newDir.trim().replace(/^["']|["']$/g, "");
    if (d && !dirs.includes(d)) setDirs([...dirs, d]);
    setNewDir("");
  };
  const removeDir = (d) => setDirs(dirs.filter((x) => x !== d));

  const buildCfg = () => {
    // Image models are intentionally not chat models. A hand-typed image id must
    // not sneak around the disabled entry in the model picker.
    const chatModel = modelClassFor(model) === "image" ? "auto" : model;
    const cfg = {
      model_override: chatModel,
      tts,
      allowed_dirs: dirs,
      system_alerts: sysAlerts,
      calendar_sync: calendarSync,
      overlay: { enabled: ovlEnabled, mode: ovlMode, apps: ovlApps },
      autopilot_model: autopilotModel.trim(),
      autopilot_thinking: autopilotThinking === "off" ? 0 : -1,
      autopilot_vision: autopilotVision,
      provider_mode: providerMode,
    };
    cfg.auto_switch_models = autoSwitch;
    if (IS_MOBILE) cfg.wake_word = wakeWordOn;
    // Offline-only fields — sent just for the offline edition so switching modes
    // doesn't trigger needless model re-discovery.
    if (providerMode === "offline") {
      cfg.offline_model = offlineModel.trim();
      cfg.ollama_url = ollamaUrl.trim();
    }
    if (storageDir.trim()) cfg.storage_dir = storageDir.trim();
    if (vertexSaJson.trim()) cfg.vertex_sa_json = vertexSaJson.trim();
    if (groqKey.trim()) cfg.groq_api_key = groqKey.trim();
    if (geminiKey.trim()) cfg.gemini_api_key = geminiKey.trim();
    if (openrouterKey.trim()) cfg.openrouter_api_key = openrouterKey.trim();
    if (mistralKey.trim()) cfg.mistral_api_key = mistralKey.trim();
    if (nvidiaKey.trim()) cfg.nvidia_api_key = nvidiaKey.trim();
    if (elevenKey.trim()) cfg.elevenlabs_api_key = elevenKey.trim();
    if (mapsKey.trim()) cfg.google_maps_key = mapsKey.trim();
    return cfg;
  };
  const cfgNow = JSON.stringify(buildCfg());
  const [cfgOnOpen] = useState(cfgNow);
  const dirty = cfgNow !== cfgOnOpen;

  const handleSave = () => {
    onSave(buildCfg());
    onRefreshModels && onRefreshModels();
    onClose();
  };

  const geminiSelected = isGemini(model);
  const nativeAudio = /native-audio/.test(model);
  const imageModelSelected = modelClassFor(model) === "image";

  /* ── Pages ── */

  const desktopModelsPage = (
    <>
      <Group title="Sağlayıcı">
        <Field>
          <select
            className="sp-input"
            value={providerMode}
            onChange={(e) => setProviderMode(e.target.value)}
            aria-label="Yapay zekâ sağlayıcısı"
          >
            <option value="vertex">Vertex AI — Google Cloud kredilerinizle Gemini</option>
            <option value="gemini">Gemini API anahtarı — yedek olarak Groq</option>
            <option value="offline">Çevrimdışı — yerel bir Ollama modeli, bulut yok</option>
          </select>
          {providerMode === "vertex" &&
            (sysInfo.has_vertex_sa ? (
              <div className="sp-desc">
                gcloud oturumunuz üzerinden Google Cloud projenize faturalandırılır. Oturum
                algılandı.
              </div>
            ) : (
              <Warn>
                gcloud oturumu bulunamadı. <code>gcloud auth application-default login</code>{" "}
                komutunu çalıştırın.
              </Warn>
            ))}
          {providerMode === "gemini" &&
            (sysInfo.has_gemini_key ? (
              <div className="sp-desc">Gemini, API anahtarınızla çalışır. Vertex kapalı kalır.</div>
            ) : (
              <Warn>API anahtarları bölümüne bir Gemini anahtarı ekleyin.</Warn>
            ))}
        </Field>
        {providerMode === "offline" && (
          <>
            <Field
              label="Yerel model"
              hint="Bulut katmanlarından daha yavaş ve daha az yeteneklidir. Komutlar yine çalışır."
            >
              <select
                className="sp-input"
                value={offlineModel}
                onChange={(e) => setOfflineModel(e.target.value)}
              >
                <option value="">Otomatik — ilk yüklü model</option>
                {localOpts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {localOpts.length === 0 && (
                <Warn>
                  {ollamaUrl} adresinde yerel model yok. Ollama’yı kurun, ardından bir model
                  indirin, örneğin <code>ollama pull llama3.1</code>.
                </Warn>
              )}
            </Field>
            <Field label="Ollama adresi">
              <input
                type="text"
                className="sp-input sp-mono"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434"
              />
            </Field>
          </>
        )}
      </Group>

      <Group title="Sohbet modeli">
        <Field>
          <select
            className="sp-input"
            value={allValues.includes(model) ? model : "__custom"}
            onChange={(e) => {
              if (e.target.value !== "__custom") setModel(e.target.value);
            }}
            aria-label="Sohbet modeli"
          >
            {modelGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.opts.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.selectable === false}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {!allValues.includes(model) && <option value="__custom">Özel: {model}</option>}
          </select>
          {geminiSelected && sysInfo.has_vertex_sa && (
            <div className="sp-desc">Google Cloud kredilerinizle Vertex AI üzerinden sunulur.</div>
          )}
          {geminiSelected && !sysInfo.has_vertex_sa && !sysInfo.has_gemini_key && (
            <Warn>
              Bu bir Gemini modeli. API anahtarları bölümüne bir Gemini anahtarı ekleyin ya da
              gcloud ile Vertex’te oturum açın.
            </Warn>
          )}
          {imageModelSelected && (
            <Warn>
              Görsel modelleri yalnızca görsel üretir; bu yüzden kaydettiğinizde sohbet için
              Otomatik kalır. DUNYATEK’ten bir görsel istediğinizde bu modeli kendiliğinden
              kullanır.
            </Warn>
          )}
          {nativeAudio && (
            <div className="sp-desc">
              Yerel ses modelleri Google’ın Live API’si üzerinden konuşur: araya girilebilen çift
              yönlü ses; Whisper ya da TTS gerekmez. Yazılı mesajlar bir Gemini metin modeli
              kullanır. Vertex ya da bir Gemini anahtarı gerekir.
            </div>
          )}
          <details className="sp-more" open={!allValues.includes(model)}>
            <summary>Model kimliği kullan</summary>
            <input
              type="text"
              className="sp-input sp-mono"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="tam model kimliği"
              spellCheck={false}
            />
          </details>
          <More>
            Otomatik modda her istek, anahtarınız olan tüm sağlayıcılar arasında onu
            karşılayabilecek en zayıf sıralı modele gider. Sıralama Yönlendirme bölümündedir. Görsel
            istekleri sohbeti atlayıp doğrudan yalnızca görsel üreten bir Gemini modeline gider.
          </More>
        </Field>
        <Toggle
          label="Model kullanılamadığında yedeğe geç"
          checked={autoSwitch}
          onChange={setAutoSwitch}
          hint={
            autoSwitch
              ? "Modeliniz kullanım sınırına takılır ya da çalışmazsa yönlendirme sırasındaki bir sonraki model yanıt verir ve yanıtta bu belirtilir."
              : "Yalnızca bu model kullanılır. Birden fazla anahtarı varsa yine sırayla kullanılır. Sınır dolduğunda istek başarısız olur ve bu belirtilir."
          }
        />
      </Group>
    </>
  );

  // Phone: the provider list is Auto plus every provider you have a key for, and
  // the model list is exactly what those keys reach (sysInfo.reachable_models). An
  // option's value carries its provider ("groq::llama-…"): the same id can be
  // served by two providers, and picking a model picks its provider too.
  const keyedProviders = ["gemini", "vertex", "groq", "openrouter", "nvidia", "mistral"].filter(
    (p) => (p === "vertex" ? sysInfo.has_vertex_sa : sysInfo[`has_${p}_key`]),
  );
  const reachable = (sysInfo.reachable_models || []).filter(
    (g) => providerMode === "auto" || g.provider === providerMode,
  );
  const modelValue = model === "auto" ? "auto" : `${providerMode}::${model}`;
  const modelListed = reachable.some((g) =>
    g.models.some((m) => `${g.provider}::${m}` === modelValue),
  );
  const providerName = PROVIDER_NAME[providerMode] || providerMode;
  const pickProvider = (next) => {
    setProviderMode(next);
    // A model the new provider can't serve would silently stop routing.
    const stays =
      next === "auto" ||
      (sysInfo.reachable_models || []).some((g) => g.provider === next && g.models.includes(model));
    if (!stays) setModel("auto");
  };
  const fallbackHint =
    model !== "auto"
      ? autoSwitch
        ? `${model} kullanım sınırına takılır ya da çalışmazsa önce başka bir ${providerName} modeli, sonra diğer sağlayıcılar yanıt verir. Yanıtta bu belirtilir.`
        : `Yalnızca ${model} kullanılır. Birden fazla anahtarı varsa yine sırayla kullanılır. Sınır dolduğunda istek başarısız olur ve bu belirtilir.`
      : autoSwitch
        ? `Tüm ${providerName} modelleri kullanım sınırına takılır ya da çalışmazsa başka bir sağlayıcı yanıt verir ve yanıtta bu belirtilir.`
        : `Yalnızca ${providerName} modelleri kullanılır. Hepsinin sınırı dolduğunda istek başarısız olur ve bu belirtilir.`;

  const mobileModelsPage = (
    <>
      <Group title="Sağlayıcı">
        <Field
          hint={
            providerMode === "auto"
              ? "Her istek, tüm anahtarlarınız arasındaki en iyi modele gider."
              : `Sohbet ve telefon görevleri ${providerName} kullanır. Sesli giriş bundan etkilenmez.`
          }
        >
          <select
            className="sp-input"
            value={providerMode}
            onChange={(e) => pickProvider(e.target.value)}
            aria-label="Yapay zekâ sağlayıcısı"
          >
            <option value="auto">Otomatik</option>
            {keyedProviders.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_NAME[p]}
              </option>
            ))}
            {providerMode !== "auto" && !keyedProviders.includes(providerMode) && (
              <option value={providerMode}>{providerName} (anahtar yok)</option>
            )}
          </select>
          {["openrouter", "nvidia", "mistral"].includes(providerMode) && (
            <Warn>
              {providerName} ücretsiz modelleri ortak kapasitede çalışır ve sık sık yoğun olur; bu
              yüzden yanıtlar yavaş gelebilir ya da başarısız olabilir.
            </Warn>
          )}
        </Field>
      </Group>

      <Group title="Sohbet modeli">
        <Field
          hint={
            model !== "auto"
              ? `Her istek ${providerName} üzerindeki ${model} modeline gider.`
              : providerMode === "auto"
                ? "DUNYATEK her istek için modeli kendisi seçer: sohbet için hızlı bir model, gerçek işler için daha güçlü bir model."
                : `DUNYATEK her istek için en uygun ${providerName} modelini seçer.`
          }
        >
          <select
            className="sp-input"
            value={modelListed || model === "auto" ? modelValue : "__custom"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom") return;
              if (v === "auto") return setModel("auto");
              const [p, ...rest] = v.split("::");
              setProviderMode(p);
              setModel(rest.join("::"));
            }}
            aria-label="Sohbet modeli"
          >
            <option value="auto">
              {providerMode === "auto" ? "Otomatik" : `Otomatik — en iyi ${providerName} modeli`}
            </option>
            {reachable.map((g) => (
              <optgroup key={g.provider} label={PROVIDER_NAME[g.provider]}>
                {g.models.map((m) => (
                  <option key={m} value={`${g.provider}::${m}`}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))}
            {!modelListed && model !== "auto" && (
              <option value="__custom">{model} (erişilemiyor)</option>
            )}
          </select>
          {reachable.length === 0 && (
            <div className="sp-desc">
              Anahtarlarınızın model listeleri yüklendiğinde modeller burada görünür.
            </div>
          )}
          {!modelListed && model !== "auto" && (
            <Warn>
              Anahtarlarınızın hiçbiri artık {model} modelini listelemiyor. Başka bir model ya da
              Otomatik’i seçin.
            </Warn>
          )}
        </Field>
        {!(providerMode === "auto" && model === "auto") && (
          <Toggle
            label="Kullanılamadığında yedeğe geç"
            checked={autoSwitch}
            onChange={setAutoSwitch}
            hint={fallbackHint}
          />
        )}
        <div className="sp-field">
          <More>
            Otomatik mod her isteği, onu karşılayabilecek en zayıf sıralı modele gönderir; sıralama
            Yönlendirme bölümündedir. O model kullanım sınırına takılırsa sıradaki devralır. Görsel
            istekleri sohbeti atlayıp doğrudan yalnızca görsel üreten bir Gemini modeline gider.
          </More>
        </div>
      </Group>
    </>
  );

  const modelsPage = IS_MOBILE ? mobileModelsPage : desktopModelsPage;

  const routingPage = (
    <>
      <RoutingSection routing={sysInfo.routing} onRerank={onRerankModels} />
      <QuotaPanel />
    </>
  );

  const multiKeyHint =
    "Ücretsiz kullanım sınırları anahtar başınadır. Her satıra bir tane olacak şekilde birkaç anahtar yapıştırın; DUNYATEK sırayla kullanır.";
  const keysPage = (
    <>
      <p className="sp-lede">
        {IS_MOBILE
          ? "Anahtarlar bu cihazda kalır. Kaydedilen bir anahtar bir daha gösterilmez; değiştirmek için yenisini yapıştırın."
          : "Anahtarlar proje klasörünün dışında, uygulama verilerinde saklanır. Kaydedilen bir anahtar bir daha gösterilmez."}
      </p>
      {IS_MOBILE && providerMode === "vertex" ? (
        <Group title="Vertex AI">
          <KeyField
            label="Hizmet hesabı JSON’u"
            configured={sysInfo.has_vertex_sa}
            status={sysInfo.vertex_project ? `Proje ${sysInfo.vertex_project}` : undefined}
            note="Gemini sohbetini Google Cloud kredilerinizle çalıştırır."
            value={vertexSaJson}
            onChange={setVertexSaJson}
            placeholder="JSON dosyasının tamamını yapıştırın"
            multiline
          />
          <KeyField
            label="Groq"
            configured={sysInfo.has_groq_key}
            note="İsteğe bağlı. “Hey Jarvis” ve sesli giriş için Chirp yerine Whisper kullanır. Sohbet Vertex’te kalır."
            value={groqKey}
            onChange={setGroqKey}
            placeholder="gsk_…"
            removeName="groq_api_key"
            onSave={onSave}
          />
        </Group>
      ) : (
        <Group title="Sohbet ve ses">
          <KeyField
            label="Groq"
            configured={sysInfo.has_groq_key}
            note="Sesli giriş ve sohbet."
            value={groqKey}
            onChange={setGroqKey}
            placeholder="gsk_…  her satıra bir tane"
            multiline
            removeName="groq_api_key"
            onSave={onSave}
          />
          <KeyField
            label={IS_MOBILE ? "Google" : "Gemini"}
            configured={sysInfo.has_gemini_key}
            value={geminiKey}
            onChange={setGeminiKey}
            placeholder={
              IS_MOBILE ? "AIza… veya AQ.…  her satıra bir tane" : "AIza…  her satıra bir tane"
            }
            multiline
            removeName="gemini_api_key"
            onSave={onSave}
          />
          <div className="sp-field">
            <div className="sp-desc">{multiKeyHint}</div>
          </div>
        </Group>
      )}
      {IS_MOBILE && (
        <Group title="Ek ücretsiz sağlayıcılar">
          {[
            ["OpenRouter", "openrouter", openrouterKey, setOpenrouterKey, "sk-or-…"],
            ["NVIDIA NIM", "nvidia", nvidiaKey, setNvidiaKey, "nvapi-…"],
            ["Mistral", "mistral", mistralKey, setMistralKey, "Mistral API anahtarı"],
          ].map(([label, id, value, set, hint]) => (
            <KeyField
              key={id}
              label={label}
              configured={sysInfo[`has_${id}_key`]}
              value={value}
              onChange={set}
              placeholder={hint}
              removeName={`${id}_api_key`}
              onSave={onSave}
            />
          ))}
          <div className="sp-field">
            <div className="sp-desc">
              Daha fazla ücretsiz kota. Ücretsiz modelleri bulunur ve Gemini ile Groq’un yanında
              sıralanır.
            </div>
            <Warn>
              Bir telefon görevi sırasında yedek sağlayıcının yanıtladığı isteklere ekrandakiler de
              dahildir. Mistral’ın ücretsiz katmanı kendisine gönderilen verilerle model eğitir.
            </Warn>
          </div>
        </Group>
      )}
      {!IS_MOBILE && (
        <Group title="Ses ve yerler">
          <KeyField
            label="ElevenLabs"
            configured={sysInfo.has_elevenlabs_key}
            note="Premium metin okuma."
            value={elevenKey}
            onChange={setElevenKey}
            placeholder="ElevenLabs API anahtarı"
          />
          <KeyField
            label="Google Maps"
            configured={sysInfo.has_google_maps_key || sysInfo.places_source === "google"}
            status={
              !sysInfo.has_google_maps_key && sysInfo.places_source === "google"
                ? "Vertex üzerinden"
                : undefined
            }
            note={
              sysInfo.places_source === "google"
                ? "Yakındaki yerler ve mesafeler doğru gösterilir. Etkin."
                : "OpenStreetMap yerine yakındaki yerleri ve mesafeleri doğru gösterir. Vertex kullanıyorsanız projenizde “Places API (New)”u etkinleştirmeniz yeterlidir."
            }
            value={mapsKey}
            onChange={setMapsKey}
            placeholder="AIza…"
          />
        </Group>
      )}
    </>
  );

  const voicePage = (
    <Group>
      {IS_MOBILE ? (
        <>
          <Toggle
            label="“Hey Jarvis” uyandırma sözü"
            checked={wakeWordOn}
            onChange={setWakeWordOn}
            hint="Dinleme telefonun kendisinde yapılır. Uyandırma sözü duyulana kadar hiçbir şey gönderilmez."
          />
          <div className="sp-field">
            <More>
              Mikrofon izni gerekir. Konuşmayı yazıya çevirmek için Vertex’te Cloud Speech-to-Text,
              Groq ve Gemini’de Groq Whisper kullanılır. Yanıtlar telefonun yerleşik metin okuma
              özelliğiyle seslendirilir.
            </More>
          </div>
        </>
      ) : (
        <Field label="Ses">
          <select className="sp-input" value={tts} onChange={(e) => setTts(e.target.value)}>
            {TTS_OPTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {tts === "piper" && (
            <div className="sp-desc">
              Gizli ve sınırsız. 60 MB’lık ses, DUNYATEK ilk kez konuştuğunda indirilir.
            </div>
          )}
          {tts === "elevenlabs" &&
            (sysInfo.has_elevenlabs_key ? (
              <div className="sp-desc">
                En doğal ses, ancak ücretsiz katman ayda yaklaşık 10 bin karakterle sınırlıdır.
              </div>
            ) : (
              <Warn>ElevenLabs bir anahtar gerektirir. API anahtarları bölümüne ekleyin.</Warn>
            ))}
        </Field>
      )}
      <div className="sp-field sp-row">
        <span className="sp-label">Uyandırma sözü</span>
        <span className="sp-value sp-mono">{sysInfo.wakeWord || "hey_jarvis"}</span>
      </div>
    </Group>
  );

  const automationPage = (
    <>
      <Group title="Otopilot">
        <Field
          label="Model"
          hint={
            sysInfo.autopilot_model_active
              ? `Çok adımlı tarayıcı ve masaüstü görevlerini yürütür. Şu an ${sysInfo.autopilot_model_active} kullanılıyor.`
              : "Çok adımlı tarayıcı ve masaüstü görevlerini yürütür. Otomatik için boş bırakın."
          }
        >
          <input
            type="text"
            className="sp-input sp-mono"
            value={autopilotModel}
            onChange={(e) => setAutopilotModel(e.target.value)}
            placeholder="auto, bir model kimliği ya da ollama:llama3.1"
            spellCheck={false}
          />
        </Field>
        <Field
          label="Adım akıl yürütmesi"
          hint="Dinamik, zorlu adımlarda daha çok düşünür. Kapalı en hızlısıdır ama zor sayfalarda daha kötü hamleler seçer."
        >
          <select
            className="sp-input"
            value={autopilotThinking}
            onChange={(e) => setAutopilotThinking(e.target.value)}
          >
            <option value="dynamic">Dinamik (önerilen)</option>
            <option value="off">Kapalı</option>
          </select>
        </Field>
        <Toggle
          label="Takıldığında ekran görüntülerine bak"
          checked={autopilotVision}
          onChange={setAutopilotVision}
        />
      </Group>
      <Group title="Uyarılar">
        <Toggle
          label="Sistem yükü hakkında sesli uyar"
          checked={sysAlerts}
          onChange={setSysAlerts}
          hint="Yüksek işlemci kullanımı, dolu bellek ya da düşük pil. Gündem hatırlatıcıları ve zamanlayıcılar etkilenmez."
        />
      </Group>
      <Group title="Durum rozeti">
        <Toggle
          label="Diğer uygulamaların üzerinde göster"
          checked={ovlEnabled}
          onChange={setOvlEnabled}
          hint="Ekranın üstündeki küçük bir rozet, DUNYATEK'in dinlediğini ya da çalıştığını gösterir; durdurma düğmesi de vardır."
        />
        {ovlEnabled && (
          <Field label="Bu uygulamalarda gizle">
            <div className="dirlist">
              {ovlApps.length === 0 && (
                <StateMessage variant="empty" icon="info" title="Tüm uygulamalarda gösteriliyor">
                  chrome ya da code gibi bir uygulamanın işlem adını ekleyin.
                </StateMessage>
              )}
              {ovlApps.map((a) => (
                <div key={a} className="dirlist-row">
                  <span className="dirlist-path" title={a}>
                    {a}
                  </span>
                  <button
                    className="dirlist-rm"
                    aria-label={`${a} içinde yeniden göster`}
                    onClick={() => removeApp(a)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="sp-inline">
              <input
                type="text"
                className="sp-input sp-mono"
                value={newApp}
                placeholder="chrome"
                onChange={(e) => setNewApp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addApp()}
              />
              <button type="button" className="sp-btn" onClick={addApp}>
                Gizle
              </button>
            </div>
          </Field>
        )}
      </Group>
    </>
  );

  const locationPage = (
    <Group>
      <div className="sp-field sp-row">
        <span className="sp-label">Geçerli</span>
        <span className="sp-value">
          {pinnedLoc?.label ? pinnedLoc.label.split(",")[0] : "Otomatik"}
        </span>
      </div>
      <Field
        label={pinnedLoc?.label ? "Başka bir yer sabitle" : "Bir yer sabitle"}
        hint={
          IS_MOBILE
            ? "İzin verildiğinde GPS’i, aksi halde IP adresinizi kullanır. Hava durumu ya da mesafeler yanlışsa bölgenizi sabitleyin."
            : "Tarayıcı GPS’ini ya da IP adresinizi kullanır. Sabitlenen yer her yerde bunun yerine geçer. “Konumumu … olarak ayarla” da diyebilirsiniz."
        }
      >
        <div className="sp-inline">
          <input
            type="text"
            className="sp-input"
            value={locInput}
            placeholder="Kadıköy, İstanbul"
            onChange={(e) => setLocInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && pinLocation()}
          />
          <button
            type="button"
            className="sp-btn"
            onClick={pinLocation}
            disabled={!locInput.trim()}
          >
            Sabitle
          </button>
        </div>
        {pinnedLoc?.label && (
          <button
            type="button"
            className="sp-link"
            onClick={() => onSetLocation && onSetLocation({ clear: true })}
          >
            Otomatiğe geri dön
          </button>
        )}
      </Field>
    </Group>
  );

  const calendarPage = (
    <Group>
      <Toggle
        label="Gündem öğelerini telefonumun takvimine ekle"
        checked={calendarSync}
        onChange={(on) => {
          setCalendarSync(on);
          // Ask here, not mid-action: at the moment JARVIS is adding an
          // event it is also launching the calendar, and the permission
          // dialog would lose that race.
          if (on) void requestCalendarPermission();
        }}
        hint="Kayıtlar Google Takvim'de ve diğer cihazlarınızda görünür. Ajandayı yalnızca DUNYATEK içinde tutmak için kapatın."
      />
      <div className="sp-field">
        <More label="Takvim iznini reddederseniz">
          DUNYATEK bunun yerine takvimin kendi yeni etkinlik ekranını açar; böylece öğeyi yine de
          kendiniz ekleyebilirsiniz.
        </More>
      </div>
    </Group>
  );

  const filesPage = IS_MOBILE ? (
    <Group>
      <div className="sp-field sp-row">
        <span className="sp-label">Klasör</span>
        <span className="sp-value sp-mono">{grantedFolder ? grantedFolder.name : "Yok"}</span>
      </div>
      <Field hint="DUNYATEK bu klasörü listeleyip içindeki metin dosyalarını okuyabilir. Hiçbir şeyi yazamaz, taşıyamaz ya da silemez.">
        <button type="button" className="sp-btn" onClick={chooseFolder}>
          {grantedFolder ? "Klasörü değiştir" : "Klasör seç"}
        </button>
      </Field>
    </Group>
  ) : (
    <>
      <Group title="DUNYATEK'in kayıt yeri">
        <Field hint="Görseller, kayıtlar ve belgeler buradaki alt klasörlere kaydedilir.">
          <input
            type="text"
            className="sp-input sp-mono"
            value={storageDir}
            onChange={(e) => setStorageDir(e.target.value)}
            placeholder="C:\Users\kullanici\DUNYATEK"
            spellCheck={false}
          />
        </Field>
      </Group>
      <Group title="DUNYATEK'in okuyabileceği klasörler">
        <Field hint="Bu klasörleri listeleyebilir ve içindeki dosyaları her seferinde size sorarak okuyabilir. Hiçbir şeyi çalıştıramaz, yazamaz, taşıyamaz ya da silemez.">
          <div className="dirlist">
            {dirs.length === 0 && (
              <StateMessage variant="empty" icon="folder" title="Henüz klasör yok">
                DUNYATEK’in dosyalarını okuyabilmesi için bir klasör ekleyin.
              </StateMessage>
            )}
            {dirs.map((d) => (
              <div key={d} className="dirlist-row">
                <span className="dirlist-path" title={d}>
                  {d}
                </span>
                <button
                  className="dirlist-rm"
                  aria-label={`${d} klasörünü kaldır`}
                  onClick={() => removeDir(d)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="sp-inline">
            <input
              type="text"
              className="sp-input sp-mono"
              value={newDir}
              placeholder="C:\Users\kullanici\Documents"
              onChange={(e) => setNewDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDir()}
              spellCheck={false}
            />
            <button type="button" className="sp-btn" onClick={addDir}>
              Ekle
            </button>
          </div>
        </Field>
      </Group>
    </>
  );

  const diagnosticsPage = (
    <>
      <Group title="Şu an">
        <div className="sp-field sp-row">
          <span className="sp-label">Sağlayıcı</span>
          <span className="sp-value">
            {PROVIDER_NAME[sysInfo.provider_mode || sysInfo.provider] ||
              sysInfo.provider_mode ||
              sysInfo.provider}
          </span>
        </div>
        {sysInfo.ram != null && (
          <div className="sp-field sp-row">
            <span className="sp-label">Kullanılabilir bellek</span>
            <span className="sp-value sp-mono">{sysInfo.ram} GB</span>
          </div>
        )}
      </Group>
      <Group title={IS_MOBILE ? "Bağlantı" : "Bileşenler"}>
        <Field
          hint={
            IS_MOBILE
              ? "Ağı ve anahtarlarınızın Groq ile Gemini’ye erişip erişemediğini denetler."
              : "Bir özellik kurulum gerektiğini söylerse tarayıcı motorunu, konuşma modelini ya da sesi yeniden indirir. İlerleme ana ekranda gösterilir."
          }
        >
          <button
            type="button"
            className="sp-btn"
            onClick={() => {
              if (onRepairSetup) onRepairSetup();
              onClose();
            }}
            disabled={!onRepairSetup}
          >
            {IS_MOBILE ? "Bağlantı testini çalıştır" : "Bileşenleri onar"}
          </button>
        </Field>
      </Group>
    </>
  );

  /* ── Index: every page with its live readout ── */

  const keyFlags = IS_MOBILE
    ? ["vertex_sa", "groq_key", "gemini_key", "openrouter_key", "nvidia_key", "mistral_key"]
    : ["groq_key", "gemini_key", "elevenlabs_key", "google_maps_key"];
  const keyCount = keyFlags.filter((k) => sysInfo[`has_${k}`]).length;
  const rankedCount = sysInfo.routing?.models?.length ?? 0;
  const restingCount = quota.snapshot().benched?.length ?? 0;

  // tone: "on" = configured/active, "off" = inactive, "warn" = needs attention.
  // Each inner array is one group in the nav.
  const sections = [
    [
      {
        id: "models",
        title: "Modeller",
        icon: "sparkle",
        value: model !== "auto" ? model : PROVIDER_NAME[providerMode] || providerMode,
        tone: "on",
        body: modelsPage,
      },
      {
        id: "routing",
        title: "Yönlendirme",
        icon: "route",
        value: restingCount
          ? `${restingCount} dinleniyor`
          : rankedCount
            ? `${rankedCount} sıralı`
            : "Sıralanmadı",
        tone: restingCount ? "warn" : rankedCount ? "on" : "off",
        body: routingPage,
      },
      {
        id: "keys",
        title: "API anahtarları",
        icon: "key",
        value: keyCount ? `${keyCount} bağlı` : "Yok",
        tone: keyCount ? "on" : "warn",
        body: keysPage,
      },
    ],
    [
      {
        id: "voice",
        title: "Ses",
        icon: "mic",
        value: IS_MOBILE
          ? wakeWordOn
            ? "Uyandırma sözü açık"
            : "Uyandırma sözü kapalı"
          : TTS_OPTS.find((o) => o.value === tts)?.short || tts,
        tone: (IS_MOBILE ? wakeWordOn : tts !== "off") ? "on" : "off",
        body: voicePage,
      },
      !IS_MOBILE && {
        id: "automation",
        title: "Otomasyon",
        icon: "robot",
        value: autopilotModel.trim() || "Otomatik",
        tone: "on",
        body: automationPage,
      },
      {
        id: "location",
        title: "Konum",
        icon: "pin",
        value: pinnedLoc?.label ? pinnedLoc.label.split(",")[0] : "Otomatik",
        tone: "on",
        body: locationPage,
      },
      {
        id: "calendar",
        title: "Takvim",
        icon: "calendar",
        value: calendarSync ? "Eşitleniyor" : "Yalnızca uygulamada",
        tone: calendarSync ? "on" : "off",
        body: calendarPage,
      },
      {
        id: "files",
        title: "Dosyalar",
        icon: "folder",
        value: IS_MOBILE ? grantedFolder?.name || "Klasör yok" : `${dirs.length} klasör`,
        tone: (IS_MOBILE ? grantedFolder : dirs.length) ? "on" : "off",
        body: filesPage,
      },
    ],
    [
      {
        id: "diagnostics",
        title: "Tanılama",
        icon: "activity",
        value: "",
        tone: null,
        body: diagnosticsPage,
      },
    ],
  ].map((group) => group.filter(Boolean));

  const current = sections.flat().find((p) => p.id === page);
  const drilled = !wide && current;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className={`sp ${wide ? "sp--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Ayarlar"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sp-hdr">
          {drilled ? (
            <button type="button" className="sp-back" onClick={() => setPage(null)}>
              <Icon name="chevronLeft" size={18} />
              <span>Ayarlar</span>
            </button>
          ) : (
            <h2 className="sp-title">Ayarlar</h2>
          )}
          <button type="button" className="sp-close" onClick={onClose} aria-label="Ayarları kapat">
            <Icon name="close" size={18} />
          </button>
        </header>

        {/* On the phone each page starts at the top, not at the index's scroll. */}
        <div className="sp-body" key={wide ? "wide" : page || "index"}>
          {(wide || !current) && (
            <nav className="sp-nav" aria-label="Ayar bölümleri">
              {sections.map((group) => (
                <div className="sp-nav-group" key={group[0].id}>
                  {group.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className={`sp-nav-row ${p.id === page ? "is-current" : ""}`}
                      aria-current={p.id === page ? "page" : undefined}
                      onClick={() => setPage(p.id)}
                    >
                      <Icon name={p.icon} size={18} className="sp-nav-ico" />
                      <span className="sp-nav-title">{p.title}</span>
                      {p.value && (
                        <span className={`sp-readout ${p.tone ? `sp-readout--${p.tone}` : ""}`}>
                          {p.value}
                        </span>
                      )}
                      {!wide && <Icon name="chevronRight" size={16} className="sp-nav-chev" />}
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          )}
          {current && (
            <div className="sp-page" key={current.id}>
              <h2 className="sp-page-title">{current.title}</h2>
              {current.body}
            </div>
          )}
        </div>

        <footer className="sp-foot">
          <span className="sp-foot-note" aria-live="polite">
            {dirty ? "Kaydedilmemiş değişiklikler" : ""}
          </span>
          <button
            type="button"
            className={`sp-btn ${dirty ? "sp-btn--primary" : ""}`}
            onClick={handleSave}
          >
            Değişiklikleri kaydet
          </button>
        </footer>
      </div>
    </div>
  );
}
