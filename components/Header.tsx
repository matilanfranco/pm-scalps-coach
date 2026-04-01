"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();

  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const supabase = useMemo(() => (mounted ? getSupabaseClient() : null), [mounted]);

  useEffect(() => setMounted(true), []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleLogout() {
    if (!supabase) return;
    try {
      setLoggingOut(true);
      await supabase.auth.signOut();
      localStorage.removeItem("trades_cache_v1");
      router.push("/login");
      router.refresh();
    } catch (e) {
      console.error("Logout failed:", e);
    } finally {
      setLoggingOut(false);
    }
  }

  const isJournal = pathname === "/journal";
  const isHistory = pathname.startsWith("/journal/history");

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backgroundColor: "rgba(12, 10, 7, 0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(180, 140, 80, 0.1)",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>

          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Ícono simple — reemplazá con tu logo si querés */}
            <div style={{
              width: 28, height: 28,
              borderRadius: 8,
              background: "linear-gradient(135deg, #4a9e6a, #b85555)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 900, color: "white",
            }}>✕</div>
            <span style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.2em",
              color: "rgba(232, 224, 208, 0.5)",
            }}>PM SCALPS</span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex" style={{ alignItems: "center", gap: 8 }}>
            <Link href="/journal" style={{
              height: 34, padding: "0 16px",
              display: "flex", alignItems: "center",
              borderRadius: 999,
              border: `1px solid ${isJournal ? "rgba(200, 146, 58, 0.4)" : "rgba(180, 140, 80, 0.12)"}`,
              background: isJournal ? "rgba(200, 146, 58, 0.12)" : "transparent",
              color: isJournal ? "#c8923a" : "rgba(232, 224, 208, 0.45)",
              fontSize: 13, fontWeight: 700,
              textDecoration: "none",
              transition: "all 0.15s",
            }}>
              Trading Day
            </Link>

            <Link href="/journal/history" style={{
              height: 34, padding: "0 16px",
              display: "flex", alignItems: "center",
              borderRadius: 999,
              border: `1px solid ${isHistory ? "rgba(200, 146, 58, 0.4)" : "rgba(180, 140, 80, 0.12)"}`,
              background: isHistory ? "rgba(200, 146, 58, 0.12)" : "transparent",
              color: isHistory ? "#c8923a" : "rgba(232, 224, 208, 0.45)",
              fontSize: 13, fontWeight: 700,
              textDecoration: "none",
              transition: "all 0.15s",
            }}>
              History
            </Link>

            {/* Logout - ícono power */}
            <button
              onClick={handleLogout}
              disabled={loggingOut || !supabase}
              style={{
                width: 34, height: 34,
                borderRadius: 999,
                border: "1px solid rgba(180, 140, 80, 0.12)",
                background: "transparent",
                color: "rgba(232, 224, 208, 0.35)",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14,
                transition: "all 0.15s",
              }}
              title="Cerrar sesión"
            >
              ⏻
            </button>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden"
            onClick={() => setMobileOpen(v => !v)}
            style={{
              height: 34, padding: "0 14px",
              borderRadius: 999,
              border: "1px solid rgba(180, 140, 80, 0.12)",
              background: "transparent",
              color: "rgba(232, 224, 208, 0.5)",
              cursor: "pointer",
              fontSize: 12, fontWeight: 700,
            }}
          >
            {mobileOpen ? "Cerrar" : "Menú"}
          </button>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div style={{
            padding: "12px 0 16px",
            borderTop: "1px solid rgba(180, 140, 80, 0.1)",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <Link href="/journal" style={{
              height: 40, padding: "0 16px",
              display: "flex", alignItems: "center",
              borderRadius: 10,
              border: `1px solid ${isJournal ? "rgba(200, 146, 58, 0.4)" : "rgba(180, 140, 80, 0.12)"}`,
              background: isJournal ? "rgba(200, 146, 58, 0.1)" : "transparent",
              color: isJournal ? "#c8923a" : "rgba(232, 224, 208, 0.5)",
              fontSize: 13, fontWeight: 700,
              textDecoration: "none",
            }}>Trading Day</Link>

            <Link href="/journal/history" style={{
              height: 40, padding: "0 16px",
              display: "flex", alignItems: "center",
              borderRadius: 10,
              border: `1px solid ${isHistory ? "rgba(200, 146, 58, 0.4)" : "rgba(180, 140, 80, 0.12)"}`,
              background: isHistory ? "rgba(200, 146, 58, 0.1)" : "transparent",
              color: isHistory ? "#c8923a" : "rgba(232, 224, 208, 0.5)",
              fontSize: 13, fontWeight: 700,
              textDecoration: "none",
            }}>History</Link>

            <button onClick={handleLogout} disabled={loggingOut} style={{
              height: 40, padding: "0 16px",
              display: "flex", alignItems: "center",
              borderRadius: 10,
              border: "1px solid rgba(184, 85, 85, 0.2)",
              background: "rgba(184, 85, 85, 0.08)",
              color: "rgba(224, 136, 136, 0.7)",
              fontSize: 13, fontWeight: 700,
              cursor: "pointer",
            }}>
              {loggingOut ? "Saliendo…" : "Cerrar sesión"}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}