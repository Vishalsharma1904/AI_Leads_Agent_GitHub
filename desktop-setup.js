'use strict';
(async () => {
  const form = document.getElementById('connection-form');
  const input = document.getElementById('backend-url');
  const status = document.getElementById('connection-status');
  const button = document.getElementById('connect');
  const back = document.getElementById('back');
  const desktop = window.RudraDesktop;
  function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
  if (!desktop) {
    button.disabled = true;
    message('Open the installed desktop app to connect this workspace.', true);
    return;
  }
  try {
    const config = await desktop.configuration();
    input.value = config.backendUrl || '';
    back.hidden = !config.backendUrl;
  } catch (_) { message('Connection settings could not be read. Restart the app.', true); }
  back.addEventListener('click', () => desktop.openWorkspace());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    input.readOnly = true;
    message('Checking the server, database and sign-in setup…');
    try {
      const result = await desktop.connect(input.value.trim());
      if (!result.ok) { message(result.error, true); return; }
      message('Connected. Opening your workspace…');
      await desktop.openWorkspace();
    } catch (_) { message('Connection check failed. Check your internet connection and try again.', true); }
    finally { button.disabled = false; input.readOnly = false; }
  });
})();
