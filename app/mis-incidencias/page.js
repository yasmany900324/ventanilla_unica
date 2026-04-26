import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  getAuthenticatedUserFromToken,
  SESSION_COOKIE_NAME,
} from "../../lib/auth";
import MyIncidentsClientShell from "../../components/MyIncidentsClientShell";

export default async function MyIncidentsPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const authenticatedUser = await getAuthenticatedUserFromToken(token);

  if (!authenticatedUser) {
    redirect("/login");
  }

  return <MyIncidentsClientShell />;
}
