// popup.js — Favicon Changer v1.0.0

let currentTab = null;
let selectedScope = "page";
let pendingDataUrl = null;

// ----- Toast -----
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

// ----- Init -----
document.addEventListener("DOMContentLoaded", async () => {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  // Fill page info
  document.getElementById("pageTitle").textContent = tab.title || "—";
  document.getElementById("pageUrl").textContent = tab.url || "—";
  const fav = tab.favIconUrl || "";
  document.getElementById("currentFavicon").src = fav || "icons/icon32.png";

  // Check existing rule
  const resp = await chrome.runtime.sendMessage({ action: "getRule", url: tab.url });
  if (resp && resp.rule) {
    document.getElementById("ruleStatus").style.display = "";
    document.getElementById("resetBtn").style.display = "";
  }

  // Tab switching
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
      if (btn.dataset.tab === "bookmarks") loadBookmarks();
      if (btn.dataset.tab === "rules") loadRules();
    });
  });

  // Scope buttons
  document.querySelectorAll(".scope-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".scope-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedScope = btn.dataset.scope;
    });
  });

  // File upload
  const uploadZone = document.getElementById("uploadZone");
  const fileInput = document.getElementById("fileInput");

  uploadZone.addEventListener("click", () => fileInput.click());
  uploadZone.addEventListener("dragover", e => { e.preventDefault(); uploadZone.classList.add("dragover"); });
  uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
  uploadZone.addEventListener("drop", async e => {
    e.preventDefault();
    uploadZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      await processFile(e.dataTransfer.files[0]);
    }
  });
  fileInput.addEventListener("change", async () => {
    if (fileInput.files.length) await processFile(fileInput.files[0]);
  });

  // URL load
  document.getElementById("urlLoad").addEventListener("click", async () => {
    const url = document.getElementById("urlInput").value.trim();
    if (!url) return;
    try {
      const dataUrl = await urlToDataUrl(url);
      showPreview(dataUrl);
    } catch (e) {
      toast("Erreur de chargement : " + e.message);
    }
  });

  // Apply
  document.getElementById("applyBtn").addEventListener("click", applyFavicon);

  // Reset
  document.getElementById("resetBtn").addEventListener("click", async () => {
    if (!currentTab) return;
    const url = currentTab.url;
    try {
      const hostname = new URL(url).hostname;
      await chrome.runtime.sendMessage({ action: "deleteRule", key: url });
      await chrome.runtime.sendMessage({ action: "deleteRule", key: `domain::${hostname}` });
    } catch { /* ignore */ }
    toast("Règle supprimée");
    document.getElementById("ruleStatus").style.display = "none";
    document.getElementById("resetBtn").style.display = "none";
  });

  // Export / Import
  document.getElementById("exportBtn").addEventListener("click", async () => {
    const resp = await chrome.runtime.sendMessage({ action: "exportRules" });
    const blob = new Blob([resp.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "favicon-rules.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Export réussi");
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });
  document.getElementById("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const resp = await chrome.runtime.sendMessage({ action: "importRules", json: text });
    if (resp.ok) {
      toast(`${resp.count} règle(s) importée(s)`);
      loadRules();
    } else {
      toast("Erreur : " + resp.error);
    }
  });

  // Options link
  document.getElementById("optionsLink").addEventListener("click", e => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});

// ----- Process uploaded file -----
async function processFile(file) {
  try {
    const dataUrl = await fileToDataUrl(file);
    showPreview(dataUrl);
  } catch (e) {
    toast("Image invalide");
  }
}

function showPreview(dataUrl) {
  pendingDataUrl = dataUrl;
  document.getElementById("previewRow").style.display = "flex";
  document.getElementById("previewImg").src = dataUrl;
  document.getElementById("applyBtn").disabled = false;
}

// ----- Send message to tab, injecting content script if needed -----
async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Content script not present — inject it then retry
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

// ----- Apply favicon -----
async function applyFavicon() {
  if (!pendingDataUrl || !currentTab) return;

  try {
    const url = currentTab.url;

    // Reject pages where we can't inject (chrome://, edge://, about:, etc.)
    if (/^(chrome|edge|about|chrome-extension):/.test(url)) {
      toast("Impossible sur cette page système");
      return;
    }

    const hostname = new URL(url).hostname;

    if (selectedScope === "domain") {
      await chrome.runtime.sendMessage({
        action: "setDomainRule",
        hostname,
        faviconDataUrl: pendingDataUrl
      });
    } else {
      await chrome.runtime.sendMessage({
        action: "setPageRule",
        url,
        faviconDataUrl: pendingDataUrl
      });
    }

    // Apply to current tab immediately (inject if needed)
    await sendToTab(currentTab.id, {
      action: "applyFavicon",
      faviconDataUrl: pendingDataUrl
    });

    document.getElementById("ruleStatus").style.display = "";
    document.getElementById("resetBtn").style.display = "";
    toast("Favicon appliqué !");
  } catch (e) {
    toast("Erreur : " + e.message);
  }
}

// ----- Bookmarks -----
async function loadBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const flat = [];
  function walk(nodes) {
    for (const n of nodes) {
      if (n.url) flat.push(n);
      if (n.children) walk(n.children);
    }
  }
  walk(tree);

  renderBookmarks(flat);

  document.getElementById("bmSearch").addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    const filtered = flat.filter(b =>
      (b.title || "").toLowerCase().includes(q) ||
      (b.url || "").toLowerCase().includes(q)
    );
    renderBookmarks(filtered);
  });
}

function renderBookmarks(list) {
  const container = document.getElementById("bmList");
  container.innerHTML = "";
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Aucun favori trouvé</div>';
    return;
  }
  for (const bm of list.slice(0, 100)) {
    const div = document.createElement("div");
    div.className = "bm-item";
    const favUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(bm.url)}&size=32`;
    div.innerHTML = `
      <img src="${favUrl}" alt="">
      <span title="${bm.url}">${truncate(bm.title || bm.url, 55)}</span>
    `;
    div.addEventListener("click", () => openBookmarkEditor(bm));
    container.appendChild(div);
  }
}

function openBookmarkEditor(bm) {
  // Switch to page tab with bookmark context
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector('[data-tab="page"]').classList.add("active");
  document.getElementById("panel-page").classList.add("active");

  document.getElementById("pageTitle").textContent = bm.title || "Sans titre";
  document.getElementById("pageUrl").textContent = bm.url;

  // Override apply for bookmark
  const applyBtn = document.getElementById("applyBtn");
  const handler = async () => {
    if (!pendingDataUrl) return;
    await chrome.runtime.sendMessage({
      action: "setBookmarkRule",
      url: bm.url,
      faviconDataUrl: pendingDataUrl,
      label: bm.title,
      bookmarkId: bm.id
    });
    toast("Favicon du favori modifié !");
    applyBtn.removeEventListener("click", handler);
    applyBtn.addEventListener("click", applyFavicon);
  };
  applyBtn.removeEventListener("click", applyFavicon);
  applyBtn.addEventListener("click", handler);
}

// ----- Rules list -----
async function loadRules() {
  const resp = await chrome.runtime.sendMessage({ action: "getRules" });
  const rules = resp.rules || {};
  const container = document.getElementById("rulesList");
  container.innerHTML = "";
  const keys = Object.keys(rules);

  if (!keys.length) {
    container.innerHTML = '<div class="empty-state">Aucune règle définie</div>';
    return;
  }

  for (const key of keys) {
    const rule = rules[key];
    const div = document.createElement("div");
    div.className = "rule-item";
    const typeLabel = rule.type === "domain" ? "Domaine" :
                      rule.type === "bookmark" ? "Favori" : "Page";
    div.innerHTML = `
      <img src="${rule.faviconDataUrl}" alt="">
      <div class="rule-info">
        <div class="rule-label">${truncate(rule.label || key, 45)}</div>
        <div class="rule-type">${typeLabel}</div>
      </div>
      <button class="rule-del" title="Supprimer">✕</button>
    `;
    div.querySelector(".rule-del").addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ action: "deleteRule", key });
      toast("Règle supprimée");
      loadRules();
    });
    container.appendChild(div);
  }
}
