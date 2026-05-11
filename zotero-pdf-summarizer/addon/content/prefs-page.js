/* eslint-disable no-undef */
// Runs inside the prefs pane's XHTML document. Has access to `Zotero` via
// the global the prefs window provides.
(function () {
  const doc = document;
  const testBtn = doc.getElementById("pas-test-btn");
  const result = doc.getElementById("pas-test-result");
  if (!testBtn) return;

  testBtn.addEventListener("click", async () => {
    result.textContent = "Testing…";
    try {
      // The plugin attaches its API to Zotero.PDFAutoSummariser at startup.
      const api = Zotero.PDFAutoSummariser;
      if (!api) {
        result.textContent = "Plugin not loaded";
        return;
      }
      const ok = await api.testConnection();
      result.textContent = ok ? "OK ✓" : "Failed";
    } catch (e) {
      result.textContent = `Failed: ${e.message || e}`;
    }
  });
})();
