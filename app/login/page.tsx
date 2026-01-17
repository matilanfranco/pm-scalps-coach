"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";

function cn(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const emailTrim = useMemo(() => email.trim(), [email]);
  const canSubmit = emailTrim.length > 3 && password.length >= 6 && !loading;

  // helper: siempre te da supabase o te corta con mensaje
  function requireSupabase() {
    const sb = getSupabaseClient();
    if (!sb) {
      setErr("Supabase no está configurado (faltan env vars). Reiniciá el dev server.");
      return null;
    }
    return sb;
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(null);
    setLoading(true);

    try {
      const supabase = requireSupabase();
      if (!supabase) return;

      const { error } = await supabase.auth.signInWithPassword({
        email: emailTrim,
        password,
      });
      if (error) throw error;

      router.push("/");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  async function signUp() {
    setErr(null);
    setOk(null);
    setLoading(true);

    try {
      const supabase = requireSupabase();
      if (!supabase) return;

      const { error } = await supabase.auth.signUp({
        email: emailTrim,
        password,
      });
      if (error) throw error;

      setOk("Cuenta creada. Si te pide confirmar email, revisá tu inbox.");
      router.push("/");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Error al crear cuenta");
    } finally {
      setLoading(false);
    }
  }

  const input =
    "h-11 rounded-xl border border-white/12 bg-white/[0.05] px-3 text-sm font-extrabold text-white outline-none placeholder:text-white/35 focus:border-white/25 focus:bg-white/[0.08] transition";
  const btnPrimary =
    "h-11 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-extrabold hover:bg-white/15 active:scale-[0.99] transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed";
  const btnGhost =
    "h-11 rounded-xl border border-white/12 bg-white/[0.04] px-4 text-sm font-extrabold hover:bg-white/[0.08] active:scale-[0.99] transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed";

  return (
    <div className="min-h-screen bg-neutral-950 text-white relative overflow-hidden flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center flex flex-col items-center gap-3">
          <Image
            src="/logo.png"
            alt="PM Scalps"
            width={72}
            height={72}
            priority
            className="rounded-2xl"
          />
          <div className="text-xs font-black tracking-[0.22em] text-white/55">PM SCALPS</div>
          <div className="text-2xl font-black">{mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</div>
          <div className="text-sm text-white/60">Email + password</div>
        </div>

        <form
          onSubmit={signIn}
          className="rounded-3xl border border-white/12 bg-white/4 backdrop-blur-xl p-5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]"
        >
          <div className="mb-4 flex rounded-2xl border border-white/10 bg-white/4 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setErr(null);
                setOk(null);
              }}
              className={cn(
                "w-1/2 rounded-xl py-2 text-sm font-black transition cursor-pointer",
                mode === "login" ? "bg-white/10 border border-white/10" : "text-white/70 hover:text-white"
              )}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setErr(null);
                setOk(null);
              }}
              className={cn(
                "w-1/2 rounded-xl py-2 text-sm font-black transition cursor-pointer",
                mode === "signup" ? "bg-white/10 border border-white/10" : "text-white/70 hover:text-white"
              )}
            >
              Sign up
            </button>
          </div>

          <div className="grid gap-3">
            <input
              className={input}
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
            />

            <input
              className={cn(input)}
              placeholder="password (mín 6)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />

            {err && (
              <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                {err}
              </div>
            )}
            {ok && (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                {ok}
              </div>
            )}

            {mode === "login" ? (
              <button type="submit" disabled={!canSubmit} className={btnPrimary}>
                {loading ? "Entrando..." : "Entrar"}
              </button>
            ) : (
              <button type="button" disabled={!canSubmit} onClick={signUp} className={btnPrimary}>
                {loading ? "Creando..." : "Crear cuenta"}
              </button>
            )}

            <div className="pt-1 text-center text-xs text-white/45">Tip: contraseña mínimo 6 caracteres.</div>

            <button
              type="button"
              disabled={loading}
              onClick={() => {
                setEmail("");
                setPassword("");
                setErr(null);
                setOk(null);
              }}
              className={btnGhost}
            >
              Limpiar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}