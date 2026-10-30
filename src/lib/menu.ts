// Right-click item-menu entries: "Summarise with AI" and "Add to research wiki".
// Both run against the selected items' PDF attachments.

import type { SummariseOptions } from "./summarise";
import { summariseAttachment } from "./summarise";

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

// Adds the menu items to one main window, or to the current main window when
// none is given. Zotero calls this again (via onMainWindowLoad) whenever a
// main window opens, e.g. reopening it from the Dock on macOS, so it must be
// idempotent per window.
export async function registerMenu(win?: any): Promise<void> {
  try {
    win = win ?? Zotero.getMainWindow();
    if (!win) {
      log("No main window yet; menu will be added when it opens");
      return;
    }

    const doc = win.document;
    const popup = doc.getElementById("zotero-itemmenu");
    if (!popup) {
      log("Could not find #zotero-itemmenu");
      return;
    }

    for (const { id, label, opts } of MENU_ITEMS) {
      if (doc.getElementById(id)) continue;
      const menuitem = doc.createXULElement("menuitem");
      menuitem.setAttribute("id", id);
      menuitem.setAttribute("label", label);
      menuitem.addEventListener("command", () => runOnSelection(opts));
      popup.appendChild(menuitem);
    }
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

// Removes the menu items from one window, or from every main window.
export function unregisterMenu(win?: any): void {
  try {
    const wins = win ? [win] : (Zotero.getMainWindows?.() ?? [Zotero.getMainWindow()]);
    for (const w of wins) {
      if (!w) continue;
      for (const { id } of MENU_ITEMS) w.document.getElementById(id)?.remove();
    }
  } catch (e: any) {
    log(`unregisterMenu error: ${e?.message || e}`);
  }
}

function log(msg: string): void {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}
