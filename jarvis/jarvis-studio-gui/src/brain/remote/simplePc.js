/**
 * DUNYATEK basit PC baglantisi.
 * PC'nin sagladigi hazir API'yi kullanir:
 *   POST /login  { pin: <tek kullanimlik anahtar> } -> { ok, token }
 *   WS   /ws?token=<token>  -> JSON mesajlar, gonderim: {type:"command", text:"..."}
 */
// PC'nin mobil uygulama icin actigi duz HTTP portu (dunya_live dashboard APP_PORT).
// Asil panel portu (8000) kendinden imzali HTTPS kullaniyor, WebView ona guvenmiyor.
export const PC_APP_PORT = 8002;
// PC'nin (Gemini Live) konusma sesi ornekleme hizi.
const PC_VOICE_RATE = 24000;

/**
 * Adreslerin hepsini ayni anda dener, ilk cevap vereni dondurur (yoksa null).
 * Tailscale tunelinin ilk acilisi 10-15 sn surebildigi icin bekleme uzun tutulur;
 * sirayla denemek (once ev/ofis Wi-Fi adresi, sonra Tailscale) bu sureyi ikiye katliyordu.
 */
export async function findReachableHost(hosts, port = PC_APP_PORT, secure = false, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const proto = secure ? "https" : "http";
  try {
    return await Promise.any(
      hosts.map(async (h) => {
        await fetch(`${proto}://${h}:${port}/login`, { signal: ctrl.signal });
        return h;
      }),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ctrl.abort(); // digerlerini birak
  }
}

export class SimplePC {
  constructor({ host, port = PC_APP_PORT, secure = false, onStateChange, onMessage }) {
    this.host = host;
    this.port = port;
    this.secure = secure;
    this.onStateChange = onStateChange || (() => {});
    this.onMessage = onMessage || (() => {});
    this.token = null;
    this.ws = null;
    this._closed = false;
  }

  get httpBase() {
    return `${this.secure ? "https" : "http"}://${this.host}:${this.port}`;
  }

  get wsBase() {
    return `${this.secure ? "wss" : "ws"}://${this.host}:${this.port}`;
  }

  /** QR'daki tek kullanimlik anahtarla ilk eslesme. */
  connect(key) {
    return this._login("/login", { pin: key });
  }

  /** Daha once eslesmis cihaz: QR okutmadan yeniden baglan (orn. evden, Tailscale ile). */
  reconnect(deviceToken) {
    return this._login("/api/device-login", { device_token: deviceToken });
  }

  async _login(path, body) {
    this._closed = false;
    this.onStateChange("connecting");
    try {
      const ctrl = new AbortController();
      // Tailscale'in ilk baglantisi (tunel kurulumu) birkac saniye surebilir.
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(`${this.httpBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.token) {
        this.lastError = `HTTP ${res.status}`;
        this.onStateChange("unauthorized");
        return false;
      }
      this.token = data.token;
      this.loginInfo = data;
    } catch (err) {
      this.lastError = err?.name === "AbortError" ? "zaman asimi" : String(err?.message || err);
      this.onStateChange("offline");
      return false;
    }

    return new Promise((resolve) => {
      try {
        // client=phone: PC bu soketi telefon olarak tanir (SMS istegini sadece buraya yollar).
        const ws = new WebSocket(`${this.wsBase}/ws?token=${encodeURIComponent(this.token)}&client=phone`);
        this.ws = ws;
        // Soket 10 sn icinde acilmazsa vazgec (yoksa yeniden deneme hic baslamaz).
        const openTimer = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            this.lastError = "soket zaman asimi";
            try {
              ws.close();
            } catch {
              /* ignore */
            }
            this.onStateChange("offline");
            resolve(false);
          }
        }, 10000);
        ws.onopen = () => {
          clearTimeout(openTimer);
          this.onStateChange("online");
          resolve(true);
        };
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            this.onMessage(data);
          } catch {
            // JSON degilse yoksay
          }
        };
        ws.onclose = () => {
          if (!this._closed) this.onStateChange("offline");
        };
        ws.onerror = () => {
          clearTimeout(openTimer);
          this.lastError = "soket hatasi";
          this.onStateChange("offline");
          resolve(false);
        };
      } catch (e) {
        this.lastError = String(e?.message || e);
        this.onStateChange("offline");
        resolve(false);
      }
    });
  }

  /** PC'ye yapisal cevap (ornegin SMS sonucu). */
  sendJson(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  sendCommand(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "command", text }));
    return true;
  }

  get voiceActive() {
    return Boolean(this._voice);
  }

  /**
   * Ses gercekten akiyor mu? Telefon ekrani kapaninca/uygulama arka plana gecince
   * Android mikrofonu ve ses motorunu durdurur; baglanti "acik" gorunse de ses gitmez.
   * Son 4 sn'de ses gonderilmediyse (ya da mikrofon kapandiysa) saglikli degil.
   */
  voiceHealthy() {
    const v = this._voice;
    if (!v) return false;
    if (v.ws.readyState !== WebSocket.OPEN) return false;
    if (v.stream.getAudioTracks().some((t) => t.readyState === "ended")) return false;
    if (v.ctx.state === "suspended") v.ctx.resume().catch(() => {});
    if (v.playCtx?.state === "suspended") v.playCtx.resume().catch(() => {});
    return Date.now() - v.lastSent < 4000;
  }

  /**
   * Telefon mikrofonunu canli olarak PC'ye aktarir (WS /ws/phone-audio).
   * PC 16 kHz, 16-bit mono PCM bekler ve sesi dogrudan Gemini Live'a verir.
   * onEnd: baglanti koparsa cagrilir.
   */
  async startVoice(onEnd) {
    if (this._voice || !this.token) return false;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    let ctx;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      ctx = new AudioContext();
    }
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});

    const ws = new WebSocket(
      `${this.wsBase}/ws/phone-audio?token=${encodeURIComponent(this.token)}&speaker=1`,
    );
    ws.binaryType = "arraybuffer";
    // DUNYATEK'in sesi ayni soketten gelir (24 kHz 16-bit mono PCM) ve telefonda calinir.
    let playCtx = null;
    try {
      playCtx = new AudioContext();
      if (playCtx.state === "suspended") await playCtx.resume().catch(() => {});
    } catch {
      playCtx = null;
    }
    let playAt = 0;
    ws.onmessage = (ev) => {
      if (!playCtx || !(ev.data instanceof ArrayBuffer) || ev.data.byteLength < 2) return;
      if (playCtx.state === "suspended") playCtx.resume().catch(() => {});
      const pcm = new Int16Array(ev.data, 0, ev.data.byteLength >> 1);
      const abuf = playCtx.createBuffer(1, pcm.length, PC_VOICE_RATE);
      const ch = abuf.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
      const node = playCtx.createBufferSource();
      node.buffer = abuf;
      node.connect(playCtx.destination);
      const now = playCtx.currentTime;
      // Geride kaldiysak kisa bir tampon birakip bastan baslat.
      if (playAt < now) playAt = now + 0.05;
      node.start(playAt);
      playAt += abuf.duration;
    };

    const voice = { ws, ctx, stream, node: null, playCtx, lastSent: Date.now() };
    this._voice = voice;

    return new Promise((resolve) => {
      ws.onopen = async () => {
        const rate = ctx.sampleRate;
        const src = ctx.createMediaStreamSource(stream);
        // 1024 ornek (16 kHz'de 64 ms) biriktirip gonder - PC mikrofon parcasi ile ayni.
        let buf = [];
        let len = 0;
        const push = (f32) => {
          const chunk = f32ToPcm16(f32, rate);
          buf.push(chunk);
          len += chunk.length;
          if (len >= 1024) {
            const out = new Int16Array(len);
            let off = 0;
            for (const c of buf) {
              out.set(c, off);
              off += c.length;
            }
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(out.buffer);
              voice.lastSent = Date.now();
            }
            buf = [];
            len = 0;
          }
        };
        try {
          const code =
            "class P extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice());return true;}}registerProcessor('dunyatek-mic',P);";
          const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          const node = new AudioWorkletNode(ctx, "dunyatek-mic");
          node.port.onmessage = (e) => push(e.data);
          src.connect(node);
          voice.node = node;
        } catch {
          // Eski WebView: ScriptProcessor yedegi
          const sp = ctx.createScriptProcessor(4096, 1, 1);
          sp.onaudioprocess = (e) => push(e.inputBuffer.getChannelData(0));
          src.connect(sp);
          sp.connect(ctx.destination);
          voice.node = sp;
        }
        resolve(true);
      };
      ws.onerror = () => {
        this.stopVoice();
        onEnd?.();
        resolve(false);
      };
      ws.onclose = () => {
        if (this._voice === voice) {
          this.stopVoice();
          onEnd?.();
        }
        resolve(false);
      };
    });
  }

  stopVoice() {
    const v = this._voice;
    if (!v) return;
    this._voice = null;
    try {
      v.node?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      v.ctx.close();
    } catch {
      /* ignore */
    }
    try {
      v.playCtx?.close();
    } catch {
      /* ignore */
    }
    v.stream.getTracks().forEach((t) => t.stop());
    try {
      v.ws.close();
    } catch {
      /* ignore */
    }
  }

  close() {
    this._closed = true;
    this.stopVoice();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.token = null;
  }
}

/** Float32 ses -> 16 kHz Int16 PCM (basit yeniden ornekleme). */
function f32ToPcm16(f32, srcRate) {
  let s = f32;
  if (srcRate !== 16000) {
    const ratio = srcRate / 16000;
    const n = Math.round(f32.length / ratio);
    s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = f32[Math.min(Math.round(i * ratio), f32.length - 1)];
  }
  const out = new Int16Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s[i] * 32768)));
  }
  return out;
}
