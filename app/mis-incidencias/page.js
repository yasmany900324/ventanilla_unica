import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import MyIncidentsPageContent from "../../components/MyIncidentsPageContent";
import {
  getAuthenticatedUserFromToken,
  SESSION_COOKIE_NAME,
} from "../../lib/auth";

export default async function MyIncidentsPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const authenticatedUser = await getAuthenticatedUserFromToken(token);

  if (!authenticatedUser) {
    redirect("/login");
  }

  return (
    <main className="page page--dashboard">
      <section className="card dashboard-header dashboard-header--stacked">
        <div>
          <p className="eyebrow">Espacio privado ciudadano</p>
          <h1>Mis incidencias</h1>
          <p className="description">
            Consulta el historial completo de tus incidencias registradas.
          </p>
        </div>
      </section>
      <MyIncidentsPageContent />
    </main>
  );
}
