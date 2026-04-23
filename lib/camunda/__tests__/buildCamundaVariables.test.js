import { describe, expect, it } from "vitest";
import {
  buildIncidentCamundaVariables,
  buildTramiteCamundaVariables,
  countProcedureAttachmentsHint,
  pickLocationFromProcedureCollected,
} from "../buildCamundaVariables";

describe("buildIncidentCamundaVariables", () => {
  it("arma variables de negocio esperadas", () => {
    const incident = {
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      description: "Hay un bache",
      location: "Av. Central",
      status: "recibido",
      category: "bache",
      hasAttachment: true,
      createdAt: new Date("2026-01-15T12:00:00.000Z"),
    };
    const vars = buildIncidentCamundaVariables(incident, {
      channel: "web",
      risk: "alto",
      authenticatedUser: { id: "u1", fullName: "Ana Pérez", cedula: "1234567" },
    });
    expect(vars.localCaseId).toBe(incident.id);
    expect(vars.localCaseCode).toBe("INC-AAAAAAAA");
    expect(vars.caseType).toBe("incident");
    expect(vars.channel).toBe("web");
    expect(vars.citizenId).toBe("1234567");
    expect(vars.citizenName).toBe("Ana Pérez");
    expect(vars.risk).toBe("alto");
    expect(vars.attachmentsCount).toBe(1);
    expect(vars.status).toBe("recibido");
  });
});

describe("buildTramiteCamundaVariables", () => {
  it("usa requestCode y summary", () => {
    const proc = {
      id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
      requestCode: "TRA-BBBBCCCC",
      summary: "Solicitud de certificado",
      status: "recibido",
      procedureCode: "cert",
      procedureName: "Certificado",
      procedureCategory: "general",
      createdAt: new Date("2026-02-01T10:00:00.000Z"),
      collectedData: {},
    };
    const vars = buildTramiteCamundaVariables(proc, {
      channel: "whatsapp",
      procedureCollectedData: { domicilio: "Calle 1" },
    });
    expect(vars.caseType).toBe("tramite");
    expect(vars.channel).toBe("whatsapp");
    expect(vars.localCaseCode).toBe("TRA-BBBBCCCC");
    expect(vars.location).toBe("Calle 1");
    expect(vars.risk).toBeNull();
  });
});

describe("pickLocationFromProcedureCollected", () => {
  it("elige la primera clave conocida", () => {
    expect(pickLocationFromProcedureCollected({ foo: "x", domicilio: "Y" })).toBe("Y");
  });
});

describe("countProcedureAttachmentsHint", () => {
  it("cuenta campos que parecen adjuntos", () => {
    expect(countProcedureAttachmentsHint({ archivoDni: "s3://x" })).toBe(1);
  });
});
