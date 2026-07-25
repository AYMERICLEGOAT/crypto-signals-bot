import { describe, it, expect } from "vitest";
import { timingSafeEqual } from "../src/utils/timingSafeEqual";

describe("timingSafeEqual", () => {
  it("retourne true pour deux chaînes identiques", () => {
    expect(timingSafeEqual("mon-secret-webhook", "mon-secret-webhook")).toBe(true);
  });

  it("retourne false pour des chaînes différentes de même longueur", () => {
    expect(timingSafeEqual("mon-secret-webhook", "mon-secret-webhouk")).toBe(false);
  });

  it("retourne false pour des chaînes de longueurs différentes", () => {
    expect(timingSafeEqual("court", "beaucoup-plus-long")).toBe(false);
    expect(timingSafeEqual("beaucoup-plus-long", "court")).toBe(false);
  });

  it("retourne true pour deux chaînes vides", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
