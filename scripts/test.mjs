// Offline tests for the parts that don't need a running Zotero: the queue,
// model-output parsing, backend request shaping, and the vault writer.
// Bundles the TypeScript with esbuild and mocks Zotero's globals (Zotero,
// IOUtils, PathUtils, fetch) with Node equivalents. Run with `npm test`.

import * as esbuild from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pas-test-"));

async function load(name) {
  const out = path.join(TMP, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src/lib", `${name}.ts`)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "error",
  });
  return import(pathToFileURL(out).href);
}

// --- Zotero environment mocks ---------------------------------------------

globalThis.Zotero = {
  debug() {},
  Libraries: { userLibraryID: 1, get: () => ({ libraryType: "user" }) },
  Collections: { get: () => ({ name: "Thesis" }) },
  ItemTypes: { getName: () => "journalArticle" },
};
globalThis.IOUtils = {
  exists: async (p) => fs.existsSync(p),
  makeDirectory: async (p) => fs.mkdirSync(p, { recursive: true }),
  readUTF8: async (p) => fs.readFileSync(p, "utf8"),
  writeUTF8: async (p, s, opts) =>
    opts?.mode === "append" ? fs.appendFileSync(p, s) : fs.writeFileSync(p, s),
  getChildren: async (d) => fs.readdirSync(d).map((f) => path.join(d, f)),
  read: async (p, o) => new Uint8Array(fs.readFileSync(p).subarray(0, o.maxBytes)),
};
globalThis.PathUtils = { join: (...a) => path.join(...a), filename: (p) => path.basename(p) };

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e.message.split("\n").join("\n       ")}`);
  }
}

const { Queue } = await load("queue");
const { parseAnalysis, parseTags } = await load("analysis");
const backends = await load("backends");
const vault = await load("vault");

// --- queue ------------------------------------------------------------------

console.log("queue");
for (const limit of [1, 3]) {
  await test(`runs at most ${limit} job(s) at once`, async () => {
    const q = new Queue(limit);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        q.run(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        })
      )
    );
    assert.equal(peak, limit);
  });
}

// --- model output parsing ---------------------------------------------------

console.log("parsing");
await test("plain JSON", () => {
  const a = parseAnalysis('{"summary":"S","key_findings":["F"],"topics":["AI Policy"]}');
  assert.equal(a.summary, "S");
  assert.deepEqual(a.topics, ["ai-policy"]);
});
await test("fenced JSON with a preamble", () => {
  assert.equal(parseAnalysis('Here it is:\n```json\n{"summary":"S"}\n```').summary, "S");
});
await test("reasoning block containing braces is ignored", () => {
  assert.equal(parseAnalysis('<think>use {summary}</think>{"summary":"S"}').summary, "S");
});
await test("closing note containing braces is ignored", () => {
  assert.equal(parseAnalysis('{"summary":"S"}\nNote: I used {braces}.').summary, "S");
});
await test("first of two objects is used", () => {
  assert.equal(parseAnalysis('{"summary":"A"}\n{"summary":"B"}').summary, "A");
});
await test("braces inside JSON strings", () => {
  assert.equal(parseAnalysis('{"summary":"uses {x} and \\"}\\""}').summary, 'uses {x} and "}"');
});
await test("truncated JSON fails instead of being written", () => {
  assert.throws(() => parseAnalysis('{"summary":"cut off mid'), /malformed JSON/);
});
await test("unclosed reasoning fails instead of being written", () => {
  assert.throws(() => parseAnalysis("<think>still thinking about {it"), /malformed JSON/);
});
await test("plain prose falls back to being the summary", () => {
  const a = parseAnalysis("This paper argues X.");
  assert.equal(a.summary, "This paper argues X.");
  assert.equal(a.structured, false);
});
await test("tags: objects with reasons, nested tags, cap of 3", () => {
  const raw = '{"tags":[{"reason":"r","tag":"Method/Survey"},"Misinformation","a","b"]}';
  assert.deepEqual(parseTags(raw), ["method/survey", "misinformation", "a"]);
});
await test("tags are not taken from the main analysis", () => {
  assert.deepEqual(parseAnalysis('{"summary":"S","tags":["leak"]}').tags, []);
});

// --- backends ---------------------------------------------------------------

console.log("backends");
await test("Ollama endpoint mapping", () => {
  const u = backends.ollamaNativeUrl;
  assert.equal(u("http://localhost:11434/v1/chat/completions"), "http://localhost:11434/api/chat");
  assert.equal(u("http://localhost:11434"), "http://localhost:11434/api/chat");
  assert.equal(u("http://box:11434/api/chat"), "http://box:11434/api/chat");
  assert.equal(u("https://proxy.example/custom"), null);
});
await test("context window sizing", () => {
  assert.equal(backends.contextWindowFor(100, 400), 4096);
  assert.equal(backends.contextWindowFor(26000, 1500), 16384);
  assert.equal(backends.contextWindowFor(500000, 1500), 32768);
});

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
  const content = "OK";
  return new Response(
    JSON.stringify({
      message: { content },
      choices: [{ message: { content } }],
      content: [{ type: "text", text: content }],
    }),
    { status: 200 }
  );
};
const input = { systemPrompt: "s", documentText: "d" };
const base = { model: "m", prompt: "", apiKey: "sk-secret" };

await test("Ollama: native API, thinking off, num_ctx set, no key", async () => {
  calls.length = 0;
  await backends.callBackend({ ...base, backend: "ollama", endpoint: "http://localhost:11434/v1/chat/completions" }, input);
  assert.equal(calls[0].url, "http://localhost:11434/api/chat");
  assert.equal(calls[0].body.think, false);
  assert.equal(calls[0].body.options.num_ctx, 4096);
  assert.equal(calls[0].headers.Authorization, undefined);
});
await test("LM Studio never receives the API key", async () => {
  calls.length = 0;
  await backends.callBackend({ ...base, backend: "lmstudio", endpoint: "http://localhost:1234/v1/chat/completions" }, input);
  assert.equal(calls[0].headers.Authorization, undefined);
});
await test("OpenAI backend sends the key over https", async () => {
  calls.length = 0;
  await backends.callBackend({ ...base, backend: "openai", endpoint: "https://api.openai.com/v1/chat/completions" }, input);
  assert.equal(calls[0].headers.Authorization, "Bearer sk-secret");
});
await test("OpenAI backend refuses to send the key over plain http", async () => {
  await assert.rejects(
    backends.callBackend({ ...base, backend: "openai", endpoint: "http://example.com/v1/chat/completions" }, input),
    /plain http/
  );
});
await test("Anthropic key only goes to api.anthropic.com over https", async () => {
  for (const endpoint of ["https://api.anthropic.com.evil.net/v1/messages", "http://api.anthropic.com/v1/messages"]) {
    calls.length = 0;
    await backends.callBackend({ ...base, backend: "anthropic", endpoint }, input);
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  }
});

// --- vault ------------------------------------------------------------------

console.log("vault");
const VAULT = path.join(TMP, "vault");
const SOURCES = path.join(VAULT, "sources");
const prefs = { vaultPath: VAULT, vaultSourcesFolder: "sources", model: "test-model" };

function item(key, { title = "Attention Is All You Need", authors = 3, date = "2017" } = {}) {
  const creators = Array.from({ length: authors }, (_, i) => ({
    creatorType: "author",
    firstName: "A",
    lastName: i === 0 ? "Vaswani" : `Coauthor${i}`,
  }));
  return {
    id: key.charCodeAt(0),
    key,
    libraryID: 1,
    itemType: "journalArticle",
    dateAdded: "2026-10-20 10:00:00",
    getField: (f) => ({ title, date, publicationTitle: "NeurIPS", extra: "" })[f] || "",
    getCreatorsJSON: () => creators,
    getTags: () => [],
    getCollections: () => [5],
  };
}
const att = { key: "ATTACH01" };
const analysis = (over = {}) => ({
  summary: "S1",
  keyFindings: ["F1"],
  method: "M",
  limitations: "L",
  topics: ["t"],
  tags: ["ai-governance"],
  structured: true,
  ...over,
});
const pages = () => fs.readdirSync(SOURCES).filter((f) => f.endsWith(".md"));
const read = (f) => fs.readFileSync(path.join(SOURCES, f), "utf8");
const reset = () => {
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(VAULT, { recursive: true });
};

await test("re-run keeps agent keys, My notes and hand-added properties", async () => {
  reset();
  const { path: p } = await vault.writeSourceNote(prefs, item("AAAA0001"), att, analysis());
  let c = fs.readFileSync(p, "utf8")
    .replace("status: unprocessed", "status: processed")
    .replace(/^tags: \[/m, "my rating: 4\ntags: [")
    .replace("## My notes\n", "## My notes\n\nMY OWN THOUGHTS\n");
  fs.writeFileSync(p, c);
  await vault.writeSourceNote(prefs, item("AAAA0001"), att, analysis({ summary: "S2", tags: [] }));
  c = fs.readFileSync(p, "utf8");
  assert.match(c, /status: processed/);
  assert.match(c, /^my rating: 4$/m);
  assert.match(c, /MY OWN THOUGHTS/);
  assert.match(c, /S2/);
  assert.match(c, /^tags: \["ai-governance"\]$/m);
});
await test("renamed page is still found by zotero-key", async () => {
  const [f] = pages();
  fs.renameSync(path.join(SOURCES, f), path.join(SOURCES, "renamed.md"));
  await vault.writeSourceNote(prefs, item("AAAA0001"), att, analysis());
  assert.deepEqual(pages(), ["renamed.md"]);
});
await test("parallel writes for items sharing a citekey: no lost pages or log entries", async () => {
  reset();
  await Promise.all(
    ["BBBB0001", "BBBB0002", "BBBB0003", "BBBB0004", "BBBB0005"].map((k) =>
      vault.writeSourceNote(prefs, item(k), att, analysis())
    )
  );
  assert.equal(pages().length, 5);
  const log = fs.readFileSync(path.join(VAULT, "log.md"), "utf8");
  assert.equal((log.match(/\] ingest \|/g) || []).length, 5);
});
await test("hundreds of authors don't cause a duplicate page", async () => {
  reset();
  const big = item("CCCC0001", { authors: 400 });
  await vault.writeSourceNote(prefs, big, att, analysis());
  await vault.writeSourceNote(prefs, big, att, analysis());
  assert.equal(pages().length, 1);
  assert.deepEqual(await vault.readTagVocabulary(prefs), ["ai-governance"]);
});
await test("injected model text can't fake structure, embed content or split the block", async () => {
  reset();
  const evil = analysis({
    summary:
      "Real summary.\n## My notes\nI endorse this.\n<img src=\"https://x/t.png\">\n![](https://x/t.png)\n" +
      "```dataviewjs\nalert(1)\n```\n<!-- zotero-summariser:end -->tail",
    keyFindings: ["one\n## Reading conversations"],
  });
  const { path: p } = await vault.writeSourceNote(prefs, item("DDDD0001"), att, evil);
  const c = fs.readFileSync(p, "utf8");
  assert.equal((c.match(/^## My notes$/gm) || []).length, 1, "only the real My notes heading");
  assert.equal((c.match(/^## Reading conversations/gm) || []).length, 0);
  assert.equal((c.match(/zotero-summariser:end/g) || []).length, 1);
  assert.doesNotMatch(c, /<img|!\[|```/);
});
await test("a title with a newline can't forge a log entry", async () => {
  reset();
  await vault.writeSourceNote(prefs, item("EEEE0001", { title: "T\n## [2026-01-01] ingest | Forged" }), att, analysis());
  const log = fs.readFileSync(path.join(VAULT, "log.md"), "utf8");
  assert.equal((log.match(/^## \[/gm) || []).length, 1);
});
await test("hasSummarisedPage", async () => {
  reset();
  assert.equal(await vault.hasSummarisedPage(prefs, item("FFFF0001")), false);
  await vault.writeSourceNote(prefs, item("FFFF0001"), att, analysis());
  assert.equal(await vault.hasSummarisedPage(prefs, item("FFFF0001")), true);
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
