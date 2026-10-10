# -*- coding: utf-8 -*-
"""DUNYATEK güncelleme paketi (tek dosya; değişen dosyalar bu dosyanın içinde gömülü).

Kullanım (güncellenecek proje klasöründe):
    python guncelle_xxx.py                    # varsayılan klasöre uygular
    python guncelle_xxx.py --hedef <klasör>   # başka klasör
    python guncelle_xxx.py --kontrol          # yalnızca denetler, hiçbir şey yazmaz
    python guncelle_xxx.py --canli-onayli     # test klasörü dışına uygulamak için gerekli

Adımlar: dosyaların şu anki halini hash ile doğrular (satır sonu fark etmez; yerelde
değişmiş dosya varsa hiçbir şeye dokunmadan durur) → yedek (bellek + %TEMP%) → yazar
→ paketteki denetimleri çalıştırır (test/derleme) → herhangi biri başarısızsa dosyaları
birebir eski haline döndürür → git deposuysa commit eder (push etmez).
"""
import argparse
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

GOMULU = None  # dosyanın sonunda doldurulur


def yaz(m):
    print(m, flush=True)


def norm_hash(b: bytes) -> str:
    b = b.replace(b"\r\n", b"\n")
    if b.startswith(b"\xef\xbb\xbf"):
        b = b[3:]
    return hashlib.sha256(b).hexdigest()


def calistir(cmd, cwd):
    satir = " ".join(cmd)
    yaz("  > " + (satir if len(satir) < 100 else satir[:97] + "..."))
    return subprocess.run(cmd, cwd=cwd, shell=(os.name == "nt"), capture_output=True,
                          text=True, encoding="utf-8", errors="replace")


def asistan_acik_mi(kok: str) -> bool:
    try:
        import psutil
    except Exception:
        return False
    kok = os.path.normcase(os.path.abspath(kok))
    for p in psutil.process_iter(["cmdline", "cwd"]):
        try:
            cmd = " ".join(p.info.get("cmdline") or [])
            cwd = os.path.normcase(p.info.get("cwd") or "")
            if "main.py" in cmd and "python" in cmd.lower() and (cwd == kok or kok in os.path.normcase(cmd)):
                return True
        except Exception:
            continue
    return False


def eslint_ozet(cikti, kok):
    try:
        veri = json.loads(cikti)
    except Exception:
        return None
    ozet = {}
    for f in veri:
        yol = os.path.relpath(f["filePath"], kok).replace("\\", "/")
        for m in f.get("messages", []):
            k = (yol, m.get("ruleId") or m.get("message", "")[:60], m.get("severity"))
            ozet[k] = ozet.get(k, 0) + 1
    return ozet


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hedef")
    ap.add_argument("--canli-onayli", action="store_true")
    ap.add_argument("--kontrol", action="store_true")
    a = ap.parse_args()

    paket = zipfile.ZipFile(io.BytesIO(base64.b64decode(GOMULU)))
    m = json.loads(paket.read("manifest.json").decode("utf-8"))
    kok = os.path.abspath(a.hedef or m["varsayilan_hedef"])
    yaz(f"DUNYATEK güncelleme: {m['baslik']}")
    yaz(f"Hedef: {kok}")
    if not os.path.isdir(kok) or not os.path.exists(os.path.join(kok, m["isaret_dosyasi"])):
        yaz(f"HATA: {kok} doğru proje klasörü değil ({m['isaret_dosyasi']} bulunamadı).")
        return 2
    test = m.get("test_klasoru")
    canli = bool(test) and os.path.normcase(kok.rstrip("\\/")) != os.path.normcase(test)
    if canli and not a.canli_onayli:
        yaz(f"DURDU: Bu klasör test klasörü ({test}) değil. Önce testte deneyin; "
            "canlıya uygulamak için --canli-onayli ekleyin.")
        return 2
    if m.get("asistan_kontrol") and not a.kontrol and asistan_acik_mi(kok):
        yaz("DURDU: Asistan bu klasörde açık görünüyor. Kapatıp tekrar çalıştırın.")
        return 2

    yazilacak, zaten = [], []
    for d in m["dosyalar"]:
        yol = os.path.join(kok, d["yol"])
        mevcut = open(yol, "rb").read() if os.path.exists(yol) else None
        h = norm_hash(mevcut) if mevcut is not None else None
        if h == d["yeni"]:
            zaten.append(d)
        elif h == d["eski"]:
            yazilacak.append((d, mevcut))
        else:
            neden = "yerelde değişmiş" if mevcut is not None else "bulunamadı"
            if d["eski"] is None:
                neden = "zaten var ama içeriği farklı"
            yaz(f"DURDU: {d['yol']} {neden} (beklenen hali değil). Hiçbir dosyaya dokunulmadı.")
            return 3
    yaz(f"Doğrulandı: {len(yazilacak)} dosya güncellenecek, {len(zaten)} dosya zaten güncel.")
    if a.kontrol or not yazilacak:
        return 0

    yedek = os.path.join(tempfile.gettempdir(), f"dunyatek_yedek_{time.strftime('%Y%m%d_%H%M%S')}")
    for d, mevcut in yazilacak:
        if mevcut is not None:
            hedef = os.path.join(yedek, d["yol"])
            os.makedirs(os.path.dirname(hedef), exist_ok=True)
            open(hedef, "wb").write(mevcut)
    yaz(f"Yedek: bellekte ve {yedek}")

    def geri_al():
        for d, mevcut in yazilacak:
            yol = os.path.join(kok, d["yol"])
            if mevcut is None:
                if os.path.exists(yol):
                    os.remove(yol)
            else:
                open(yol, "wb").write(mevcut)
        yaz("Tüm dosyalar birebir eski haline döndürüldü.")

    try:
        for d, mevcut in yazilacak:
            yeni = paket.read("dosyalar/" + d["yol"])
            if not d.get("ikili"):
                yeni = yeni.replace(b"\r\n", b"\n")
            if not d.get("ikili") and mevcut is not None and b"\r\n" in mevcut:
                yeni = yeni.replace(b"\n", b"\r\n")
            if not d.get("ikili") and mevcut is not None and mevcut.startswith(b"\xef\xbb\xbf") and not yeni.startswith(b"\xef\xbb\xbf"):
                yeni = b"\xef\xbb\xbf" + yeni
            yol = os.path.join(kok, d["yol"])
            os.makedirs(os.path.dirname(yol), exist_ok=True)
            open(yol, "wb").write(yeni)
        yaz("Dosyalar yazıldı.")

        for k in m.get("kontroller", []):
            yaz(f"Denetim: {k['ad']}")
            komut = [sys.executable if p == "{python}" else p for p in k["komut"]]
            r = calistir(komut, os.path.join(kok, k.get("klasor", "")))
            son = (r.stdout + r.stderr).strip().splitlines()[-6:]
            yaz("  " + "\n  ".join(son))
            if r.returncode != 0:
                yaz(f"DURDU: {k['ad']} başarısız.")
                geri_al()
                return 5
        if m.get("eslint"):
            e = m["eslint"]
            gui = os.path.join(kok, e["klasor"])
            js = [d["yol"][len(e["klasor"]) + 1:] for d, _ in yazilacak
                  if d["yol"].startswith(e["klasor"] + "/") and re.search(r"\.(jsx?|tsx?)$", d["yol"])]
            if js:
                r = calistir(["npx", "eslint", "-f", "json", *js], gui)
                ozet = eslint_ozet(r.stdout, gui)
                if ozet is None:
                    yaz("DURDU: ESLint çalıştırılamadı.")
                    geri_al()
                    return 6
                taban = {tuple(json.loads(k)): v for k, v in e["taban"].items()}
                yeni = {k: v for k, v in ozet.items() if v > taban.get(k, 0)}
                if yeni:
                    yaz("DURDU: ESLint'te yeni sorun var: " + ", ".join(f"{f} {r}" for f, r, _ in yeni))
                    geri_al()
                    return 6
                yaz("ESLint: yeni sorun yok.")
    except Exception as ex:
        yaz(f"DURDU: beklenmeyen hata: {ex}")
        geri_al()
        return 9

    if os.path.isdir(os.path.join(kok, ".git")):
        yollar = [d["yol"] for d, _ in yazilacak]
        r = calistir(["git", "add", "--", *yollar], kok)
        if r.returncode == 0:
            r = calistir(["git", "commit", "-m", m["commit"], "--", *yollar], kok)
        yaz("Commit: " + ("yapıldı" if r.returncode == 0 else "yapılamadı (dosyalar yine de güncel)"))
    yaz("TAMAM. " + m.get("sonraki", ""))
    return 0


GOMULU = (
    "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"
    "c29uUEsFBgAAAAACAAIAgAAAAOMIAAAAAA=="
)


if __name__ == "__main__":
    sys.exit(main())
