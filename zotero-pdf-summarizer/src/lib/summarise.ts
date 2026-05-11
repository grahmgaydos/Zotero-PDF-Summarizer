// Core summarisation flow. Decides whether to run on a given item, pulls
// text, calls the backend, and writes the result back to abstractNote.

import { callBackend } from "./backends";
import { getPdfText } from "./pdf";
import type { Prefs } from "./prefs";
import { getPrefs } from "./prefs";
import { Queue } from "./queue";

const queue = new Queue(1);

export function setQueueConcurrency(n: number): void {
  queue.setConcurrency(n);
}

type Decision = "proceed" | "ask" | "skip";

export interface SummariseOptions {
  /** Force-run regardless of prefs (right-click menu path). */
  force?: boolean;
  /** Skip the toast; just overwrite if needed. */
  silent?: boolean;
}

export async function summariseAttachment(
  attachmentItem: any,
  opts: SummariseOptions = {}
): Promise<void> {
  const prefs = getPrefs();

  // Walk up to the parent regular item (book, journalArticle, etc.).
  const parentItem = await getParentItem(attachmentItem);
  if (!parentItem) {
    log(`No parent item for attachment ${attachmentItem.id}; skipping`);
    return;
  }

  const existing = (parentItem.getField("abstractNote") || "").trim();
  const decision = decide(prefs, existing, opts);

  if (decision === "skip") return;

  if (decision === "ask") {
    const replace = await confirmReplace(parentItem.getField("title"));
    if (!replace) return;
  }

  await queue.run(() => runSummarise(attachmentItem, parentItem, prefs));
}

function decide(prefs: Prefs, existing: string, opts: SummariseOptions): Decision {
  if (opts.force) return "proceed";
  if (!existing) return "proceed";
  if (opts.silent) {
    // Manual silent path treats existing as overwrite intent.
    return "proceed";
  }
  switch (prefs.onExistingAbstract) {
    case "skip":
      return "skip";
    case "overwrite":
      return "proceed";
    case "ask":
    default:
      return "ask";
  }
}

async function runSummarise(
  attachmentItem: any,
  parentItem: any,
  prefs: Prefs
): Promise<void> {
  const title = parentItem.getField("title") || "(untitled)";
  log(`Summarising: ${title}`);

  const progress = showProgress(`Summarising "${truncate(title, 60)}"…`);

  try {
    const text = await getPdfText(
      attachmentItem,
      prefs.maxChars,
      prefs.indexWaitSeconds
    );

    const summary = await callBackend(prefs, {
      systemPrompt: prefs.prompt,
      documentText: text,
      itemTitle: title,
    });

    parentItem.setField("abstractNote", summary);
    await parentItem.saveTx();

    progress.done(`Summary written to "${truncate(title, 60)}"`);
    log(`Done: ${title}`);
  } catch (e: any) {
    const msg = e?.message || String(e);
    log(`ERROR for "${title}": ${msg}`);
    progress.fail(`Summary failed: ${msg}`);
    throw e;
  }
}

async function getParentItem(attachmentItem: any): Promise<any | null> {
  try {
    const parentID = attachmentItem.parentItemID;
    if (!parentID) return null;
    return await Zotero.Items.getAsync(parentID);
  } catch {
    return null;
  }
}

function confirmReplace(title: string): Promise<boolean> {
  // Use Zotero's prompt service. Returns true if user clicked Replace.
  return new Promise((resolve) => {
    try {
      const ps = Services.prompt;
      const buttonFlags =
        ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING +
        ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING;
      const win =
        Zotero.getMainWindow?.() ??
        Services.wm.getMostRecentWindow("navigator:browser");
      const result = ps.confirmEx(
        win,
        "PDF Auto-Summariser",
        `Replace existing abstract for "${truncate(title, 80)}"?`,
        buttonFlags,
        "Replace",
        "Keep existing",
        null,
        null,
        { value: false }
      );
      resolve(result === 0);
    } catch (e) {
      log(`confirmReplace error: ${e}`);
      resolve(false);
    }
  });
}

interface ProgressHandle {
  done: (msg: string) => void;
  fail: (msg: string) => void;
}

function showProgress(initialMessage: string): ProgressHandle {
  let pw: any = null;
  try {
    pw = new Zotero.ProgressWindow({ closeOnClick: true });
    pw.changeHeadline("PDF Auto-Summariser");
    const itemProgress = new pw.ItemProgress("", initialMessage);
    pw.show();
    return {
      done: (msg) => {
        try {
          itemProgress.setText(msg);
          itemProgress.setProgress(100);
          pw.startCloseTimer(4000);
        } catch {
          /* ignore */
        }
      },
      fail: (msg) => {
        try {
          itemProgress.setText(msg);
          itemProgress.setError();
          pw.startCloseTimer(8000);
        } catch {
          /* ignore */
        }
      },
    };
  } catch {
    // Headless / no window available — silent operation is fine.
    return { done: () => undefined, fail: () => undefined };
  }
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function log(msg: string): void {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}
