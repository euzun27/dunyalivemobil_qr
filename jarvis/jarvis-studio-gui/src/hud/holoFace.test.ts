import { describe, it, expect } from "vitest";
import meshJson from "./faceMesh.json";
import { HoloFace, KonusmaZarfi, blend, rate, rgba, type FaceMesh } from "./holoFace";

const mesh = meshJson as unknown as FaceMesh;

function seeded(seed = 7): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const LISTEN = { amp: 0, speaking: false, muted: false, state: "LISTENING" };

function run(face: HoloFace, seconds: number, inp: Parameters<HoloFace["step"]>[1], fps = 30) {
  for (let i = 0; i < seconds * fps; i++) face.step(1 / fps, inp);
}

/** Cizim cagrilarini kaydeden sahte tuval. */
function fakeCtx() {
  const calls: Record<string, number> = {};
  const coords: number[] = [];
  const rec = (name: string) => (...args: unknown[]) => {
    calls[name] = (calls[name] ?? 0) + 1;
    for (const a of args) if (typeof a === "number") coords.push(a);
    return name === "createRadialGradient" ? { addColorStop: () => {} } : undefined;
  };
  const ctx = new Proxy(
    {},
    {
      get: (_t, p: string) => rec(p),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, coords };
}

describe("faceMesh.json", () => {
  it("eksiksiz ve tum indeksler gecerli", () => {
    expect(mesh.verts.length).toBe(mesh.nVerts * 3);
    expect(mesh.normals.length).toBe(mesh.nVerts * 3);
    expect(mesh.faces.length).toBe(mesh.nFaces * 3);
    for (const arr of [mesh.jaw, mesh.brow, mesh.lips, mesh.fade]) expect(arr.length).toBe(mesh.nVerts);
    expect(mesh.faceGroup.length).toBe(mesh.nFaces);
    const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < mesh.nVerts;
    expect(mesh.faces.every(ok)).toBe(true);
    expect(mesh.edges.every(ok)).toBe(true);
    for (const k of ["eye_l", "eye_r", "brow_l", "brow_r", "lips_out", "lips_in"]) {
      expect(mesh.landmarks[k].length).toBeGreaterThan(4);
      expect(mesh.landmarks[k].every(ok)).toBe(true);
    }
  });
});

describe("yardimcilar", () => {
  it("rate kare hizindan bagimsizdir", () => {
    const tek = rate(0.1, 0.05);
    const iki = 1 - (1 - rate(0.05, 0.05)) ** 2;
    expect(Math.abs(tek - iki)).toBeLessThan(1e-12);
  });

  it("blend ve rgba", () => {
    expect(blend([0, 0, 0], [255, 100, 50], 255)).toBe("rgb(255,100,50)");
    expect(blend([10, 10, 10], [255, 255, 255], 0)).toBe("rgb(10,10,10)");
    expect(rgba([1, 2, 3], 510)).toBe("rgba(1,2,3,1.000)");
  });
});

describe("HoloFace animasyonu", () => {
  it("konusurken agiz acilir, susunca kapanir; sessizde hic acilmaz", () => {
    const f = new HoloFace(mesh, seeded());
    run(f, 0.5, { amp: 0.9, speaking: true, muted: false, state: "" });
    expect(f.mouth).toBeGreaterThan(0.5);
    run(f, 1.0, LISTEN);
    expect(f.mouth).toBe(0);
    const m = new HoloFace(mesh, seeded());
    run(m, 1.0, { amp: 0.9, speaking: true, muted: true, state: "" });
    expect(m.mouth).toBe(0);
  });

  it("agiz acilinca cene asagi iner", () => {
    const f = new HoloFace(mesh, seeded());
    const CENE = 152; // MediaPipe: cene ucu
    const once = f.posedVertex(CENE)[1];
    run(f, 0.5, { amp: 1, speaking: true, muted: false, state: "" });
    // ayni bas pozunda karsilastirmak icin: cene agirligi olmayan bir noktaya gore goreli
    const alin = 10;
    const sonra = f.posedVertex(CENE)[1] - f.posedVertex(alin)[1];
    const f0 = new HoloFace(mesh, seeded());
    const ref = f0.posedVertex(CENE)[1] - f0.posedVertex(alin)[1];
    expect(sonra).toBeLessThan(ref - 0.02);
    expect(Number.isFinite(once)).toBe(true);
  });

  it("dusunurken bakis yana kayar, dinlerken merkeze doner", () => {
    const f = new HoloFace(mesh, seeded(3));
    const bias = (f as unknown as { gazeBias: number[] }).gazeBias;
    // yon 1.4-3 sn'de bir yeniden secilir (sag<->sol gecisi sifirdan gecer): en buyuk sapmaya bak
    let enBuyuk = 0;
    for (let i = 0; i < 30 * 4; i++) {
      f.step(1 / 30, { amp: 0, speaking: false, muted: false, state: "THINKING" });
      enBuyuk = Math.max(enBuyuk, Math.abs(bias[0]));
    }
    expect(enBuyuk).toBeGreaterThan(0.3);
    run(f, 4, LISTEN);
    expect(Math.abs(bias[0])).toBeLessThan(0.05);
  });

  it("goz kirpar ve tekrar acilir", () => {
    const f = new HoloFace(mesh, seeded());
    let kirpti = false;
    for (let i = 0; i < 30 * 8; i++) {
      f.step(1 / 30, LISTEN);
      if (f.blink > 0.5) kirpti = true;
    }
    expect(kirpti).toBe(true);
    run(f, 0.3, LISTEN);
    expect(f.blink).toBeLessThan(1);
  });

  it("ayni tohumla ayni sonuc (deterministik)", () => {
    const a = new HoloFace(mesh, seeded(11));
    const b = new HoloFace(mesh, seeded(11));
    run(a, 2, { amp: 0.6, speaking: true, muted: false, state: "" });
    run(b, 2, { amp: 0.6, speaking: true, muted: false, state: "" });
    expect(a.posedVertex(1)).toEqual(b.posedVertex(1));
  });
});

describe("HoloFace cizimi", () => {
  it("yuzeyi, tel kafesi ve yuz hatlarini cizer; bozuk koordinat yok", () => {
    const f = new HoloFace(mesh, seeded());
    run(f, 0.5, { amp: 0.8, speaking: true, muted: false, state: "" });
    const { ctx, calls, coords } = fakeCtx();
    f.paint(ctx, 116, 101, 92, { primary: [0, 229, 255], accent: [0, 255, 136], bg: [5, 8, 12] }, 116);
    expect(calls.fill).toBeGreaterThan(500); // yuzey ucgenleri
    expect(calls.ellipse).toBe(4); // iki iris + iki gozbebegi
    expect(calls.stroke).toBeGreaterThan(500);
    expect(coords.every(Number.isFinite)).toBe(true);
  });
});

describe("KonusmaZarfi", () => {
  it("susarken 0, konusurken 0..1 arasi hece ritmi ve duraklar", () => {
    const z = new KonusmaZarfi(seeded(5));
    expect(z.next(0.03, false)).toBe(0);
    const seviyeler = Array.from({ length: 300 }, () => z.next(1 / 30, true));
    expect(seviyeler.every((x) => x >= 0 && x <= 1)).toBe(true);
    expect(Math.max(...seviyeler)).toBeGreaterThan(0.6);
    expect(seviyeler.filter((x) => x < 0.05).length).toBeGreaterThan(10); // hece aralari ve duraklar
    expect(z.next(0.03, false)).toBe(0);
  });
});
