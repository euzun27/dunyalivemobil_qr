import { SimplePC } from "./simplePc";

const KEY = "dunyatek_simple_pc_v1";
let config = null;
try {
  const raw = localStorage.getItem(KEY);
  if (raw) config = JSON.parse(raw);
} catch {}

let state = "idle";
let messages = [];
let client = null;
const listeners = new Set();

// Cached snapshot object - only replaced when data actually changes, so
// useSyncExternalStore does not loop forever re-rendering.
let snapshot = { config, state, messages };
function refreshSnapshot() {
  snapshot = { config, state, messages };
}

function emit() {
  refreshSnapshot();
  listeners.forEach((fn) => fn());
}

function setState(s) {
  state = s;
  emit();
}

function saveConfig(cfg) {
  config = cfg;
  try {
    if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
    else localStorage.removeItem(KEY);
  } catch {}
  emit();
}

export const simplePcStore = {
  getSnapshot() {
    return snapshot;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async pair({ host, port, secure, key }) {
    this.disconnect();
    client = new SimplePC({
      host,
      port,
      secure,
      onStateChange: setState,
      onMessage: (msg) => {
        messages = [...messages.slice(-49), msg];
        emit();
      },
    });
    const ok = await client.connect(key);
    if (ok) saveConfig({ host, port, secure: !!secure });
    return ok;
  },
  disconnect() {
    client?.close();
    client = null;
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
};