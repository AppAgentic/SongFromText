# Product Requirements Document — SongFromText
*Agent-ready specification for v1 web app*

> **Note**: The original `.docx` version of this PRD (with embedded reference images) is in `docs/PRD.docx`. This `.md` version is the searchable working copy for agents.

---

## Purpose
This PRD defines the scope, UX, business model, technical architecture, and delivery requirements for SongFromText v1. It is written so an implementation agent can use it directly to design and build the product.

## 1. Product Snapshot

| Field | Value |
|-------|-------|
| Product | SongFromText |
| One-line pitch | Paste only the other person's messages and turn those exact messages into a shareable song. |
| Platform | Responsive web app optimized for mobile-first traffic from Meta and TikTok ads. |
| Business model | Weekly subscription only, no free trial, charged before any paid generation is triggered. |
| Core constraint | The exact pasted messages must remain the core lyrics. No paraphrasing or narrative rewriting. |

## 2. Problem Statement
Users are seeing social content where someone turns "what he said" or "what she said" into a song. The viral appeal comes from authenticity: the words feel real, recognizable, and emotionally loaded. Existing generic AI music tools require too much prompting, feel broad rather than trend-native, and do not package the result in a conversion-focused funnel.

SongFromText should provide a much simpler, trend-aligned experience: paste the other person's messages, choose a vibe, pay to unlock unlimited usage, and receive songs that preserve those exact words as lyrics.

## 3. Goals, Non-goals, and Success Criteria

### 3.1 Goals
- Make the product instantly understandable from paid social traffic with minimal explanation.
- Preserve exact user-provided messages as the lyrical core of each song.
- Ensure no expensive generation occurs before subscription payment succeeds.
- Convert cold ad traffic into weekly subscribers with a mobile-first, low-friction funnel.
- Deliver a usable, polished v1 in the narrowest possible scope.

### 3.2 Non-goals for v1
- No screenshot upload or OCR.
- No multi-user chat parsing or full conversation reconstruction.
- No manual DAW-style editing, stems, or advanced music controls.
- No social feed or public discovery layer.
- No native iOS or Android app.

### 3.3 Success Criteria
- A new user from a TikTok or Meta ad can go from landing page to paid generation in under 90 seconds.
- No Kie/Suno generation cost is incurred until after successful payment.
- The generated lyrics are visibly recognizable as the pasted input.
- The product works well on a mobile browser and remains usable on desktop.
- Users can access their song library and replay prior generations after purchase.

## 4. Target User and Positioning
**Primary user**: a social-media-native consumer who wants to turn emotionally charged or funny messages from another person into a song and share or replay the result. They are not looking for a general AI music studio. They are responding to a specific trend format.

### 4.1 Positioning
- **Primary value proposition**: "Paste what they said. Hear it as a real song."
- **Differentiator**: exact messages are preserved as lyrics rather than rewritten into generic song text.
- **Funnel framing**: "Turn their messages into a song," not "Generate AI music."

### 4.2 User motivations
- **Curiosity**: hear what the messages would sound like as a track.
- **Validation**: prove that the words were "literally what they said."
- **Humor or catharsis**: transform awkward, sad, or chaotic messages into something entertaining.
- **Shareability**: create content that can be posted or sent to friends.

## 5. Business Model and Unit Economics
- Monetization model: **one weekly subscription only**.
- Default price assumption for v1: **£6.99/week**.
- **No free trial.**
- **No real generation before payment.**
- Post-payment generation should default to a small fixed number of outputs, ideally two versions per request, to keep costs bounded while still providing choice.
- **Economic rule**: the system must be architected so that expensive generation begins only after checkout is complete. Pre-paywall screens may show inferred metadata, a generated title, a fake waveform, and other low-cost signals, but must not trigger Kie generation jobs.

### 5.1 Economic assumptions for the build
- Paid social is the main acquisition channel, so conversion speed matters more than broad feature depth.
- The first paid week should be sufficient to cover acquisition if the funnel performs; therefore cost leakage before payment must be eliminated.
- Retention is helpful but the product must also survive on first-week economics.

## 6. Product Principles
- **Exact words over polished prose**: preserve authenticity.
- **Fast over flexible**: keep the creation flow extremely short.
- **Mobile-first over dashboard-first**: design for ad traffic on phones.
- **Perceived certainty over ambiguity**: by the paywall stage the user should feel that "their song is ready."
- **Cheap before payment, expensive after payment.**

## 7. End-to-End User Flow
1. User lands on the landing page from a Meta or TikTok ad.
2. User taps primary CTA and reaches the creation screen.
3. User pastes only the other person's messages into a textarea.
4. User selects a vibe or accepts the recommended default.
5. System validates that the input is substantial enough to make a good song.
6. System shows a processing screen with low-cost progress states.
7. System shows a locked preview with generated title, tone, and waveform-style teaser.
8. User sees hard paywall for weekly subscription.
9. After successful payment, backend triggers Kie/Suno generation.
10. User is taken to a result screen once assets are ready, then can access songs from the library.

## 8. Screen-by-Screen Requirements

### 8.1 Landing Page
- Hero headline: "Turn their messages into a song."
- Subheadline must emphasize exact words, not generic rewriting.
- Primary CTA above the fold.
- Visual must demonstrate "messages in → song out."
- Secondary trust cues may include publication logos, social proof, or "built for real conversations."
- Pricing hint can be visible but should not dominate above-the-fold area.

### 8.2 How It Works / Supportive explainer
- Three simple steps: paste messages, pick a vibe, get your song.
- Keep this section scannable for cold traffic.
- Do not over-explain AI generation mechanics.

### 8.3 Sign Up / Continue
- Allow email and social continuation options if used.
- This screen can also be deferred until payment if the checkout flow covers identity creation.
- If shown before payment, keep it minimal and mobile-friendly.

### 8.4 Intro / Rules modal
- Explain two key rules: only paste the other person's messages, and those exact messages are preserved as lyrics.
- Tone should be concise and confidence-building.

### 8.5 Create: Paste Messages
- Large textarea with placeholder examples.
- Helper text: only paste one person's messages.
- Character counter or line count.
- Continue CTA disabled until minimum criteria pass.

### 8.6 Choose Tone / Genre
- User selects one of a few large tone cards: Emotional, Funny, Dramatic, Savage.
- Genre can default to auto-detect with optional override.
- Keep choices intentionally narrow to reduce paralysis.

### 8.7 Input Validation
- If input is too weak, show a dedicated validation screen or in-flow state.
- Give concrete tips: add more lines, make sure it is all from one person, use more meaningful messages.

### 8.8 Processing
- Show progress states such as detecting messages, finding the hook, structuring lyrics, composing melody, generating vocals.
- Before payment, this is a **perceived-value screen** and should remain low cost.

### 8.9 Locked Preview
- Show generated song title, tone chip, duration-like metadata, and blurred waveform/player.
- Must feel like the song already exists.
- CTA leads into paywall.

### 8.10 Hard Paywall
- Headline: "Your song is ready."
- One weekly subscription only.
- **No free trial.**
- Benefits list should emphasize unlimited songs, exact words preserved, downloads, and cancel anytime.
- A video upsell variant should show messages turning into a track.

### 8.11 Checkout Success / Subscription Confirmation
- Clear confirmation that subscription is active and the song is now unlocked or generating.
- Direct path to the result or my songs page.

### 8.12 Song Result Screen
- Display cover art or placeholder art, player, version tabs, metadata chips, and download actions.
- Allow replay and sharing.
- Show exact source text or a lyric excerpt so authenticity is reinforced.

### 8.13 Regeneration Options
- Offer lightweight post-result actions like make it funnier, sadder, or more dramatic.
- These should use the same preserved-lyrics principle.

### 8.14 My Songs Library
- User can browse prior songs, replay, search, and open details.
- This is important for subscription retention and perceived value.

### 8.15 Song Detail / History
- Show prior versions of a song, source text, and asset actions such as download MP3 or share.

### 8.16 Account / Billing / Settings / FAQ
- Basic account management, subscription status, cancellation, privacy language, and FAQ.
- These can share a common dashboard shell.

## 9. Functional Requirements
- The product must accept pasted multiline text input.
- The product must guide the user to paste only the other person's messages.
- The product must preserve exact user-provided lines as the core lyrics.
- The product may reorder or repeat lines for musical structure but must not materially rewrite them.
- The system must infer a hook line or strong repeated line for chorus construction.
- The system must not trigger paid generation before payment succeeds.
- The system must support at least one generated result and ideally two variations per request after payment.
- The user must be able to replay generated songs from a library.
- The user must be able to download at least MP3 in v1 if the upstream provider supports it.
- The product must support subscription gating and cancellation access through a billing page.

## 10. Input Rules and Content Handling

### 10.1 Input validation rules
- Recommended minimum: at least 5 meaningful lines.
- Reject or warn on low-information inputs such as "ok / yeah / lol".
- Encourage messages with emotion, conflict, humor, or recognisable phrases.
- Preserve emojis and slang if they are present.

### 10.2 Lyrics preservation rules
- **Allowed transformations**: repetition, sectioning, line breaks, very short filler words if absolutely needed for rhythm.
- **Not allowed**: paraphrasing, summarizing, inventing a new narrative around the text, changing meaning, or adding unrelated verses.
- The result should feel like the same words, just musically arranged.

## 11. Generation Pipeline
The system should use a two-stage preparation flow before sending data to Kie/Suno. The goal is to retain authenticity while improving song structure.

### 11.1 Pre-generation orchestration
- Normalize pasted text by trimming whitespace and splitting into lines.
- Run validation and basic sentiment/tone inference.
- Select a likely hook line based on emotional weight or repetition potential.
- Construct a simple song layout such as verse/chorus using the exact lines.
- Generate a short title from the strongest line.

### 11.2 Example internal structured lyric format
```
[Verse]
where are you?
i told you 7pm
it's 9:30

[Chorus]
you always say that
you always say that
you always say that

[Verse]
traffic was crazy
i'm sorry okay
```

### 11.3 Kie/Suno prompt guidance
Use Kie custom mode where possible so title and style can be controlled. The prompt should explicitly instruct the model to use only the supplied lines as lyrics, while allowing repetition for structure. The backend should never ask the model to rewrite the lines into a new lyric narrative.

### 11.4 Post-payment generation flow
1. User completes weekly subscription payment.
2. Backend creates generation job record and calls Kie API.
3. Backend polls or receives callback until assets are ready.
4. Song asset URLs and metadata are stored.
5. User is redirected to the result screen or shown a loading state until the asset is available.

## 12. Technical Architecture
- **Frontend**: Next.js with App Router, mobile-first responsive UI.
- **Styling**: Tailwind CSS plus a component system such as shadcn/ui.
- **Backend**: Next.js server routes (App Router route handlers) for orchestration.
- **Database**: Firebase Firestore.
- **Auth**: Firebase Auth (email + social providers).
- **Storage**: Firebase Storage for generated audio and cover art.
- **Billing**: Whop (weekly subscription) via `@whop/sdk`.
- **Analytics**: PostHog or equivalent.
- **Music generation**: Kie.ai Suno API.
- **Hosting**: Firebase App Hosting (SSR Next.js, single Firebase project for hosting + Firestore + Auth + Storage).

### 12.1 Core backend responsibilities
- Session and identity management.
- Input validation and normalization.
- Pre-paywall metadata generation such as title, tone, and fake waveform state.
- Subscription status enforcement.
- Kie job creation, polling, and result persistence.
- Asset authorization and song library retrieval.

## 13. Data Model
- **users**: identity, subscription state, timestamps.
- **projects**: raw input, normalized input, title, selected tone, status.
- **generations**: project_id, provider task id, generation status, output URLs, version label, duration metadata.
- **subscriptions**: whop membership id, plan id (`plan_...`), active state, renewal timestamps.
- **events**: analytics events for funnel and retention measurement.

## 14. Analytics and Measurement
- Track landing page CTA click rate.
- Track input completion rate.
- Track validation failure rate.
- Track preview-to-paywall rate.
- Track paywall conversion to paid subscription.
- Track time-to-first-song after payment.
- Track number of songs created per active subscriber.
- Track library revisit rate and retention by week.

## 15. Marketing and Ad Alignment
Because the main acquisition channels are Meta and TikTok ads, the landing page must visually and verbally match the ad promise. The product should never present itself as a generic AI music studio. The ad and page should both emphasize the same narrow concept: turn their messages into a song, using their exact words.

### 15.1 Messaging requirements
- **Preferred message**: "Turn their messages into a song."
- **Preferred proof phrase**: "Uses their exact words."
- **Avoid language** like "compose original lyrics from your conversation."
- Do not force users to understand AI tooling or model choices.

## 16. Privacy and Trust
- Explain clearly how pasted text is handled.
- Default posture should be privacy-forward, with deletion after processing unless storage is required for saved songs.
- FAQ should answer whether texts are stored, whether they are used for training, and how users can delete data.
- Billing and cancellation path should be obvious to reduce support friction.

## 17. Edge Cases and Failure Handling
- If generation fails after payment, user should be able to retry without ambiguity.
- If input is too short, validation should occur before paywall.
- If user loses connection after payment, library and processing state should restore on refresh.
- If Kie returns partial or delayed results, UI should keep the user informed without exposing raw provider errors.

## 18. Acceptance Criteria for v1
- A user can paste multiline text, choose a vibe, and reach a locked preview on mobile.
- No paid generation occurs before checkout succeeds.
- A paid user receives at least one playable song generated from the exact provided lines.
- The result view and library are accessible after the generation finishes.
- Subscription state is enforced for gated actions.
- The visual design is consistent with the dark, neon-accented references bundled with this PRD.

## 19. Recommended Build Order
1. Implement landing page and creation flow UI.
2. Implement input validation and tone selection.
3. Implement locked preview and hard paywall.
4. Wire Whop subscription checkout (`@whop/sdk` → `purchase_url`) and webhook handling.
5. Implement backend orchestration for Kie generation after payment.
6. Implement song result screen and my songs library.
7. Add account, billing, settings, and FAQ pages.
8. Instrument analytics and run initial paid ad tests.

## 20. Reference Image Bundle
The following files are referenced throughout this document (embedded in `docs/PRD.docx`):
- songfromtext_web_app_ui_mockup.png
- songfromtext_workflow_mockup_preview.png
- neon_accented_music_app_ui_flow.png
- neon_themed_music_dashboard_interface_design.png
- a_clean_modern_dark_themed_web_landing_page_desig.png
- a_wide_high_resolution_ui_ux_mockup_collage_on_a.png
