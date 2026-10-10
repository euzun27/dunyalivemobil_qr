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
    "UEsDBBQAAAAIACWgSl0nTuWIShYAAKpAAABaAAAAZG9zeWFsYXIvamFydmlzL2phcnZpcy1zdHVkaW8tZ3VpL3NyYy10YXVyaS90"
    "YXVyaS1wbHVnaW4tcGhvbmUvaW9zL1NvdXJjZXMvU2VzTW90b3J1LnN3aWZ0tVtLcxw3kr7rV0AdXrvKbhabGlvraJnmSJTssWWJ"
    "XFG2Y4JSKNBVaDZcr3Y9SDU5nJjT7n1jIvbIo8+86KQbqT/iX7JfAqgq1KMp2zHTobDZVUACyOeXmejNTfbw+6d/vf/80WP26z/+"
    "yeTewZTt7zIZCZaLPJLs6OpNdvX23UUsEpmwlchERG9YnBZpVnq3Njfxjz0VgTBvp+zHxz+K2Q9SnHxEM3gSXl8ykRwJUHN+SKUv"
    "9rPUF3kuk6Nv9lyGwex+GchUrXr1C4+uLxOe0CqSaGdiLjKe5IxHMT+9xwoRiXmalAlbpEueRWqDCa1/9cv1ZYiZ9ZGIBItlmKWY"
    "wNmRzOQSx/toJdiRyBT1IxnIVZoFJXPMVo/ppS/DWLgee1BmPOA1DXpZr8poiZnM2P0f1P4fJUcyER8FIpDZmGgTn+S7i0jEoqau"
    "GeEyrjZbXF9m0/aZGV8lGKf4G3BzKIy7vsBTefULeAopMTCAFRwjM1oJ26q2SHNycDLz2NdpehSJj0CafS1imUj2ncRImo7tJ+L6"
    "AhKZy0zMeC42fy6lH+YFz4oNmeZEVZ1qN02KLI2IYH4i54VLiy3lUvi82PAjKRI1fuNIrbARYYWNEzHLUz8UhTnMii+vL1f4Iyyj"
    "SG26Upz74Mm7C+bcT4IslQGYF0qG6WyVRqVSCE1hmYEfYRqN2Y8HbPMk31wu0kRscNrhTr4UPBTZ9pY7JZqsEdev//2/bOsuC/9y"
    "iv9tzGQBviYpVODJmG1N7nyq+RBGMmTO3U9ZnLsMwiV58ExN3t/VFGET9BUzBmipV0YJ9iMOM3iaBhB5yDM6HQn5+tLHKQJoIU4T"
    "s8X15SlJHNIVx9DKzK2XiUUBEcci5z9FNH/KzkbFailG01EssgWf8dF4FIp8NJ2laXTONpv39PScOWr72n5YXuZFqakfXL05ZRgC"
    "ZTQmBMXGPyUc6F/GnFzGy0js+95POejm6eljGu4VuSUJHIpnrqeEF2TQV0cpJc6bYqUyZjzhi4J2zo4xkC3wmoyEnAPWwrHJjL1b"
    "t7BWmhXg21dpia0UMk2qZ9YTrNPeyYH5u9nSlPFcQnETFsIq3l2UWQhnUOkA/EQhlxBwDk6viCdXb6KrX67eRldvlZlu1loJESVk"
    "LIpzs5Km3sF5C+0UQJOfson3pwmTOU67wkNI7h52l7DPjd6An5/Rq23itHdrLhMeMT/iebPxA77ivmRntyBv6LU85oUgVmEaBD5l"
    "hw8g15egcPiyN0SfAbaIYQ/TchYJM1CNnJeJD3eZi8Jx2Zmmp16zc2vAXIjAeWVITZkm47KNLxktbPZFH1pwBuMQCY6+jZNP6ldy"
    "3mzF8yGtgn25ze5ak+kTwQHkmNkMzSFdrO7eU+9iememb7I7rbnWwtWQ/4A0trfZFtth+WH8kk2hsIcx22BbL9kn6pHbInN+y96I"
    "Esrgpj/80Dynr5Bv+0G9kY/ZHYsDirkeXy5FEjjpCicCT/RDQxo6YWTgZSJOj8VXMssLxx6zwT53rW2Cwm1s88zapllAP9CL9M7A"
    "Pv28NcderTt4A4OxZHtRvaW5jAqROWfsgwk7dxsGfdZSpXtQMNg5jCorhUXGPJ3zKBe3NPehdC39F/kTBRqm7OnB3uwn4RdGX2C7"
    "hfSVlJb+X+SprLQSK975dDKZ6CVgqYjdBEMcK5y5xupjrhFDh2AsuxS37lYUG4JKyIGkgFjHjiFqMHKfEw2KHZ0PqOlQgyDGVDDp"
    "zg7LVVaGB4m1GVK3arZ/9TYmn5Zx5fjJPY80NABAGbGcr5TvXMFri2Me96hDUeRBmce8tcId7zNF3fh8PczEBbgDTjEHYYmic63q"
    "OVyj6NKXAGwd2ltE2+y+DfSuL3PlTFuu2ECvnLDfKcVcBHkc9VbLzdFSQiEpLNBCVo7bG7hU0bYZ2ETfocH+A+nLuBn9VZrFHDaC"
    "0BHwLNBff5TF4oBTHHyGidNGbT2tm2PmL3iSiCifsi33dm8VKNzwMn4aAzDoL1MGarH++5uk2Lo7hniH1jTqO275xhs/1u7GTCYw"
    "6UjwYxFMlcV2NkwuHqBEKcO02i8QHyIbJu5Uko0gydNGjMC0Jtz5GpeSqlZBlJBEb41ChI+BC6Jpmyc7vYFlFu0pGDFl3z/77oA0"
    "JU36w/IU4NIegiTiQCHO5zwP++OP0lOgcF/qyFm5n30ClX4dbG8ZTd7LCh6yQIEZx2D49nnHegOECr49wN/ZUZmXZLi54oU7ZaGM"
    "ABB5VKgHXk9L9PtteMLvsO2OstKOARFCvG/8qf0S4LOQa99iy1+LKFg/QNn5Sgf1lv8yiUjceAMapY+u/Q8O2COXwFFGbVqanOVk"
    "RA5cX0NrAlmUgOEg2GcmYwlXEBoPN6Q/gFi7lP5hlYd45gUK7xX7PC96Y30eIeokbTdL25mVVjYb2KlmkcKRxNrtMUf7LiymgG1f"
    "NLDJgxZ4ogX625ChzH/DOBzta0BxcCM2pxvQBoBJBRsHKSz9GhOvk3gVGwoEX1pip6eQeUOiDVQHdgMGPIe3SsHhQ+W91qDVBS/4"
    "E1EkpImjUaMXjRSgO5S4a312YEsizMgZ05C8ECoxUmT/DIn78NEcbHwm8jJqy10BW2VTkfzi+ZeAt3OgQwVqn+v/AsSo916k7O0e"
    "YugckaN6Wib6OTuvAc6cvtVO4dd//gP/2Iwjn+cEV+Ef8M88b9A1Umm8xwY4JUfKRbmsWGTpSW6hYwVIdbpUhwnjybx8wTMRfJOQ"
    "hvuVMtCnyFZmkgeIv4tzH6XZyvEoCCJ/fib8NAvGyEoDaJx3TJWWXYhgzNIlpVLYzKGHU3Mw73l6oHPmMfN4FKUnD6JSFGlaLF62"
    "1tuxFtxXhRja2t6Dco4/H5aZytEcZAZ31m3zvl8ApDkq9txqnZ+qMZQd6GDvyWRZFhS5W4TUIKLTKRw9SkgTAk2X9QHIVBdQjLxi"
    "riopb8DPmrpZlhcF9xeOBhJu962fIpb6hXk9hqOYVq9iLpMn8rVGG2M2N3HdgIyhs1awQJ8pLQsc2GADzH5QQkCTZgdHJdTdmug1"
    "AAGQfzK2X5mYv2vygQlD/BedZEzpIOLNoyxLMydIaf9TNqpqZSPgGqU4QA1lLrJvknmqQiXiExzqqQgeitzPpFKlx2KFqU8qPKBq"
    "WYrL15feyNKgJj2AfCoOJSpYBFdvry8AeK/eqlBw9YsI4QbgcGPpsQf6DxwDThNYJBbhuAMwdf0Mfs1eolNfgTPMQrh4lkZBeX1B"
    "NYVOrU4iCFy9CQntIBRRIdBrBKDEJMkOo+g5XzppomU0RiQh/T8AV6YqFRjbh6PU+/AE1oVAHM1fstmYvQIQawmD3ux4FaByZkMs"
    "0zr3b9pAlZo3SDOLc3sfzS6NW1UpJn23Ahtl1NaOz7vms8wEYn7Xh5mXqtRovUpXCafvtkAflxEnCYabTdU1oLrluwsFGkwBy1IM"
    "yuZ0ioPolVWF1NK4a05StmSMJWotNtqna0qrnBsPAgQkVYzSnr8qlckoNHqvSnxqI1i/UiO3tYbW52rnhVzBOh2cBZpe+V1XQ6RA"
    "JgBdMOoVNN8sGUOSRk2nduxE1IRPstcpV0cl2SFVpUPsDogqITFVFTo6izknyCs25bI+ISZwizekIgkhjqdpIefSV75+V1BGUYWR"
    "xlYafF2VLBLf40GwN4MvgQWTh3vKYwpMLQtErjGXRyaQIFpBhohXCp1XnvZ35D7s51KUtAY5t64ZrDFCUpOH4giAUjqNS7UM0v0j"
    "p+zEdJWHZaVynjY7m7PCbv9VB02GjB0BGaJ0Eq9y7juH7T1+Y23x+Wop4ONfMp7vsO/xxu1tzZtDM5/AKXVO2iWDo8vCyfjJDxyq"
    "PnXblORcb2ybeTNxhBhdORltrs4IZAn8gn+kqQ5SrJiPGeUQMTueea43sgto552wW5KLa5JEpOCWtoF7Ro3HsMwIy1PqTcs33/9L"
    "s5mcak24TlFBu8xb653k6pl3YmejzoksFlONBxsqOoHcxpT6keVoB3IC65gnuQdaZWw7VuU4nBOzwnm7pqKQqa3or5S36WTjroUY"
    "NPq4bbbknBmIfu6O2e0KsOXPygTu9sigjQo3t8uuyuX0Qd5vhD802wY+UBTauPVorMe0EFA1qvVwABLZSsZXR9eXVOmvnTRzwn70"
    "IYWrMoTfE/eCtAvH1gdC+lTBsF4CaW3hL244gIlz/XClcdmUvXAEQT9KgHqAzh11EYjdMTDLUM9gJpZTdlBkJHZK6txOUoOwONV9"
    "hO1Gn7smr3XprFUztphIn6rCQfj+Xr8YYhGrk0wo5KN4WVD93E481Z471K0S9oAQtepRgF+n2HYggO4+4iSZG+KkKcnXYeKDiTtM"
    "rcmj6aN8BAAX5YGRcSNeQiYT7UZpXmbQ/kzwnHzZsIvagcUdQ9oBLAUp4q6m1EtzGrPUG7XBZjPYANLfMCQv0mV/lc5TlV72NrA+"
    "1VPS70x/T+psJaBqtpUKg4+Q1mqvWIgs30seCk7jlOxaLpT6g98eqG4g+/vWZMLinOr71NHM04wDCZqSBcDb6urtKRVyry/IaVBf"
    "gjrnV2/xrOm9hpGcSQMPK+sqY12rONSWBb+cIPg2djNsSWRvvmr1bjfFOsr+/vY3EzO8QsZCRWQowYEknlSVNJd9YYH/qjMxZCWH"
    "oxRQZzTVVvjhh+y2Ms4xG/lQQhHgTfXgKC2UPEbTugg5DGpGpCg4qTWQKKvTgE4sfbyp62x4gnCBJ/q0O3ZtjVE+NLxGTgc+gCE+"
    "yTEXbHBu4koVcF32MVKqyQSRjhrqB+JnTK7qb2tWUo4Vw2q/83LYmzZ1pP3dj8hLU8aQkN1bZaRW0NZh/RVC/tpqt+2CFTLwBd3y"
    "aGNCHLD0u7hQOzqVCmKQ8pX43zqnR58cTgi+TlNra6PPMc2bcxnBLzmqi+NOe+yiFWpw94AshScUdUMYZqli1HvjU7NYXvrkI9Ri"
    "8dBierdxZ6cNAbhFrmYHrkZ+8LWRE/TRrllPWaeakFcT1EUNJ+9P+XOZhEl6kjATA2Al8NVhb9x57wm1gRXtBn2prxUEMyDZqyFf"
    "h0Y3IR8Cg3rbiOhVNO+DP8UX1X5XbCpz5Zm8sph/7nbtoOrmK6f87cHe0wOYEklROVTvJyiMbrmYKBa4KrVo+bshmjpriQ/1DRed"
    "jxj0sU5Nm5Sivi9TVXkVtm5Vyx2QplszmjLhFpdm6t72MFEaThJQvQ0qJDekmyo7SFOZCyRMl5k8SAHADUZkFCqoraSgsS+O+XKt"
    "mEgdX7FAFe15F2uR3w8Grk9o8SVWIXAYmvMi4r8brHXa/maQkpW69FJzoG9zGLfWARedeGT1srtrE0MpJYTnVNybUTcJCFq35nqr"
    "doWyxlTo07vD0B6C/RPLBgFhbTEzqxm9+0QXyp2611vXh8dsjlRW7PIlomqxajIx9ZRE6iTuoJnBoSHcI/1OebGrExxSjp3Dycu1"
    "0sZwovsd0FaxsBrT9mJNquKRjX6f5HwuHqwKKOoZcxacOrLq2TN+oo+1n6qyhtsNK0DETOIhm3jeF8mAItAxjrEN1TtyoHdFJB5B"
    "SjyhEBojAvDg+wTu4ygh3JelMe1jbz7Pqekr6SbOGAY71QQ8cobugM9eHEpqTH1FnHKO6W7Qn+78593Pb/SV1fYIXFPqrfp24A4m"
    "dy8CtMbPYMux2pBtS3YrVmcyNU77ZJtt1a0m3UHtlX5zfyGCMhJGi2ZUoqe8VyUYPIpm3A+pxjLVkUxdfgge4OF7S19/IPJbAWlA"
    "pJqgGmTawduaJzcSrQlbHemYv3Ym487jDbbVF7Aa0ukMO2uG1U1hYjwJ971aQFG4KsHn+xquqptQKjHv4rpNdvU/CpwCeeXXl+rS"
    "cL17dZ9wIWL6U4UN5lQJAfW/3fb1AOX4q/AylAQYddEaZPfy79l9crtHfq+5QVldD+wrm8rOmG7c6xO0W/ZU4YaWZfVEu0ZhMUIZ"
    "iWmuv7uI1e0lugVE62CBdQ0YJFROXb8O4Rfp9tAQayoJnNmi6tWkKE/pV68o/uvjmt2sgeetC8R093cNPK87OK/YbNrz+92AvZCn"
    "2nerWGAVsTpxhMapFl/bb98UzwmgmDs2O3bB7Pa2onamT0c1DXObQ7dOug2zuvi1xlvMf+flKazdvi81lECpqNYQrq8fKc8/ZXPd"
    "dq3uVbk3epSKCVQtuldfbcI3f22hRy1Pt7AJTpkJY41oGmLVn/pFyKGD4do4PIiO6a74zdCgWaODDVpqMAgKECcEyYZW+X3QQM9o"
    "oYPWcvVAtYRXLqmUZCSj2UBRCRBCZ9jtrdadeX2BjNQvpBO2rIJsPZeFGMQlJgC3yQIA9G7Isc2af5b+u+wTBP0hgctQ1Rdvkkel"
    "cT15VDter4p0+4Vuh3dvYVXvqFAwrZrxO/UrpYZ06YAMwCGtV/scM1VgmLIPFzoNYK/G5n5aJ67DDVTLnukR3lKhNOKul6SkDk/T"
    "kwZ4tGCH2l29aw1YekQW/FgQmZoGadBa46INExag9pY+TNelaYtK6WcYZKZqiCRc91s1WKMY045e28/WtwCpxENX50HTurNUvUc8"
    "7klrGPLUpan6Tnn3tb4gVbUJIdJCJEW+N69QdAtCO6oFMNVcaNlTj2VuB+meLOh3EM2C9bVtC66qS8t9zKbujpENZBliYUNimYm5"
    "fO10CAwg7GaKfeW8O28Q/ld1S7v65/yLipj9FWEWekFdYzRI0J5bXW4eYBN94MT+2rp+shDJ1dvTzq/V2NWb64tMJLEIkOqTt9P9"
    "90B0bz57g6uQMMyFOicTS8ELVRyZ1Bqx1OLtH5A+XYjXrzRpE7KZYRVDhg9Ovzeo6KofjthZUKxtwFm6rqp+5Gx7qD5grT28yPt3"
    "3s83lClX5rW0U1bbsLAtsnVH35eZMtV4adMfwv5NnFAdXd2rXed/KN0NKN3Ve+qc8YRur2GLuogWuN3UbNF14YbrC+M164549xrO"
    "cI/4PaVAQ5xE1d5mlW+0Hq6pbOm17jWXUikT6SxcH9vUTEdnL1QN78Vo+oJKaC9G5yPFC0pN11UsGzxe/4zFRuKUbEw8b2vM2i0Y"
    "8yvJ1q/ZEA2s37CpX4CJcKoeX/0f+8zkGebXDvp3VIgfa1D9xpfVhd6hmqm/Hhe+F9BPOhgCNq/KF/W930rh6vpKH3SBWkEi8an8"
    "8bH+X+93OrFMHDDOwCuHCoi6TtIBcF7+Mw4mnqUp7JKA12e9fM/+cV7tEyxmO6rXAdm8wttXkTgWkREAco0Bxjd+5RVb1jeMb+L6"
    "7WXd+30vOzs3sSt+HhM/l5hJEnzdVH6OoeeKm69x9tcd1KFu1BDrzODKPbe5Zhtexr7YZncnwztsi8bJ2AaGUuXJuXN3MtHfKu6D"
    "/+I1IAV1g+xfVg30iB6auyyGbYrHZRZVd2Je6ahEPeRm8pi1rrCs7T0N98MCGezBL1MyWP3EQv+AF39U/Yad4dKG6fRr7HnDNRj7"
    "esK//TDUbBd0GqY6nrvqnuwaIt5uNaTpzSv7t89bN8BkdCRzupijGgKzuh+mfzylEo2C2mNOmAbshVMv71UXqly6kPIHOFJ0GKHO"
    "r86qK4zquCo7qXIPnaoMnELfKok5WU+rpYfMwbp88sFkTWcPQWtnpz2Tqj/qLnGj7v8PUEsDBBQAAAAIACWgSl1Ot36BqhwAANlU"
    "AAA+AAAAZG9zeWFsYXIvamFydmlzL2phcnZpcy1zdHVkaW8tZ3VpL3NyYy9icmFpbi9yZW1vdGUvc2ltcGxlUGMuanO9XNtyG0eS"
    "fddXlBAOq2FDIClbml3QFJemNGONLYkrUONwOBxUsbsItNEXTF9IgTT2V+Zxn/2yPzCe/9qTWZeubjRI2rGxDAVFdFdlZWXlPbOw"
    "89lnD8Rn4sX7Nz8cnb78VpzLMq7EyTH+mCUyq+IyHtOAk+NHWZyJkp5G8SwWc3kdF+Lo5NWjVSwWdYLBcTGhoUKcvJ2eip0kn2GG"
    "uBHLOJuIryq1sOPSJF4Imcl5JYvnYi0eP8eofDESVb5QmVhrKN9P8Wvnqjzkpwdf8X/PBY3+6/TtG5GqUv6cyGIkZnkWqSJOJ+Km"
    "Wi3VZBDmaSqzaACI6mM1GYzH4wFB3XkQp8u8qLDcNL/+VpWpGomFKuOE/liG6VRdxisFlC6KPBWD8U5phg32HzzY2bFkSPPzOBH1"
    "alYnMpUiDvFMhhXRJaqvxTenpyeC1qlFENXZSp4l8aUSkSzn57ksIpDt5Ozk7bvT4ZiAHmF9sZSZSuykf9vd3R0CsSyKsbNMxOm1"
    "TGKGO7VEXOXY+ffq/G+xuhJ5JsWsvlRZSs/HD9RH3maYZyWd5pldUBwIwH6y7+0l+ItK4ywW3wFFrJlndYktlSCKyItMLRKVKjGP"
    "r8EHDtzf3r46fnn2DhwDgE++BLYM8bhOEyVkIXEqQFwuwBlxKcV5Xib1Ag8jKeSlxKnbdYh3iLxlnDnw3x39cPbN2+9enE0BfHf8"
    "hab8qUrURZ5pxJgyoqzLqi6ielFJPM+zQto9gRyAHAwAezAUM4XjvS6VOK/FQkZYnQcTVLxSDFOsVBYTqUMQGpwsAshATnsBzh1k"
    "07gUeSLBAnExtGh/+/LNi1dn0/fT10dnrwnzJ0+JKg92PmuEB8uUYOJKH6peO6WPYNwBce5gwiivMR14SLPbOU4gM7sdExOb072o"
    "M/CcpgmY9DXJQxwwwKG4eSBEoTAjA1+3Xh2OaSlxcHAgeLX9B+t7oqlFDoQ1YpaqYi7P5eAXhjMSELP1UKwkOF1k4NJeZDvYMKJV"
    "seL/heHYFAQgGR8vZVEqM3KfB5g9peLTTwVhkV/QaNpLfv6zCquB/8LbaVmBJWcDcYjhE8aO4K1B5yqcm8UNbPeSCbMj4pN5nilw"
    "SAEJJeqkeZUXNXBdQDQW+DOF1pzox6RBE1kRb5AuA/sDKnMQxHXvqSiJVYs6K+trgk3sBuYPwWQyieKC5o3Fe6tZZBgnpG4hTBZU"
    "VBc1ZBxipdezWoi4Uy5lBe6sAMOw5Q8v37387mz6cnr24uWbl29e/fD2HWg7YK0EjXzGmzrDps5w1oq1yoBl+TUDhzZTCW1myQIC"
    "JsRmRRgvGGWIUa3FPAMJIH6yqPQWJoZaGkUrW3qJHtyO3357+n4LXqByVZ89AVaOhTQlvs1XgYxGgDpTRZeP4guoXnrBp08nCj2Q"
    "5OcyOZ3H5TjJQfgpcJMzdTguVJpfqleVSgHQ8JlKoDC2zihVZYbb9Te5aeczvFrmfI6rfFFKwyr6zFN5PdKcQABgACAqmuU623y7"
    "qAmrzv4Mq25FcOYQHIpffrk/v5MeeJuFCmdKvAdekpuM32W5Kl5hd1VRKxFcqXPsNqlhkKK6rJMaKrJPDTDQqSqP6XgDvT06tGbT"
    "Paw7HNrjdRzQM2qkz3t/60hmt5GYskoIXoDhxll+FQyH+hQbzfl1nidKZr1IMRCaYbSn1hI78YmMRPD9t8YyY/NvyYaAniuZ4bfK"
    "oFBjMtziqI7iXMQwmWx0rLqvyEOS1/vsBcFkrepr9gEY/qOIbTMgzHASMEYbp0OqYiWXJIUiwPEV1d/yOFT9pxDn5es6qCVkz2Ol"
    "TF7GMwlgh+O6VMXRTGUVcdEAOh7vtgxuznBH4/oL0QK/8mhnXKmywjo4QENa4pb9htI7r8FuWZWX82YsafIA4A/Hqfx4mtfh/CTH"
    "mJJQgXv0XOztC1bPMno7FdDBkkwkXA74l7PYnAtR8SgqQDJ4iBls6bIkb0eu6BfRipQSVHOcLESoLuVSXIKgeBnBqYS2AxG18DJP"
    "sS98KuOkxJEpUdVw2mIymjRdC0ws9nYfG0VfF+pcK3DtI54bd6q+hthXdUXiwedcxoVcJRqZFI5ykEMGhbrcyS/gbHwfP/4zsKVd"
    "xCPj6TgkhsQjtBKkEXoZ3utCVgkp8qgeP/AOXZarLGyO/gJG5Z2SISx4or7JQfI5fpUj9kFxxJ7XiDVViBXw9EJCL45EWhoPZ1ef"
    "ulboYVUkeJ7BIT06B5TjPKuKPAHlA5YsPaqKU1LLgFmd4s+8rgLI/8Fznj6WNDEY0hLenGUB3uY5jMehGMyralkOYMr5r8F+n3aU"
    "V5KCGbjycanGMlsF/FYI3im4ahloogRzRuDGvBZm5oWCrgw+fHLDy68nOzuf3MzXE3wGjmsd4HwYIZgo41kmk4negf4g1kYBefjM"
    "7ZP1cMR/9ViNrk6mc5JJ4vwj6KPCko0paZbxicdiAa5TBTN9LM7BXgvr0djYIJFlKaYIiBIFX9edYlGHEObghol0P27Is2kFJXo8"
    "l1Bu9BEeHiJFxFFWX1ekKQggJtF/+81TswD95z11S+g/vDetxTCg/RmqwXDTjT0AM8vidODht220jkMP3CmYx1fl5rOzMMlLFVli"
    "aAOCXzDAgjjzawkHdtg+XHCUv8lNbtas5ohGLOdotf7QWuOqvN8KV6WGf1XeFzoZtf9894ht15bgHRqLFB8pV5iisfZhwEUZHPFg"
    "oVYdrDTBWGyCgRafwcgmCDDcyIxb/YWcS6E1Ia8AVRjGc3k9AV4iX9RVCsuaOfdSpyygO4tsDN2JRyNPV8PODg2GhbI4Roj3Q3VK"
    "x30rrrCnO3rs4wZt/eCMmWUiPFD+PrSCMYDgK81HCIejVUswenioj9mDgUGbAhnLrk7n3VcJs2u60xDmkbFeTcJHBGzXcOAFDFRa"
    "D0l/LGQoSko7KGvWyJH3F76nXt97QlZjvzUVhg0TO0pXM6gRoTWULoi3JnXr1Criwnkegakp4TQYuedzJSNVlIiqxYC2D/fl8SmH"
    "12Igl8skhsKFCdz5GaZ0INbNRDqZiY48dbwYX6wCPq5mTI+uty/Xw7HR1nbnm9q6s/NIVtJtHWQYE07BcMwmwUDxvFntXz2kgfmC"
    "1NdDAnDY/lD57OxYCeq+elkUOR3RB85QfXJDcOAiVnWp5d4b3uE8+PM1iF3E1yoabFo2j2+1A72hSgk1/WHff81y8Sq7yM0Q/dKa"
    "xEAVRbORjW3g7SH8z9SE+Mzu/I7C/ME1IhT4AP/6x2+/pr/9SsrPOPw8LW1MAC3SQqqz9/ziAk6eara9uWkW9cZ4Q/aM1xEEoHGe"
    "UGrNczB8qWVpDJMYTHqwJLd5wunX2uRgxKDSma8B5Zxgxjk+gMM6fT1FcFORR6ltfA0XkiJNaGknmZbNtOUCWog7pnkIwIEbIZy1"
    "0LZk3eRcP7lRWZhH6v27V8d5ugRyGfjYHetw/amP+IdGSIYdbuL1r8p9f89T2h+cZfKUyTuOFHvQCH3gbV/K65kKre/tJxA4Gxnq"
    "NAvGDrtbzZcqO92mim68XZMkXZUI/mW04vMWD8FFjkDjtycv3wxbM3pYcMCnJDq8tt+e1Dpt/YOFWekHw/bYtjPY/OwgwJxlOWw5"
    "WzBvwiZ+d7Gv/jF8GTAXt941INdQ17u+umbE84xojM1v0rSl8NxJtKD3ophtYmjxo0DRe7HuoJI6ty5Qlxv4bJK+pXa9HKO6HNPD"
    "DpE4jaSVapNJVFl0VqaUWe6e0mUeR8ak06hpWoLDRqIHsNUV+3cfpnFWgw0o/bwCyeLyCGeVSqVTT6v+4+3Qkjmy91zZ6vi+yvC+"
    "rNZdQxnB+eO80yN+c5Cm7MjdvUVhmyA4zBtrdKtRtdalbVu6mvBujPrx0afWdpDpEaftmzy9tQqzeGId9jDWQ2A4oDKpRBVniVrF"
    "SzFQl6oagFOieFEpW0Oh/JQ2IJ8xOGN/6syUXeaU8Msi9rSXqpCchL4mIxSR2zGDpi72OTcc0sJwGBGIUgzq8tsMe6dxjn1ZKdTf"
    "LZUTxS7RNkf3RsTZJY5frJ0Dpat7weA/KlkX8WP4eiW77iEUp2++G29TgwgGy6SGIzJhO/aLk3Df2axy50AARxhAnRHzPEOuNbbG"
    "4EFnlA0z+3hK40WV0ImNrMs6TWUBn/SDrX/Ricz++T9U8IQpjHDMMNJtllt/sLy73iDdFcWEWdRY/46z21KeVOSBiKXlGVCrk8pz"
    "saES4HjTJuPIf0q4PyT/lHxS/wU5OeRClKqYiNemdCvUopBZbMocI49jB3/hmu5AiQiBXiZDOD7BXGX1NRisoo0PfdXhIJu17QMf"
    "A0dLHmE+mbRmI/TupDoHZQkDQ6x1DmW+IQ6U+Ya/ZhyAMk5jzugOGEu/UkhyVljrvbZSTIdxrKvVAbGLS3A7hXvF+U7z513eyqZn"
    "aifyqXcP2x5xu14OIrSLbTZX2wTmpl1gYmuGWuVkyqRQEYKPQTeob2lYx4behMZfKcTJz3/+f90rrXfLriiVckl58iOE15cb+RRb"
    "CNAmkAf2aOIpBBi6LlSsTeWCkrAirQ9d8dqwO7MOVdB2XAuBRIAtlmB+0r9whkOlQR5lUUFORRovipy0sLhUfrK/pnog56n3XQSP"
    "IDeMFwOuEGQw6JGewRx5bRU7sPkSnvcj+1K3UCQkWSvMCXQV1y7rcfuQm0DiRRJrF6PR5kyWb5RMqvnKEVDraqoZeLTbb879su8g"
    "6c0lIruKexI6ZwBHjaqQY3IRdI3APqFCqpoiHnldisNDqhF8JXRzQgP0j/CVngleUjKlyhoXbk4LGS5KhOplniLMq9ifqXzg7C2C"
    "FSli3g42rD5yDG69y7pcmjlCvyQBwgrtnIDLV2og4JzVcfXxcDskM+IOaAbJpiQmHmMueTlEVo+cbca3/O24FHwZSjj1NmbVfoBc"
    "VLKgstT3U2rs2WFr+1gSNYdj68yIvWdi8c01Io9nj89hoVOEG3j8WhdPCsP/VJ+ZFTV5IV7/yiNJ1RvnveTZywxWysnFIidfnwqw"
    "s15HpKmWBTzVV1Ae93KqxYuCe47WdQ1MGhH6XMxp/QQ6gdKp53HRW7sL4rfTdq2QpNmEuYD7ssQbpze4IF9T7LzI07oyhWYJEY05"
    "cdsux6rCgfnBq8/313MD3d+ga5+x7k9g+SfMI0rNcj0fOmVkgarSW9Jac24HcAjPcYSusswrcO+PJbMuSLJYP+yUiIcd/y9fOC/O"
    "hFzu+N6w5jCH6GfOMOeh6wcwx5YvfGdJw9ay7uC7GueY9KN8waneklTBe9D0NT1znhOzM6UeQ7j4mUqO8zqDW7g3Eiqc58cSKipJ"
    "OP84YRM0Elkel2paL5eQzdI9t3lJK5rkDUMd9HjD1Ueb76WlOeH5sYJxLyXVdt5BlrH8Mwjuhvd5B4ihTxgi3y26ShPqdn3lEXh7"
    "QmozGeXriXsnpoCZXKjiYO+DV2pj//c8zuD4nXI8D1NZFHJ1Xl9cqGLgZNf6N49iU5PncjH7fZUOtUiLPfmSFFVXTw1JQ5mYKZK2"
    "n2zcVguPPNuaSAMeaoBVVRq3RAf64BGCr5ZKOM9XidI+Qh++me4ioBjPrkKasoRnCsfM+BRk+klgsb1ZfE57pCiNERg7jjNmo133"
    "8piveW8l95C5abKVmzQnWXN0Kzfdz2Z1mbkP5XVrQ0dUcNxtxGqWa5PuCjBE0/PatliATibGZk9JQQ+CrJb25PSV3DZKHZNJqIuu"
    "E+3rsQ52zbWr+roGXJw4Vc64q7AuxI4OyIuG6HldvVYVZzD7qe5R0E9JePMs6ULosUodZTKBV1f42UY7eHxxUU3jaxKGp3tPet7b"
    "WpkFGakS8T9rsG52onMSvftYW8KdgMPxj2IkoitMY8iNo5z/5o5CGJgVuXQiaAJDyVnuWVwgAtTdHKYzknopxp6G4QZKijG1npkq"
    "x4FGxfOsjUzUBexhoEfANFw4MK3UTyermIGN86VP3L7UHCLHa0nqA9qCNu0lctcP2v/bRcecE2sAd5lX2OblMafDvVYmcNUeJ26J"
    "0rrnFq4I4rEFdZkQv1HrYgK514fiVN+p01xlfq37XfWB2GZPDm+JB8gd497EGB4onLsVNf2yswIxiOoZnMChhVqSvipKpxgpttDZ"
    "pFDq/hhWW4LOBFGkO26KLVlOKoa3ISnL0PZxt4un5oibd8wC5mPgWVRGYsp9Q0RVwrWb77JtxrNaUM6L+lKIINRjjOOgiM00FYOJ"
    "Wdun8tramtvy0+xV6kZVk3xudar6DNd0xbru2c18NcFL/US1PbFhm0zpeEGJJoywEfCW+bp72mdhTYp2zaKHgqDOgpTEhJRdJL3E"
    "otdsrVMFVVxsSEE3N772CPbQanfywS0RRAzykGMFUh6RPf+a7Tl3Ppoh4/NVpb6D9azmiGKeDDtLEOhmI/6m6U0rHPL2+1Wn69tB"
    "JSKwZFJDObZ5ToJR0P0AB7dDtp6t3mEi72cchW/c/PM2fVVhaoTjVVbtPWPiWaqOxO6oj3zPn4u9ThVbwoHaMDr6EII9vlgxTnjy"
    "qH17oAMGCvOAYZFnfazdZ9BeBk0BitUzCW6suS3GITTg8fnzz4eA82P8EwtLSn/siC+e/OnZv7XXyuA9bkF5mtdF6FXmaOhYu4gG"
    "v9Ybax+dtQPX3WYrnXKXURQQhPZC5MtG3Axiegjs8AjiU6n2DLuXK38rdVHAHabqiR0GdvwLnBKKEk0UtzA3M+DHVpIcaN0jBocR"
    "loTuU+g29nGHH48oB4Dlho0posU/F7vj3aetbXAwZuZ07dfn5pSjumDS7Fsb5NRyGodMy03Xx76hKxK3+Dd2WL9308zk2G3K0Z45"
    "dh36Dd2xWkhbvE0Pn66PY1JfnDI48DLwowYL+6dedOQRUN9RGHmEO26G20XtZ8t69rNN2Ey8TM6o4YXGxjvXlKOcki0c2TCduIR9"
    "Yt6wYQxn4Ul/X8LcpfHwsAFJyE7aPrOxo5LL9cZzpvCZr9aYUpJJiNR800Q7xFja1fRp27CFEyMKViVSdsCptUPHVa2rQ8/75MHc"
    "/DC0WHtZ4zN7TCY/6WfD7mzn8GvipqG0U900bU6syJn7mth8vzOoLMIWb2/l0GbiDjl7iEb5vpYIdAKNwrtnX1IbLYl2vKCbGUuT"
    "54UZwxm4zBS73qUuXFAo2rRUkCxq3f7jT/utpwnvdreL/bIuSYkHF1882SzwGiVfZ5S5wYjT/CRM957R4BETp+VYkIYgcAHPaL2i"
    "xaFE+IVV/d5r0lY05PkB06Vbpzfpo7raNH2Y1SnUczx2cdHeK/14gUJIgQLQ3WwIwCJ0VyQIRwRkoweAANM+evbQbQbY7FY5uLNb"
    "pSn3ER7agm3gwAzfpHgPPJXRHcpWoHElIYV6shFTP0XXnmQd8fGFUlHg7lkSWsPeSf2upv1p+U7b0fUJ8Kh9we5Rz+B158la3wHa"
    "RM7tBrpAVZvrrm85xk1hop8NYdrSpdENPA37sSvTAjjQ3d0nQn1ExBmVOhPzfV4gZqugy0JEJXlBfe30VxAPbwyog/jH3Z8+/ZR+"
    "499+fBGEQ9ccjF9lZdtRwnGZUKZ8ONz3C2rrdaFmVA4s3DLBI3ut6zEM16PRyXC/1amhl665bfX9u++M3nvL1/nwOSAZ/TrJz4Mf"
    "aac/UeutqVu2mjkR5ZYhdFw1aAqY+qfJTUqPDOR/vc6jOlEB1m5NICwKRZ0BDRbdMS030iW7DOw3eEzZ0lFzpY323m48YT+J6doO"
    "E1lxsuZTmz1JMA/ONWm5gvSjxdHihP/uyEiYaoK5qzQRU6afOzjEaVTi29h0uWxZqM6s4Mvdf382ooT3XhvzJfbJB2DYbmOzcbas"
    "K+2Db0YAW6lQLrvL2DfhFg98g1Tl0iOUF4X2dKA5aby1m0k331f5UleT/LQb1SQOx/6jLQ0/rYVca9ZGk5vrQ+KlXIfveZxADCkp"
    "YxLLv/2DimC//Vr+9mv226+m0IM/gkUeUQ/JJXVNgBqHh2JwOFgPvYbgbv2LLI+ugbeb7bZuunfbm4TuJUBfy9O2G7mB7vvRzTyP"
    "uWxA+Vm+y1qPy6v4ohpOdB5/5NyfETm3qdSQ/dz9Im5yYPCtZCTH4q9TvoAL3/i/9nZ34V2Rm0VRFBgfpA6Ovzt6/+LlOI2oe14m"
    "4ktb2PzWK88FXCfj0t2QHVK6bEaX0EI5QxSW9VftWh1T/aWuVs39D/ZH+dr4/7wW0yTeXGPXHVc5t1zSbNvCOzu6mFs11fjqBm3v"
    "tlase90v1T1NVCPlRogR3Zae1Rl3I7bi8/Tu7sAthd1JU9YddbhiLHAmC8mr2WKDafmoMz9u38lyYRp8dmJ9uTJt+hGaoJUEuEAw"
    "T7aM1UjwwchZI2HUbZbyJQwQDZw5Eaqh4wOzEb+0TKVebIf61DIYkyzeQFUEg9c2EPFG01d2DJu6sG0p+51HtGVjGx1gGxuFwvwX"
    "FCYUJCP026+D1i6JgyHxs/ob6jylXNRg4ItPN+jXrSym4GuesR6hQjFFjq7jz8a17oGLge3VyzicUGYOvjP/7zW94HNzm4UTONmM"
    "Rm8mAaDTpurvNN9SiHptN3MOfvCtLabutPGib9eW4702U4f3j7cb0pVsv/rC6K4ZetiYoXY2l04ncmff8pmj++iJZZ4kjavW3/7b"
    "Pv07e3+3Z7R7d6Rv83T35ZGYrsv4yesgGuszdZej9WD9cHi/OpEtzhirV8WtdQ18LOwv5SMRjW1z+F3uSTTWnlNH9lpeiuk5a7V1"
    "/w6/au3znN6Bd0MNMb8qLmVi8uXcuE++65BvPBgglFfhi9ys5e23w5S6PUbrN/5CJEix/Z4P2Wpy3n4B5RaX6v6Kja5nPN310dV3"
    "aliNuroU9015X8yg+4Jcyopq/0bRXs0pA9SPF3fk+DLOk7sPu+e/UT3Rg51uokv8u+4W+V1n3FXjnn/5YSsX8QUj8tLkP/8b2pyV"
    "+Sc3vvgeig8iaD2C90t3ZQfrvitNVnhNa1ArOchn7B16odlpo5Gmj2bd3fljfo+0dLpctx1mn97mlkrf3fZSxSfHOkncpIf3GQvK"
    "7prMLjWO6r5R9+UU7qsTTP+vSxX13bZlVA6t9cC5eI+bJJP/9T0WzaOMbiWXrhWDWjDE7ni8R/13lE9tGghclnlkUoAuB+7eGFwT"
    "damS8g90st50jLTVQr1trWaw7WEldEmvmrmu2bXmmwQOVHtykZYA7CoVZq5+amsDQz1Vd5030vV7N9dnwxsfsr1DK9PcxeA07uW4"
    "al3subevbdxr04o88n1vC+rW+MaJ8riaqywImgCJxfbWwCFfDoYegC21Vp9Em3cvLjndcDiO4tJmKLZfMmjf9usDxgkY/w7hH4DS"
    "6h7mhK77wL4ILeJ3D/+R9fzOadc0fZEXLyWR0PZN6w6antiOW7Z//7rM52Za/137phreb3F8JEwUfPjHCL7tuyO6XzPBX8+hJfEs"
    "JZn9mrPFZBL+nOSy+uKJrlI83Xsy9L4Oi+RcZs3X7zyUTU8y+2fNTmRGp8DAyES9yFMZZ5xgcwtu/04S0/htoh+bsO6ryDtg7bp8"
    "ScUO945K85+1PhI4s9ZrWc2h0DJqH+C/y79DsEu4q13YQwB5OnRfw2QIxbbg8XPTTK5LPNxFHuhvuLQ3it1XHOoLKs2343SqU2UR"
    "UrFOE9nuH2/2Dc3Ne5Ya7rVtK1auc5PnaYbt6EF+3EOMwDstcvhotKrZIAbzdMN0ZR9H2Nxm32Fklvq6KQKAf3TU9RaMQUe9zkh4"
    "iz8We8Of7MHfUjkr7XFs44myzQuaOgClsdIYyY/BY+7VGDUMQJ//NPJJU2rO4YGb39kFkMQM/wtQSwMEFAAAAAgAJaBKXS+WrC4F"
    "BwAAfhcAAEkAAABkb3N5YWxhci9qYXJ2aXMvamFydmlzLXN0dWRpby1ndWkvc3JjL2JyYWluL3JlbW90ZS9zaW1wbGVQY05hdGl2"
    "ZS50ZXN0LnRz3VjdbuM2Fr7PUxwI6FYGHFnObroDedNpZprdmQJpg8lMd4GiCGiJtllRpEpS9jhunqXPkPveNftePSQl+TcTZya7"
    "F71IYvPn8JzvnO87ZFhRSmVgAWRkqDoj6aQLQzqSivrPGdWpYkPaBfq+pKnpAsOfKYMbGClZQDBlhmoTDA4OUim0ASamMqfnMs3h"
    "BNdFIxF2Bgf4ocChMPjKkEqxQ1KWukdK1kvxpKALYQdOvoRwUW9PIIyiiCRQiVzImfjhRze/tO2mO3DT6bQHv7549d23Z3hocC6v"
    "GeekdxzFELKLiRR0AC8v3oH/DN9dQv/ZVQyc5RTOSWoH/tOxIRA9FymMKpEaJgUwbWiRMnRucQDQ68FXRh96HA6pUlKBZkXJ6UUK"
    "2e+/XcM3l10wv/+mYMh4xhQrGMxljlu9hwu49MtfInonQGaEIV4uAWEQ9Rpb0U86wLCaXSkuFXTW7kWQJlKbBIJ+HEdf/C2Ko36A"
    "SLgdkUGAhAWBwDCwQ4qaSglIBwc3BwdNNsOghmJOFeWgqYZCGqmqNhU2YE4NZJWqigTeUExU9g9tFBPjbpOWLwfNKlrKrUX+r1uz"
    "rKhwaR5seVSa/pPk9C0rqNKhC8KNa1MN/8XlkPAwEGTKxgTdQ+8WgDvU6ZgKRMCnvAsFef9WVunkQjJhdALHNRzgHEM0Fjc7DXOZ"
    "En6JhsnYFqF3CmBMzWtMPBZhntRROKetsR/yH+H5cxAV5916ud5ejgxZ29lYhtYGcmNQD940hhQt5JTuPHrVAAJOGzsbNtqwbdZs"
    "3PW0LKlIwKiKNmelXGqaJTAiXLeDY2lOq4zJjeGSkzk6sjFasDSBODpqvssKMxK3oDCR0kvM0rnNRzucU31Jf27X1WlZ8tqpxBuK"
    "kDa1sDH32pKgQLvEMjT0hA3TItsJFxu5OTg5QUaUvBozkZS28H+ZSpbSK22IMkGnIckCZF7DBLoqCqLmSDO3iGZB4+3DZkvJ+dKq"
    "S8agzfHGSY1Vnzr/u9XiHWx5QwnfYkslbFmfcu4ru56yxvAPQ3VBhrOa7I7oGcoD0RxBVF3vYAUaeYDfclISgdnDFQynmWVdDfOK"
    "M0ttqmWskcrByrQUZyJbbQPLqRKH08hB+73FLHRr6yXeJO4i2ZRgHfl4X8zt31PrSnh0HNdrvRyHfkvZQQF8QUML7Pr8sozskldk"
    "Sl9QKl4Szmn2b2Ym4f3lsRSGSnGsh5lOer2l9ibP4vioN9M9t/OQWAI9dzJ8Qj47iod/0SVFhVMn/WCdpLVnaeQOe4V5NZN52Lk3"
    "hDSqidiusSrUGdjGdPHy8wx1f0JFde3kfEx5QTO2vp/TKbXFYbef/VyhBC6WNK4J3FTNiogANlv3pbuiEJ4lrTT4r95EdNwU9cOJ"
    "7G8mcjvKXUg0kUR4Yr0Mj/2Q5xuCFMef5OPOlDl59PkoWK7kCK8QjnhjZgo2lypBCgpmE1WTjzN1v8detL3mtnq9Khkf4bln2RYD"
    "7A4d9ndGeYp3oSldD/EJmCXLYFOkcllUxt6YNIGQ6pyhCCMSHZjRIQ7zShAECtv/TkXaq1GsdQczUXLm7lZn9jIXBt9KVCeUfRQt"
    "5+al5T+MZCWyoDNYI+9e+jd2OfXqt5cDTaCbp33oQtRo09a1qOnTm5ejdgL1gXxNpxgoDi/stecdGjm3w4nzfeNW4SNtq2NFvJEB"
    "iv6EwxpL4K2NajuWeh/a3a6T7X6FqTRAUsYLco3l0I9BI5mkUATxQgaxOacwJddjmt5TDw9QqiHRXonc6lZrs0OacwSe4aI6yHIH"
    "Hi6EYO8O149RpNZWN8c8gqQriHosMyLqBq8Q1ZULQSVqXAXKFT4v6H2N/1FKha9GW9jYNF+Qu185EebuFnLcxAn6cnebwDV+EED+"
    "++vdbXF3G/zfs7KnX3un7a8fSNpKNrLqeoyQT4jBlKDDeUExRoK3Q4b5sUX/lOC/f1JcPwzo+0/Aaq2y7QsHYxRzYmh+5Ur1Crvp"
    "FRappb9UvtrfiYyOmNihIa6ufaf1IrJfgX/Mg6N5VD341Gifcc/rJ0Cdt+Vr4xIvb0OsO7we3N225XjYj5/9/RjT2BpI1t4QXqj3"
    "602Pk/H65E1w2TXz5astoOsNurA4PwHIO3pl4CCNViAFIbFRcC5nNIvggqqCaY1GNJ6qZcqwejKY4T0ELTDd9PcEnKHEbTx05g59"
    "hh7V5h8H5YqnW3j2j32DQyHWeIVPCWfaPcLWtEE4dcg+7VV2H73/B6+uPTn8VlXuHv2Ia20cf9RJ96uFxJPwxmnbJKJGfFeEaj52"
    "PWHOXNs0hs1RSPa6jz7okf0vXT9wzwWXZEsa6wXkUhBRp9x1A6b/vJfKJ2XYPXfO1ScKkvDx/wDwdiIi5igi7mm6V/FhWk11dbRd"
    "5DZ4+/MHUEsDBBQAAAAIACWgSl3sApLBRQ0AANIjAABBAAAAZG9zeWFsYXIvamFydmlzL2phcnZpcy1zdHVkaW8tZ3VpL3NyYy9i"
    "cmFpbi9yZW1vdGUvc2ltcGxlU3RvcmUuanOtWutyG0UW/q+naKsomAnK2LDLj5UruBJjlhBgQ+wsRVFZpz3TkpoZ9YjpGRnZ0bPs"
    "M/AO7Hvtd053z0VSQqjdVDmW+nr6XL7z9Wnr5aqsanEvLvVyVajn5xMx0yZ7oWS6kDeF+qq0tdiKWVUuxTg5tm5UOj4d6TDz6XdP"
    "r54+/ub6+fn15dXjq5eXE2HUr/Xz9LKWdWN7s1e+qT97IU1WqHO5VJV8oX5p1GC/1aI0vhOTRscPxBcvv/vx8dXFM/FQ1KpQs9JM"
    "xI0u5trKjawymet2yEfaiOZO5rU0Im+W2EhanYzEA3FhC2WX2mJmJZ6fi7WsrBTNZt4UcimFTHWBDvq1lHeiNFLcyHkhja4m/lOt"
    "RV6uaBqt95mw5qNM8XIbZXSmjMCPqsRahakmlSKVptDCKov/52XV2KXaYCFlMm01BtpC1roiEY9Ho7Q00MWzix/FIzHOGrORtcqv"
    "nQWuV+n1+hOoxA16cXH14sfrby8x8rOTk5PTUaFqga6ZnqPJNEVxOqqrjbgfCeFmVPIWPUWZyuKyLis5V8lc1U9rtYywY3yKgXom"
    "IgyLu4W+vvzHdwkdWnHH6WiLE9XpgteFbW7KuyYXudzoGuZRrGRFaoZt6EjbEQtm4QSKDqVh+bETdqmshRAWzT+9ck3rUqc0bCYL"
    "q/yRCq1M3R7p+Fg8wwcoN9Vi/Kw0UCg2hxmgxTEskOmNVRM2iy1NRc4RzLeREDSTFVnDm2Cp72BzWuEu6SSAelYrlT3ZvLSw50Cc"
    "Qtr6oqpKah6PWZ7n5/ADbANPwzFhdZE1VbNsRPTVyy9Eiq4qU3MdTwUdXrwRBcbBY8wcn+uFNrn7aFdK0kfeZ5Vig70wC8Z3K6iK"
    "dGfUrbhUdRRTsByLc0SxyuCccmUXZS3Km59VSrYpTbERlVoVMkX/7YL8Vdbk+XUjC/Qh+g3MMYHeaKHGqsuNSS9+rVVlnMsokZWw"
    "l8GyRVmuxAxNa2ioUg8raFNVkN6psd3+EeLdOdPEOcGktfvEKXvS6XQiAlxM8SmxHkxOR7PGpLUuDXaaVcouLv3yUcx++H/ebUuo"
    "84BAwhnSNEIXqsK5dHUqyJa2Ji8TddUoEaVyrivgDdy+FgpaiBPy/FbmVXqxhgtHah33opHwkq3XwWaEToHhE/59L5IkUWsga3k7"
    "FV/gMAk+4cTb0A+LaqOmIbgewSNd07g9LIPp4ybT5dQH14cf+pA6S+AKG1jsLMGiRy7A3OItFjghsfAqjaH7uqlMCAbhXJRG0Bff"
    "SRphBbanJ614M+0Zjya2rpzAmy7gvFE0M7F49LmYmSiOh4tZVZOqVGT7qryVFAesBVoxYI11Qjrl3wuEVjYVY0wxY7HlvZ1s4bB2"
    "oEJSFC181Gtzm4p3ggT1I3qetCkDLlQ0XSbYyQGFnkMuxKJME56LI17ppSqbOopYDdgM4eyTMEchuWpV/5OEiOKE4Thikb6U8NMs"
    "nogTPtR2qDu5VuccG1E6m7f6czCPFpoREoZTCA8b5Avb5YuJSw22pqDXsw2Pjt35FTQxnFipZblWg1zTTyScSjK1KjkXb8ocqdnK"
    "TMFfb1RRqBwGrZuawoqO1VnOp5dKkVmBc4SkrSkIxb7VeVWCMXBmx+KUHqSI9B1gGvuI9U0SiwUMGPI5Em5FKaKskBVkoZdJp8Ke"
    "kiPlNHjQFVwUiEGyeB0kmYoP7tVZ4nFJvHkj1Pb16fBM7Y6N0b9EFCIhgjjKfgIyBNinzmSmC6B09KQsCyVNHL8arrKUuTrnoI8W"
    "IHeABRAxIKRKm0oNVuZVPS2MnGV4hkMmmuWdlGa6z6XhkDzn7DFtQzR0fuvOORXR0s7Zod2yzsXQdpbUm5WHr5Rp33UqV5Cmizcf"
    "UzuJNpBBJHWaZRFH3Eh0BKmKQRqqj2y5uHF0Q/6sGb6LOGnX5fA6wEhJtAnYEIscENMiZL8GrUCzd3X653QXvm/97z69gb3C1wRE"
    "EHH78K9/Q5xij1dh3h5SoXPMQzxacWS1iCUcVG+dw6hfmVs7PByABeVEjAPT20marc1D9uSgpDVtc2PTSt8oRmI3toNpmWXUftpf"
    "wiFVNyaDZWoVhvGilFFbDh59/4JSqiDcu2Oulqs7z9PQH/dIuljqMxf3c6JFUlcIvp0TeL+PHJydJeSyw52RpSpJFxvk+u9ffMR3"
    "hisEsgVGKSEz5KUIKT7W3R1DyI3R4gf98EuN8c5vrEqcLNKCGrE0sNd+TE1wns2ktytzXBjLyw3WByVp61ErWLRNb+MOzsa+z5kW"
    "OSTToG3sVgwOP7ndiSu0u70azKnoYofhkbyVYCh7d72oW3QHGWJCJ1rfLxeoeA9PePGdaf3NAbGPhNvYTU/CmaEhP5KAoMy7YHcz"
    "tZmVlJncrKJEnnxKTRDpfhvioZfUOqggiafu2JO2sQOvDsCm4uioD2UdzhCLxxUzA3VHgnYOAv8QEfuD+LhznpjuezkSBe4jqV7A"
    "naWRCyRonQwEguM5e8FSfYXja/S4quQm0ZZ/R3RwdmHEwZnovokpfCh+FXeyZmoNLLkqwSSmbqBrua6piTRFnC6M71Bk9xLDvS5r"
    "3x8Y8vqDe1bmllJXsEfbj12YcbkkFvCvD1Q+Ssu8H5LU8wCxiOamRl4GdIdrtMOBqbtVFp32YZOFWgHnNXy5Dc6BMdyq3El3f0rx"
    "hQTTT9VarmCpihCHlmvv6FUiLta0aygbbMCYa70UMKhhE/YCvuUZLQKR7x4F3OnZg9TSZyX79NlzLBdTIJv7LD4esmqnygHR6To6"
    "5hbiZ+Fxx3mdEzFpwSLqNVgSll2rDat3AFF//Ta290GFF554hpk4fPBfBjDhVciQ3Uv3A/970hZ7pGgK+Z9///4bc7nffxPRB/e8"
    "U/JzqU2EfDmOt/Hr016gh5OUs5nT6m7i7pukS98h5adFaVXUnf0ABjqlvudJB1jY+ZOf0POguK+OPwGJh8ObdXEILAV5g78z9xo7"
    "1td970OYN+//gl7bfUt0/twZYgeJaLH3A6IhCB2y9pb8lmsf9+2YQxeJIA5jVz9t+3kHfWWncEVNO+WtoX9yZaxjLY1hdvFHjKEz"
    "KW3jW3cqa0NVOIoHInteLqlAGtUgDjuEqs93h8Og5Fb6ll2d92+2lDrpe05lNvys9UYReIuIblaGqdemuWN8BQV2l70Tz6sKtUYa"
    "2uV3XpVnreeHUVNxD36YTsXJRODGjN9i20rmILt/Vx5gtlsT53FWCd6zc+H3EvCYARFr4/DdbKe3fTS4/RzwBSYff3da3KkO3Oi6"
    "1lNcz/BFC69I1rixDfg38luloQm9ybkO3V5wOMdwkLAQHCnxMKYuleV42hnVhdHezYRlH7/tWhIPnd2l/cDyKNMd/yvCnm/ChTie"
    "Hic13bhaqeL4IIb9kRzv5hwWl/ShH7zz7t5FdW/iW8P4/UXruWZdzueF2vdNntuhP4f+nhAH8ax/dD+t836/+9YVRl72Xj5ychoV"
    "LmegvxtHjzQR26l7G8FKYF8I70l4BRk8gdDTR0LrwrJtwT1U2d3/RtHMuuECDC53Hd2zhcQgLsWUphHk2QQYVBJra/IvFJ+FMM0/"
    "dtwiA39TpnkLsb1CDbYGEYkGtQ0qM5QzkZVps2RkpkBvEF5IAiobEwKEvoQXwKnrzWVHy/yqY1chPh7CHm7NlapIkeH+yFG6W+bL"
    "5QpXXCpWTN0A10JPRbTkY5NVVJAI71IbTTVomfMjEd00CFPnul6qu2TkvKgr8OHbD14n0bA+ynmorf+22tkv+fFQDDlqlYsvRq71"
    "XNZllYTWMzAXrpJ0XtqzhgPA/VlhUjS2aaWU6ahYO0JmGQfSN76UcJZE4wr6lJaK2kMEFfse4JlDQCJ3pWG4DwcLUzrBnbQ9GXm3"
    "aE+2wSbMBgYFzN1hhOUZDqvyQpklVaKopkmA7UoJI1+f3TFipfYS1ltwaA+F3o1BHQINw+njR+ITam2Bp+35XHwatOTjGqEicZ1K"
    "pa+m0qmmdN/tXkgRu2XR4Efe8IPqQwpvula5EUkHoMOA/jM06q2cvivEbUcHUvKfKqIHnVBh4oC8/fJqrtTqcaHXwWA0bc8YtU5z"
    "skUcLEFKHWcN0ncDNY7FHcLdUG1zqUe+LDmM6CDRURu/gZ7wWrLKpVgVTAwCjNxBS4bL21YNoMQvdejiStE/oMFoiHqXU+apHV1y"
    "F9Zgh15q3X206N2d2UJdcO7ffFmIFq+O9hP1O/Z5D7v+4d47T2UshCd03PWVkkW92ERxL0DaF59xS8bGjqGRfQWlWgJvmS9dWbqP"
    "/isOKJ8Du4MNweDUQwaJ7XPZLXyrvHWUtctk/lG0e0hqHXRCfyvAC9FLjqlVtZZFvzv8VQGP2U1xSPVyLam0ZcQ4p6d357n+udvn"
    "PZe9U3qzAXMHXtCzna+36Iz/1GGwex/UnXsHPu5VHg8K7AeDi14ykR/8g+Y0kG//nd5Mu7hjFiQ++fQknDEwoY08Zpt49pHhgPRw"
    "R09QwHA6PnI7UZ9C0hlarrCbs6Jxxx7cm/pO6mKo7WL4sKH+4g3lX9Peggeu/P9fUEsDBBQAAAAIACWgSl0XTcodhQwAACwlAABD"
    "AAAAZG9zeWFsYXIvamFydmlzL2phcnZpcy1zdHVkaW8tZ3VpL3NyYy9jb21wb25lbnRzL01vYmlsZVJlbW90ZVBDLmpzeK1aX3Pb"
    "NhJ/96fY8O5aqidTdpu4iWLZ46S5tpOm59rO9TqdTguJkIQRCGpA0A6taqZv9wVubqZPfuyzX/qUNztfpJ/kFgD/gBQl+3r1TGZI"
    "AthdLH67+1soLJrHUsECOLnMunCaJnMqEtqFNKGniigKSxjLOAJPUjJS3tMtZle8ikPCj4mgPB8PetWnatrno1iUE/RLNbQwOvCF"
    "0+NRqSYIetM4niU9Z9Bdc/z8+6Pj4++P/35y5q4ZSsJET9IoVrSXVOu2UGWi4Ct5OiJCUAkDs1Pf78DgAKxUH00rJ3idDq7qfQCf"
    "vP7ym6OzFy9hG56RhCl4fUlmqB5owmmimIxosAUf4Jf3BRNwib4SkJApm0PMw3SSQo/HExz5K/QuEjg6/vz9hAkGs5RzIpgM4CWR"
    "EUqeoRmXhOMIizibaZnnFL6mw5MzVDaTRMCcZBxnRgyGqSQhgSyeoV0JCemIwiyOUgWTWIQUjeoZ+6xxvWL/p2e4le9fvTg7Qgcs"
    "tgBYyGnfHPuQ8j54L95dcfruKqIh87owinks8eufPiaPCdnxYNnFNShK0JFiYuKufEZur3BDt9dZLIMgcFfTHfJ4p1gdC85ETefN"
    "v+i5xE3d/FLT+dFe+NGTJ8Wq8bi57BnjE5aQjEgCKSfvrm6vOYmMflfMeGePPAxzMakgqZrGkl3SsG8cAC3y0LugKKfjWOCD3pMV"
    "C7/99G/46gQdHaaQUcFCPOp4lqpUeF0jy9H68NEjYr6i4iVCaZwK9FmsD1Em9JgwiQ58Lbmv6BvVMbYomeU22dNKJcdjEvQCXp98"
    "YeYFCh3la2hWs2Y0w1k4N0gokaPpMTokSoIJRUDjmJdPZmPwH+B7ByRVqRQgEIB2qNfDXXXRMAxZBOpnZ2fHp0BCSQ1QfTy7nQ76"
    "IWHyKaTZBJ0dESAZjiHoMwphemkWgY6iVISI1CGZWHQXClTSL0LkjDCejAinVofPqewwhHHuciv5a7b9N/Y+QjykE8Zn6OiQ2pBD"
    "owJn++gVST6LE5WgF/x2N6jE68CPP4LndYJkzhl+6uLjmHFFpf8sjjklIvdT7p0FTFFm3/hVPwkSYTbUG+y7uacLCR2lEoE5Jlzn"
    "S/Rw17VpqaUuYUTUaJofbsP/y63l1hZ9Y/JaSMck5QpKsLyKh4zTE5PPjp/7Cwyf5zxOMB1byFgflKAZs4kFYqJztn2M0GVkQhP7"
    "dh6zUT4wRwzap1RUz5Lm8d3NoyNRL6SM89GEivB5HEVEhKUiqf5RCU1UPC9flxqYVf72jYutyd8aQ6xklGpFmNfv8kV6B77nraw5"
    "1RoxdqplxZfaSnMeOoeXqxOd2YuFp/lL65raksrG0+Jtg4lzG9hmfh7km1WMcm/qBblnN4jH4ZRwTBtm/qvibXVFuUQbREMcz2Hu"
    "W5gcGlQ7om1exnkGOjAYDMCz37xqUkQVwSlVGfnWzP5OB1f1MdBVxTEB85p2BS4kSSZG4EtycWayHtZeN+GZ1KhtbebIYoGTyuzc"
    "Tr4eaufj598As3qq0zUMUX1ZyaktcqZ222Qe0tsrxk1+H5ZlICQzBjb04Gg0wjCyZfj2Wpghs9Km/yDP/wC5iUWU27fl1oqFXpGX"
    "K5z4Sqa0ltqxuqPPLgizx+jne15ZWIEqd048u9sxRb3W2Ty8vV7ZfOUvcvPL7fUMsAgewpEgUww39AEkN291iYAw5lH67grpDsH1"
    "ukjUxOQefB4LJWP+208/07J2Dklyez03rxu9qf23dAA1xSDh1DI1DZe8hpZocuK75psciHb601ahNqRO02GETkfJjlTj2TIAi1Jc"
    "O+hCQTlrjZbTKo22KclzQqsKJwP7jXklLorxHGSufhVPJpyatFnFY911VSquUKrNMtnXwVWR6f3NmK+laBfjFd1pwXtVVyrxBbRL"
    "ENeNLT8juk9pgugyCFe314gy5NsyXQd1DOa5jCdS00dRwF2z99srS2dohLwl5i40K3Dmxd2ntZhrM4weBppH2OT6ZayOOI8vaGhm"
    "eY75h+C9YjMZazbELjE4zqlkXJNyY3pFlIjkJha1jWW4aiItIMoFEJSAr1oCWu8o6TtKzJZz7+B37FV8tDVnDjq5004zJGHMBOE8"
    "W9lzedRu5FURjFwQeaCO/gluQ2DcizRBPjkjGVO4GyScCbuEXrmfTond0ZSYmCwYjTbs2+9KHudHBsfRYaCyee5kbL08eO89iAIT"
    "80HCNaK2H9sKqQFVsIJOnZ0Vh7ZftMKa4PEhGc0Gi32n6VVoNB14L7HG4L7z/sc7eInHjH2J9WvRE+07rfHB8qA8i/2qLY3FCU2Q"
    "AQ4WtRy31LyPiBHlg4WN1tUUt4ReIXK/V1htv9gsoHdc213LPkxzW3VCXsE3B4v8oTR7P2TnMEJ6mHyJex14aJA+9WQbCbHn7A2n"
    "OaBLVIZqFgsIGRJxkiHYxpy+wYYNO9+J+FzRCBsFb0QFnih+nZB5Hx53AUGqTrFr68PuR/bta8omUyTjezs7sFyWKg4cZfsJtjTO"
    "e6W+9hHggoVq2ocn3cb3aa5jZWAYS2yyT0jIUm3uo52/eCtTECoTGWP+6BvaFJjecFXQm9MpCeOLPvywAzvweP4G/ryo5i9/qK9w"
    "dgrVeZebPVjkdO/Q6jS9LdSbW+q0+Mv9nlnmyCkkYND4NdVGQXWAEZETJr6gY/SPh111jKcVz8mIKTzUnWCvfkoPzSkdNHa/sFzU"
    "UNFlv3jTndCyrnrFyk41Yb+HEKsDrhWXUyaU58p4hpxwRi/Ljt6Sj6eQxAJDd5gWbA9hIHUkYyG5vcJke3t9ibRm6Fw/YHsaIvNB"
    "DikwsTkqhgXJkgG8OMexHibYd1c6Z9su2QxHGHM2adeI0zktMj2+OE1zUZ4igpklWOcH5xwto3/gMHr9tezsmke92YMVApzT/rgW"
    "obsrR32U6SqldHFZlHqXppg9goQIllFs74fmQFxXlkwR/+GTTqOuofUdO5hwNl+0OyE9x9R/FuurhLU+cb5Wt1zeioOGqVJYNVuz"
    "HzmnXjNKzmKdxdArJp0yXUNsFi+bbb/T8Ng3JUU2EKnt2qpv2XjukP8xQ1txjoa1+3LmNDZSz6jtnU5jVDTooP2rJTgsEmTIaThY"
    "5G31mjxvbpeFMXhkCi+eAEJxsNjd01Vx4YG3bElxSLNeuld5uoB79WxZNXpm0M06xSncM/OsxYS7k28I6NRSEtfqFo5yDP2MzHX6"
    "wAHTgPk3v0pBZ31HwFSpedLv9XaffBjs7j0OdoOHj/r6Aq+nU/S2uYk+nNFs8E/z1+mvTaNMzFN1ByiiOKR8m4UuMDT3Gniabblf"
    "sdaP6BQpNZUD795G6ntkR8g54Sl6sGyulnU8ImOa4LDm4ZYgldcjPg3w+CZUBUZEx13Ydix7Lgx7/2+orDv4tmhabUI3xoNmwCst"
    "aXuQPGskkhYAL8rrrnuXhAsihVfPXJWUehFfPKiS8traUyprqzJ1HrjbbR7ZQXuZaSBb/9UQcEcZ0W5GK+/gFdV1SsX2tdj21OzU"
    "p/zereaHe2buNkDeD5IO4pwLgfp5VWCrXbvWJ60h1HMShub3IW9XM9rdD+dvVgiyc5QfbyLPRrvO1cWPKpihcYBi/0nDDey4gcra"
    "JhrqDlda4fJnrMbM3JzGV7ClRKRIq0mGaXvIFJPNtabltrPAr5geJ5irsC+FCabzm7eamXe8Oj6bBf931Zq9FVa2aNsL7gQ7TXSA"
    "Y0/BOTVfm5kNpKJbNui//fQzUtdMg18ZelzRViRuaUZGZJZY3tziT+/TSs2MzA2nddgPNitEVQQ5vHl7izMzau8OReBtiORih2Wm"
    "uSONObOX9eg1sh5YJKKcB3Wxqzfmd+S433F6D1vap/Z01+icGh6pZb6FvlEJOBUTNYUDbD/bLW2zZ3en2ZTrjX+Wt3u7waPWdk+r"
    "i8jc96MuMFOmm8k/V6mr/4It7+0KszBRMhaTg0UUJHNKZvpXfn0maUKlp3GNthp6VwDXW/axs7SLYGGviJar9qyWD3Rj5/5+ro11"
    "ln94DdhcmCylzMgl8tdZ8X8Ebn7V/0mAif6K3Su87/7Mbx33a7C/m/9I0cf2enLzVsxu3sKUDKnkaA3c/HpJFW8Uqpz05Vfdda+3"
    "kb7i7nsD5dMLX9Lsk/hClCtpYH5H13h5Ye6e9GmsXNb7nfbyt5Y8Ni9p/oDOccWoRjB8ag93YwG5G5IOEDeR3pBJzhK1jfV+qMTv"
    "Zb1tPaT9Tdpv9I75LaS/rmesMd4UalW2vPjKsKUjPMQuqoUNlz6xn50b2y1zkbrc+i9QSwMEFAAAAAgAJaBKXQi5Ggi5AwAAEQcA"
    "AA0AAABtYW5pZmVzdC5qc29urVRLbtxGEN3rFI3ZaBGNpv8feWXIAQIETowou8gYVHdXS/RwyAmblDMxDOQQuUNu4FV2uklOkiLl"
    "bMZIAAdesEk0u17Ve6+q352xVYTaNrvVFVv9iC2Wvrtizav7vkNWsbLHPx4/7PbI8uOfv2I77rE27Cu2gwN0e2AdZuwahrsBugyr"
    "C4JL/X7fjDNc8/3NDHHFUr8gTE8ALQ7NxbyHQ0X2FiM79u3UAR2oODz7L+wHGCocmxa67T39LXOW66vb29T2U8ZtGRBvb19M3RG2"
    "bfOA25+H7b6PTYtLdFNhwHGb+3qE2syxb2B4aOrm6bWu45Sbfn03NZsDpB3c4eWb2ndL7Ih13O5aqP0wfV5WSlVHKnjXd+PQtxRc"
    "oK04//q4RYLQ7k+v5y3KN8BuKe5bOGbMTccekN09fugy6Ube3DUjg5zZ+vmz5ftJb7bes9t/FD8RvDa3q6ezh6nes35o7gj1m6+f"
    "v7jKc9Uj7jb3U14f0jpPw7Rn7K/ffmdLJey6z7iHuyadj8jOb0YYRjLmLYtT0+bzy4XhImgLC4kzxt7Rw1bHheq/K1yHtB5hGprN"
    "sq4P7URVrQ9z422avm5u+mlISG+sL/uRZL+sb5syzhkJHuuTSFo58DwZ9MYn4aJWimeugJscs7IKkik+lMh1Qi+cLCCj9zoL56Tl"
    "1n6EO1KnzXDSIEefeIkxlmJMQW+1czkVL2xOoAEDOgE5Sc6zS9G5iFxDTBGFT2lFaO8vPkeETRyg6TYD7vsRN7XZH1p8lajxTohK"
    "m7lVaEq0MjrhwRfBbbESkKdghAUBwkck6ikKRx3CizMlBREDFRZPiKLMxkiBFp1Sxnqji7DRWw8aS/G2IDeR4EoMOkKwmmQRmiKk"
    "V04V+aWIfgcjjczlPF6X4ylnLIq75LRIpK1HlzVGLmnN1iIWnRSXOlphFVlT6GASgGQR50ELm/QJZxOMJKGSF0ER2YzWyJQtuYrR"
    "S4ySPEdRgpLck8oqBlTeIAUFZY3/QpxvqJfxU39TRqPJC6lKEE4QP3BcebrkIJCrnCMHHXzWWkgpg4/BBSotpuCSdwlPuBKOnyWS"
    "oKk9VfQpWCWk9iaqKLPURiU0NAyzt1n5QO2kjS8lGRWFCf+DK11EBxrebqybl8v198NC+9U1kf3lhC23EYrzVKUhc6WWyJUKNI8a"
    "jaLWsxB5om4nr6VDkfmihdTCZ5pbgE/YCk3zTsJkFzgRtykrV0AX1A4MVzb7ADqlHMhzERPNNVfJWYc20wgsbM/Y67P3fwNQSwEC"
    "FAMUAAAACAAloEpdJ07liEoWAACqQAAAWgAAAAAAAAAAAAAAgAEAAAAAZG9zeWFsYXIvamFydmlzL2phcnZpcy1zdHVkaW8tZ3Vp"
    "L3NyYy10YXVyaS90YXVyaS1wbHVnaW4tcGhvbmUvaW9zL1NvdXJjZXMvU2VzTW90b3J1LnN3aWZ0UEsBAhQDFAAAAAgAJaBKXU63"
    "foGqHAAA2VQAAD4AAAAAAAAAAAAAAIABwhYAAGRvc3lhbGFyL2phcnZpcy9qYXJ2aXMtc3R1ZGlvLWd1aS9zcmMvYnJhaW4vcmVt"
    "b3RlL3NpbXBsZVBjLmpzUEsBAhQDFAAAAAgAJaBKXS+WrC4FBwAAfhcAAEkAAAAAAAAAAAAAAIAByDMAAGRvc3lhbGFyL2phcnZp"
    "cy9qYXJ2aXMtc3R1ZGlvLWd1aS9zcmMvYnJhaW4vcmVtb3RlL3NpbXBsZVBjTmF0aXZlLnRlc3QudHNQSwECFAMUAAAACAAloEpd"
    "7AKSwUUNAADSIwAAQQAAAAAAAAAAAAAAgAE0OwAAZG9zeWFsYXIvamFydmlzL2phcnZpcy1zdHVkaW8tZ3VpL3NyYy9icmFpbi9y"
    "ZW1vdGUvc2ltcGxlU3RvcmUuanNQSwECFAMUAAAACAAloEpdF03KHYUMAAAsJQAAQwAAAAAAAAAAAAAAgAHYSAAAZG9zeWFsYXIv"
    "amFydmlzL2phcnZpcy1zdHVkaW8tZ3VpL3NyYy9jb21wb25lbnRzL01vYmlsZVJlbW90ZVBDLmpzeFBLAQIUAxQAAAAIACWgSl0I"
    "uRoIuQMAABEHAAANAAAAAAAAAAAAAACAAb5VAABtYW5pZmVzdC5qc29uUEsFBgAAAAAGAAYAhgIAAKJZAAAAAA=="
)


if __name__ == "__main__":
    sys.exit(main())
