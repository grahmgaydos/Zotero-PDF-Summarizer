# Zotero PDF Auto-Summariser

A Zotero 7 plugin that automatically generates an abstract for newly added PDFs and writes it to the item's `Abstract` field. Backed by a local model (Ollama / LM Studio) by default; configurable to use Anthropic, OpenAI, or OpenRouter.

## What it does

When a PDF attachment is added under a regular item (book, journal article, report, etc.), the plugin:

1. Waits briefly for Zotero's full-text indexer to extract the PDF text.
2. Sends a trimmed extract (head + tail, by default ~24k characters) to your configured model with a customisable summarisation prompt.
3. Writes the result to the parent item's `Abstract` field and saves.

If the abstract is already populated (e.g. Crossref supplied one on import), the plugin asks before overwriting by default. Configurable to skip or always overwrite. A right-click "Summarise with AI" item-menu entry lets you re-run on demand against any item with a PDF attachment.

## Research wiki (Obsidian) export

Optionally, the plugin also writes a source page for each paper into an Obsidian vault, for an LLM-maintained research wiki. The model call returns structured JSON (summary, key findings, method, limitations, suggested topics). The summary goes to the `Abstract` field as before, and everything goes into `<vault>/sources/<citekey>.md` with frontmatter pulled from Zotero (authors, year, venue, DOI, tags, collections, `zotero://` links). The plugin also appends an entry to the vault's `log.md`.

- **Enable**: Settings → PDF Auto-Summariser → *Research wiki (Obsidian)*. Set the vault folder (e.g. `~/Documents/research-wiki`).
- **Backfill**: select items → right-click → **Add to research wiki**. This writes the page and only fills the abstract if it's empty.
- **Auto-tags**: each new page gets 2-3 tags in its `tags` frontmatter. The model is shown every tag already used in the vault's `sources/` and told to reuse them, so the vocabulary stays consistent and you steer it by editing tags in the vault. Re-runs only fill `tags` if it is empty.
- **Re-runs are safe**: pages are matched by Zotero item key, so renames are fine. Only the bibliographic frontmatter and the text between the `zotero-summariser` markers are regenerated. `status`, `topics`, `projects`, the *Connections* section and *My notes* are preserved.
- **Filenames** use the Better BibTeX citekey when installed, otherwise `surname-year-title-words`.
- If a small local model ignores the JSON format, the plugin falls back to using the whole reply as the summary.

The vault's own `CLAUDE.md` defines the page schema and the workflow an agent follows to work new sources into topic pages.

## Install (end users)

1. Download the latest `pdf-auto-summariser-<version>.xpi` from the [releases page](https://github.com/grahmgaydos/Zotero-PDF-Summarizer/releases).
2. In Zotero: **Tools → Plugins → ⚙ → Install Plugin From File…** → select the `.xpi`.
3. Restart Zotero.
4. Open **Edit → Settings → PDF Auto-Summariser** to configure the backend.

### Default backend (Ollama)

The defaults assume Ollama is running locally on its standard port. To get started:

```sh
brew install ollama        # or download from ollama.com
ollama serve               # in one terminal
ollama pull llama3.1:8b    # in another
```

The plugin will then work without any configuration changes. Click **Test connection** in the prefs pane to verify.

### Switching to LM Studio

In the prefs pane:
- **Backend**: LM Studio
- **Endpoint**: `http://localhost:1234/v1/chat/completions`
- **Model**: whatever you've loaded in LM Studio (its UI shows the model name)
- **API key**: leave blank

### Switching to Anthropic

- **Backend**: Anthropic
- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **Model**: e.g. `claude-sonnet-4-5` (check the Anthropic docs for current model names)
- **API key**: your `sk-ant-…` key

### Switching to OpenAI or OpenRouter

- **Backend**: OpenAI / OpenRouter
- **Endpoint**: `https://api.openai.com/v1/chat/completions` or `https://openrouter.ai/api/v1/chat/completions`
- **Model**: e.g. `gpt-4o-mini` or any OpenRouter model slug
- **API key**: your key

## Development

```sh
git clone https://github.com/grahmgaydos/Zotero-PDF-Summarizer.git
cd Zotero-PDF-Summarizer
npm install
npm run build        # one-shot bundle
npm run watch        # rebuild on changes
npm run typecheck    # tsc --noEmit
npm run package      # produces dist/pdf-auto-summariser-<version>.xpi
```

### Hot reload during development

The fastest dev loop is to point Zotero at the unpacked `addon/` directory: (`scripts/dev-link.sh link` does steps 2–3 for you, backing up any installed `.xpi`; `scripts/dev-link.sh unlink` restores it):

1. Find your Zotero profile directory (Help → Troubleshooting Information → Profile Directory in Zotero).
2. In that directory, find `extensions/` (create it if absent).
3. Create a file named `pdf-auto-summariser@grahmgaydos.dev` (no extension) containing the absolute path to your local `addon/` folder.
4. Start Zotero with `-purgecaches`. It will load the plugin from your working copy.
5. After making code changes, run `npm run build`, then restart Zotero (or use the "Restart with logging" entry in the developer pane).

Logs go to **Help → Debug Output Logging**; filter for `[PDF Auto-Summariser]`.

## Releasing an update

Installed copies check `update.json` on `main` (the `update_url` in `addon/manifest.json`) and install any newer version listed there. Pushing code alone doesn't update anyone.

1. Bump `version` in both `package.json` and `addon/manifest.json`.
2. `npm run package`. This builds `dist/pdf-auto-summariser-<version>.xpi` and adds the version to `update.json`, with the file's SHA-256 hash.
3. On GitHub, publish a release tagged `v<version>` and attach **that exact** `.xpi`. Rebuilding changes the hash.
4. Commit and push `update.json` (plus the version bumps). Push only after the release is live, because `update.json` links to the release's file.

## How it works (architecture)

```
addon/
├─ manifest.json          # Zotero 7 plugin manifest
├─ bootstrap.js           # lifecycle entry — loaded directly by Zotero
├─ prefs.js               # default preference values
├─ content/
│  ├─ index.js            # bundled output of src/ (built, gitignored)
│  ├─ prefs.xhtml         # preference pane UI
│  └─ prefs-page.js       # prefs pane glue (Test Connection button)
└─ locale/en-US/
   └─ pdf-auto-summariser.ftl

src/
├─ index.ts               # main entry — registers prefs pane, notifier, menu
├─ types.d.ts             # ambient Zotero declarations
└─ lib/
   ├─ prefs.ts            # typed accessor over Zotero.Prefs
   ├─ backends.ts         # OpenAI-compatible + Anthropic Messages
   ├─ pdf.ts              # PDF text extraction via Zotero.Fulltext
   ├─ queue.ts            # concurrency limiter (bulk-import safety)
   ├─ analysis.ts         # structured JSON analysis (summary, findings, topics)
   ├─ summarise.ts        # orchestrates extraction → model → write-back
   ├─ vault.ts            # Obsidian research-wiki source pages + log.md
   ├─ notifier.ts         # Zotero.Notifier observer on attachment adds
   └─ menu.ts             # right-click "Summarise with AI" / "Add to research wiki"
```

### Why bootstrapped, not WebExtension?

Zotero 7 is built on Firefox 115 but plugins use Mozilla's older bootstrapped (non-restartable) extension model, not the WebExtension `background.js` model. The entry point is `bootstrap.js` with `install` / `startup` / `shutdown` / `uninstall` functions, and `manifest.json` declares an `applications.zotero` block instead of `background` or `permissions`.

### Backend abstraction

Ollama, LM Studio, OpenAI, and OpenRouter all speak the OpenAI Chat Completions schema, so one code path handles them. Only the endpoint, model name, and API key differ. Anthropic uses its own Messages API (system prompt as a top-level field, `max_tokens` required, `content` as a block array) and gets its own function.

### Full-text source

Rather than ship a PDF parser, the plugin reads `Zotero.Fulltext.getItemContent(attachmentID)`. Zotero already indexes PDFs for its own search; we piggyback on that. For freshly added items the indexer may not have finished, so the extraction step polls for up to `indexWaitSeconds` (default 8) before giving up.

## Caveats

- **Abstract clobbering**: the default `Ask via toast` mode prompts before overwriting an existing abstract. If you set it to `Always overwrite`, do so with intent — a Crossref-supplied abstract is generally more authoritative than an LLM paraphrase.
- **Bulk imports**: the queue defaults to concurrency 1 so a 200-PDF drag doesn't fan out to 200 simultaneous model calls. Raise it in prefs if you have headroom.
- **Linked PDFs**: only stored attachments get summarised. Linked URLs are skipped (no text to extract).
- **Non-English papers**: the default prompt is English. Adjust the prompt in prefs to set your target language.
- **API key storage**: keys are saved in Zotero's plaintext prefs file. Fine for personal use; do not commit a profile to git.

## License

MIT. See `LICENSE`.
