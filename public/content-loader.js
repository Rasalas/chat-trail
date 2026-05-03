(async () => {
  await import(chrome.runtime.getURL("assets/content.js"));
})();
