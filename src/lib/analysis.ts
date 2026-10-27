// Structured analysis of a paper. One model call returns the abstract-style
// summary plus the extra fields the research-wiki note needs. The user's
// prompt pref still controls the summary's style; we append the JSON contract.

import { callBackend } from "./backends";
import type { Prefs } from "./prefs";

export interface Analysis {
  summary: string;
  keyFindings: string[];
  method: string;
  limitations: string;
  topics: string[];
  /** 2-3 filing tags for the wiki page, preferring the vault's existing vocabulary. */
  tags: string[];
  /** False when the model ignored the JSON contract and we fell back to raw text. */
  structured: boolean;
}

// The user's prompt pref is written for a bare abstract ("output only the
// abstract paragraph"), so we wrap it as style guidance for the summary field
// rather than appending to it, and restate the JSON task after the paper text
// where small models weight it most.
function systemPrompt(stylePrompt: string): string {
  return `You analyse academic papers for a researcher's reference library and reply with a single JSON object.

The "summary" field is an abstract. Write it according to these instructions:
<summary_instructions>
${stylePrompt}
</summary_instructions>

The JSON object has exactly these keys:
- "summary": string, the abstract described above
- "key_findings": array of 3-5 strings, each one concrete finding or claim in one sentence
- "method": string, one or two sentences on the method, data or evidentiary basis
- "limitations": string, one or two sentences on scope conditions and weaknesses
- "topics": array of 3-6 short lowercase kebab-case topic slugs, e.g. "ai-procurement", "algorithmic-accountability"
- "tags": array of 2-3 broad lowercase kebab-case tags for filing the paper, e.g. "ai-governance", "disinformation". Tags are coarser than topics: each should fit many papers in the library.`;
}

// The tag vocabulary goes after the paper text, next to the task, because
// small local models over-apply list items they saw only in the system prompt.
function jsonTask(vocabulary: string[]): string {
  const tagRule = vocabulary.length
    ? `For "tags": the library already uses these tags: ${vocabulary.join(", ")}. ` +
      `Decide what the paper is about first. Reuse a listed tag only if it accurately describes ` +
      `this paper's subject; otherwise write a new tag. Never include a tag just because it is listed.\n\n`
    : `For "tags": the library has no tags yet, so choose broad, reusable ones.\n\n`;
  return (
    tagRule +
    `Now write the JSON object for the paper above, with the keys summary, key_findings, ` +
    `method, limitations, topics and tags. Output only the JSON object: no code fences, ` +
    `no text before or after it.`
  );
}

export async function analysePaper(
  prefs: Prefs,
  documentText: string,
  itemTitle: string,
  tagVocabulary: string[] = []
): Promise<Analysis> {
  const raw = await callBackend(prefs, {
    systemPrompt: systemPrompt(prefs.prompt),
    documentText,
    itemTitle,
    task: jsonTask(tagVocabulary),
    maxTokens: 1500,
  });
  return parseAnalysis(raw);
}

export function parseAnalysis(raw: string): Analysis {
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj.summary !== "string" || !obj.summary.trim()) {
    // Small local models sometimes ignore the contract. Keep the old
    // behaviour: treat the whole response as the summary.
    return {
      summary: raw.trim(),
      keyFindings: [],
      method: "",
      limitations: "",
      topics: [],
      tags: [],
      structured: false,
    };
  }
  return {
    summary: obj.summary.trim(),
    keyFindings: stringList(obj.key_findings),
    method: str(obj.method),
    limitations: str(obj.limitations),
    topics: uniqueSlugs(obj.topics, 6),
    tags: uniqueSlugs(obj.tags, 3),
    structured: true,
  };
}

// Models wrap JSON in fences or add a preamble often enough that a strict
// JSON.parse on the whole response is not viable. Take the outermost {...}.
function extractJsonObject(raw: string): any | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
}

function uniqueSlugs(v: unknown, max: number): string[] {
  return [...new Set(stringList(v).map(slugify).filter(Boolean))].slice(0, max);
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
