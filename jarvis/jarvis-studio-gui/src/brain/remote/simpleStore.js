import { SimplePC, findReachableHost } from "./simplePc";

/* DUNYATEK - telefon, bilgisayardaki DUNYATEK'in uzaktan kumandasi.
 * Eslesmis bir PC varsa uygulama acilir acilmaz ona baglanir, baglanti koparsa
 * 5 sn'de bir yeniden dener ve baglaninca canli sesli gorusmeyi kendisi baslatir.
 */

const KEY = "dunyatek_simple_pc_v1";
const RETRY_MS = 5000;
let config = null;
try {
  const raw = localStorage.getItem(KEY);
  if (raw) config = JSON.parse(raw);
} catch {
  /* bozuk kayit - eslesmemis say */
}

let state = "idle";
let messages = [];
let voice = false;
let client = null;
// Kullanici "Konusmayi bitir" dediyse, bir sonraki baglantiya kadar sesi kendimiz acmayiz.
let voiceStoppedByUser = false;
let lastError = "";
const listeners = new Set();

// Cached snapshot object - only replaced when data actually changes, so
// useSyncExternalStore does not loop forever re-rendering.
let snapshot = { config, state, messages, voice, lastError };
function refreshSnapshot() {
  snapshot = { config, state, messages, voice, lastError };
}

function emit() {
  refreshSnapshot();
  listeners.forEach((fn) => fn());
}

function setState(s) {
  const was = state;
  state = s;
  emit();
  if (s === "online" && was !== "online") {
    voiceStoppedByUser = false;
    // Baglanti kurulunca canli gorusmeyi kendiliginden ac.
    setTimeout(() => void simplePcStore.startVoice().catch(voiceFailed), 0);
  }
}

function saveConfig(cfg) {
  config = cfg;
  try {
    if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
    else localStorage.removeItem(KEY);
  } catch {
    /* depolama yoksa sadece bellekte tut */
  }
  emit();
}

let reconnecting = false;

// Mikrofon acilamadiysa (izin yok vb.) her 5 sn'de tekrar sormayalim.
function voiceFailed(e) {
  voiceStoppedByUser = true;
  lastError = `Mikrofon: ${e?.message || e}`;
  emit();
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function makeClient(host, port, secure) {
  return new SimplePC({
    host,
    port,
    secure,
    onStateChange: setState,
    onMessage: (msg) => {
      messages = [...messages.slice(-49), msg];
      emit();
    },
  });
}

export const simplePcStore = {
  getSnapshot() {
    return snapshot;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Eslesmis (QR ile en az bir kez baglanmis) bir PC var mi? */
  get paired() {
    return Boolean(config?.host);
  },
  /** extraHosts: QR'daki Tailscale adres(ler)i - telefon ayni Wi-Fi'da degilse. */
  async pair({ host, port, secure, key, extraHosts = [] }) {
    this.disconnect();
    setState("connecting");
    const candidates = uniq([host, ...extraHosts]);
    const reach = (await findReachableHost(candidates, port, secure)) || host;
    client = makeClient(reach, port, secure);
    const ok = await client.connect(key);
    if (ok) {
      const info = client.loginInfo || {};
      saveConfig({
        host: reach,
        port,
        secure: !!secure,
        // PC'nin bildirdigi adresler (Wi-Fi + Tailscale) ve kalici cihaz anahtari.
        hosts: uniq([...candidates, ...(Array.isArray(info.hosts) ? info.hosts : [])]),
        deviceToken: info.device_token || null,
      });
    }
    return ok;
  },
  /**
   * QR okutmadan yeniden baglan: kayitli adreslerin hepsini (ayni Wi-Fi + Tailscale)
   * ayni anda yoklar, cevap veren adrese baglanir. Evden uzaktan yonetim icin.
   */
  async reconnect() {
    if (!config?.deviceToken || reconnecting) return false;
    if (client && state === "online") return true;
    reconnecting = true;
    try {
      const hosts = uniq([config.host, ...(config.hosts || [])]);
      setState("connecting");
      const host = await findReachableHost(hosts, config.port, config.secure);
      if (!host) {
        lastError = `PC'ye ulasilamadi (${hosts.join(", ")})`;
        setState("offline");
        return false;
      }
      client?.close();
      client = makeClient(host, config.port, config.secure);
      if (await client.reconnect(config.deviceToken)) {
        const info = client.loginInfo || {};
        lastError = "";
        saveConfig({
          ...config,
          host,
          hosts: uniq([...hosts, ...(Array.isArray(info.hosts) ? info.hosts : [])]),
        });
        return true;
      }
      lastError = `${host}: ${client.lastError || state}`;
      emit();
      return false;
    } finally {
      reconnecting = false;
    }
  },
  disconnect() {
    client?.close();
    client = null;
    voice = false;
    setState("idle");
  },
  unpair() {
    this.disconnect();
    saveConfig(null);
    messages = [];
    emit();
  },
  sendCommand(text) {
    return client?.sendCommand(text) || false;
  },
  async startVoice() {
    if (!client || voice || state !== "online") return voice;
    const ok = await client.startVoice(() => {
      voice = false;
      emit();
    });
    voice = ok;
    emit();
    return ok;
  },
  stopVoice() {
    voiceStoppedByUser = true;
    client?.stopVoice();
    voice = false;
    emit();
  },
  async toggleVoice() {
    if (voice) {
      this.stopVoice();
      return false;
    }
    return this.startVoice();
  },
};

// Uygulama acikken eslesmis PC'ye bagli kal: acilista hemen, koparsa 5 sn'de bir dene.
// Ses baglantisi kendi kendine koptuysa (PC yeniden basladi vb.) onu da geri ac.
let voiceRestarts = 0;
let wakeLock = null;

function visible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

// Canli gorusme surerken telefon ekrani kendiliginden kapanmasin: ekran kapaninca
// Android uygulamayi duraklatir ve ses gitmez.
async function syncWakeLock() {
  const want = voice && visible();
  try {
    if (want && !wakeLock && navigator.wakeLock?.request) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener?.("release", () => {
        wakeLock = null;
      });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null; // desteklenmiyorsa sorun degil
  }
}

async function restartVoice() {
  client?.stopVoice();
  voice = false;
  emit();
  voiceRestarts += 1;
  if (voiceRestarts > 2) {
    // Ses defalarca acilamiyor: ana baglanti da olu olabilir - bastan baglan.
    voiceRestarts = 0;
    client?.close();
    client = null;
    setState("offline");
    return;
  }
  const ok = await simplePcStore.startVoice().catch(voiceFailed);
  if (ok) voiceRestarts = 0;
}

function keepAlive() {
  void syncWakeLock();
  if (!visible()) return; // arka planda Android zaten her seyi duraklatir
  if (config?.deviceToken && !reconnecting && (state === "idle" || state === "offline")) {
    void simplePcStore.reconnect();
  } else if (state === "online" && !voice && !voiceStoppedByUser) {
    void simplePcStore.startVoice().catch(voiceFailed);
  } else if (state === "online" && voice && client && !client.voiceHealthy()) {
    // Baglanti "cevrimici" gorunuyor ama ses akmiyor (ekran kapanip acildi vb.)
    void restartVoice();
  }
}
if (typeof window !== "undefined") {
  setTimeout(keepAlive, 500);
  setInterval(keepAlive, RETRY_MS);
  // Uygulamaya/ekrana geri donulunce beklemeden toparla.
  document.addEventListener("visibilitychange", () => {
    if (visible()) setTimeout(keepAlive, 300);
    else void syncWakeLock();
  });
}
