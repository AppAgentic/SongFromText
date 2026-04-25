# Mobile Message Funnel Direction

Visual thesis: a late-night chat becomes a music preview, with the message composer as the first action and the price revealed only after enough messages exist.

Primary route: `/create`
- Chat-style message builder.
- Message-by-message input with editable rows.
- Preview and checkout stay locked until the input has at least five messages and enough total text.

Variant route: `/quiz`
- Step 1: messages.
- Step 2: sound.
- Step 3: locked preview and checkout.

Sound update:
- Keep a direct `Country` choice for users who expect the current country-pop / country-heartbreak lane from short-form ads.
- Add `UK folk` as the Amber Run-adjacent lane: British, acoustic, intimate, and emotional rather than full Nashville country.
- Add `UK R&B` as a smooth late-night lane for users who want R&B rather than folk/country.
- Keep artist names out of public UI/generation prompts and describe the broader sound instead.
- Keep both routes using the shared `lib/vibes.ts` list so the picker and checkout validation stay in sync.

Generated direction reference: `docs/design/mobile-flow-direction.png`.
