document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('panel-toggle');
  const apiKeyInput = document.getElementById('api-key');
  const saveBtn = document.getElementById('save-btn');

  // Load saved state
  const data = await chrome.storage.local.get(['panelEnabled', 'geminiApiKey']);
  toggle.checked = data.panelEnabled || false;
  apiKeyInput.value = data.geminiApiKey || '';

  // Immediate toggle: Save to storage as soon as the checkbox changes
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ panelEnabled: toggle.checked });
  });

  // Save button: Used to commit the API key and close the popup
  saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value;
    chrome.storage.local.set({ geminiApiKey: key }, () => {
      // The content script is already listening for storage changes, 
      // so we just close the window here.
      window.close();
    });
  });
});