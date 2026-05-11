// Plugin entry point. Bootstrap.js loads our bundled output as a sub-script
// and calls Summariser.startup() / Summariser.shutdown().

import { registerNotifier, unregisterNotifier } from "./lib/notifier";
import { registerMenu, unregisterMenu } from "./lib/menu";
import { setQueueConcurrency } from "./lib/summarise";
import { getPrefs } from "./lib/prefs";
import { testConnection } from "./lib/backends";

const PREFS_PANE_ID = "zotero-prefpane-pdf-auto-summariser";

export const Summariser = {
  async startup(data: BootstrapData) {
    Zotero.debug("[PDF Auto-Summariser] index.ts startup");

    // Apply current concurrency setting from prefs.
    setQueueConcurrency(getPrefs().concurrency);

    // Register the preference pane.
    try {
      await Zotero.PreferencePanes.register({
        pluginID: data.id,
        src: `${data.rootURI}content/prefs.xhtml`,
        id: PREFS_PANE_ID,
        label: "PDF Auto-Summariser",
        scripts: [`${data.rootURI}content/prefs-page.js`],
        defaultXUL: false,
      });
    } catch (e: any) {
      Zotero.debug(`[PDF Auto-Summariser] prefs pane register error: ${e?.message || e}`);
    }

    // Expose an API so the prefs pane can invoke testConnection.
    (Zotero as any).PDFAutoSummariser = {
      testConnection: async () => testConnection(getPrefs()),
      getPrefs,
    };

    registerNotifier();
    await registerMenu();
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
