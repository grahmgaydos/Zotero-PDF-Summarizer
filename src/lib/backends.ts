// Model backends. Three code paths: Ollama's native chat API, OpenAI-compatible
// (LM Studio, OpenAI, OpenRouter), and the Anthropic Messages API.

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
  /**
   * Replaces the whole paper-framed user message. For follow-up calls that
   * work from the summary rather than the paper text (e.g. tagging).
   */
  userMessage?: string;
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
  if (input.userMessage !== undefined) return input.userMessage;
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
  if (prefs.backend === "ollama") {
    return callOllama(prefs, input, signal);
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

// Ollama's default context window is 4,096 tokens, and it drops overflow from
// the START of the prompt without any error: the system prompt and the
// opening of the paper vanish and the output quietly degrades. Its
// OpenAI-compatible endpoint ignores context options, so we use the native
// /api/chat endpoint and size num_ctx to each request.
async function callOllama(
  prefs: Prefs,
  input: SummariseInput,
  signal?: AbortSignal
): Promise<string> {
  const url = ollamaNativeUrl(prefs.endpoint);
  if (!url) {
    log(
      `Ollama endpoint ${prefs.endpoint} isn't a recognisable Ollama URL; ` +
        `using it as OpenAI-compatible, so the context window can't be set`
    );
    return callOpenAICompatible(prefs, input, signal);
  }

  const user = userContent(input);
  const maxTokens = input.maxTokens ?? 400;
  const numCtx = contextWindowFor(input.systemPrompt.length + user.length, maxTokens);

  const body = {
    model: prefs.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: user },
    ],
    stream: false,
    options: { temperature: 0.2, num_predict: maxTokens, num_ctx: numCtx },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Empty response from model");
  }
  return content.trim();
}

// Map the configured endpoint (normally the OpenAI-style default,
// http://localhost:11434/v1/chat/completions) to Ollama's native chat URL.
// Returns null for URLs we can't map, e.g. a proxy with a custom path.
export function ollamaNativeUrl(endpoint: string): string | null {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return null;
  }
  const path = u.pathname.replace(/\/+$/, "");
  if (path.endsWith("/api/chat")) return u.toString();
  if (path === "" || path.endsWith("/v1/chat/completions") || path.endsWith("/v1")) {
    u.pathname = path.replace(/\/v1(\/chat\/completions)?$/, "") + "/api/chat";
    return u.toString();
  }
  return null;
}

// Conservative: English prose averages about 4 characters per token, so
// dividing by 3 overestimates and leaves headroom.
const CHARS_PER_TOKEN = 3;
const MIN_CONTEXT = 4096;
// Larger windows cost memory; 32k fits a 12B model on a typical Mac.
const MAX_CONTEXT = 32768;

// Rounds up to a power of two so most papers land on the same size. Ollama
// reloads the model whenever num_ctx changes, which costs several seconds.
export function contextWindowFor(promptChars: number, maxTokens: number): number {
  const needed = Math.ceil(promptChars / CHARS_PER_TOKEN) + maxTokens + 256;
  let ctx = MIN_CONTEXT;
  while (ctx < needed && ctx < MAX_CONTEXT) ctx *= 2;
  if (needed > ctx) {
    log(
      `Prompt needs ~${needed} tokens but the context is capped at ${ctx}; ` +
        `Ollama will drop the start of the paper. Lower "Max characters" in settings.`
    );
  }
  return ctx;
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

function log(msg: string): void {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}
