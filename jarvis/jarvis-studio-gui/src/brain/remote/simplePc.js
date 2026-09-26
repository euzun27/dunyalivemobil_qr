/**
 * DUNYATEK basit PC baglantisi.
 * PC'nin sagladigi hazir API'yi kullanir:
 *   POST /login  { pin: <tek kullanimlik anahtar> } -> { ok, token }
 *   WS   /ws?token=<token>  -> JSON mesajlar, gonderim: {type:"command", text:"..."}
 */
export class SimplePC {
  constructor({ host, port = 8001, secure = false, onStateChange, onMessage }) {
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

  async connect(key) {
    this._closed = false;
    this.onStateChange("connecting");
    try {
      const res = await fetch(`${this.httpBase}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: key }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.token) {
        this.onStateChange("unauthorized");
        return false;
      }
      this.token = data.token;
    } catch (e) {
      this.onStateChange("offline");
      return false;
    }

    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(`${this.wsBase}/ws?token=${encodeURIComponent(this.token)}`);
        this.ws = ws;
        ws.onopen = () => {
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
          this.onStateChange("offline");
          resolve(false);
        };
      } catch (e) {
        this.onStateChange("offline");
        resolve(false);
      }
    });
  }

  sendCommand(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: "command", text }));
    return true;
  }

  close() {
    this._closed = true;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.token = null;
  }
}
