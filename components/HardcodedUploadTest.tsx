"use client";

import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";

const BUCKET = "trade-charts";

// PNG 1x1 transparente
const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Z8oUAAAAASUVORK5CYII=";

function base64ToBlob(base64: string, mime = "image/png") {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

export default function HardcodedUploadTest() {
  const [log, setLog] = useState<string>("");

  async function run() {
    setLog("running...");

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setLog("Supabase client no está inicializado. Revisá env vars (NEXT_PUBLIC_SUPABASE_URL / KEY).");
        return;
      }

      // 1) Ver sesión y user
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) {
        setLog(`SESSION ERROR: ${sessErr.message}`);
        return;
      }

      const session = sess.session;
      if (!session?.user?.id) {
        setLog("NO SESSION. Tenés que estar logueado para este test.");
        return;
      }

      const uid = session.user.id;

      // 2) Crear blob imagen
      const blob = base64ToBlob(ONE_BY_ONE_PNG_BASE64, "image/png");

      // 3) Path hardcodeado (clave: empieza con uid/)
      const path = `${uid}/hardcoded-test.png`;
      console.log("UPLOAD PATH:", path);

      // 4) Upload
      const { data, error } = await supabase.storage.from(BUCKET).upload(path, blob, {
        upsert: true,
        contentType: "image/png",
        cacheControl: "3600",
      });

      if (error) {
        setLog(`UPLOAD ERROR: ${error.message}`);
        console.error("UPLOAD ERROR FULL", error);
        return;
      }

      // 5) URL: public si se puede, sino signed (bucket privado)
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = pub?.publicUrl ?? "";

      if (publicUrl) {
        setLog(
          `OK ✅\npath: ${path}\nreturned: ${JSON.stringify(data)}\npublicUrl: ${publicUrl}`
        );
        return;
      }

      // fallback: signed url (bucket privado)
      const { data: signed, error: signedErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60); // 1h

      if (signedErr) {
        setLog(
          `OK ✅ (pero no pude generar URL)\npath: ${path}\nreturned: ${JSON.stringify(
            data
          )}\nSIGNED URL ERROR: ${signedErr.message}`
        );
        return;
      }

      setLog(
        `OK ✅ (bucket privado)\npath: ${path}\nreturned: ${JSON.stringify(data)}\nsignedUrl: ${
          signed?.signedUrl
        }`
      );
    } catch (e: any) {
      setLog(`CRASH: ${e?.message ?? String(e)}`);
      console.error(e);
    }
  }

  return (
    <div className="p-6 text-white">
      <button
        onClick={run}
        className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 font-bold cursor-pointer"
      >
        Run hardcoded upload test
      </button>

      <pre className="mt-4 whitespace-pre-wrap text-xs opacity-80">{log}</pre>
    </div>
  );
}