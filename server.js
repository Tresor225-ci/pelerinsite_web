import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const {
  PORT = "8080",
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET = "resources",
  ADMIN_CODE,
  ADMIN_CODES,
  PUBLIC_SITE_ORIGIN = "*",
  MAX_UPLOAD_MB = "200",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const allowedAdminCodes = String(ADMIN_CODES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (ADMIN_CODE && !allowedAdminCodes.includes(ADMIN_CODE)) {
  allowedAdminCodes.push(ADMIN_CODE);
}

if (allowedAdminCodes.length === 0) {
  throw new Error("Missing ADMIN_CODE (or ADMIN_CODES)");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const app = express();

app.use(
  cors({
    origin: PUBLIC_SITE_ORIGIN === "*" ? true : PUBLIC_SITE_ORIGIN.split(",").map((s) => s.trim()),
    credentials: false,
  })
);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "plr-backend",
    endpoints: {
      health: "/health",
      resources: "/api/resources",
      upload: "/api/upload",
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/check-code", requireAdminCode, (_req, res) => {
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(MAX_UPLOAD_MB) * 1024 * 1024,
  },
});

function requireAdminCode(req, res, next) {
  const code = req.header("x-admin-code") || req.body?.adminCode;
  if (!code || !allowedAdminCodes.includes(String(code))) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

function guessTypeFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "document";
  if (m === "application/zip" || m === "application/x-zip-compressed") return "archive";
  return "document";
}

function safeExt(filename) {
  const parts = String(filename || "").split(".");
  if (parts.length <= 1) return "";
  const ext = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext ? `.${ext}` : "";
}

function safePathSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 60);
}

app.get("/api/resources", async (_req, res) => {
  const { data, error } = await supabase
    .from("resources")
    .select("id,title,subject,type,format,url,download_url,created_at")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const mapped = (data || []).map((r) => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    type: r.type,
    format: r.format,
    url: r.url,
    downloadUrl: r.download_url || r.url,
    createdAt: r.created_at,
  }));

  return res.json({ resources: mapped });
});

app.post("/api/upload", upload.single("file"), requireAdminCode, async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const type = String(req.body?.type || "").trim().toLowerCase();
    const format = String(req.body?.format || "").trim().toLowerCase();

    const file = req.file;

    if (!file) return res.status(400).json({ error: "missing_file" });
    if (!title || !subject) return res.status(400).json({ error: "missing_fields" });

    const inferredType = guessTypeFromMime(file.mimetype);
    const finalType = type || inferredType;
    const finalFormat = format || safeExt(file.originalname).replace(".", "") || "file";

    const subjectSeg = safePathSegment(subject) || "general";
    const typeSeg = safePathSegment(finalType) || "file";
    const ext = safeExt(file.originalname) || `.${safePathSegment(finalFormat)}`;

    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
    const objectPath = `${subjectSeg}/${typeSeg}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });

    if (uploadErr) return res.status(500).json({ error: uploadErr.message });

    const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(objectPath);
    const url = publicData?.publicUrl;

    if (!url) return res.status(500).json({ error: "public_url_failed" });

    const { data: row, error: insertErr } = await supabase
      .from("resources")
      .insert({
        title,
        subject,
        type: finalType,
        format: finalFormat,
        url,
        download_url: url,
        storage_path: objectPath,
      })
      .select("id,title,subject,type,format,url,download_url,created_at")
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    return res.json({
      resource: {
        id: row.id,
        title: row.title,
        subject: row.subject,
        type: row.type,
        format: row.format,
        url: row.url,
        downloadUrl: row.download_url || row.url,
        createdAt: row.created_at,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "server_error" });
  }
});

app.use((err, _req, res, _next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file_too_large" });
  }
  return res.status(500).json({ error: "server_error" });
});

app.listen(Number(PORT), () => {
  // eslint-disable-next-line no-console
  console.log(`PLR backend listening on :${PORT}`);
});
