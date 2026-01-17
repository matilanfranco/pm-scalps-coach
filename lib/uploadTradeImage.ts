import { getSupabaseClient } from "@/lib/supabaseClient";

type UploadArgs = {
  userId: string;
  tradeId: string;
  file: File;
};

type UploadResult = {
  imgUrl: string;   // publicUrl o signedUrl
  imgPath: string;
};

const BUCKET = "trade-charts";

function sb() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Supabase client no inicializado. Revisá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return supabase;
}

function safeFileExt(file: File) {
  const name = file.name || "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return ext;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

export async function uploadTradeImage(args: UploadArgs): Promise<UploadResult> {
  const { userId, tradeId, file } = args;

  const ext = safeFileExt(file);
  const imgPath = `${userId}/${tradeId}.${ext}`;

  // debug auth
  const { data: sessData, error: sessErr } = await sb().auth.getSession();
  if (sessErr) console.warn("getSession error:", sessErr);

  console.log("[storage] session:", {
    hasSession: !!sessData.session,
    role: sessData.session?.user?.role,
    uid: sessData.session?.user?.id,
    expectedUid: userId,
    bucket: BUCKET,
    path: imgPath,
  });

  // 1) Upload (reemplaza si ya existía)
  const { error: upErr } = await sb().storage.from(BUCKET).upload(imgPath, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || `image/${ext}`,
  });

  if (upErr) throw upErr;

  // 2) URL
  // Si tu bucket es PUBLIC, esto alcanza:
  const { data: publicData } = sb().storage.from(BUCKET).getPublicUrl(imgPath);
  if (publicData?.publicUrl) {
    return { imgUrl: publicData.publicUrl, imgPath };
  }

  // Si NO es public (o querés que sea privado), firmá URL:
  const { data: signed, error: signErr } = await sb()
    .storage
    .from(BUCKET)
    .createSignedUrl(imgPath, 60 * 60); // 1 hora

  if (signErr) throw signErr;
  if (!signed?.signedUrl) throw new Error("No se pudo obtener signedUrl del storage.");

  return { imgUrl: signed.signedUrl, imgPath };
}