import { useSyncExternalStore } from "react";
import { simplePcStore } from "../brain/remote/simpleStore";

export function useSimplePc() {
  const snap = useSyncExternalStore(simplePcStore.subscribe, simplePcStore.getSnapshot);
  return {
    config: snap.config,
    state: snap.state,
    messages: snap.messages,
    pair: (args) => simplePcStore.pair(args),
    unpair: () => simplePcStore.unpair(),
    sendCommand: (text) => simplePcStore.sendCommand(text),
  };
}
