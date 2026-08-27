chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'getActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(tabs => sendResponse({ tab: tabs[0] || null }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});
