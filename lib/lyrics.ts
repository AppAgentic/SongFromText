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

/**
 * Normalize whitespace / smart quotes without altering wording.
 * NOT IMPLEMENTED — stub returns trimmed input split by newline.
 */
export function normalize(input: RawMessageInput): string[] {
  return input.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Detect the hook line. Heuristic TBD; for now returns the first line.
 * NOT IMPLEMENTED — real version should score by repetition and emotional weight.
 */
export function detectHook(lines: string[]): string {
  return lines[0] ?? "";
}

/**
 * Convert verbatim lines into a song-structured lyric string with [Verse],
 * [Chorus], [Bridge] tags. Chorus MUST be verbatim repetition of the hook line
 * — no paraphrasing allowed (PRD §3 rule 1).
 * NOT IMPLEMENTED — returns a placeholder.
 */
export function structureLyrics(_input: RawMessageInput): StructuredLyrics {
  throw new Error("structureLyrics not implemented");
}
