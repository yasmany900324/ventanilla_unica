import { POST as postClaimExpediente } from "../claim-expediente/route";

/**
 * Endpoint legado.
 * Mantiene compatibilidad con clientes previos y delega al claim local explícito.
 */
export async function POST(request, context) {
  const response = await postClaimExpediente(request, context);
  response.headers.set("X-Endpoint-Deprecated", "true");
  response.headers.set(
    "X-Endpoint-Replacement",
    "/api/funcionario/procedures/requests/:id/claim-expediente"
  );
  return response;
}
