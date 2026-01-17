import { supabase } from "@/lib/supabaseClient";

type UploadArgs = {
  userId: string;
  tradeId: string;
  file: File;
};

type UploadResult = {
  imgUrl: string;
  imgPath: string;
};

const BUCKET = "trade-charts";

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

  // 🔍 DEBUG AUTH (una vez, prolijo)
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) console.warn("getSession error:", sessErr);

  console.log("[storage] session:", {
    hasSession: !!sessData.session,
    role: sessData.session?.user?.role,
    uid: sessData.session?.user?.id,
    expectedUid: userId,
    bucket: BUCKET,
    path: imgPath,
  });

  // 1) Upload
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(imgPath, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || `image/${ext}`,
  });

  if (upErr) throw upErr;

  // 2) Public URL
  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(imgPath);

  const imgUrl = publicData.publicUrl;
  if (!imgUrl) throw new Error("No se pudo obtener publicUrl del storage.");

  return { imgUrl, imgPath };
}