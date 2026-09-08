/**
 * Content-script entry point.
 *
 * Declared in the manifest as a classic script so it runs at `document_start`, then
 * dynamically imports the real module graph. That import resolves inside the content
 * script's isolated world, which is what lets the rest of the codebase be plain ES
 * modules with real imports rather than one flat concatenated bundle.
 *
 * Nothing here touches the page beyond what the runtime itself does.
 */

(() => {
  // A page that navigates within itself must not end up with two runtimes.
  if (window.__webin) return;
  window.__webin = { status: 'loading' };

  const start = async () => {
    try {
      const { Webin } = await import(chrome.runtime.getURL('src/content/runtime.js'));
      const webin = new Webin({ doc: document, view: window });
      window.__webin = { status: 'ready', webin };

      chrome.runtime.onMessage.addListener((message, _sender, respond) => {
        webin.handleMessage(message).then(respond).catch((error) => {
          console.error('[webin]', error);
          respond({ ok: false, reason: error?.message ?? 'Unexpected error.' });
        });
        return true; // keep the channel open for the async reply
      });

      // Re-applies whatever theme this site is wearing. Nothing is shown.
      await webin.boot();
    } catch (error) {
      window.__webin = { status: 'failed', error };
      // A page the extension cannot run on must fail quietly rather than break browsing.
      console.warn('[webin] could not start on this page:', error?.message ?? error);
    }
  };

  start();
})();
