"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [{ href: "/admin/dashboard", label: "Catálogo de procedimientos" }];

export default function AdminPanelNav() {
  const pathname = usePathname();
  return (
    <section className="card dashboard-section admin-panel-nav">
      <div className="admin-panel-nav__list" role="tablist" aria-label="Navegación administrativa">
        {LINKS.map((link) => {
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`admin-panel-nav__link ${isActive ? "admin-panel-nav__link--active" : ""}`}
              role="tab"
              aria-selected={isActive}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
