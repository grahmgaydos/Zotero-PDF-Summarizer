// PDF text extraction. We use Zotero's own full-text index because (a) it's
// already there for any indexed item, and (b) it sidesteps having to ship a
// PDF parser in our plugin. The catch is that fresh imports may not be
// indexed yet, so we poll briefly.

export async function getPdfText(
  attachmentItem: any,
  maxChars: number,
  waitSeconds: number
): Promise<string> {
  const itemID = attachmentItem.id;
  const start = Date.now();
  const deadline = start + waitSeconds * 1000;

  let text = "";
  while (Date.now() < deadline) {
    try {
      // Returns { content, totalPages, indexedPages } for indexed PDFs.
      const result = await Zotero.Fulltext.getIndexedState(itemID);
      const hasContent =
        result === Zotero.Fulltext.INDEX_STATE_INDEXED ||
        result === Zotero.Fulltext.INDEX_STATE_PARTIAL;

      if (hasContent) {
        text = await Zotero.Fulltext.getItemContent(itemID);
        if (text && text.length > 0) break;
      }
    } catch {
      // Fall through to retry.
    }

    // Trigger indexing if it hasn't started.
    try {
      await Zotero.Fulltext.indexItems([itemID], false);
    } catch {
      // Ignore; we'll keep polling.
    }

    await sleep(1000);
  }

  if (!text) {
    throw new Error(
      "Could not extract text from PDF (full-text index empty after wait)"
    );
  }

  return trimForModel(text, maxChars);
}

// Take the first portion plus a tail. Most academic papers front-load the
// abstract/intro and back-load the conclusion; the middle is methods detail
// and citations that contribute less to a summary.
function trimForModel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars - 100; // 100 chars for separator
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  return `${head}\n\n[... middle of document elided ...]\n\n${tail}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
