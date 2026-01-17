"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
      // 1) Ver sesión y user
      const { data: sess } = await supabase.auth.getSession();
      const session = sess.session;

      if (!session?.user) {
        setLog("NO SESSION. Tenés que estar logueado para este test.");
        return;
      }

      const uid = session.user.id;

      // 2) Crear blob imagen
      const blob = base64ToBlob(ONE_BY_ONE_PNG_BASE64, "image/png");

      // 3) Path hardcodeado (clave: empieza con uid/)
      const path = `${session.user.id}/hardcoded-test.png`;
      console.log(path)

      // 4) Upload
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, {
          upsert: true,
          contentType: "image/png",
          cacheControl: "3600",
        });

      if (error) {
        setLog(`UPLOAD ERROR: ${error.message}`);
        console.error("UPLOAD ERROR FULL", error);
        return;
      }

      // 5) Public url (si el bucket es public)
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

      setLog(
        `OK ✅\npath: ${path}\nreturned: ${JSON.stringify(data)}\npublicUrl: ${pub.publicUrl}`
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
        className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 font-bold"
      >
        Run hardcoded upload test
      </button>

      <pre className="mt-4 whitespace-pre-wrap text-xs opacity-80">{log}</pre>
    </div>
  );
}