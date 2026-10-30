/* eslint-disable no-undef */
// Zotero 7 bootstrapped plugin entry point.
// Loaded directly by Zotero. Must be plain JS (not a module).
// We bundle our TypeScript source into a single classic script at build time
// and load it from this file via Services.scriptloader.

var Summariser; // global hook into our bundled code

function log(msg) {
  Zotero.debug(`[PDF Auto-Summariser] ${msg}`);
}

async function install() {
  log("install()");
}

async function startup({ id, version, rootURI }) {
  log(`startup() id=${id} version=${version} rootURI=${rootURI}`);

  // Wait for Zotero to be fully ready before doing anything.
  await Zotero.initializationPromise;

  // Load the bundled plugin code. It attaches Summariser to the bootstrap
  // sandbox's global scope.
  try {
    Services.scriptloader.loadSubScript(rootURI + "content/index.js", this);
  } catch (e) {
    log(`ERROR loading content/index.js: ${e}\n${e.stack || ""}`);
    return;
  }

  if (typeof Summariser === "undefined") {
    log("ERROR: Summariser bundle did not attach to global scope");
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
}

// Zotero 7+ calls these for each main window, including one reopened after
// being closed (on macOS, from the Dock). Without them the menu items vanish.
async function onMainWindowLoad({ window }) {
  try {
    if (typeof Summariser !== "undefined") await Summariser.onMainWindowLoad(window);
  } catch (e) {
    log(`onMainWindowLoad error: ${e}`);
  }
}

async function onMainWindowUnload({ window }) {
  try {
    if (typeof Summariser !== "undefined") Summariser.onMainWindowUnload(window);
  } catch (e) {
    log(`onMainWindowUnload error: ${e}`);
  }
}

async function uninstall() {
  log("uninstall()");
}
