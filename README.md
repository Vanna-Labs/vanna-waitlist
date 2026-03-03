# Vanna Landing + Waitlist Backend

Landing page for Vanna plus a production-ready waitlist backend:
- React + Vite frontend
- Supabase Postgres table
- Supabase Edge Function (`waitlist-signup`)
- Optional Cloudflare Turnstile verification
- Optional Resend confirmation + internal notification emails

## 1) Frontend Environment

Copy `.env.example` to `.env` and fill values:

```bash
cp .env.example .env
```

Required:
- `VITE_WAITLIST_API_URL`: your deployed Edge Function URL

Optional:
- `VITE_TURNSTILE_SITE_KEY`: Cloudflare Turnstile site key

## 2) Supabase Setup

Make sure Supabase CLI is installed and you are logged in.

### Apply migration

```bash
supabase db push
```

This creates `public.waitlist_signups` with:
- case-insensitive unique email (`citext`)
- metadata fields (`source`, UTM params, referral)
- bot/rate-limit support fields (`ip_hash`, `signups_count`)
- RLS enabled (no public read/write policies)

### Set function secrets

Use `supabase/.env.functions.example` as reference:

```bash
supabase secrets set \
  SUPABASE_URL="https://YOUR-PROJECT-REF.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
  ALLOWED_ORIGINS="https://yourdomain.com,https://www.yourdomain.com,http://localhost:5173" \
  TURNSTILE_SECRET_KEY="0x4AAAA..." \
  WAITLIST_IP_SALT="long-random-secret" \
  WAITLIST_MAX_SIGNUPS_PER_HOUR="20" \
  RESEND_API_KEY="re_..." \
  RESEND_FROM_EMAIL="Vanna <waitlist@yourdomain.com>" \
  WAITLIST_NOTIFY_EMAIL="you@yourdomain.com"
```

Notes:
- `TURNSTILE_SECRET_KEY` is optional but recommended.
- `RESEND_*` vars are optional. If missing, signup still succeeds; emails are skipped.
- `ALLOWED_ORIGINS` should include production + local dev origins.

### Deploy function

```bash
supabase functions deploy waitlist-signup --no-verify-jwt
```

Function file:
- `supabase/functions/waitlist-signup/index.ts`

## 3) Local Development

```bash
npm install
npm run dev
```

The modal waitlist form posts to `VITE_WAITLIST_API_URL`.

## 4) Build

```bash
npm run build
npm run lint
```

## 5) Security/Best-Practice Notes

- CORS origin allowlist is enforced in the function (`ALLOWED_ORIGINS`)
- Turnstile token verification is server-side when secret is present
- Honeypot field is included (`website`)
- Rate limiting by hashed IP (`WAITLIST_MAX_SIGNUPS_PER_HOUR`)
- RLS blocks direct browser reads/writes to waitlist table
- Service role key is only used inside Edge Function, never in frontend
