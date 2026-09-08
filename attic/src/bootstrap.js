/**
 * Content-script entry point.
 *
 * Declared in the manifest as a classic script so it runs at `document_start`, then
 * dynamically imports the real module graph. That import resolves inside the content
 * script's isolated world, which is what lets the rest of the codebase be plain ES
 * modules with real imports rather than one flat concatenated bundle (§78).
 *
 * Nothing here touches the page beyond what the editor itself does.
 */

(() => {
  // A page that navigates within itself must not end up with two editors.
  if (window.__webInterfaceDevTools) return;
  window.__webInterfaceDevTools = { status: 'loading' };

  const start = async () => {
    try {
      const { Editor } = await import(chrome.runtime.getURL('src/content/main.js'));
      const editor = new Editor({ doc: document, view: window });
      window.__webInterfaceDevTools = { status: 'ready', editor };

      // Apply saved customisations immediately; the UI is only built when asked for.
      await editor.boot();

      chrome.runtime.onMessage.addListener((message, _sender, respond) => {
        editor.handleMessage(message).then(respond).catch((error) => {
          console.error('[web-interface-devtools]', error);
          respond({ ok: false, reason: error?.message ?? 'Unexpected error.' });
        });
        return true; // keep the channel open for the async reply
      });
    } catch (error) {
      window.__webInterfaceDevTools = { status: 'failed', error };
      // A page the extension cannot run on must fail quietly rather than break browsing.
      console.warn('[web-interface-devtools] could not start on this page:', error?.message ?? error);
    }
  };

  start();
})();
