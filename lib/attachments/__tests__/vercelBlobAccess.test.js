import { describe, it, expect, afterEach } from "vitest";
import { getVercelBlobAccessMode } from "../vercelBlobAccess";

const keys = ["ATTACHMENT_VERCEL_BLOB_ACCESS", "VERCEL_BLOB_ACCESS"];

afterEach(() => {
  for (const k of keys) {
    delete process.env[k];
  }
});

describe("getVercelBlobAccessMode", () => {
  it("default public", () => {
    expect(getVercelBlobAccessMode()).toBe("public");
  });

  it("private when ATTACHMENT_VERCEL_BLOB_ACCESS=private", () => {
    process.env.ATTACHMENT_VERCEL_BLOB_ACCESS = "private";
    expect(getVercelBlobAccessMode()).toBe("private");
  });

  it("VERCEL_BLOB_ACCESS alias", () => {
    process.env.VERCEL_BLOB_ACCESS = "PRIVATE";
    expect(getVercelBlobAccessMode()).toBe("private");
  });
});
