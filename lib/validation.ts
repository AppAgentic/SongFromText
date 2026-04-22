/**
 * Input validation for pasted message text.
 * See PRD §10.1 (Input validation rules).
 *
 * Rules:
 *   - At least 5 non-empty lines.
 *   - Total text length between 40 and 2000 characters.
 *   - Reject low-information inputs (single repeated word, only emojis, only URLs).
 *   - Strip PII-like patterns? (NO — PRD says exact words, users accept the risk.)
 */
import { z } from "zod";

const MIN_LINES = 5;
const MIN_CHARS = 40;
const MAX_CHARS = 2000;

export const PastedInputSchema = z
  .object({
    text: z.string(),
  })
  .superRefine((data, ctx) => {
    const text = data.text.trim();
    if (text.length < MIN_CHARS) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: `Needs at least ${MIN_CHARS} characters. Paste a bit more.`,
      });
    }
    if (text.length > MAX_CHARS) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: `Too long — keep it under ${MAX_CHARS} characters.`,
      });
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < MIN_LINES) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: `Needs at least ${MIN_LINES} message lines.`,
      });
    }
    if (lines.length > 0 && isLowInformation(lines)) {
      ctx.addIssue({
        code: "custom",
        path: ["text"],
        message: "Paste real messages — a song needs actual words.",
      });
    }
  });

export type PastedInput = z.infer<typeof PastedInputSchema>;

/**
 * Low-info detector: flags inputs that are all emoji, all URLs, or the same
 * single word repeated. Not exhaustive — refine as we see real bad inputs.
 */
export function isLowInformation(lines: string[]): boolean {
  const joined = lines.join(" ").toLowerCase();
  const wordCount = joined.split(/\s+/).filter(Boolean).length;
  if (wordCount < 10) return true;

  const urlOnly = lines.every((l) => /^https?:\/\/\S+$/i.test(l));
  if (urlOnly) return true;

  // crude emoji-only heuristic: no ASCII letters anywhere
  if (!/[a-z]/i.test(joined)) return true;

  const uniqueWords = new Set(joined.split(/\s+/).filter(Boolean));
  if (uniqueWords.size < 5) return true;

  return false;
}
