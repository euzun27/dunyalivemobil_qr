import { useSyncExternalStore } from "react";
import { simplePcStore } from "../brain/remote/simpleStore";

export function useSimplePc() {
  const snap = useSyncExternalStore(simplePcStore.subscribe, simplePcStore.getSnapshot);
  return {
    config: snap.config,
    state: snap.state,
    messages: snap.messages,
    voice: snap.voice,
    lastError: snap.lastError,
    pair: (args) => simplePcStore.pair(args),
    unpair: () => simplePcStore.unpair(),
    reconnect: () => simplePcStore.reconnect(),
    sendCommand: (text) => simplePcStore.sendCommand(text),
    startVoice: () => simplePcStore.startVoice(),
    stopVoice: () => simplePcStore.stopVoice(),
  };
}
