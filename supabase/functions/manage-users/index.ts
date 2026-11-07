import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const validRoles = new Set(["owner", "admin", "baker", "helper", "cashier"]);
const adminAssignableRoles = new Set(["baker", "helper", "cashier"]);

Deno.serve(async (request: Request) => {
  const allowedOrigin = Deno.env.get("CORS_ALLOWED_ORIGIN");
  const requestOrigin = request.headers.get("Origin");
  const corsHeaders = {
    "Access-Control-Allow-Origin": allowedOrigin ?? "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (!allowedOrigin) {
    return Response.json({ error: "Origin staging belum dikonfigurasi." }, { status: 503, headers: corsHeaders });
  }
  if (requestOrigin && requestOrigin !== allowedOrigin) {
    return Response.json({ error: "Origin tidak diizinkan." }, { status: 403, headers: corsHeaders });
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return Response.json({ error: "Sesi login diperlukan." }, { status: 401, headers: corsHeaders });
  }

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!projectUrl || !anonKey || !serviceRoleKey) {
    return Response.json({ error: "Konfigurasi server belum lengkap." }, { status: 503, headers: corsHeaders });
  }

  const callerClient = createClient(projectUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(projectUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: authError } = await callerClient.auth.getUser();
  if (authError || !userData.user) {
    return Response.json({ error: "Sesi login tidak valid." }, { status: 401, headers: corsHeaders });
  }

  const { data: callerProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !callerProfile?.is_active || !["owner", "admin"].includes(callerProfile.role)) {
    return Response.json({ error: "Akses pengelolaan pengguna ditolak." }, { status: 403, headers: corsHeaders });
  }

  let body: { action?: string; email?: string; fullName?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Format permintaan tidak valid." }, { status: 400, headers: corsHeaders });
  }

  if (body.action !== "invite") {
    return Response.json({ error: "Aksi tidak dikenal." }, { status: 400, headers: corsHeaders });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const fullName = String(body.fullName ?? "").trim();
  const role = String(body.role ?? "").trim().toLowerCase();
  if (!email || !fullName || !validRoles.has(role)) {
    return Response.json({ error: "Email, nama, dan role yang valid wajib diisi." }, { status: 400, headers: corsHeaders });
  }
  if (callerProfile.role === "admin" && !adminAssignableRoles.has(role)) {
    return Response.json({ error: "Admin hanya dapat mengundang Baker, Helper, atau Cashier." }, { status: 403, headers: corsHeaders });
  }

  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });
  if (inviteError || !inviteData.user) {
    return Response.json({ error: inviteError?.message ?? "Undangan pengguna gagal dibuat." }, { status: 400, headers: corsHeaders });
  }

  const { error: updateError } = await adminClient
    .from("profiles")
    .update({ full_name: fullName, role, is_active: true })
    .eq("id", inviteData.user.id);
  if (updateError) {
    console.error("Invited user profile role update failed.", updateError);
    return Response.json({ error: "Undangan terkirim, tetapi role profil belum tersimpan. Minta Owner memeriksa akun ini." }, { status: 500, headers: corsHeaders });
  }

  return Response.json({ id: inviteData.user.id, email, role }, { status: 201, headers: corsHeaders });
});
