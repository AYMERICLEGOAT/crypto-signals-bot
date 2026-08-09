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

describe("secret absent de l'environnement", () => {
  // La CI a revele ce cas : TELEGRAM_WEBHOOK_SECRET est optionnel dans Env, et
  // `undefined.length` levait un TypeError qui remontait jusqu'au handler
  // fetch. « Refuser la requete » devenait une erreur 500, le bot muet, et le
  // symptome ressemblait a une panne d'infrastructure.
  it("ne leve jamais, quelle que soit la valeur manquante", () => {
    expect(() => timingSafeEqual(undefined, "secret")).not.toThrow();
    expect(() => timingSafeEqual("secret", undefined)).not.toThrow();
    expect(() => timingSafeEqual(undefined, undefined)).not.toThrow();
  });

  it("refuse tout ce qui n'est pas deux chaines", () => {
    expect(timingSafeEqual(undefined, "secret")).toBe(false);
    expect(timingSafeEqual("secret", undefined)).toBe(false);
  });

  it("deux secrets absents ne s'authentifient PAS mutuellement", () => {
    // Le piege : undefined === undefined est vrai. Ici il ne doit pas l'etre,
    // sinon un deploiement sans secret accepterait un appelant sans secret.
    expect(timingSafeEqual(undefined, undefined)).toBe(false);
  });
});
