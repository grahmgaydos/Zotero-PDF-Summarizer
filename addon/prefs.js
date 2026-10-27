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
pref("extensions.pdf-auto-summariser.indexWaitSeconds", 15);
pref(
  "extensions.pdf-auto-summariser.prompt",
  "You are an academic abstract writer. Write a tight 3 to 4 sentence abstract in British English, policy-memo register: lead with the central empirical or theoretical claim, then the method or evidentiary basis, then the scope condition or limitation. Output one plain paragraph. Do not use headings. Do not use bullet points or numbered lists. Do not use bold, italics, asterisks, or any markdown formatting. Do not include a 'Key Takeaways' section, a 'Strengths' section, or any commentary on the paper. Do not ask follow-up questions. Do not introduce the abstract with phrases like 'Here is the abstract' or 'This paper presents'. Output only the abstract paragraph itself."
);
pref("extensions.pdf-auto-summariser.vaultEnabled", false);
pref("extensions.pdf-auto-summariser.vaultPath", "");
pref("extensions.pdf-auto-summariser.vaultSourcesFolder", "sources");
