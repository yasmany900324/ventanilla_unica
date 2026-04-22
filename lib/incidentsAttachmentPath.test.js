import { describe, it, expect } from "vitest";
import { resolveIncidentAttachmentAbsolutePath } from "./incidents";

describe("resolveIncidentAttachmentAbsolutePath", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";

  it("resolves when storage key matches incident id and allowed extension", () => {
    const resolved = resolveIncidentAttachmentAbsolutePath(id, `${id}.jpg`);
    expect(resolved).toBeTruthy();
    expect(resolved.endsWith(`${id}.jpg`)).toBe(true);
  });

  it("returns null when basename does not match incident id", () => {
    expect(resolveIncidentAttachmentAbsolutePath(id, "other-id.png")).toBeNull();
  });

  it("returns null for disallowed extension", () => {
    expect(resolveIncidentAttachmentAbsolutePath(id, `${id}.exe`)).toBeNull();
  });
});
