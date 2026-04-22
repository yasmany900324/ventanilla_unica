import { describe, it, expect, afterEach } from "vitest";
import {
  getIncidentAttachmentStorage,
  ATTACHMENT_PROVIDER_LOCAL_FS,
  ATTACHMENT_PROVIDER_VERCEL_BLOB,
} from "../getIncidentAttachmentStorage";

const originalProvider = process.env.ATTACHMENT_STORAGE_PROVIDER;

afterEach(() => {
  if (originalProvider === undefined) {
    delete process.env.ATTACHMENT_STORAGE_PROVIDER;
  } else {
    process.env.ATTACHMENT_STORAGE_PROVIDER = originalProvider;
  }
});

describe("getIncidentAttachmentStorage", () => {
  it("usa vercel_blob cuando no hay variable de entorno", () => {
    delete process.env.ATTACHMENT_STORAGE_PROVIDER;
    const s = getIncidentAttachmentStorage();
    expect(s.providerId).toBe(ATTACHMENT_PROVIDER_VERCEL_BLOB);
  });

  it("respeta ATTACHMENT_STORAGE_PROVIDER=local_fs", () => {
    process.env.ATTACHMENT_STORAGE_PROVIDER = "local_fs";
    const s = getIncidentAttachmentStorage();
    expect(s.providerId).toBe(ATTACHMENT_PROVIDER_LOCAL_FS);
  });
});
