// Default preferences. Read by Zotero on startup; user values override.
// Branch prefix matches what the TS code uses: extensions.pdf-auto-summariser.*

pref("extensions.pdf-auto-summariser.backend", "ollama");
pref("extensions.pdf-auto-summariser.endpoint", "http://localhost:11434/v1/chat/completions");
pref("extensions.pdf-auto-summariser.model", "llama3.1:8b");
pref("extensions.pdf-auto-summariser.apiKey", "");
pref("extensions.pdf-auto-summariser.maxChars", 24000);
pref("extensions.pdf-auto-summariser.autoOnAdd", true);
pref("extensions.pdf-auto-summariser.onExistingAbstract", "ask"); // ask | skip | overwrite
pref("extensions.pdf-auto-summariser.concurrency", 1);
pref("extensions.pdf-auto-summariser.indexWaitSeconds", 8);
pref(
  "extensions.pdf-auto-summariser.prompt",
  "You are summarising an academic paper for a researcher's reference library. Write a tight 3–4 sentence abstract in British English, policy-memo register: lead with the central empirical or theoretical claim, then the method or evidentiary basis, then the scope condition or limitation. Avoid throat-clearing, generic openers ('This paper'), and rhetorical questions. Do not use bullet points. Output the summary only, no preface or framing."
);
