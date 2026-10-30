/* eslint-disable no-undef */
// External script for the prefs pane. Loaded via the `scripts` parameter
// to PreferencePanes.register, which runs it in the pane's actual document
// context (unlike inline <script> tags, which don't reliably execute).

(function () {
  function wireUp() {
    const btn = document.getElementById("pas-test-btn");
    const result = document.getElementById("pas-test-result");
    if (!btn || btn.dataset.wired === "1") return;
    // prefs.xhtml wires the button with an inline onclick, which runs even
    // when this script doesn't. Adding a listener too sent two test requests.
    if (btn.hasAttribute("onclick")) return;
    btn.dataset.wired = "1";

    btn.addEventListener("click", async () => {
      result.textContent = "Testing…";
      result.style.color = "";
      try {
        const api = Zotero.PDFAutoSummariser;
        if (!api) {
          result.style.color = "red";
          result.textContent = "Plugin not loaded";
          return;
        }
        const ok = await api.testConnection();
        if (ok) {
          result.style.color = "green";
          result.textContent = "OK ✓";
        } else {
          result.style.color = "red";
          result.textContent = "Failed (empty response)";
        }
      } catch (e) {
        result.style.color = "red";
        const msg = e && e.message ? e.message : String(e);
        result.textContent = "Failed: " + msg;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUp, { once: true });
  } else {
    wireUp();
  }
})();
