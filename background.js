// background.js — Favicon Changer v1.0.0
// Manages favicon rules storage and applies them via content script messaging

const STORAGE_KEY = "faviconRules";

// ----- Storage helpers -----

async function getRules() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

async function saveRules(rules) {
  await chrome.storage.local.set({ [STORAGE_KEY]: rules });
}

// ----- Rule matching -----

function findRule(url, rules) {
  if (!url) return null;
  // 1. Exact page match
  if (rules[url]) return rules[url];
  // 2. Domain match (scheme + host)
  try {
    const u = new URL(url);
    const domainKey = `domain::${u.hostname}`;
    if (rules[domainKey]) return rules[domainKey];
  } catch { /* ignore */ }
  return null;
}

// ----- Message handler -----

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {

        case "getRules": {
          const rules = await getRules();
          sendResponse({ rules });
          break;
        }

        case "getRule": {
          const rules = await getRules();
          const rule = findRule(msg.url, rules);
          sendResponse({ rule });
          break;
        }

        case "setPageRule": {
          // Save a rule for a specific page URL
          const rules = await getRules();
          rules[msg.url] = {
            type: "page",
            url: msg.url,
            faviconDataUrl: msg.faviconDataUrl,
            label: msg.label || msg.url,
            createdAt: Date.now()
          };
          await saveRules(rules);
          sendResponse({ ok: true });
          break;
        }

        case "setDomainRule": {
          // Save a rule for an entire domain
          const rules = await getRules();
          const key = `domain::${msg.hostname}`;
          rules[key] = {
            type: "domain",
            hostname: msg.hostname,
            faviconDataUrl: msg.faviconDataUrl,
            label: msg.hostname,
            createdAt: Date.now()
          };
          await saveRules(rules);
          sendResponse({ ok: true });
          break;
        }

        case "setBookmarkRule": {
          // Save a rule keyed by bookmark URL
          const rules = await getRules();
          rules[msg.url] = {
            type: "bookmark",
            url: msg.url,
            faviconDataUrl: msg.faviconDataUrl,
            label: msg.label || msg.url,
            bookmarkId: msg.bookmarkId || null,
            createdAt: Date.now()
          };
          await saveRules(rules);
          sendResponse({ ok: true });
          break;
        }

        case "deleteRule": {
          const rules = await getRules();
          delete rules[msg.key];
          await saveRules(rules);
          sendResponse({ ok: true });
          break;
        }

        case "deleteAllRules": {
          await saveRules({});
          sendResponse({ ok: true });
          break;
        }

        case "exportRules": {
          const rules = await getRules();
          sendResponse({ json: JSON.stringify(rules, null, 2) });
          break;
        }

        case "importRules": {
          try {
            const imported = JSON.parse(msg.json);
            const rules = await getRules();
            Object.assign(rules, imported);
            await saveRules(rules);
            sendResponse({ ok: true, count: Object.keys(imported).length });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
          break;
        }

        default:
          sendResponse({ error: "Unknown action" });
      }
    } catch (e) {
      sendResponse({ error: e.message });
    }
  })();
  return true; // keep channel open for async
});

// ----- Apply favicon on tab updates -----

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab.url) {
    const rules = await getRules();
    const rule = findRule(tab.url, rules);
    if (rule) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          action: "applyFavicon",
          faviconDataUrl: rule.faviconDataUrl
        });
      } catch { /* content script not ready yet — will self-apply on load */ }
    }
  }
});
