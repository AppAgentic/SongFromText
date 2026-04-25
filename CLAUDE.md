# SongFromText

## Overview
Web app that turns pasted messages into AI-generated songs using the user's **exact words** as lyrics. Users paste "what they said" (messages from another person), pick a vibe, pay the weekly subscription, and get a shareable song where the original messages are preserved verbatim as sung lyrics.

Primary acquisition: Meta + TikTok ads riding the current "text-to-song" viral trend.

## Tech Stack
- **Framework**: Next.js (App Router) + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Platform**: Responsive web (mobile-first — most traffic from ads on phones)
- **Database / Auth**: Firebase (Firestore + Firebase Auth)
- **Storage**: Firebase Storage (generated audio + cover art)
- **Billing**: Whop (weekly subscription, hard paywall, NO free trial) — via `@whop/sdk`
- **Analytics**: PostHog + Meta Pixel/Conversions API for paid-social attribution
- **Music generation**: Kie.ai Suno API (custom mode so we can enforce verbatim lyrics)
- **Hosting**: Firebase App Hosting (SSR Next.js, same project as Firestore/Auth/Storage — single Firebase project)

## Business Model
- **Price**: £6.99/week (v1 default — revisit after ad tests)
- **Trial**: None. Hard paywall before any paid generation.
- **Upsell**: Optional video export (chat-bubble animated video set to the song) as paid add-on in later versions.
- **Economic rule**: No Kie/Suno cost until after Whop checkout succeeds. Pre-paywall screens show only cheap inferred metadata (title, tone, fake waveform).

## Project Structure
(To be scaffolded. Target shape:)
```
SongFromText/
├── app/                   # Next.js App Router
│   ├── (marketing)/       # Landing page
│   ├── (funnel)/          # Create → tone → preview → paywall flow
│   ├── (app)/             # My Songs, result, library (authed)
│   └── api/               # Whop webhooks, Kie orchestration
├── components/            # shadcn/ui + custom
├── lib/                   # Firebase, Whop, Kie clients
├── docs/
│   ├── PRD.md             # Source of truth (in this repo)
│   └── plans/             # Feature plans
└── firebase/              # Firestore rules, indexes, functions (if used)

# Root-level Firebase config:
# - apphosting.yaml           # Firebase App Hosting build + runtime config
# - firebase.json             # Firestore rules/indexes/storage/emulator config
# - .firebaserc               # Project alias
```

## Commands
```bash
# Install
pnpm install

# Dev
pnpm dev

# Build
pnpm build

# Typecheck / lint
pnpm typecheck
pnpm lint

# Firebase App Hosting deploy (push to `main` auto-deploys once backend is linked)
firebase apphosting:backends:create      # one-time: link GitHub repo → backend
firebase deploy --only apphosting        # manual deploy if needed
firebase emulators:start                 # local Firestore/Auth/Storage emulators
```

## Environment Variables
```
# Firebase (client SDK — safe to expose)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin (server only — App Hosting uses ADC; service account env is local fallback)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Whop
WHOP_API_KEY=
WHOP_COMPANY_ID=
WHOP_WEBHOOK_SECRET=
SONG_WEEKLY_PRICE_GBP=6.99

# Kie.ai (Suno)
KIE_API_KEY=

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=

# Meta ads attribution
NEXT_PUBLIC_META_PIXEL_ID=
META_CAPI_ACCESS_TOKEN=
META_GRAPH_VERSION=v25.0
META_TEST_EVENT_CODE=
```

## Core Product Rules (from PRD)
1. **Exact words over polished prose** — never paraphrase, never rewrite. Repetition/sectioning for song structure is allowed.
2. **Fast over flexible** — ad traffic on mobile, paste → vibe → paywall under 90s.
3. **Cheap before payment, expensive after** — no Kie jobs before Whop checkout success.
4. **Messaging**: "Turn their messages into a song." NEVER frame as "generic AI music studio."
5. **One paid product** — weekly sub only. No monthly, no annual, no free tier.

## Key Integration Points
- **Kie.ai Suno API** — music generation, custom mode (forces our lyrics). Polling or webhook for job completion.
- **Whop** — weekly subscription via `@whop/sdk`. Create checkout with an inline dynamic renewal plan → redirect to `purchase_url` → webhook activates subscription. Do not require a hardcoded weekly plan id; store the returned checkout id + plan id for reconciliation. Price comes from `SONG_WEEKLY_PRICE_GBP` (default £6.99). HTTPS redirect URLs required — use ngrok for local dev. See `~/.claude/rules/whop-integration.md`.
- **Meta Ads attribution** — use browser Pixel + server CAPI together. Generate unique event ids per conversion action; send the same id as Pixel `eventID` and CAPI `event_id` for dedupe. Capture `_fbp`, `_fbc`, `fbclid`, UTM params, landing page, referrer, client IP, and user agent before Whop redirect. Send `InitiateCheckout` before redirect and `Purchase` from the Whop webhook using stored project attribution. Do not depend on Whop-hosted checkout alone for attribution.
- **Firebase** — Firestore collections: `users`, `projects` (input + metadata), `generations` (provider job + assets), `subscriptions`, `events`. Firebase Auth for identity. Firebase Storage for MP3 + cover art assets. Firebase App Hosting serves the Next.js app (SSR) from the same project.

## Hosting Notes (Firebase App Hosting)
- App Hosting runs Next.js natively (SSR + route handlers + middleware supported). No serverless adapter needed.
- Secrets (WHOP_API_KEY, WHOP_WEBHOOK_SECRET, WHOP_COMPANY_ID, KIE_API_KEY once available, etc.) go in `apphosting.yaml` via `secret:` references, synced from Google Secret Manager.
- Firebase Admin on App Hosting should use application default credentials rather than checked-in service-account secret refs.
- Public env vars (NEXT_PUBLIC_*) can be set as plain `env:` values in `apphosting.yaml`.
- Add `NEXT_PUBLIC_META_PIXEL_ID` and `META_CAPI_ACCESS_TOKEN` only after the Meta dataset/pixel is created. CAPI no-ops without both values.
- Rollouts are triggered by pushes to the linked branch (default: `main`). Preview channels available per-PR.
- Custom domain: configure in Firebase console after first rollout.

## Notes & Gotchas
- Full PRD: [`docs/PRD.md`](docs/PRD.md)
- Reference UI mockups: dark, neon-accented aesthetic (see PRD section 8 references)
- Research note: Lyria 3 Pro was evaluated as an alternative music engine via Gemini API and produces usable output — if Kie.ai ever blocks or prices badly, Lyria 3 is a fallback option.
- GitHub: https://github.com/AppAgentic/SongFromText
- Slack: #songfromtext
