// Model backends. Two code paths: OpenAI-compatible (covers Ollama, LM Studio,
// OpenAI, OpenRouter) and Anthropic Messages API.

import type { Prefs } from "./prefs";

export interface SummariseInput {
  systemPrompt: string;
  documentText: string;
  itemTitle?: string;
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
  const userContent =
    `Title: ${input.itemTitle ?? "(unknown)"}\n\n` +
    `--- BEGIN PAPER TEXT ---\n${input.documentText}\n--- END PAPER TEXT ---`;

  const body: any = {
    model: prefs.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
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

  const userContent =
    `Title: ${input.itemTitle ?? "(unknown)"}\n\n` +
    `--- BEGIN PAPER TEXT ---\n${input.documentText}\n--- END PAPER TEXT ---`;

  // Default endpoint if user left the OpenAI-shaped default in place.
  const url = prefs.endpoint.includes("api.anthropic.com")
    ? prefs.endpoint
    : "https://api.anthropic.com/v1/messages";

  const body = {
    model: prefs.model,
    max_tokens: 1024,
    system: input.systemPrompt,
    messages: [{ role: "user", content: userContent }],
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
