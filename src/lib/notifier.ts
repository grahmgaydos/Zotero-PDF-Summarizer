// Zotero.Notifier observer. Fires on item lifecycle events. We listen for
// 'add' on attachments and filter for PDFs that just landed under a parent.

import { getPrefs } from "./prefs";
import { summariseNewAttachments } from "./summarise";

let observerID: string | null = null;

export function registerNotifier(): void {
  if (observerID) return;
  observerID = Zotero.Notifier.registerObserver(
    {
      notify: async (event: string, type: string, ids: number[], extraData: any) => {
        if (event !== "add" || type !== "item") return;
        if (!getPrefs().autoOnAdd) return;
        await handleAdds(ids, extraData || {});
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

async function handleAdds(ids: number[], extraData: Record<number, any>): Promise<void> {
  const attachments: any[] = [];
  const parents = new Set<number>();

  for (const id of ids) {
    try {
      // Zotero sync also fires "add" for items it downloads (marked with
      // skipRenameFile). Those were added on another device or by someone
      // else; their PDFs often aren't downloaded yet either.
      if (extraData[id]?.skipRenameFile) continue;

      const item = await Zotero.Items.getAsync(id);
      if (!item) continue;
      if (!item.isAttachment()) continue;

      // Only the user's own library. In a group, a collaborator's upload
      // would otherwise be sent to this user's backend (and bill them), and
      // the summary written back to everyone's copy.
      if (item.libraryID !== Zotero.Libraries.userLibraryID) continue;

      // PDF attachments only. Linked URLs and snapshots skip.
      if (item.attachmentContentType !== "application/pdf") continue;

      // Skip top-level orphan PDFs — we need a parent item to write the
      // abstract back to. (Zotero 7 creates them on standalone drag-in but
      // the connector usually creates the parent first.)
      if (!item.parentItemID) {
        log(`Skipping orphan PDF attachment ${id} (no parent)`);
        continue;
      }

      // One run per paper, even if it arrived with several PDFs.
      if (parents.has(item.parentItemID)) continue;
      parents.add(item.parentItemID);
      attachments.push(item);
    } catch (e: any) {
      log(`handleAdds error for ${id}: ${e?.message || e}`);
    }
  }

  if (attachments.length) await summariseNewAttachments(attachments);
}

function log(msg: string): void {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}
