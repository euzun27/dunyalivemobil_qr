/* VideoAvatar.jsx - HUD merkezinde gercekci DUNYATEK avatari (masaustuyle ayni klipler).
   Klipler public/avatar/ altinda; bir kez belge olarak (blob) okunur: telefonun web
   gorunumunde gomulu videolarda ileri-geri sarma boylece sorunsuz calisir.
   Hizli acilis: once bekleme klibinin ilk karesi (kucuk JPEG) hemen cizilir, yalnizca
   bekleme klibi beklenir; diger klipler arkadan gelir, gelene kadar bekleme oynar.
   Iki <video> slotu: biri gorunurken digeri siradaki klibi hazirlar; gecis 0.4 sn,
   yeni kare eski karenin bas pozuna oturtulur (videoPlayer.ts). Arka planda durur. */

import { useEffect, useRef } from "react";
import {
  GecisYoneticisi,
  POZ_GENISLIK,
  POZ_YUKSEKLIK,
  esle,
  hedefKlip,
  karisikMatris,
  kareNo,
  ters,
} from "./videoPlayer";
import { bakis } from "./kameraDurumu";
import { kesilme } from "../brain/remote/sozKesme";

const ILK = "bekleme"; // avatar yalnizca bunu bekler
const SONRADAN = ["dusunme", "konusma", "kamera", "sozkesme"]; // gelince eklenir; o zamana kadar bekleme oynar
const ILK_KARE = "/avatar/bekleme-ilk.jpg"; // bekleme klibinin 0. karesi (video hazir olana kadar)
const FRAME_MS = 1000 / 30;
let kaynakSozu = null; // { url: {klip: blobUrl}, poz: {klip: Afin[]} } - uygulama boyunca bir kez

function kaynaklariYukle() {
  if (!kaynakSozu) {
    kaynakSozu = (async () => {
      const meta = await (await fetch("/avatar/pozlar.json")).json();
      const url = {};
      const poz = {};
      const al = async (k) => {
        const b = await (await fetch(`/avatar/${meta.klipler[k].dosya}`)).blob();
        poz[k] = meta.klipler[k].poz;
        url[k] = URL.createObjectURL(b); // url en son: klip ancak pozu hazirsa secilir
      };
      await al(ILK);
      for (const k of SONRADAN) {
        if (meta.klipler[k]) void al(k).catch(() => {}); // yoksa ya da yuklenemezse bekleme oynar
      }
      return { url, poz };
    })().catch((e) => {
      kaynakSozu = null; // sonraki denemede tekrar
      throw e;
    });
  }
  return kaynakSozu;
}

function videoOlustur() {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("muted", "");
  v.preload = "auto";
  // bazi web gorunumleri DOM'da olmayan videoyu cozmez: gorunmez sekilde eklenir
  v.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0";
  document.body.appendChild(v);
  return v;
}

export function VideoAvatar({ status = "idle", muted = false, width = 260, onError }) {
  const canvasRef = useRef(null);
  const live = useRef({ status, muted });
  const hataRef = useRef(onError); // her cizimde yeni fonksiyon gelse de avatar yeniden yuklenmesin
  useEffect(() => {
    live.current = { status, muted };
    hataRef.current = onError;
  });

  const height = Math.round((width * POZ_YUKSEKLIK) / POZ_GENISLIK);

  useEffect(() => {
    let iptal = false;
    let raf = 0;
    const slotlar = [videoOlustur(), videoOlustur()];
    const slotKlip = [null, null];
    const yon = new GecisYoneticisi();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const olcek = (width / POZ_GENISLIK) * dpr;

    const durum = (i) => ({
      klip: slotKlip[i],
      zaman: slotlar[i].currentTime || 0,
      sure: Number.isFinite(slotlar[i].duration) ? slotlar[i].duration : 0,
      hazir: slotKlip[i] !== null && slotlar[i].readyState >= 2 && !slotlar[i].seeking,
    });

    // Video cozulene kadar ilk kare: yuz acilir acilmaz gorunur. Bekleme klibi ayni
    // kareden basladigi icin gecis fark edilmez; video bir kare cizince bu artik onemsiz.
    let videoCizdi = false;
    const ilkKare = new Image();
    ilkKare.onload = () => {
      if (iptal || videoCizdi || !ctx) return;
      ctx.setTransform(olcek, 0, 0, olcek, 0, 0);
      ctx.drawImage(ilkKare, 0, 0, POZ_GENISLIK, POZ_YUKSEKLIK);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };
    ilkKare.src = ILK_KARE;
    // iOS web gorunumu ekranda gorunmeyen videonun oynatilmasini ilk dokunusa kadar
    // erteleyebilir: ilk dokunusta iki slot da yeniden baslatilir.
    const dokunus = () => {
      slotlar.forEach((v) => {
        if (v.src && v.paused) void v.play().catch(() => {});
      });
    };
    window.addEventListener("pointerdown", dokunus, { once: true, passive: true });

    kaynaklariYukle()
      .then(({ url, poz }) => {
        if (iptal || !ctx) return;
        const baslat = (i, klip) => {
          const v = slotlar[i];
          slotKlip[i] = klip;
          if (v.src !== url[klip]) v.src = url[klip];
          try {
            v.currentTime = 0;
          } catch {
            /* yuklenmeden once sarilamaz; play() bastan baslar */
          }
          void v.play().catch(() => {});
        };
        const ciz = (v, klip, matris, alfa) => {
          const n = poz[klip].length;
          ctx.save();
          ctx.globalAlpha = alfa;
          ctx.setTransform(olcek, 0, 0, olcek, 0, 0);
          if (matris) {
            const [[a, c, e], [b, d, f]] = matris;
            ctx.transform(a, b, c, d, e, f);
          }
          ctx.drawImage(v, 0, 0, POZ_GENISLIK, POZ_YUKSEKLIK);
          ctx.restore();
          return kareNo(v.currentTime || 0, n);
        };

        let son = 0;
        const kare = (now) => {
          raf = requestAnimationFrame(kare);
          if (document.hidden) {
            slotlar.forEach((v) => v.pause());
            return;
          }
          if (now - son < FRAME_MS) return;
          son = now;
          const s = live.current;
          const bakiyor = bakis.aktif(Date.now() / 1000, s.status === "speaking");
          const kesildi = kesilme.aktif(Date.now() / 1000);
          let hedef = hedefKlip(s.status, s.muted, bakiyor, kesildi);
          if (!url[hedef]) hedef = hedefKlip(s.status, s.muted, bakiyor);
          if (!url[hedef]) hedef = hedefKlip(s.status, s.muted);
          if (!url[hedef]) hedef = ILK; // klip henuz gelmedi
          const e = yon.adim(now / 1000, hedef, [durum(0), durum(1)]);
          if (e.baslat) baslat(e.baslat.slot, e.baslat.klip);
          if (e.durdur !== undefined) slotlar[e.durdur].pause();
          const a = yon.aktif;
          const va = slotlar[a];
          if (slotKlip[a] === null || va.readyState < 2) return;
          if (va.paused) void va.play().catch(() => {});
          videoCizdi = true;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const ka = slotKlip[a];
          const ia = ciz(va, ka, null, 1);
          if (e.karisim !== null) {
            const g = yon.gelen;
            const vg = slotlar[g];
            const kg = slotKlip[g];
            if (kg && vg.readyState >= 2) {
              const ig = kareNo(vg.currentTime || 0, poz[kg].length);
              // ornekleme matrisi M (yeni -> eski poz); cizim donusumu onun tersi
              const M = karisikMatris(esle(poz[ka][ia], poz[kg][ig]), e.karisim);
              ciz(vg, kg, ters(M), e.karisim);
            }
          }
        };
        raf = requestAnimationFrame(kare);
      })
      .catch(() => {
        if (!iptal) hataRef.current?.();
      });

    return () => {
      iptal = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", dokunus);
      slotlar.forEach((v) => {
        v.pause();
        v.removeAttribute("src");
        v.load();
        v.remove();
      });
    };
  }, [width, height]);

  return (
    <div className="reactor video-avatar" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          width,
          height,
          filter: muted ? "brightness(0.6)" : "none",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0, #000 6%, #000 70%, transparent 100%)," +
            "linear-gradient(to right, transparent 0, #000 9%, #000 91%, transparent 100%)",
          WebkitMaskComposite: "source-in",
          maskComposite: "intersect",
        }}
      />
    </div>
  );
}
