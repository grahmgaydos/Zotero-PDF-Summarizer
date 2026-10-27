// Typed accessor over Zotero.Prefs for our preference branch.

const BRANCH = "extensions.pdf-auto-summariser";

export type Backend = "ollama" | "lmstudio" | "openai" | "anthropic";
export type OnExisting = "skip" | "ask" | "overwrite";

export interface Prefs {
  backend: Backend;
  endpoint: string;
  model: string;
  apiKey: string;
  maxChars: number;
  autoOnAdd: boolean;
  onExistingAbstract: OnExisting;
  concurrency: number;
  indexWaitSeconds: number;
  prompt: string;
}

export function getPrefs(): Prefs {
  const get = (k: string, def?: any) => {
    try {
      const v = Zotero.Prefs.get(`${BRANCH}.${k}`, true);
      return v === undefined || v === null ? def : v;
    } catch {
      return def;
    }
  };

  return {
    backend: (get("backend", "ollama") as Backend),
    endpoint: get("endpoint", "http://localhost:11434/v1/chat/completions"),
    model: get("model", "llama3.1:8b"),
    apiKey: get("apiKey", ""),
    maxChars: Number(get("maxChars", 24000)),
    autoOnAdd: Boolean(get("autoOnAdd", true)),
    onExistingAbstract: (get("onExistingAbstract", "ask") as OnExisting),
    concurrency: Number(get("concurrency", 1)),
    indexWaitSeconds: Number(get("indexWaitSeconds", 15)),
    prompt: get(
      "prompt",
      "Summarise this academic paper in 3-4 sentences. Output the summary only."
    ),
  };
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  Zotero.Prefs.set(`${BRANCH}.${String(key)}`, value as any, true);
}
