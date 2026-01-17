"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();

  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navBtn =
    "px-3 py-2 rounded-xl text-sm font-extrabold transition border cursor-pointer";
  const navIdle =
    "border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:border-white/20";
  const navActive = "border-white/30 bg-white/10 text-white";

  async function handleLogout() {
    try {
      setLoggingOut(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // opcional: limpiar caches
      localStorage.removeItem("trades_cache_v1");
      localStorage.removeItem("trades_lastFetchedAt_v1");

      setMobileOpen(false);
      router.push("/login");
      router.refresh();
    } catch (e) {
      console.error("Logout failed:", e);
      alert("No se pudo cerrar sesión.");
    } finally {
      setLoggingOut(false);
    }
  }

  // cerrar menú mobile al navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // cerrar con ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-50 backdrop-blur bg-black/70 border-b border-white/10">
      <div className="mx-auto max-w-6xl px-4 py-3">
        {/* TOP ROW */}
        <div className="flex items-center justify-between gap-3">
          {/* LEFT */}
          <div className="flex items-center gap-3 min-w-0">
            <Image
              src="/logo.png"
              alt="PM Scalps Coach"
              width={34}
              height={34}
              priority
              className="rounded-md"
            />
            <div className="min-w-0">
              <div className="text-sm font-black tracking-[0.18em] text-white/70 truncate">
                PM Scalps Coach
              </div>
              <div className="text-[11px] font-extrabold text-white/40 md:hidden truncate">
                {pathname.startsWith("/journal/history")
                  ? "History"
                  : pathname.startsWith("/journal")
                  ? "Trading Day"
                  : "—"}
              </div>
            </div>
          </div>

          {/* DESKTOP NAV */}
          <div className="hidden md:flex items-center gap-2">
            <Link
              href="/journal"
              className={`${navBtn} ${pathname === "/journal" ? navActive : navIdle}`}
            >
              Trading Day
            </Link>

            <Link
              href="/journal/history"
              className={`${navBtn} ${
                pathname.startsWith("/journal/history") ? navActive : navIdle
              }`}
            >
              History
            </Link>

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="h-10 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-sm font-extrabold text-white/80 hover:bg-white/10 hover:border-white/20 transition disabled:opacity-50 cursor-pointer"
            >
              {loggingOut ? "Saliendo..." : "Cerrar sesión"}
            </button>
          </div>

          {/* MOBILE MENU BUTTON */}
          <div className="md:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="h-10 rounded-xl border border-white/12 bg-white/5 px-3 text-sm font-extrabold text-white/80 hover:bg-white/10 hover:border-white/20 transition cursor-pointer"
              aria-expanded={mobileOpen}
              aria-label="Abrir menú"
            >
              {mobileOpen ? "Cerrar" : "Menú"}
            </button>
          </div>
        </div>

        {/* MOBILE DRAWER */}
        {mobileOpen && (
          <div className="md:hidden mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="grid gap-2">
              <Link
                href="/journal"
                className={`${navBtn} ${pathname === "/journal" ? navActive : navIdle} w-full`}
              >
                Trading Day
              </Link>

              <Link
                href="/journal/history"
                className={`${navBtn} ${
                  pathname.startsWith("/journal/history") ? navActive : navIdle
                } w-full`}
              >
                History
              </Link>

              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="h-11 rounded-xl border border-white/12 bg-white/5 px-3 text-sm font-extrabold text-white/80 hover:bg-white/10 hover:border-white/20 transition disabled:opacity-50 cursor-pointer w-full"
              >
                {loggingOut ? "Saliendo..." : "Cerrar sesión"}
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}