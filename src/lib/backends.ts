// Model backends. Two code paths: OpenAI-compatible (covers Ollama, LM Studio,
// OpenAI, OpenRouter) and Anthropic Messages API.

import type { Prefs } from "./prefs";

export interface SummariseInput {
  systemPrompt: string;
  documentText: string;
  itemTitle?: string;
  /**
   * The closing instruction placed after the paper text. Defaults to the
   * plain-abstract task; structured analysis passes its own.
   */
  task?: string;
  /** Upper bound on response length. Structured analysis needs more room than a bare abstract. */
  maxTokens?: number;
}

const ABSTRACT_TASK =
  `Now write the abstract for the paper above. Output only the abstract — ` +
  `do not introduce it, evaluate it, comment on it, ask follow-up questions, ` +
  `or add any text before or after it.`;

// The user message structure matters more than people expect on smaller
// models. Delimiters like "--- BEGIN PAPER TEXT ---" can cue the model to
// treat the input as a draft for review rather than source material to
// summarise. We avoid framing markers and put the explicit task last so
// it's the most salient instruction the model sees.
function userContent(input: SummariseInput): string {
  return (
    `Below is the full text of an academic paper titled "${input.itemTitle ?? "(unknown)"}". ` +
    (input.task ? `Read it, then do the task that follows.\n\n` : `Read it, then write the abstract.\n\n`) +
    `${input.documentText}\n\n` +
    (input.task ?? ABSTRACT_TASK)
  );
}

export async function callBackend(
  prefs: Prefs,
  input: SummariseInput,
  signal?: AbortSignal
): Promise<string> {
  if (prefs.backend === "anthropic") {
    return callAnthropic(prefs, input, signal);
  }
  return callOpenAICompatible(prefs, input, signal);
}

// Used by the prefs pane's Test Connection button. Sends a tiny ping.
export async function testConnection(prefs: Prefs): Promise<boolean> {
  const out = await callBackend(prefs, {
    systemPrompt: "You reply with a single word: OK.",
    documentText: "Say OK.",
    itemTitle: "test",
  });
  return typeof out === "string" && out.length > 0;
}

async function callOpenAICompatible(
  prefs: Prefs,
  input: SummariseInput,
  signal?: AbortSignal
): Promise<string> {
  const body: any = {
    model: prefs.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userContent(input) },
    ],
    temperature: 0.2,
    max_tokens: input.maxTokens ?? 400,
    stream: false,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (prefs.apiKey) {
    headers["Authorization"] = `Bearer ${prefs.apiKey}`;
  }

  const res = await fetch(prefs.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Empty response from model");
  }
  return content.trim();
}

async function callAnthropic(
  prefs: Prefs,
  input: SummariseInput,
  signal?: AbortSignal
): Promise<string> {
  if (!prefs.apiKey) {
    throw new Error("Anthropic backend requires an API key");
  }

  // Default endpoint if user left the OpenAI-shaped default in place.
  const url = prefs.endpoint.includes("api.anthropic.com")
    ? prefs.endpoint
    : "https://api.anthropic.com/v1/messages";

  const body = {
    model: prefs.model,
    max_tokens: input.maxTokens ?? 400,
    system: input.systemPrompt,
    messages: [{ role: "user", content: userContent(input) }],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": prefs.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const blocks = data?.content;
  if (!Array.isArray(blocks)) {
    throw new Error("Unexpected Anthropic response shape");
  }
  const text = blocks
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Empty response from Anthropic");
  return text;
}
