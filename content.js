// content.js — Favicon Changer v1.0.0
// Injected into every page to apply custom favicons

function applyFavicon(dataUrl) {
  if (!dataUrl) return;
  // Remove existing favicon links
  const existing = document.querySelectorAll(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  );
  existing.forEach(el => el.remove());

  // Create new favicon link
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = dataUrl;
  (document.head || document.documentElement).appendChild(link);
}

// Listen for messages from background / popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "applyFavicon") {
    applyFavicon(msg.faviconDataUrl);
    sendResponse({ ok: true });
  }
});

// On load, ask background if there's a rule for this page
(async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getRule",
      url: window.location.href
    });
    if (response && response.rule) {
      // Wait for head to exist
      if (document.head) {
        applyFavicon(response.rule.faviconDataUrl);
      } else {
        const observer = new MutationObserver(() => {
          if (document.head) {
            observer.disconnect();
            applyFavicon(response.rule.faviconDataUrl);
          }
        });
        observer.observe(document.documentElement, { childList: true });
      }
    }
  } catch { /* extension context may not be ready */ }
})();
