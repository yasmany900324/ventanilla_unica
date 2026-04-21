import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaAppSecretSignature } from "./metaSignature";

describe("verifyMetaAppSecretSignature", () => {
  it("accepts a valid X-Hub-Signature-256", () => {
    const secret = "test_app_secret";
    const rawBody = '{"hello":"world"}';
    const sig =
      "sha256=" +
      createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    expect(verifyMetaAppSecretSignature(rawBody, sig, secret)).toBe(true);
  });

  it("rejects tampered body", () => {
    const secret = "test_app_secret";
    const rawBody = '{"hello":"world"}';
    const sig =
      "sha256=" +
      createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    expect(verifyMetaAppSecretSignature(rawBody + " ", sig, secret)).toBe(false);
  });

  it("rejects missing header", () => {
    expect(verifyMetaAppSecretSignature("{}", null, "s")).toBe(false);
  });
});
