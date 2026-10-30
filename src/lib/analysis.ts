// Structured analysis of a paper. One model call over the paper text returns
// the abstract-style summary plus the extra fields the research-wiki note
// needs; a second, short call over that summary picks the filing tags. The
// user's prompt pref still controls the summary's style.

import { callBackend } from "./backends";
import type { Prefs } from "./prefs";

export interface Analysis {
  summary: string;
  keyFindings: string[];
  method: string;
  limitations: string;
  topics: string[];
  /** 2-3 filing tags for the wiki page, preferring the vault's existing vocabulary. Nested tags (`method/survey`) keep their slash. */
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
- "topics": array of 3-6 short lowercase kebab-case topic slugs, e.g. "ai-procurement", "algorithmic-accountability"`;
}

const JSON_TASK =
  `Now write the JSON object for the paper above, with the keys summary, key_findings, ` +
  `method, limitations and topics. Output only the JSON object: no code fences, ` +
  `no text before or after it.`;

/**
 * @param tagVocabulary the vault's existing tags, or null to skip tagging
 *   (only the wiki page uses tags).
 */
export async function analysePaper(
  prefs: Prefs,
  documentText: string,
  itemTitle: string,
  tagVocabulary: string[] | null = null
): Promise<Analysis> {
  const raw = await callBackend(prefs, {
    systemPrompt: systemPrompt(prefs.prompt),
    documentText,
    itemTitle,
    task: JSON_TASK,
    maxTokens: 1500,
  });
  const analysis = parseAnalysis(raw);
  if (tagVocabulary && analysis.structured) {
    analysis.tags = await tagPaper(prefs, itemTitle, analysis, tagVocabulary);
  }
  return analysis;
}

// Tagging runs as its own short call over the summary, not the paper. Asked
// inside the main call, with 6k tokens of paper between the vocabulary and the
// answer, small local models reused listed tags that didn't fit (gemma3:12b put
// "ai-governance" on a disinformation paper in most runs). Each tag's reason
// comes before the tag in the JSON, so the model states the fit before it
// commits to a tag rather than justifying one after the fact.
async function tagPaper(
  prefs: Prefs,
  itemTitle: string,
  a: Analysis,
  vocabulary: string[]
): Promise<string[]> {
  const existing = vocabulary.length
    ? `Tags already used in the library: ${vocabulary.join(", ")}`
    : `The library has no tags yet.`;
  const userMessage = [
    `Title: ${itemTitle}`,
    `Summary: ${a.summary}`,
    a.keyFindings.length ? `Key findings:\n${a.keyFindings.map((f) => `- ${f}`).join("\n")}` : "",
    a.topics.length ? `Topics: ${a.topics.join(", ")}` : "",
    "",
    existing,
    "",
    `Choose 2 or 3 tags for this paper. A tag names a broad subject area that the paper is ` +
      `substantially about, broad enough to fit many papers. Reuse an existing tag only if this ` +
      `paper is substantially about that subject, not merely adjacent or loosely related to it. ` +
      `If no existing tag fits, create a new lowercase kebab-case tag, but if an existing tag is ` +
      `a close synonym of the one you would create, reuse the existing one. Two accurate tags are ` +
      `better than three where the third is a stretch.`,
    "",
    `Reply with only this JSON object, writing each reason before its tag: ` +
      `{"tags": [{"reason": "one short sentence on what in the paper makes it substantially ` +
      `about this subject", "tag": "..."}]}`,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  try {
    const raw = await callBackend(prefs, {
      systemPrompt:
        "You file academic papers in a research library by choosing tags. " +
        "Reply with a single JSON object and nothing else.",
      documentText: "",
      userMessage,
      maxTokens: 400,
    });
    return parseTags(raw);
  } catch (e: any) {
    // Tags are a nice-to-have; never lose the summary over them.
    Zotero.debug(`[PDF Auto-Summariser] Tagging failed: ${e?.message || e}`);
    return [];
  }
}

export function parseTags(raw: string): string[] {
  const obj = findJsonObject(stripReasoning(raw), (o) => Array.isArray(o.tags));
  const list: unknown[] = obj ? obj.tags : [];
  const names = list.map((t: any) => (typeof t === "string" ? t : t?.tag));
  const tags = names
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.split("/").map(slugify).filter(Boolean).join("/"))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 3);
}

export function parseAnalysis(raw: string): Analysis {
  const text = stripReasoning(raw);
  const obj = findJsonObject(text, (o) => typeof o.summary === "string" && o.summary.trim() !== "");
  if (!obj) {
    // Writing a half-formed JSON object or a model's reasoning into the
    // abstract would be worse than writing nothing, so fail the run.
    if (looksLikeJsonOrReasoning(raw)) {
      throw new Error("Model returned malformed JSON (often truncated or mixed with reasoning)");
    }
    // Small local models sometimes ignore the contract and just write the
    // abstract. Keep that as the summary.
    return {
      summary: text,
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
    tags: [],
    structured: true,
  };
}

// Reasoning models put their thinking in <think> tags, which can contain
// braces of their own. Drop it, including an unclosed block cut off by the
// token limit.
function stripReasoning(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

function looksLikeJsonOrReasoning(raw: string): boolean {
  const t = raw.trim();
  return /^(\{|```|\[)/.test(t) || /<think>/i.test(t) || /"summary"\s*:/.test(t);
}

// Models wrap JSON in fences, add a preamble or a closing note (which may
// contain braces), or emit more than one object. Try each balanced {...} in
// turn and return the first that parses and passes `accept`.
function findJsonObject(text: string, accept: (o: any) => boolean): any | null {
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const end = matchingBrace(text, i);
    if (end === -1) continue;
    try {
      const obj = JSON.parse(text.slice(i, end + 1));
      if (obj && typeof obj === "object" && accept(obj)) return obj;
    } catch {
      /* not JSON; try the next brace */
    }
  }
  return null;
}

// Index of the "}" closing the "{" at `start`, skipping braces inside JSON
// strings; -1 if it never closes (e.g. output truncated at the token limit).
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}" && --depth === 0) {
      return i;
    }
  }
  return -1;
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
