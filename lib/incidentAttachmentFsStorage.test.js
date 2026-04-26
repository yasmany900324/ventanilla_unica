import { afterEach, describe, expect, it, vi } from "vitest";
import path from "path";
import {
  getChatbotDraftPhotoDirectory,
  getIncidentAttachmentStorageMode,
  getIncidentAttachmentStorageRootResolved,
} from "./incidentAttachmentFsStorage";

describe("incidentAttachmentFsStorage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses explicit INCIDENT_ATTACHMENT_ROOT when set", () => {
    vi.stubEnv("INCIDENT_ATTACHMENT_ROOT", "/mnt/uploads");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "");
    vi.stubEnv("VERCEL", "");
    expect(getIncidentAttachmentStorageMode()).toBe("explicit");
    expect(getIncidentAttachmentStorageRootResolved()).toBe(path.resolve("/mnt/uploads"));
  });

  it("uses tmp root on serverless when no explicit root", () => {
    vi.stubEnv("INCIDENT_ATTACHMENT_ROOT", "");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "fn");
    expect(getIncidentAttachmentStorageMode()).toBe("tmp");
    const draftDir = getChatbotDraftPhotoDirectory().replace(/\\/g, "/");
    expect(draftDir.toLowerCase()).toMatch(
      /(^|\/)tmp\/ventanilla-unica-attachments\/chatbot-procedure-photos$/i
    );
  });
});
