// Research-wiki export. Writes one Markdown source page per Zotero item into
// an Obsidian vault (`<vault>/<sourcesFolder>/<citekey>.md`) and appends to
// the vault's log.md. The vault's CLAUDE.md defines the page format; keep the
// two in sync.
//
// Re-runs are safe: the plugin owns the bibliographic frontmatter keys and the
// text between the markers below. Everything else on the page (agent-owned
// keys like `status`/`topics`, the Connections section, the human's
// "My notes") is preserved.

import type { Analysis } from "./analysis";
import { slugify } from "./analysis";
import type { Prefs } from "./prefs";

const START = "<!-- zotero-summariser:start -->";
const END = "<!-- zotero-summariser:end -->";

// Frontmatter key order. Plugin-owned keys are rewritten on every run;
// the rest are set once on creation and then left to the agent.
const KEY_ORDER = [
  "type", "title", "authors", "year", "item-type", "venue", "doi", "url",
  "citekey", "zotero-key", "zotero-link", "pdf-link", "zotero-tags",
  "collections", "suggested-topics", "model", "added",
  "status", "topics", "projects", "created", "updated", "tags",
];
const AGENT_KEYS = new Set(["status", "topics", "projects", "created", "tags"]);

const VENUE_FIELDS = [
  "publicationTitle", "proceedingsTitle", "bookTitle", "websiteTitle",
  "blogTitle", "forumTitle", "publisher", "institution", "university",
];

const STOPWORDS = new Set([
  "a", "an", "the", "of", "on", "in", "for", "and", "to", "from", "with",
  "by", "at", "is", "are", "towards", "toward",
]);

interface ItemMeta {
  title: string;
  authors: string[];
  shortAuthors: string;
  year: string;
  itemType: string;
  venue: string;
  doi: string;
  url: string;
  citekey: string;
  zoteroKey: string;
  zoteroLink: string;
  pdfLink: string;
  zoteroTags: string[];
  collections: string[];
  added: string;
}

export interface VaultWriteResult {
  path: string;
  created: boolean;
}

export async function writeSourceNote(
  prefs: Prefs,
  parentItem: any,
  attachmentItem: any,
  analysis: Analysis
): Promise<VaultWriteResult> {
  const { vault, folder, dir } = await sourcesDir(prefs);
  await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });

  const meta = readMeta(parentItem, attachmentItem);
  const today = localDate();

  const existingPath = await findExisting(dir, meta.citekey, meta.zoteroKey);
  const path =
    existingPath ?? (await freePath(dir, meta.citekey, meta.zoteroKey));
  const existing = existingPath ? await IOUtils.readUTF8(existingPath) : null;

  const content = renderNote(meta, analysis, prefs.model, today, existing);
  await IOUtils.writeUTF8(path, content);

  const linkTarget = `${folder}/${PathUtils.filename(path).replace(/\.md$/, "")}`;
  await appendLog(vault, meta, linkTarget, prefs.model, today, !existing);

  return { path, created: !existing };
}

// The tags already on source pages, most used first. Passed to the model so
// it reuses the vault's vocabulary instead of coining near-synonyms.
export async function readTagVocabulary(prefs: Prefs, limit = 150): Promise<string[]> {
  const { dir } = await sourcesDir(prefs);
  if (!(await IOUtils.exists(dir))) return [];

  const counts = new Map<string, number>();
  for (const child of await IOUtils.getChildren(dir)) {
    if (!child.endsWith(".md")) continue;
    const { blocks } = splitFrontmatter(await readHead(child));
    for (const tag of parseList(blocks.get("tags"))) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

async function sourcesDir(prefs: Prefs): Promise<{ vault: string; folder: string; dir: string }> {
  const vault = expandHome(prefs.vaultPath.trim());
  if (!vault) throw new Error("Research wiki: no vault path set in settings");
  if (!(await IOUtils.exists(vault))) {
    throw new Error(`Research wiki: vault folder not found: ${vault}`);
  }
  const folder = prefs.vaultSourcesFolder.trim().replace(/^\/+|\/+$/g, "") || "sources";
  return { vault, folder, dir: PathUtils.join(vault, ...folder.split("/")) };
}

// ---------------------------------------------------------------------------
// Zotero metadata

function readMeta(item: any, attachment: any): ItemMeta {
  const field = (name: string): string => {
    try {
      return String(item.getField(name) || "").trim();
    } catch {
      return "";
    }
  };
  const extra = field("extra");

  const creators: any[] = item.getCreatorsJSON?.() ?? [];
  const primary = creators.filter((c) => c.creatorType === "author");
  const people = primary.length ? primary : creators;
  const authors = people.map((c) =>
    c.name ? c.name : [c.lastName, c.firstName].filter(Boolean).join(", ")
  );
  const surnames = people.map((c) => c.lastName || c.name || "").filter(Boolean);

  const year = (field("date").match(/\b(\d{4})\b/) || [])[1] || "";
  const title = field("title") || "(untitled)";

  let venue = "";
  for (const f of VENUE_FIELDS) {
    venue = field(f);
    if (venue) break;
  }

  const doi = field("DOI") || extraValue(extra, "DOI");

  const lib = Zotero.Libraries.get(item.libraryID);
  const libPath =
    lib && lib.libraryType === "group" ? `groups/${lib.groupID}` : "library";

  const collections = (item.getCollections?.() ?? [])
    .map((id: number) => Zotero.Collections.get(id)?.name)
    .filter(Boolean);

  return {
    title,
    authors,
    shortAuthors: shortAuthorList(surnames),
    year,
    itemType: item.itemType || Zotero.ItemTypes.getName(item.itemTypeID) || "",
    venue,
    doi,
    url: field("url"),
    citekey: citekeyFor(item, extra, surnames[0], year, title),
    zoteroKey: item.key,
    zoteroLink: `zotero://select/${libPath}/items/${item.key}`,
    pdfLink: `zotero://open-pdf/${libPath}/items/${attachment.key}`,
    zoteroTags: (item.getTags?.() ?? []).map((t: any) => t.tag),
    collections,
    added: String(item.dateAdded || "").slice(0, 10),
  };
}

// Prefer the Better BibTeX key so filenames match [@citekey] citations in
// writing; fall back to a readable surname-year-words slug.
function citekeyFor(
  item: any,
  extra: string,
  surname: string | undefined,
  year: string,
  title: string
): string {
  let key = "";
  try {
    key = Zotero.BetterBibTeX?.KeyManager?.get(item.id)?.citationKey || "";
  } catch {
    /* BBT not installed or API changed */
  }
  if (!key) {
    try {
      key = item.getField("citationKey") || "";
    } catch {
      /* field not in this Zotero version */
    }
  }
  if (!key) key = extraValue(extra, "Citation Key");
  if (key) return key.replace(/[\\/:*?"<>|]/g, "-");

  const words = slugify(title)
    .split("-")
    .filter((w) => w && !STOPWORDS.has(w))
    .slice(0, 3);
  return [slugify(surname || "anon"), year || "nd", ...words].join("-");
}

function extraValue(extra: string, label: string): string {
  const re = new RegExp(`^${label}:\\s*(.+)$`, "im");
  return (extra.match(re) || [])[1]?.trim() || "";
}

function shortAuthorList(surnames: string[]): string {
  if (surnames.length === 0) return "Unknown author";
  if (surnames.length === 1) return surnames[0];
  if (surnames.length === 2) return `${surnames[0]} and ${surnames[1]}`;
  return `${surnames[0]} et al.`;
}

// ---------------------------------------------------------------------------
// Locating the page

// A page belongs to an item by its `zotero-key`, not its filename, so a page
// survives a citekey change or a manual rename.
async function findExisting(
  dir: string,
  citekey: string,
  zoteroKey: string
): Promise<string | null> {
  const preferred = PathUtils.join(dir, `${citekey}.md`);
  if ((await IOUtils.exists(preferred)) && (await keyOf(preferred)) === zoteroKey) {
    return preferred;
  }
  for (const child of await IOUtils.getChildren(dir)) {
    if (!child.endsWith(".md") || child === preferred) continue;
    if ((await keyOf(child)) === zoteroKey) return child;
  }
  return null;
}

async function freePath(dir: string, citekey: string, zoteroKey: string): Promise<string> {
  const preferred = PathUtils.join(dir, `${citekey}.md`);
  if (!(await IOUtils.exists(preferred))) return preferred;
  return PathUtils.join(dir, `${citekey}-${zoteroKey.toLowerCase()}.md`);
}

// Frontmatter sits at the top of the file; don't read whole pages to scan it.
async function readHead(path: string): Promise<string> {
  try {
    const bytes = await IOUtils.read(path, { maxBytes: 8192 });
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

async function keyOf(path: string): Promise<string | null> {
  try {
    const head = await readHead(path);
    const m = head.match(/^zotero-key:\s*"?([A-Z0-9]+)"?\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rendering

function renderNote(
  meta: ItemMeta,
  analysis: Analysis,
  model: string,
  today: string,
  existing: string | null
): string {
  const fresh: Record<string, string> = {
    type: "source",
    title: q(meta.title),
    authors: list(meta.authors),
    year: meta.year,
    "item-type": meta.itemType,
    venue: meta.venue ? q(meta.venue) : "",
    doi: meta.doi ? q(meta.doi) : "",
    url: meta.url ? q(meta.url) : "",
    citekey: q(meta.citekey),
    "zotero-key": meta.zoteroKey,
    "zotero-link": q(meta.zoteroLink),
    "pdf-link": q(meta.pdfLink),
    "zotero-tags": list(meta.zoteroTags),
    collections: list(meta.collections),
    "suggested-topics": list(analysis.topics),
    model: q(model),
    added: meta.added,
    status: "unprocessed",
    topics: "[]",
    projects: "[]",
    created: today,
    updated: today,
    tags: list(analysis.tags),
  };

  const block = renderBlock(meta, analysis, model, today);

  if (!existing) {
    return (
      frontmatter(KEY_ORDER.map((k) => line(k, fresh[k]))) +
      `\n${block}\n\n## Connections\n\n` +
      `*(Agent-maintained: the topics and projects this source bears on, and what it agrees or disagrees with.)*\n\n` +
      `## My notes\n\n`
    );
  }

  const { blocks, body } = splitFrontmatter(existing);
  // Agent-owned keys survive re-runs, except that empty `tags` get filled:
  // pages written before auto-tagging, or where the model returned none.
  const keep = (k: string) =>
    AGENT_KEYS.has(k) && blocks.has(k) && !(k === "tags" && parseList(blocks.get(k)).length === 0);
  const merged = KEY_ORDER.map((k) => (keep(k) ? blocks.get(k)! : line(k, fresh[k])));
  for (const [k, raw] of blocks) {
    if (!KEY_ORDER.includes(k)) merged.push(raw);
  }

  let newBody: string;
  const s = body.indexOf(START);
  const e = body.indexOf(END);
  if (s !== -1 && e > s) {
    newBody = body.slice(0, s) + block + body.slice(e + END.length);
  } else {
    // Markers were removed by hand; put a fresh block on top rather than
    // guessing which of the existing text is ours.
    newBody = `\n${block}\n${body}`;
  }
  return frontmatter(merged) + newBody;
}

function renderBlock(meta: ItemMeta, a: Analysis, model: string, today: string): string {
  const year = meta.year || "n.d.";
  const venue = meta.venue ? `, *${meta.venue}*` : "";
  const parts: string[] = [
    START,
    `# ${meta.title}`,
    "",
    `Source page for ${meta.shortAuthors} (${year})${venue}. Generated from Zotero by PDF Auto-Summariser on ${today} using ${model}; everything between the zotero-summariser markers is regenerated on each run.`,
    "",
    `[Open in Zotero](${meta.zoteroLink}) · [Open PDF](${meta.pdfLink})`,
    "",
    "## Summary",
    "",
    a.summary,
  ];
  if (a.keyFindings.length) {
    parts.push("", "## Key findings", "", ...a.keyFindings.map((f) => `- ${f}`));
  }
  if (a.method) parts.push("", "## Method", "", a.method);
  if (a.limitations) parts.push("", "## Limitations", "", a.limitations);
  parts.push("", "## Citation", "", citation(meta), END);
  return parts.join("\n");
}

function citation(meta: ItemMeta): string {
  const authors = meta.authors.length ? meta.authors.join("; ") : "Unknown author";
  const venue = meta.venue ? ` *${meta.venue}*.` : "";
  const link = meta.doi
    ? ` https://doi.org/${meta.doi}`
    : meta.url
      ? ` ${meta.url}`
      : "";
  return `${authors} (${meta.year || "n.d."}). ${meta.title}.${venue}${link}`;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers. Values are emitted as JSON, which is valid YAML, so we
// don't need a YAML library for writing. For merging we only need to split
// the existing frontmatter into top-level key blocks, not parse it.

function frontmatter(lines: string[]): string {
  return `---\n${lines.join("\n")}\n---\n`;
}

function line(key: string, value: string): string {
  return value ? `${key}: ${value}` : `${key}:`;
}

function q(s: string): string {
  return JSON.stringify(s);
}

function list(xs: string[]): string {
  return `[${xs.map(q).join(", ")}]`;
}

function splitFrontmatter(text: string): { blocks: Map<string, string>; body: string } {
  const blocks = new Map<string, string>();
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { blocks, body: `\n${text}` };

  let current: string | null = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const k = raw.match(/^([A-Za-z0-9_-]+):/);
    if (k) {
      current = k[1];
      blocks.set(current, raw);
    } else if (current) {
      blocks.set(current, `${blocks.get(current)}\n${raw}`);
    }
  }
  return { blocks, body: text.slice(m[0].length) };
}

// Reads a YAML list from a raw key block in either flow (`tags: [a, "b"]`) or
// block (`tags:\n  - a`) style. Enough for the lists this vault uses.
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  const value = raw.split(/\r?\n/)[0].replace(/^[^:]*:/, "").trim();
  let items: string[];
  if (value.startsWith("[")) {
    items = value.replace(/^\[|\]$/g, "").split(",");
  } else if (value) {
    items = [value];
  } else {
    items = raw
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-"))
      .map((l) => l.slice(1));
  }
  return items
    .map((x) => x.trim().replace(/^["']|["']$/g, "").replace(/^#/, "").trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// log.md

async function appendLog(
  vault: string,
  meta: ItemMeta,
  linkTarget: string,
  model: string,
  today: string,
  created: boolean
): Promise<void> {
  const logPath = PathUtils.join(vault, "log.md");
  const op = created ? "ingest" : "update";
  const what = created
    ? `Source page [[${linkTarget}]] created by the Zotero plugin (${model}). Status: unprocessed.`
    : `Plugin block on [[${linkTarget}]] regenerated by the Zotero plugin (${model}).`;
  const entry = `\n## [${today}] ${op} | ${meta.shortAuthors} (${meta.year || "n.d."}): ${meta.title}\n${what}\n`;

  let current = "";
  if (await IOUtils.exists(logPath)) current = await IOUtils.readUTF8(logPath);
  else current = "# Log — research\n";
  await IOUtils.writeUTF8(logPath, current.replace(/\s*$/, "\n") + entry);
}

// ---------------------------------------------------------------------------

function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    return home + p.slice(1);
  }
  return p;
}

function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
