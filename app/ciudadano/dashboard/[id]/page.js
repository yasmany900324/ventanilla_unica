import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CitizenProcedureDetailPage from "../../../../components/CitizenProcedureDetailPage";
import { getAuthenticatedUserFromToken, SESSION_COOKIE_NAME } from "../../../../lib/auth";

export default async function CitizenProcedureDetailRoutePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const authenticatedUser = await getAuthenticatedUserFromToken(token);

  if (!authenticatedUser) {
    redirect("/login");
  }

  return <CitizenProcedureDetailPage />;
}
