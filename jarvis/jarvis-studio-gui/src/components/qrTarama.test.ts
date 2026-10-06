import { describe, it, expect } from "vitest";
import { qrTaramaBoyutu } from "./qrTarama";

describe("qrTaramaBoyutu", () => {
  it("buyuk kareyi kucultur, orani korur", () => {
    expect(qrTaramaBoyutu(1920, 1080)).toEqual({ w: 640, h: 360 });
    expect(qrTaramaBoyutu(720, 1280)).toEqual({ w: 360, h: 640 });
  });
  it("kucuk kareye dokunmaz; bos kare 0", () => {
    expect(qrTaramaBoyutu(480, 320)).toEqual({ w: 480, h: 320 });
    expect(qrTaramaBoyutu(0, 0)).toEqual({ w: 0, h: 0 });
  });
});
