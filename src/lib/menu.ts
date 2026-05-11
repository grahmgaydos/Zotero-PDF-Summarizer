// Right-click "Summarise with AI" menu on items in the library pane.
// Uses Zotero.ItemTreeManager (Zotero 7) to inject a context-menu entry.

import { summariseAttachment } from "./summarise";

let menuItemID: string | null = null;

const MENU_ID = "pdf-auto-summariser-context-menu";

export async function registerMenu(): Promise<void> {
  if (menuItemID) return;
  try {
    // Zotero 7's ItemTreeManager / Menu API. We add a single menuitem to the
    // item context menu that runs against the selected items.
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

    // Remove any stale entry from a previous startup.
    const stale = doc.getElementById(MENU_ID);
    if (stale) stale.remove();

    const menuitem = doc.createXULElement("menuitem");
    menuitem.setAttribute("id", MENU_ID);
    menuitem.setAttribute("label", "Summarise with AI");
    menuitem.addEventListener("command", async () => {
      const items = Zotero.getActiveZoteroPane().getSelectedItems();
      for (const item of items) {
        // If it's a regular item, find its best PDF attachment.
        // If it's an attachment, use it directly.
        let attachment = null;
        if (item.isAttachment() && item.attachmentContentType === "application/pdf") {
          attachment = item;
        } else if (item.isRegularItem()) {
          const attIDs = item.getAttachments();
          for (const aid of attIDs) {
            const att = await Zotero.Items.getAsync(aid);
            if (att.attachmentContentType === "application/pdf") {
              attachment = att;
              break;
            }
          }
        }
        if (!attachment) {
          log(`No PDF attachment for item ${item.id}; skipping`);
          continue;
        }
        // Manual invocation: force-run with silent overwrite intent.
        summariseAttachment(attachment, { force: true }).catch((e) => {
          log(`Manual summarise failed: ${e?.message || e}`);
        });
      }
    });

    popup.appendChild(menuitem);
    menuItemID = MENU_ID;
    log("Context menu registered");
  } catch (e: any) {
    log(`registerMenu error: ${e?.message || e}`);
  }
}

export function unregisterMenu(): void {
  try {
    const win = Zotero.getMainWindow();
    if (!win) return;
    const el = win.document.getElementById(MENU_ID);
    if (el) el.remove();
    menuItemID = null;
  } catch (e: any) {
    log(`unregisterMenu error: ${e?.message || e}`);
  }
}

function log(msg: string): void {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}
