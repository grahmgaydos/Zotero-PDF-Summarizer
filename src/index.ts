// Plugin entry point. Bootstrap.js loads our bundled output as a sub-script
// and calls Summariser.startup() / Summariser.shutdown().

import { registerNotifier, unregisterNotifier } from "./lib/notifier";
import { registerMenu, unregisterMenu } from "./lib/menu";
import { setQueueConcurrency } from "./lib/summarise";
import { getPrefs } from "./lib/prefs";
import { testConnection } from "./lib/backends";

// Beacon log — fires the moment the bundle is evaluated, before any
// Zotero APIs are called. If this line doesn't appear in the debug log,
// the bundle didn't load at all.
try {
  Zotero.debug("[PDF Auto-Summariser] bundle evaluated");
} catch {
  /* Zotero global missing — log infrastructure broken */
}

const PREFS_PANE_ID = "zotero-prefpane-pdf-auto-summariser";

export const Summariser = {
  async startup(data: BootstrapData) {
    Zotero.debug("[PDF Auto-Summariser] index.ts startup");

    // Apply current concurrency setting from prefs.
    setQueueConcurrency(getPrefs().concurrency);

    // Register the preference pane. src must be a URI Zotero can fetch;
    // rootURI (jar:/file:) works directly without a chrome registration.
    // scripts[] is required for the prefs pane to run any JS — inline
    // <script> tags in the XHTML are ignored by Zotero's pane sandbox.
    try {
      await Zotero.PreferencePanes.register({
        pluginID: data.id,
        src: `${data.rootURI}content/prefs.xhtml`,
        id: PREFS_PANE_ID,
        label: "PDF Auto-Summariser",
        scripts: [`${data.rootURI}content/prefs-page.js`],
      });
      Zotero.debug("[PDF Auto-Summariser] prefs pane registered");
    } catch (e: any) {
      Zotero.debug(
        `[PDF Auto-Summariser] prefs pane register error: ${e?.message || e}\n${e?.stack || ""}`
      );
    }

    // Expose an API so the prefs pane can invoke testConnection.
    // We attach handleTestClick directly so the button can call it from an
    // inline onclick handler — this works regardless of whether external
    // <script> tags or the `scripts` array load correctly in the prefs sandbox.
    (Zotero as any).PDFAutoSummariser = {
      testConnection: async () => testConnection(getPrefs()),
      getPrefs,

      // Called by the Test Connection button's onclick handler.
      // `doc` is the prefs pane's document, passed in as `document` from the
      // inline handler. We resolve the result element from it.
      handleTestClick: async (doc: Document) => {
        const result = doc.getElementById("pas-test-result");
        if (!result) return;
        result.textContent = "Testing…";
        (result as HTMLElement).style.color = "";
        try {
          const ok = await testConnection(getPrefs());
          if (ok) {
            (result as HTMLElement).style.color = "green";
            result.textContent = "OK ✓";
          } else {
            (result as HTMLElement).style.color = "red";
            result.textContent = "Failed (empty response)";
          }
        } catch (e: any) {
          (result as HTMLElement).style.color = "red";
          result.textContent = "Failed: " + (e?.message || String(e));
        }
      },
    };

    registerNotifier();
    await registerMenu();
  },

  // Zotero calls these (via bootstrap.js) whenever a main window opens or
  // closes, including the first window if it opens after startup.
  async onMainWindowLoad(win: any) {
    await registerMenu(win);
  },

  onMainWindowUnload(win: any) {
    unregisterMenu(win);
  },

  async shutdown() {
    Zotero.debug("[PDF Auto-Summariser] index.ts shutdown");
    unregisterNotifier();
    unregisterMenu();
    delete (Zotero as any).PDFAutoSummariser;
  },
};

// bootstrap.js uses Services.scriptloader.loadSubScript with `this` bound to
// the bootstrap sandbox, so a top-level assignment attaches to the bootstrap
// global as expected.
(globalThis as any).Summariser = Summariser;
