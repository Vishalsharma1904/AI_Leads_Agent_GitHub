'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { trustedURL, atomicJSON, compare } = require('./ui-updates');

async function startNativeUpdates(app, trust, canInstall = () => false) {
  if (!app.isPackaged || process.platform !== 'win32' || !trust.native?.enabled) return;
  const settings = trust.native;
  trustedURL(settings.feed, trust.hosts);
  if (!settings.publisher) throw Error('Native update publisher is not provisioned');
  const updaterRequire = require('node:module').createRequire(require.resolve('electron-updater'));
  const config = updaterRequire('js-yaml').load(fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'));
  const publishers = Array.isArray(config.publisherName) ? config.publisherName : [config.publisherName];
  if (publishers.length !== 1 || publishers[0] !== settings.publisher) throw Error('Native update signature trust is not provisioned');
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: settings.feed });
  const marker = path.join(app.getPath('userData'), 'native-update.json');
  let pending;
  try { pending = JSON.parse(fs.readFileSync(marker, 'utf8')); } catch (_) {}
  autoUpdater.on('error', error => console.warn('Native update deferred:', error.message));
  const result = await autoUpdater.checkForUpdates();
  const info = result?.updateInfo;
  if (!info || compare(info.version, app.getVersion()) <= 0) return;
  if (!info.files?.length) throw Error('Native update has no installer payload');
  for (const file of info.files) {
    trustedURL(new URL(file.url, settings.feed).href, trust.hosts);
    if (!file.sha512 || !Number.isFinite(file.size) || file.size > 256 * 1024 * 1024) throw Error('Native update payload is invalid or too large');
  }
  const cancellation = new (updaterRequire('builder-util-runtime').CancellationToken)();
  autoUpdater.on('download-progress', progress => {
    if (progress.total > 256 * 1024 * 1024 || progress.transferred > 256 * 1024 * 1024) cancellation.cancel();
  });
  await autoUpdater.downloadUpdate(cancellation); // Library verifies SHA512 + bundled Authenticode publisher.
  atomicJSON(marker, { version: info.version });
  // This function runs before the window is created. Future checks only stage.
  if (pending?.version === info.version && canInstall()) autoUpdater.quitAndInstall(true, true);
}
module.exports = { startNativeUpdates };
