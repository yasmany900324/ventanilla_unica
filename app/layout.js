import "./globals.css";

export const metadata = {
  title: "Ventanilla de incidencias",
  description: "MVP para reporte y seguimiento local de incidencias."
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
