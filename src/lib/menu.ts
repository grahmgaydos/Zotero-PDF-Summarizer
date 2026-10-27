// Right-click item-menu entries: "Summarise with AI" and "Add to research wiki".
// Both run against the selected items' PDF attachments.

import type { SummariseOptions } from "./summarise";
import { summariseAttachment } from "./summarise";

let registered = false;

const MENU_ITEMS: { id: string; label: string; opts: SummariseOptions }[] = [
  {
    id: "pdf-auto-summariser-context-menu",
    label: "Summarise with AI",
    // Manual invocation: force-run with silent overwrite intent.
    opts: { force: true },
  },
  {
    id: "pdf-auto-summariser-wiki-menu",
    label: "Add to research wiki",
    opts: { mode: "wiki" },
  },
];

export async function registerMenu(): Promise<void> {
  if (registered) return;
  try {
    const win = Zotero.getMainWindow();
    if (!win) {
      log("No main window yet; deferring menu registration");
      return;
    }

    const doc = win.document;
    const popup = doc.getElementById("zotero-itemmenu");
    if (!popup) {
      log("Could not find #zotero-itemmenu");
      return;
    }

    for (const { id, label, opts } of MENU_ITEMS) {
      // Remove any stale entry from a previous startup.
      doc.getElementById(id)?.remove();

      const menuitem = doc.createXULElement("menuitem");
      menuitem.setAttribute("id", id);
      menuitem.setAttribute("label", label);
      menuitem.addEventListener("command", () => runOnSelection(opts));
      popup.appendChild(menuitem);
    }

    registered = true;
    log("Context menu registered");
  } catch (e: any) {
    log(`registerMenu error: ${e?.message || e}`);
  }
}

async function runOnSelection(opts: SummariseOptions): Promise<void> {
  const items = Zotero.getActiveZoteroPane().getSelectedItems();
  for (const item of items) {
    const attachment = await findPdf(item);
    if (!attachment) {
      log(`No PDF attachment for item ${item.id}; skipping`);
      continue;
    }
    summariseAttachment(attachment, opts).catch((e) => {
      log(`Manual run failed: ${e?.message || e}`);
    });
  }
}

// If it's an attachment, use it directly; if it's a regular item, take its
// first PDF attachment.
async function findPdf(item: any): Promise<any | null> {
  if (item.isAttachment() && item.attachmentContentType === "application/pdf") {
    return item;
  }
  if (!item.isRegularItem()) return null;
  for (const aid of item.getAttachments()) {
    const att = await Zotero.Items.getAsync(aid);
    if (att.attachmentContentType === "application/pdf") return att;
  }
  return null;
}

export function unregisterMenu(): void {
  try {
    const win = Zotero.getMainWindow();
    if (!win) return;
    for (const { id } of MENU_ITEMS) win.document.getElementById(id)?.remove();
    registered = false;
  } catch (e: any) {
    log(`unregisterMenu error: ${e?.message || e}`);
  }
}

function log(msg: string): void {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}
