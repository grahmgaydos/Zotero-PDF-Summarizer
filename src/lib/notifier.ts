// Zotero.Notifier observer. Fires on item lifecycle events. We listen for
// 'add' on attachments and filter for PDFs that just landed under a parent.

import { getPrefs } from "./prefs";
import { summariseAttachment } from "./summarise";

let observerID: string | null = null;

export function registerNotifier(): void {
  if (observerID) return;
  observerID = Zotero.Notifier.registerObserver(
    {
      notify: async (event: string, type: string, ids: number[]) => {
        if (event !== "add" || type !== "item") return;
        if (!getPrefs().autoOnAdd) return;
        await handleAdds(ids);
      },
    },
    ["item"],
    "pdf-auto-summariser"
  );
  log(`Notifier registered: ${observerID}`);
}

export function unregisterNotifier(): void {
  if (observerID) {
    try {
      Zotero.Notifier.unregisterObserver(observerID);
    } catch (e) {
      log(`unregister error: ${e}`);
    }
    observerID = null;
  }
}

async function handleAdds(ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      const item = await Zotero.Items.getAsync(id);
      if (!item) continue;
      if (!item.isAttachment()) continue;

      // PDF attachments only. Linked URLs and snapshots skip.
      const contentType = item.attachmentContentType;
      if (contentType !== "application/pdf") continue;

      // Skip top-level orphan PDFs — we need a parent item to write the
      // abstract back to. (Zotero 7 creates them on standalone drag-in but
      // the connector usually creates the parent first.)
      if (!item.parentItemID) {
        log(`Skipping orphan PDF attachment ${id} (no parent)`);
        continue;
      }

      // Fire-and-forget. Errors are surfaced via the progress window.
      summariseAttachment(item).catch((e) => {
        log(`summariseAttachment failed for ${id}: ${e?.message || e}`);
      });
    } catch (e: any) {
      log(`handleAdds error for ${id}: ${e?.message || e}`);
    }
  }
}

function log(msg: string): void {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}
