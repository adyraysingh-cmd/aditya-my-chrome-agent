chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return true;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'getActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(tabs => sendResponse({ tab: tabs[0] || null }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (message?.type === 'ensureContentScript') {
    ensureContentScript(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
