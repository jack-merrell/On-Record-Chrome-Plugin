const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");

let activeTabId = null;
const tabState = new Map();
const START_DELAY_MS = 1000;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    return;
  }
  activeTabId = tab.id;
  await ensureContentScript(tab.id);
  chrome.tabs.sendMessage(tab.id, { type: "show-setup" });
});

// Keyboard shortcut is handled by the built-in _execute_action command.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "selection-complete") {
    (async () => {
      const tabId = sender.tab?.id || activeTabId;
      if (!tabId) return;
      const tabInfo = await chrome.tabs.get(tabId);
      if (!tabInfo.url || tabInfo.url.startsWith("chrome://") || tabInfo.url.startsWith("chrome-extension://")) {
        await ensureContentScript(tabId);
        chrome.tabs.sendMessage(tabId, {
          type: "export-error",
          message: "Cannot capture chrome:// pages. Open a normal website tab.",
        });
        return;
      }
      const { config } = message;
      const formatChoice = config?.formatChoice || "video";
      const durationSec = Number(config?.durationSec || 0);
      const captureCursor = !!config?.captureCursor;
      const safeDuration = Number.isFinite(durationSec) && durationSec > 0
        ? Math.min(durationSec, 600)
        : 0;

      const prev = tabState.get(tabId);
      if (prev?.timerId) {
        clearTimeout(prev.timerId);
      }
      tabState.set(tabId, { formatChoice, timerId: null });

      await ensureOffscreen();
      const delayMs = config?.startDelay === false ? 0 : START_DELAY_MS;
      if (delayMs > 0) {
        chrome.tabs.sendMessage(tabId, {
          type: "recording-prep",
          delayMs,
        });
      }

      setTimeout(async () => {
        const streamId = await getTabStreamId(tabId);
        const result = await sendToOffscreen({
          type: "start-recording",
          streamId,
          rect: message.rect,
          captureCursor,
        });
        if (!result || result.ok === false) {
          chrome.tabs.sendMessage(tabId, {
            type: "export-error",
            message: result?.error || "Error starting tab capture",
          });
          return;
        }
        chrome.tabs.sendMessage(tabId, { type: "recording-started", durationSec: safeDuration, rect: message.rect });

        if (safeDuration > 0) {
          const timerId = setTimeout(async () => {
            await sendToOffscreen({ type: "stop-recording" });
            const tabInfo = await chrome.tabs.get(tabId);
            chrome.tabs.sendMessage(tabId, {
              type: "recording-ready",
              formatChoice,
              tabTitle: tabInfo?.title || "Recording",
            });
            const current = tabState.get(tabId);
            if (current) tabState.set(tabId, { ...current, timerId: null });
          }, safeDuration * 1000);
          tabState.set(tabId, { formatChoice, timerId });
        }
      }, delayMs);
    })();
  }

  if (message.type === "stop-recording") {
    (async () => {
      await sendToOffscreen({ type: "stop-recording" });
      const tabId = sender.tab?.id || activeTabId;
      if (tabId) {
        const current = tabState.get(tabId);
        if (current?.timerId) {
          clearTimeout(current.timerId);
        }
        tabState.set(tabId, { ...current, timerId: null });
        const tabInfo = await chrome.tabs.get(tabId);
        chrome.tabs.sendMessage(tabId, {
          type: "recording-ready",
          formatChoice: current?.formatChoice || "video",
          tabTitle: tabInfo?.title || "Recording",
        });
      }
    })();
  }

  if (message.type === "cancel-recording") {
    (async () => {
      await sendToOffscreen({ type: "stop-recording" });
      await sendToOffscreen({ type: "clear-recording" });
      const tabId = sender.tab?.id || activeTabId;
      if (tabId) {
        const current = tabState.get(tabId);
        if (current?.timerId) {
          clearTimeout(current.timerId);
        }
        tabState.set(tabId, { ...current, timerId: null });
        chrome.tabs.sendMessage(tabId, { type: "recording-cancelled" });
      }
    })();
  }

  if (message.type === "export") {
    (async () => {
      const { format, filename, options } = message;
      const result = await sendToOffscreen({
        type: "export",
        format,
        options,
        filename,
      });
      const tabId = sender.tab?.id || activeTabId;

      if (!result || result.ok === false) {
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: "export-error",
            message: result?.error || "Export failed",
            format,
          });
        }
        return;
      }
      if (!result?.blobUrl) {
        if (tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: "export-error",
            message: "Export failed to produce a downloadable file.",
            format,
          });
        }
        return;
      }

      const finalName = sanitizeFilename(filename || result.filename || "recording");
      chrome.downloads.download({
        url: result.blobUrl,
        filename: finalName,
        saveAs: true,
      }, () => {
        if (chrome.runtime.lastError && tabId) {
          chrome.tabs.sendMessage(tabId, {
            type: "export-error",
            message: chrome.runtime.lastError.message || "Download failed",
            format,
          });
          return;
        }
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: "export-complete", format });
        }
        sendToOffscreen({ type: "revoke-blob-url", url: result.blobUrl });
      });
    })();
  }

  if (message.type === "preview") {
    (async () => {
      const tabId = sender.tab?.id || activeTabId;
      const result = await sendToOffscreen({ type: "preview" });
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          type: "preview-ready",
          preview: result,
        });
      }
    })();
  }

  if (message.type === "clear-recording") {
    (async () => {
      await sendToOffscreen({ type: "clear-recording" });
    })();
  }

  if (message.type === "show-setup") {
    (async () => {
      const tabId = sender.tab?.id || activeTabId;
      if (!tabId) return;
      await ensureContentScript(tabId);
      chrome.tabs.sendMessage(tabId, { type: "show-setup" });
    })();
  }


  if (message.type === "offscreen-status") {
    sendResponse({ ok: true });
  }
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  }
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existing.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification: "Record a user-selected region of the current tab",
  });
}

function sanitizeFilename(name) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .trim();
  return cleaned || "recording";
}

function getTabStreamId(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        reject(chrome.runtime.lastError || new Error("No stream id"));
        return;
      }
      resolve(streamId);
    });
  });
}

function sendToOffscreen(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ ...message, target: "offscreen" }, resolve);
  });
}
