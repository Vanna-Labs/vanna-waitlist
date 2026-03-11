# Vanna Landing System Design

## 1. Purpose

This repository implements Vanna's pre-launch acquisition surface:

- a static marketing landing page built with React + Vite
- a modal-based waitlist capture flow
- a Supabase-backed backend for signup storage and basic abuse prevention
- optional integrations for bot verification and transactional email

The current system is optimized for a low-complexity launch stage: collect qualified email demand, preserve attribution metadata, and avoid exposing the database directly to browsers.

## 2. Scope

### In scope today

- Marketing content rendered entirely in the frontend bundle
- Waitlist signup from a modal CTA
- UTM/referral capture
- Server-side email validation
- Optional Cloudflare Turnstile verification
- IP-based rate limiting using a salted hash
- Idempotent-ish duplicate handling by email
- Optional confirmation and internal notification emails through Resend

### Out of scope today

- Authentication
- Admin dashboard
- CRM sync
- Analytics pipeline
- Background jobs / queues
- Multi-page content management
- Full product onboarding or trial provisioning

## 3. High-Level Architecture

```text
Visitor Browser
  |
  | loads static assets
  v
Vite/React Frontend
  |
  | POST /waitlist-signup payload
  v
Supabase Edge Function
  |
  | service-role access
  v
Supabase Postgres (waitlist_signups)
  |
  +--> optional Turnstile verification API
  |
  +--> optional Resend email API
```

## 4. Primary Components

### 4.1 Frontend application

The active frontend lives in `src/` and is mounted through a single React entrypoint.

Responsibilities:

- render the marketing site and CTA sections
- manage the waitlist modal lifecycle
- capture email input and honeypot input
- read UTM and referral query params from `window.location.search`
- conditionally load Cloudflare Turnstile when a site key is configured
- submit a JSON payload to the backend function
- present success, duplicate, and error states to the visitor

Implementation notes:

- `src/App.tsx` contains both page composition and waitlist interaction logic.
- `src/index.css` holds the real visual system; `src/App.css` still contains default Vite starter styles and appears unused.
- The frontend depends on `VITE_WAITLIST_API_URL` and optionally `VITE_TURNSTILE_SITE_KEY`.

### 4.2 Waitlist Edge Function

The backend entry point is `supabase/functions/waitlist-signup/index.ts`.

Responsibilities:

- enforce CORS with an allowlist
- accept `POST` and `OPTIONS` only
- parse and validate JSON input
- trap bots through the hidden honeypot field
- normalize email addresses to lowercase
- optionally verify Turnstile tokens server-side
- hash client IPs with a secret salt
- enforce per-IP hourly signup limits
- upsert-like behavior for repeat emails
- insert or update signup records in Postgres
- send optional transactional emails after successful inserts

Design choice:

- The function uses the Supabase service role key instead of exposing table access to the browser. This keeps RLS simple and prevents client-side writes from bypassing validation and abuse controls.

### 4.3 Postgres storage

The waitlist schema is created in `supabase/migrations/20260303123000_create_waitlist_signups.sql`.

Key characteristics:

- `email` is `citext` and unique, giving case-insensitive deduplication
- attribution fields are stored directly as columns
- operational metadata includes `ip_hash`, `user_agent`, timestamps, and `turnstile_score`
- `signups_count` increments on repeat submissions for the same email
- RLS is enabled with no public policies, intentionally blocking direct browser access
- `updated_at` is maintained by a trigger

## 5. Request Flow

### 5.1 Happy path

1. A visitor loads the landing page.
2. The visitor opens the modal from a CTA.
3. The frontend reads UTM and referral parameters once and retains them in memory.
4. If Turnstile is configured, the widget is rendered and the browser collects a token.
5. The frontend submits:
   - `email`
   - `website` honeypot
   - `turnstileToken`
   - `source`
   - `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm`
   - `referral`
6. The Edge Function validates origin, method, JSON shape, email format, and optional Turnstile proof.
7. The function computes a salted IP hash and checks hourly signup volume for that IP.
8. The function looks up the email:
   - if present, it updates metadata and increments `signups_count`
   - if absent, it inserts a new row
9. On new inserts only, the function attempts confirmation and notification emails through Resend.
10. The frontend shows success feedback and auto-closes the modal.

### 5.2 Duplicate signup behavior

Duplicate email submissions are not rejected as errors. Instead, the function:

- updates the existing row
- increments `signups_count`
- returns `alreadyJoined: true`

This is useful for low-friction UX, but it also means:

- attribution fields can be overwritten by later submissions
- repeat visits mutate the original record instead of creating an event history

## 6. Data Model

### `public.waitlist_signups`

Core fields:

- `id`: UUID primary key
- `email`: unique case-insensitive identifier
- `status`: `pending | confirmed | unsubscribed`
- `source`: coarse acquisition source

Attribution fields:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `referral`

Abuse / operations fields:

- `turnstile_score`
- `ip_hash`
- `user_agent`
- `signups_count`

Audit fields:

- `first_seen_at`
- `last_seen_at`
- `created_at`
- `updated_at`
- `metadata` JSONB

## 7. Security Model

### Controls in place

- Browser traffic cannot read or write waitlist rows directly because RLS is enabled with no client-facing policies.
- The Edge Function uses an origin allowlist before returning CORS headers.
- Email input is normalized and validated server-side.
- A hidden honeypot field catches unsophisticated bots.
- Optional Turnstile verification adds bot resistance without trusting the browser.
- IP-based rate limiting is performed against a salted hash instead of storing raw IP addresses.
- The service role key is confined to the Edge Function runtime.

### Important security assumptions

- `ALLOWED_ORIGINS` must be populated correctly in every environment.
- `WAITLIST_IP_SALT` must be secret and stable; otherwise rate limiting becomes ineffective or inconsistent.
- The Edge Function is deployed with `--no-verify-jwt`, so origin checks and function-side validation are the main protection layer.

## 8. Deployment Model

### Frontend

- Built as a static Vite bundle
- Can be deployed to any static host
- Requires runtime build-time env vars for backend URL and optional Turnstile site key

### Backend

- Supabase hosts both the database and the Edge Function
- Function config disables JWT verification because this endpoint is intentionally public
- Secrets are managed through Supabase function secrets

### External dependencies

- Cloudflare Turnstile for challenge verification
- Resend for outbound email

Both integrations are optional. The system still captures signups if those secrets are absent.

## 9. Operational Characteristics

### Strengths

- Minimal moving parts
- Cheap to host
- Clear separation between public frontend and privileged backend writes
- Good enough anti-abuse posture for an early waitlist funnel
- Simple schema with enough attribution context for launch-stage analysis

### Current limitations

- The React app is a single large component; content and behavior are tightly coupled.
- No test coverage is present for frontend or Edge Function logic.
- No observability layer exists beyond console logging.
- No analytics or event stream captures funnel steps such as modal opens or submit failures.
- Resend is only triggered for first-time signups, not repeat attempts.
- The rate-limit window uses `first_seen_at` for duplicate-heavy IP counting, which is workable but not ideal for modeling all submission attempts.

## 10. Notable Repository Findings

### Legacy prototype folder

`landing-page---beginner-investing-agent/` appears to be an older exported static prototype from aicofounder.com.

Characteristics:

- separate standalone `index.html` + `app.js`
- hardcoded third-party email capture endpoint
- not integrated with the active Vite app
- contains Windows `Zone.Identifier` sidecar files

Recommendation:

- either remove this folder from the production repo or explicitly mark it as archival material to avoid confusion about the supported frontend path.

### Styling cleanup opportunity

`src/App.css` still contains Vite starter styles and does not appear to be part of the active design system. This is low risk but increases noise for future contributors.

## 11. Recommended Next Steps

### Near-term

- split `src/App.tsx` into presentational sections and a dedicated waitlist hook/component
- add Edge Function tests around duplicate handling, origin filtering, and rate limiting
- add basic analytics for CTA clicks, modal opens, submit attempts, and conversion rate
- remove or archive the legacy prototype directory
- delete unused starter CSS

### Growth-stage

- add a lightweight admin view or export workflow for waitlist operations
- record submission events separately from the deduplicated contact record
- introduce provider abstractions if email or anti-bot vendors may change
- add CRM sync and lifecycle automation when the product launch process hardens

## 12. Summary

This system is a pragmatic launch-stage architecture: one static frontend, one public serverless write endpoint, and one private waitlist table. It is appropriately simple for demand capture, with reasonable security controls for an early product. The main architectural pressure points are maintainability, lack of tests, and the absence of analytics and operational tooling rather than raw scale.
