/* eslint-disable no-undef */
// Zotero 7 bootstrapped plugin entry point.
// Loaded directly by Zotero. Must be plain JS (not a module).
// We bundle our TypeScript source into a single classic script at build time
// and load it from this file via Services.scriptloader.

var chromeHandle;
var Summariser; // global hook into our bundled code

function log(msg) {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}

async function install() {
  log("install()");
}

async function startup({ id, version, rootURI }) {
  log(`startup() id=${id} version=${version}`);

  // Wait for Zotero to be fully ready before doing anything.
  await Zotero.initializationPromise;

  // Register chrome:// URI for our bundled assets (icons, prefs xhtml).
  const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
    Ci.amIAddonManagerStartup
  );
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "pdf-auto-summariser", rootURI + "content/"],
  ]);

  // Load the bundled plugin code. It attaches a single object to the global
  // scope of this bootstrap sandbox.
  Services.scriptloader.loadSubScript(rootURI + "content/index.js", this);

  if (typeof Summariser === "undefined") {
    log("ERROR: Summariser bundle did not load");
    return;
  }

  try {
    await Summariser.startup({ id, version, rootURI });
  } catch (e) {
    log(`startup error: ${e}\n${e.stack || ""}`);
  }
}

async function shutdown() {
  log("shutdown()");
  try {
    if (typeof Summariser !== "undefined") {
      await Summariser.shutdown();
    }
  } catch (e) {
    log(`shutdown error: ${e}`);
  }
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall() {
  log("uninstall()");
}
