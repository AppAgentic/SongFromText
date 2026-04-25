export const SONG_VIBES = [
  {
    id: "sad-acoustic",
    label: "Sad acoustic",
    detail: "soft guitar",
    badge: "Moonlit",
    sunoStyle:
      "emotional acoustic pop, fingerpicked guitar, intimate vocal, soft harmonies, slow tempo, warm room",
    negativeTags: "EDM, rap, trap drums, heavy metal, novelty",
  },
  {
    id: "uk-folk-country",
    label: "UK folk",
    detail: "indie acoustic",
    badge: "TikTok",
    sunoStyle:
      "British indie folk, acoustic guitar, intimate vocal, melancholy build, warm room, cinematic chorus",
    negativeTags: "EDM, trap drums, heavy metal, glossy dance pop, parody",
  },
  {
    id: "country-heartbreak",
    label: "Country",
    detail: "heartbreak twang",
    badge: "Country",
    sunoStyle:
      "modern country pop ballad, acoustic guitar, pedal steel, heartfelt vocal, slow-medium tempo, warm mix",
    negativeTags: "EDM, trap, synthpop, heavy metal, comedy vocals",
  },
  {
    id: "pop-revenge",
    label: "Pop revenge",
    detail: "big chorus",
    badge: "Sharp",
    sunoStyle:
      "dark pop, punchy drums, big chorus, confident vocal, glossy production, tense verses",
    negativeTags: "country twang, folk ballad, heavy metal, lo-fi",
  },
  {
    id: "dreamy-synth",
    label: "Dreamy synth",
    detail: "late night",
    badge: "Glow",
    sunoStyle:
      "dreamy synthpop, soft pads, late-night atmosphere, airy vocal, pulsing beat, wide reverb",
    negativeTags: "country twang, acoustic folk, heavy metal, harsh rap",
  },
  {
    id: "rap-confessional",
    label: "Rap confessional",
    detail: "spoken edge",
    badge: "Raw",
    sunoStyle:
      "melodic rap, confessional vocal, sparse beat, moody piano, intimate delivery, emotional hook",
    negativeTags: "country twang, EDM drop, heavy metal, comedy",
  },
] as const;

export type VibeId = (typeof SONG_VIBES)[number]["id"];

export const VIBE_VALUES = SONG_VIBES.map((vibe) => vibe.id) as [
  VibeId,
  ...VibeId[],
];

export function getSongVibe(vibeId: VibeId): (typeof SONG_VIBES)[number] {
  return SONG_VIBES.find((vibe) => vibe.id === vibeId) ?? SONG_VIBES[0];
}
