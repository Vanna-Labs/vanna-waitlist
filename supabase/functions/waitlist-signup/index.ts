import { createClient } from "npm:@supabase/supabase-js@2";

type TurnstileResult = {
  success: boolean;
  score?: number;
  action?: string;
  "error-codes"?: string[];
};

type WaitlistRequest = {
  email?: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referral?: string;
  website?: string;
  turnstileToken?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TURNSTILE_SECRET_KEY = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const WAITLIST_IP_SALT = Deno.env.get("WAITLIST_IP_SALT") ?? "";
const WAITLIST_MAX_SIGNUPS_PER_HOUR = Number.parseInt(Deno.env.get("WAITLIST_MAX_SIGNUPS_PER_HOUR") ?? "20", 10);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "";
const WAITLIST_NOTIFY_EMAIL = Deno.env.get("WAITLIST_NOTIFY_EMAIL") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for waitlist-signup function.");
}

function truncate(value: string | null | undefined, maxLength = 255): string | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeEmail(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  if (!email || email.length > 320) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseOrigin(req: Request): string {
  return req.headers.get("origin")?.trim() ?? "";
}

function isOriginAllowed(origin: string): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.length === 0) return false;
  return ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type,authorization,x-client-info,apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin"
  };
  if (origin && isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function jsonResponse(status: number, body: Record<string, unknown>, origin = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(origin)
  });
}

function getClientIp(req: Request): string {
  const fromCf = req.headers.get("cf-connecting-ip");
  if (fromCf) return fromCf;
  const fromForwarded = req.headers.get("x-forwarded-for");
  if (!fromForwarded) return "";
  const [first] = fromForwarded.split(",");
  return first?.trim() ?? "";
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyTurnstile(token: string, remoteIp: string): Promise<TurnstileResult> {
  const payload = new URLSearchParams({
    secret: TURNSTILE_SECRET_KEY,
    response: token
  });
  if (remoteIp) {
    payload.set("remoteip", remoteIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload
  });

  if (!response.ok) {
    throw new Error(`Turnstile siteverify failed with status ${response.status}`);
  }

  return (await response.json()) as TurnstileResult;
}

async function sendResendEmail(payload: Record<string, unknown>): Promise<void> {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      ...payload
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Resend email failed:", detail);
  }
}

async function sendWaitlistEmails(email: string): Promise<void> {
  await sendResendEmail({
    to: [email],
    subject: "You're on the Vanna waitlist",
    html: `
      <div style="font-family: Work Sans, Arial, sans-serif; color:#1a3a2e;">
        <h2 style="font-family: Georgia, serif; margin-bottom:8px;">You're on the list.</h2>
        <p style="line-height:1.6;">Thanks for joining the Vanna waitlist. We'll send your early-access invite as soon as it's ready.</p>
        <p style="line-height:1.6;">- Team Vanna</p>
      </div>
    `
  });

  if (!WAITLIST_NOTIFY_EMAIL) return;
  await sendResendEmail({
    to: [WAITLIST_NOTIFY_EMAIL],
    subject: "New Vanna waitlist signup",
    text: `New signup: ${email}`
  });
}

function createSupabaseAdminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

Deno.serve(async (req) => {
  const origin = parseOrigin(req);

  if (req.method === "OPTIONS") {
    if (!isOriginAllowed(origin)) {
      return jsonResponse(403, { ok: false, message: "Origin is not allowed." }, origin);
    }
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin)
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, message: "Method not allowed." }, origin);
  }

  if (!isOriginAllowed(origin)) {
    return jsonResponse(403, { ok: false, message: "Origin is not allowed." }, origin);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(500, { ok: false, message: "Server is misconfigured." }, origin);
  }

  let payload: WaitlistRequest;
  try {
    payload = (await req.json()) as WaitlistRequest;
  } catch {
    return jsonResponse(400, { ok: false, message: "Invalid JSON payload." }, origin);
  }

  if (truncate(payload.website, 255)) {
    // Honeypot trap: return success to avoid teaching bots.
    return jsonResponse(200, { ok: true, alreadyJoined: false }, origin);
  }

  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    return jsonResponse(400, { ok: false, message: "Please provide a valid email address." }, origin);
  }

  const clientIp = getClientIp(req);
  const ipHash = clientIp && WAITLIST_IP_SALT ? await sha256Hex(`${WAITLIST_IP_SALT}:${clientIp}`) : null;
  const userAgent = truncate(req.headers.get("user-agent"), 512);

  let turnstileScore: number | null = null;
  if (TURNSTILE_SECRET_KEY) {
    const token = String(payload.turnstileToken ?? "").trim();
    if (!token) {
      return jsonResponse(400, { ok: false, message: "Security check is required." }, origin);
    }
    try {
      const turnstile = await verifyTurnstile(token, clientIp);
      if (!turnstile.success) {
        return jsonResponse(400, { ok: false, message: "Security check failed. Please retry." }, origin);
      }
      turnstileScore = typeof turnstile.score === "number" ? turnstile.score : null;
    } catch (error) {
      console.error("Turnstile verification error:", error);
      return jsonResponse(502, { ok: false, message: "Security check could not be verified." }, origin);
    }
  }

  const supabase = createSupabaseAdminClient();

  if (ipHash) {
    const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from("waitlist_signups")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("first_seen_at", sinceIso);
    if (error) {
      console.error("Rate-limit query failed:", error.message);
      return jsonResponse(500, { ok: false, message: "Could not process signup right now." }, origin);
    }
    if ((count ?? 0) >= WAITLIST_MAX_SIGNUPS_PER_HOUR) {
      return jsonResponse(429, { ok: false, message: "Too many signup attempts. Try again later." }, origin);
    }
  }

  const { data: existingRow, error: existingError } = await supabase
    .from("waitlist_signups")
    .select("id, signups_count")
    .eq("email", email)
    .maybeSingle();

  if (existingError) {
    console.error("Existing-row lookup failed:", existingError.message);
    return jsonResponse(500, { ok: false, message: "Could not process signup right now." }, origin);
  }

  const nowIso = new Date().toISOString();
  const source = truncate(payload.source, 120) ?? "website";
  const sharedFields = {
    source,
    utm_source: truncate(payload.utmSource, 255),
    utm_medium: truncate(payload.utmMedium, 255),
    utm_campaign: truncate(payload.utmCampaign, 255),
    utm_content: truncate(payload.utmContent, 255),
    utm_term: truncate(payload.utmTerm, 255),
    referral: truncate(payload.referral, 255),
    turnstile_score: turnstileScore,
    ip_hash: ipHash,
    user_agent: userAgent
  };

  if (existingRow) {
    const { error: updateError } = await supabase
      .from("waitlist_signups")
      .update({
        ...sharedFields,
        signups_count: (existingRow.signups_count ?? 1) + 1,
        last_seen_at: nowIso
      })
      .eq("id", existingRow.id);

    if (updateError) {
      console.error("Existing-row update failed:", updateError.message);
      return jsonResponse(500, { ok: false, message: "Could not process signup right now." }, origin);
    }

    return jsonResponse(200, { ok: true, alreadyJoined: true }, origin);
  }

  const { error: insertError } = await supabase.from("waitlist_signups").insert({
    email,
    ...sharedFields,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    metadata: {
      origin,
      captured_at: nowIso
    }
  });

  if (insertError) {
    console.error("Insert failed:", insertError.message);
    return jsonResponse(500, { ok: false, message: "Could not process signup right now." }, origin);
  }

  try {
    await sendWaitlistEmails(email);
  } catch (error) {
    // Email delivery should not fail the signup.
    console.error("Email send failed:", error);
  }

  return jsonResponse(200, { ok: true, alreadyJoined: false }, origin);
});
