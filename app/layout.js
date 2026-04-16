import "./globals.css";
import PortalShell from "../components/PortalShell";

export const metadata = {
  title: "Ventanilla de incidencias",
  description: "MVP para reporte y seguimiento local de incidencias."
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <PortalShell>{children}</PortalShell>
      </body>
    </html>
  );
}
