# Suno/Kie Style Research

Date: 2026-04-25

## Sources Checked
- Kie Suno API quickstart: https://docs.kie.ai/suno-api/quickstart
- Kie Generate Music endpoint: https://docs.kie.ai/suno-api/generate-music/
- Suno Custom Mode help: https://help.suno.com/en/articles/3726721
- Suno own-lyrics help: https://help.suno.com/en/articles/2415873
- Suno creative sliders help: https://help.suno.com/en/articles/6141377
- Suno exclude-elements help: https://help.suno.com/en/articles/3161921
- Suno V4.5 detailed style instructions: https://help.suno.com/en/articles/5782849

## Findings
- SongFromText should use Kie/Suno Custom Mode for paid generation. In Kie Custom Mode with vocals, `style`, `prompt`, and `title` are required; the `prompt` is the lyrics input rather than a loose description.
- Non-custom/simple mode is wrong for this product because the prompt is treated as a music idea and lyrics may be generated or rewritten automatically.
- The user-facing `vibe` should be only a compact product choice. The backend should map that choice to a fuller `style` string.
- The style string can include genre, mood, instruments, tempo/energy, vocal direction, and production language.
- Kie style limits depend on model: V4 allows 200 characters; V4_5, V4_5PLUS, V4_5ALL, V5, and V5_5 allow 1000 characters. Keep our default style prompts concise anyway.
- Suno V4.5+ can accept more conversational style instructions, but concise comma-separated style tags remain safer for predictable bulk generation.
- Use `negativeTags` for obvious drift control, such as excluding rap/trap/EDM from acoustic and country options.
- Kie exposes `styleWeight`, `weirdnessConstraint`, `audioWeight`, `vocalGender`, and persona fields. Treat `styleWeight` like Suno Style Influence: stronger adherence to the style input. Keep weirdness moderate for consumer funnel consistency.
- Suno's own docs describe Exclude as a way to avoid genres, instruments, voice styles, and other unwanted elements.
- Avoid copyrighted lyrics and avoid using artist names in generation prompts. Public UI can say broad labels; backend prompts should describe the sound without promising an artist clone.

## Recommendation for SongFromText
Use this generation shape after Whop subscription activation:

```json
{
  "customMode": true,
  "instrumental": false,
  "model": "V5",
  "prompt": "[Verse]\\nexact pasted lines...",
  "style": "modern country pop ballad, acoustic guitar, pedal steel, heartfelt vocal, slow-medium tempo, warm mix",
  "title": "generated title under 80 chars",
  "negativeTags": "rap, trap drums, EDM, heavy metal, parody vocals",
  "styleWeight": 0.7,
  "weirdnessConstraint": 0.35,
  "callBackUrl": "https://songfromtext--songfromtext-app.us-central1.hosted.app/api/kie/callback"
}
```

## Vibe Mapping Draft

| Vibe id | UI label | Backend style direction | Suggested negative tags |
| --- | --- | --- | --- |
| `sad-acoustic` | Sad acoustic | emotional acoustic pop, fingerpicked guitar, intimate vocal, soft harmonies, slow tempo, warm room | EDM, rap, trap drums, heavy metal, novelty |
| `uk-folk-country` | UK folk | British indie folk, acoustic guitar, intimate vocal, melancholy build, warm room, cinematic chorus | EDM, trap drums, heavy metal, glossy dance pop, parody |
| `uk-rnb` | UK R&B | UK R&B, alt R&B, warm sub bass, syncopated drums, silky intimate vocal, moody chords, late-night mix | country twang, folk ballad, heavy metal, EDM drop, novelty |
| `country-heartbreak` | Country | modern country pop ballad, acoustic guitar, pedal steel, heartfelt vocal, slow-medium tempo, warm mix | EDM, trap, synthpop, heavy metal, comedy vocals |
| `pop-revenge` | Pop revenge | dark pop, punchy drums, big chorus, confident vocal, glossy production, tense verses | country twang, folk ballad, heavy metal, lo-fi |
| `dreamy-synth` | Dreamy synth | dreamy synthpop, soft pads, late-night atmosphere, airy vocal, pulsing beat, wide reverb | country twang, acoustic folk, heavy metal, harsh rap |
| `rap-confessional` | Rap confessional | melodic rap, confessional vocal, sparse beat, moody piano, intimate delivery, emotional hook | country twang, EDM drop, heavy metal, comedy |

## Implementation Notes
- Keep lyrics structure in `prompt`, not `style`.
- Put section tags like `[Verse]`, `[Chorus]`, and repeated hook lines in the lyrics payload.
- Keep `title` generated from the strongest original message and clamp to 80 characters.
- Store the selected `vibeId`, final `style`, `negativeTags`, model, style weight, and Kie `taskId` on the `generations` document for debugging and iteration.
- Store optional user `customSound` from the funnel and append it as a short refinement to the backend style string after validation, keeping the selected preset as the stable fallback.
- Generate at least two tracks per request if Kie returns variations; show the best two in the result UI.
