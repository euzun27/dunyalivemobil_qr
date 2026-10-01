import { describe, it, expect } from "vitest";
import {
  INITIAL_PC_STATUS,
  THINKING_TIMEOUT_MS,
  nextPcStatus,
  type PcStatusContext,
  type PcStatusEvent,
  type PcStatusState,
} from "./pcStatus";

const ON: PcStatusContext = { online: true, voice: true };
const ON_SILENT: PcStatusContext = { online: true, voice: false };
const run = (
  events: PcStatusEvent[],
  ctx: PcStatusContext = ON,
  start: PcStatusState = INITIAL_PC_STATUS,
): PcStatusState => events.reduce((st, ev) => nextPcStatus(st, ev, ctx), start);

describe("nextPcStatus", () => {
  it("bagli ve ses acikken dinler, ses kapaliyken bosta kalir", () => {
    expect(run([{ kind: "conn" }]).status).toBe("listening");
    expect(run([{ kind: "conn" }], ON_SILENT).status).toBe("idle");
  });

  it("kullanici konusunca dusunur, PC konusunca konusur, bitince dinlemeye doner", () => {
    const seq: string[] = [];
    let st = run([{ kind: "conn" }]);
    const events: PcStatusEvent[] = [
      { kind: "msg", msg: { type: "log", speaker: "user", text: "merhaba" }, now: 1000 },
      { kind: "msg", msg: { type: "speaking", state: true }, now: 1500 },
      { kind: "msg", msg: { type: "log", speaker: "jarvis", text: "selam" }, now: 1600 },
      { kind: "msg", msg: { type: "speaking", state: false }, now: 3000 },
    ];
    for (const ev of events) {
      st = nextPcStatus(st, ev, ON);
      seq.push(st.status);
    }
    expect(seq).toEqual(["thinking", "speaking", "speaking", "listening"]);
  });

  it("dusunme zaman asimiyla biter, sure dolmadan bitmez", () => {
    let st = nextPcStatus(
      run([{ kind: "conn" }]),
      { kind: "msg", msg: { type: "log", speaker: "user" }, now: 1000 },
      ON,
    );
    st = nextPcStatus(st, { kind: "tick", now: 1000 + THINKING_TIMEOUT_MS }, ON);
    expect(st.status).toBe("thinking");
    st = nextPcStatus(st, { kind: "tick", now: 1001 + THINKING_TIMEOUT_MS }, ON);
    expect(st.status).toBe("listening");
  });

  it("konusurken gelen kullanici satiri konusmayi bozmaz", () => {
    const st = run([
      { kind: "conn" },
      { kind: "msg", msg: { type: "speaking", state: true } },
      { kind: "msg", msg: { type: "log", speaker: "user" } },
    ]);
    expect(st.status).toBe("speaking");
  });

  it("baglanti kopunca her sey sifirlanir", () => {
    const st = run([{ kind: "msg", msg: { type: "speaking", state: true } }]);
    expect(nextPcStatus(st, { kind: "conn" }, { online: false, voice: false })).toBe(
      INITIAL_PC_STATUS,
    );
  });

  it("bilinmeyen ya da bozuk mesajlar durumu degistirmez", () => {
    const base = run([{ kind: "conn" }]);
    for (const msg of [null, "metin", 42, { type: "sys", text: "x" }, { type: "send_sms" }, {}]) {
      expect(nextPcStatus(base, { kind: "msg", msg }, ON)).toBe(base);
    }
  });

  it("durum degismediginde ayni nesneyi dondurur (gereksiz yeniden cizim yok)", () => {
    const base = run([{ kind: "conn" }]);
    expect(nextPcStatus(base, { kind: "voice" }, ON)).toBe(base);
    expect(nextPcStatus(base, { kind: "tick", now: 99999 }, ON)).toBe(base);
  });
});
