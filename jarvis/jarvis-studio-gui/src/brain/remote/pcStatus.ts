/**
 * DUNYATEK - PC'deki asistanin durumu (HUD reaktor cekirdegi icin).
 *
 * PC zaten iki mesaj gonderiyor (dunya_live main.py), yenisi gerekmez:
 *   {type:"speaking", state:true|false}      - konusmaya basladi / bitti
 *   {type:"log", speaker:"user"|"jarvis"}     - konusma satirlari
 * Buradan HUD'un bildigi durumlar cikarilir: idle | listening | thinking | speaking.
 *
 * Saf fonksiyon: yan etkisi yok, saat disaridan verilir (test edilebilir).
 */

export type PcHudStatus = "idle" | "listening" | "thinking" | "speaking";

export interface PcStatusState {
  readonly status: PcHudStatus;
  readonly thinkingAt: number;
}

export type PcStatusEvent =
  | { kind: "msg"; msg: unknown; now?: number }
  | { kind: "voice"; now?: number }
  | { kind: "conn"; now?: number }
  | { kind: "tick"; now?: number };

/** Olaydan SONRAKI baglanti ve ses durumu. */
export interface PcStatusContext {
  online: boolean;
  voice: boolean;
}

// Kullanici konustuktan sonra PC bu sure icinde konusmaya baslamazsa "dusunuyor"dan cik.
export const THINKING_TIMEOUT_MS = 12000;

export const INITIAL_PC_STATUS: PcStatusState = Object.freeze({ status: "idle", thinkingAt: 0 });

function rest(voice: boolean): PcHudStatus {
  return voice ? "listening" : "idle";
}

export function nextPcStatus(
  prev: PcStatusState,
  ev: PcStatusEvent,
  ctx: PcStatusContext,
): PcStatusState {
  const now = ev.now ?? 0;
  if (!ctx.online) return INITIAL_PC_STATUS;

  if (ev.kind === "msg") {
    if (!ev.msg || typeof ev.msg !== "object") return prev;
    const m = ev.msg as { type?: unknown; state?: unknown; speaker?: unknown };
    if (m.type === "speaking") {
      return m.state === true
        ? { status: "speaking", thinkingAt: 0 }
        : { status: rest(ctx.voice), thinkingAt: 0 };
    }
    if (m.type === "log" && m.speaker === "user" && prev.status !== "speaking") {
      return { status: "thinking", thinkingAt: now };
    }
    return prev;
  }

  if (ev.kind === "tick") {
    if (prev.status === "thinking" && now - prev.thinkingAt > THINKING_TIMEOUT_MS) {
      return { status: rest(ctx.voice), thinkingAt: 0 };
    }
    return prev;
  }

  // voice / conn: konusma ve dusunme surerken dokunma; digerlerinde dinlenme haline gec.
  if (prev.status === "speaking" || prev.status === "thinking") return prev;
  const status = rest(ctx.voice);
  return status === prev.status ? prev : { status, thinkingAt: 0 };
}
