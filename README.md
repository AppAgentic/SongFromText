# SongFromText

Turn pasted messages into AI-generated songs using their exact words as lyrics.

> Paste what they said. Hear it as a real song.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Firebase (Auth + Firestore + Storage + Analytics) · Whop (billing) · Kie.ai Suno (music generation) · Meta Pixel/CAPI (ads attribution) · Firebase App Hosting

## Quick start

Requires Node 20+ and pnpm (enable with `corepack enable`).

```bash
pnpm install
cp .env.example .env.local   # fill in values
pnpm dev                     # http://localhost:3000
```

Other scripts:

```bash
pnpm build       # production build
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
```

## Business model

Weekly subscription (£6.99/week). No free trial. Hard paywall before any paid generation.

## Further reading

- [`CLAUDE.md`](CLAUDE.md) — agent-facing project knowledge (stack, gotchas, integration points)
- [`docs/PRD.md`](docs/PRD.md) — full product requirements document
- [`apphosting.yaml`](apphosting.yaml) — Firebase App Hosting deployment config
- [`docs/reference-images/`](docs/reference-images/) — visual direction (dark / neon)
