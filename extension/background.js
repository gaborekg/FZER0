chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('extension/onboarding/onboarding.html') });
  }
});

// The in-call panel offers a way back to setup when nothing has been saved
// yet. openOptionsPage is not available to content scripts, so the request
// comes here.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
  }

  // A web page is not allowed to navigate to chrome:// — deliberately. An
  // extension is, which is the one advantage this half has when someone has
  // blocked the microphone: it can land them on the exact settings screen
  // rather than describing where it is.
  if (message?.type === 'open-site-settings' && message.url?.startsWith('chrome://settings/')) {
    chrome.tabs.create({ url: message.url });
  }
});

// Clicking the toolbar icon is the obvious thing to try when a panel hasn't
// appeared, and until now it did nothing at all.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
