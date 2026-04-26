/**
 * Lyric normalization, hook detection, and structured lyric formatting.
 * See PRD §11 (Lyric Structuring) — verbatim preservation with structural tags.
 *
 * Core rules (from PRD §3 + §11):
 *   - Never paraphrase or rewrite the user's words.
 *   - Repetition and sectioning (verse/chorus/bridge) ARE allowed.
 *   - Auto-detect a "hook line" from the rawest, most repeated or emotionally
 *     weighted phrase. If none, fall back to the opening line.
 */

export interface RawMessageInput {
  /** The full block of pasted text. One message per non-empty line. */
  text: string;
}

export interface StructuredLyrics {
  title: string;
  hook: string;
  /** Full lyric string ready to feed to Kie custom mode, with [Tags]. */
  formatted: string;
  /** Individual verbatim lines preserved, in order. */
  lines: string[];
}

export function normalize(input: RawMessageInput): string[] {
  return input.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Detect the hook line without rewriting. Prefer repeated or emotionally weighted
 * message lines, then fall back to the opener.
 */
export function detectHook(lines: string[]): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(normalizeForScoring(line), (counts.get(normalizeForScoring(line)) ?? 0) + 1);
  }

  let best = lines[0] ?? "";
  let bestScore = Number.NEGATIVE_INFINITY;

  lines.forEach((line, index) => {
    const normalized = normalizeForScoring(line);
    const repeated = counts.get(normalized) ?? 1;
    const score =
      repeated * 8 +
      emotionalWeight(line) +
      questionWeight(line) +
      Math.max(0, 4 - index * 0.4);

    if (score > bestScore) {
      best = line;
      bestScore = score;
    }
  });

  return best;
}

/**
 * Convert verbatim lines into a song-structured lyric string with [Verse],
 * [Chorus], [Bridge] tags. Chorus MUST be verbatim repetition of the hook line
 * — no paraphrasing allowed (PRD §3 rule 1).
 */
export function structureLyrics(input: RawMessageInput): StructuredLyrics {
  const lines = normalize(input);
  const hook = detectHook(lines);
  const title = titleFromHook(hook);
  const verseOne = lines.slice(0, 4);
  const verseTwo = lines.slice(4, 9);
  const bridge = lines.slice(9, 12);

  const sections = [
    formatSection("Verse", verseOne),
    formatSection("Chorus", [hook, hook]),
    verseTwo.length ? formatSection("Verse 2", verseTwo) : undefined,
    bridge.length ? formatSection("Bridge", bridge) : undefined,
    formatSection("Final Chorus", [hook, hook]),
  ].filter(Boolean);

  return {
    title,
    hook,
    formatted: sections.join("\n\n"),
    lines,
  };
}

function formatSection(name: string, lines: string[]): string {
  return [`[${name}]`, ...lines].join("\n");
}

function titleFromHook(hook: string): string {
  const cleaned = hook
    .replace(/^[^:]{1,24}:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Their Message";
  const title = cleaned.length > 64 ? cleaned.slice(0, 61).trimEnd() + "..." : cleaned;
  return title.length > 80 ? title.slice(0, 80).trimEnd() : title;
}

function normalizeForScoring(line: string): string {
  return line.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, "").replace(/\s+/g, " ").trim();
}

function emotionalWeight(line: string): number {
  const lowered = line.toLowerCase();
  const signals = [
    "miss",
    "love",
    "sorry",
    "hate",
    "leave",
    "left",
    "fine",
    "hurt",
    "cry",
    "wish",
    "need",
    "want",
    "truth",
    "goodbye",
  ];

  return signals.reduce((score, signal) => score + (lowered.includes(signal) ? 2 : 0), 0);
}

function questionWeight(line: string): number {
  return /[?!]/.test(line) ? 1.5 : 0;
}
