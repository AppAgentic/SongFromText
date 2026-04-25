export const SONG_VIBES = [
  { id: "sad-acoustic", label: "Sad acoustic", detail: "soft guitar", badge: "Moonlit" },
  { id: "uk-folk-country", label: "UK folk", detail: "indie acoustic", badge: "TikTok" },
  { id: "country-heartbreak", label: "Country", detail: "heartbreak twang", badge: "Country" },
  { id: "pop-revenge", label: "Pop revenge", detail: "big chorus", badge: "Sharp" },
  { id: "dreamy-synth", label: "Dreamy synth", detail: "late night", badge: "Glow" },
  { id: "rap-confessional", label: "Rap confessional", detail: "spoken edge", badge: "Raw" },
] as const;

export type VibeId = (typeof SONG_VIBES)[number]["id"];

export const VIBE_VALUES = SONG_VIBES.map((vibe) => vibe.id) as [
  VibeId,
  ...VibeId[],
];
