﻿﻿const {
  app, BrowserWindow, ipcMain, session, dialog, Menu, net, shell, webContents, clipboard, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const childProcess = require('child_process');
const http = require('http');
const https = require('https');
const nodeNet = require('net');
const { pathToFileURL } = require('url');

// Keep hardware acceleration enabled. Dola's hover video preview can render
// audio-only/blank when GPU compositing is disabled in Electron WebView.

const IS_WINDOWS = process.platform === 'win32';
const IS_MACOS = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

const PROJECT_DIR = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');
const LEGACY_DATA_DIR = path.join(PROJECT_DIR, 'data');
const BUNDLED_DATA_DIR = path.join(__dirname, 'data');
const LEGACY_USER_DATA_DIR = app.getPath('userData');
const LEGACY_APP_DATA_DIR = path.join(app.getPath('appData'), 'ai-account-manager');
const DATA_DIR = app.isPackaged ? path.join(app.getPath('appData'), 'AIAccountManager') : LEGACY_DATA_DIR;
const DEFAULT_DOWNLOAD_DIR = path.join(app.getPath('desktop'), 'AI管理器下载视频');
const LEGACY_DOWNLOAD_DIR = path.join(app.getPath('desktop'), `${String.fromCharCode(65, 105)}AccountManagerDownloads`);
let appSettings = {
  downloadDir: DEFAULT_DOWNLOAD_DIR,
  desktopShortcutPrompted: false,
  desktopShortcutChoice: ''
};
const FORCE_DISABLE_GPU = process.env.AIAM_DISABLE_GPU === '1';
const DEBUG_LOG_ENABLED = process.env.AIAM_DEBUG_LOG === '1' || !app.isPackaged;
try {
  app.setAppUserModelId('千思链');
} catch (e) {}
if (!DEBUG_LOG_ENABLED) {
  console.log = () => {};
}
if (FORCE_DISABLE_GPU) {
  try {
    app.disableHardwareAcceleration();
    console.log('[main] hardware acceleration disabled for compatibility mode');
  } catch (e) {}
}

const COMPAT_CHROME_VERSION = process.versions.chrome || '142.0.7444.175';
const COMPAT_CHROME_MAJOR = String(COMPAT_CHROME_VERSION).split('.')[0] || '142';
const COMPAT_PLATFORM = IS_MACOS ? {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
  navigatorPlatform: 'MacIntel',
  uaPlatform: 'macOS',
  platformVersion: '14.0.0',
  architecture: process.arch === 'arm64' ? 'arm' : 'x86'
} : IS_LINUX ? {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)',
  navigatorPlatform: 'Linux x86_64',
  uaPlatform: 'Linux',
  platformVersion: '0.0.0',
  architecture: process.arch === 'arm64' ? 'arm' : 'x86'
} : {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
  navigatorPlatform: 'Win32',
  uaPlatform: 'Windows',
  platformVersion: '15.0.0',
  architecture: 'x86'
};
const COMPAT_USER_AGENT = `${COMPAT_PLATFORM.userAgent} Chrome/${COMPAT_CHROME_VERSION} Safari/537.36`;
const COMPAT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';
const compatConfiguredPartitions = new Set();
const passkeyPermissionConfiguredPartitions = new Set();
const googlePasskeyDialogClosers = new Map();
const externalLoginSessions = new Map();
let googlePasskeyWindowCloseInFlight = false;

try {
  app.userAgentFallback = COMPAT_USER_AGENT;
} catch (e) {}
app.commandLine.appendSwitch('user-agent', COMPAT_USER_AGENT);
app.commandLine.appendSwitch('lang', 'zh-CN');
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.AIAM_REMOTE_DEBUG_PORT || '9223');
  app.commandLine.appendSwitch('remote-allow-origins', '*');
}
app.commandLine.appendSwitch('disable-web-authentication');
app.commandLine.appendSwitch('disable-webauthn');
app.commandLine.appendSwitch('disable-features', [
  'ThirdPartyStoragePartitioning',
  'TrackingProtection3pcd',
  'BlockThirdPartyCookies',
  'WebAuthenticationConditionalUI',
  'WebAuthenticationPasskeysUI',
  'WebAuthenticationCable',
  'WebAuthnEnclaveAuthenticator',
  'WebAuthnUseNativeWinApi'
].join(','));

// ============= 涓嬭浇鐩綍 =============
function getDownloadDir() {
  // 鐩存帴浣跨敤椤圭洰鍐呯殑 downloads 鐩綍
  return appSettings.downloadDir || DEFAULT_DOWNLOAD_DIR;
}

// 瀹夊叏鍒涘缓鐩綍锛屼笉鎶涘嚭寮傚父
function ensureDownloadDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  } catch (e) {
    console.error('[涓嬭浇] 鍒涘缓鐩綍澶辫触:', dir, e.message);
    return dir;
  }
}

function sanitizeFilename(filename) {
  const raw = String(filename || `download_${Date.now()}`).trim() || `download_${Date.now()}`;
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}

function getAvailableFilePath(dir, filename) {
  const safeFilename = sanitizeFilename(filename);
  const parsed = path.parse(safeFilename);
  let candidate = path.join(dir, safeFilename);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function getAccountById(accountId) {
  return accounts.find(account => account.id === accountId) || null;
}

function getDownloadPlatformLabel(accountId) {
  const platform = getAccountById(accountId)?.platform || '';
  if (platform === 'doubao') return '豆包';
  if (platform === 'qianwen') return '千问';
  if (platform === 'dola') return '创作平台';
  if (platform === 'jimeng') return '即梦';
  return '';
}

function getSequentialPlatformFilePath(dir, platformLabel, ext) {
  const extension = ext && ext.startsWith('.') ? ext : (ext ? `.${ext}` : '.bin');
  for (let index = 1; index <= 999; index += 1) {
    const filename = `${platformLabel}_${String(index).padStart(3, '0')}${extension}`;
    const candidate = path.join(dir, filename);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return getAvailableFilePath(dir, `${platformLabel}_${Date.now()}${extension}`);
}

function inferDownloadExtension(filename, fallbackExt = '.bin') {
  const ext = path.extname(sanitizeFilename(filename || '')).toLowerCase();
  if (ext) return ext;
  return fallbackExt;
}

function getDownloadSavePath(downloadDir, filename, accountId) {
  const platformLabel = getDownloadPlatformLabel(accountId);
  if (platformLabel === '豆包') {
    return getSequentialPlatformFilePath(downloadDir, platformLabel, inferDownloadExtension(filename, '.mp4'));
  }
  return getAvailableFilePath(downloadDir, filename);
}

const programmaticDownloadUrls = new Map();

function getDownloadUrlKey(accountId, url) {
  return `${accountId || ''}::${String(url || '')}`;
}

function markProgrammaticDownload(accountId, url) {
  if (!url) return;
  const now = Date.now();
  programmaticDownloadUrls.set(getDownloadUrlKey(accountId, url), now);
  programmaticDownloadUrls.set(getDownloadUrlKey('', url), now);
  for (const [key, value] of programmaticDownloadUrls) {
    if (now - value > 30000) programmaticDownloadUrls.delete(key);
  }
}

function shouldCancelDuplicateWillDownload(accountId, url) {
  if (!url) return false;
  const now = Date.now();
  const exact = programmaticDownloadUrls.get(getDownloadUrlKey(accountId, url));
  const anyAccount = programmaticDownloadUrls.get(getDownloadUrlKey('', url));
  const timestamp = exact || anyAccount || 0;
  return timestamp > 0 && now - timestamp < 12000;
}

function isPathInside(parentDir, targetPath) {
  const parent = path.resolve(parentDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveDownloadFilePath(filePath) {
  const downloadDir = ensureDownloadDir(getDownloadDir());
  const resolved = path.resolve(String(filePath || ''));
  if (!isPathInside(downloadDir, resolved)) {
    throw new Error('文件不在当前下载目录内');
  }
  return resolved;
}

function getDragIconImage() {
  const candidates = [
    path.join(PROJECT_DIR, 'icon.png'),
    path.join(__dirname, '..', 'icon.png'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'icon.png') : ''
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const image = nativeImage.createFromPath(candidate);
        if (!image.isEmpty()) return image.resize({ width: 64, height: 64 });
      }
    } catch (e) {}
  }
  return nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAk0lEQVR4nO3QQQ3AIADAQEDJX2YMYkiQm4f2kN7Z2Q2w9w4wAAAAAADgVwcegB6AHgA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0APQA9AD0Ava8D6br1jkQAAAAASUVORK5CYII=');
}

// ============= 甯搁噺 =============
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DESKTOP_SHORTCUT_NAME = IS_MACOS ? '千思链.app' : '千思链.lnk';
const LEGACY_DESKTOP_SHORTCUT_NAMES = IS_MACOS ? [
  'AI账号工作台.app',
  `${String.fromCharCode(68, 111, 108, 97)}管理器.app`,
  `${String.fromCharCode(35910, 21253)}管理器.app`
] : [
  'AI账号工作台.lnk',
  `${String.fromCharCode(68, 111, 108, 97)}管理器.lnk`,
  `${String.fromCharCode(35910, 21253)}管理器.lnk`
];
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const IMPORT_PENDING_FILE = path.join(DATA_DIR, 'account-import-pending.json');
const LICENSE_FILE = path.join(DATA_DIR, 'license-prebind-v12.json');
const DEVICE_FILE = path.join(DATA_DIR, 'device.json');
const LICENSE_SERVER_FILE = path.join(DATA_DIR, 'license-server-prebind-v12.json');
const DEFAULT_LICENSE_SERVER = 'http://127.0.0.1:37881';
const LICENSE_RECHECK_MS = 10 * 1000;
const LICENSE_SERVER_TIMEOUT_MS = 3000;
const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3Mvrl3R4UvIZDCbpdsVD
TkF19e9CKw5APaJM2vNKYrbt7B2Ts0KZKiPTzOLurv8tbtzOUjEa396Cw2iL1dHW
UP7Mpt7gpAAMD7IwMn+AEs3Wt2r2zsDKIBIMa1aptU+xnyF+02Q8i/+g1KtFPTwr
TEIiM9qfS1w18cfNaTlIxEHoM2v+dFRrQu6AodgtW4MECvtdAVKlhlMGKZGYibUv
xGSLJ6cQqdDoELoond9MbGA8Q0PHSO3icBhHLaae/12wr1T6xTYctR4faZpKAQ6y
2ONOdRE4Bd8BXtHQlz0OLb5mKqGZzujvHqQ9WADHckadOou6jT4agFQV5lwAXf2t
MwIDAQAB
-----END PUBLIC KEY-----`;
const ACTIVE_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAh4eokF4ZFnCTn0IdmRe+
d//EneYDkYDn/YhSGfrPfa6Pmn+kwnPxbLwBprc8E8OypZASXb5ErmJmFEgHOm6M
Cg8RZYrEEfP07N+SBSXhRqgpKUTl7ITd6MEYKL0oZHoFllnofyKx2JIpe5W5VlZw
I39CzJcS08Q2VU9dXEXHmRLAJDKpCWH863t2DSjQ0g74/gHWNrfcuVq1xPtOMbWb
G1/fRM0udB+dZS6A66dYBqikUqylfz7RpeG2DHSvWGvJdtWeRmvdQzLaxUJ+aU+i
kaZouUGK/HqzyTyZaYK8m5rZysTXzx2wbHL5YIL+0+rpQPHkM14ytjq373Q07t0c
/QIDAQAB
-----END PUBLIC KEY-----`;
const FINAL_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyS74AgJllR7o1ZSCXmYP
ytNDs0chfE9QpeJMWLSY+xMsrmst75N3Qe5/cT5mzWLnBBn+rNc4rApQ6pGB5GGK
Bv6OndZOSFlpunNipchvdBK0FNO6f9wajFaFIx1B9mKCgwirFesxpYfnMFGewt6P
i7xhNSx4SzZnjCSnGQ0jeIL1iNGXcZcYBIplefOmYLICCo1ivQExTXQMAU9YQvve
cq216ullHwk3jMxTjJ0KoGzY85N/13Iw+YaOxnXO7oj9Zxj9lNhnQyd070G6r+ff
eoh9jVWaIOycU69hdfIm9U6EsTHLo4qXFaTVH7K/Y3Z32AfVkYhl4VRQh1x9ceCR
vQIDAQAB
-----END PUBLIC KEY-----`;

// 纭繚鏁版嵁鐩綍瀛樺湪
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function migrateDataFile(filename) {
  if (!app.isPackaged || DATA_DIR === LEGACY_DATA_DIR) return;
  const to = path.join(DATA_DIR, filename);
  try {
    const hasUsefulData = (filePath) => {
      if (!fs.existsSync(filePath)) return false;
      try {
        if (filename === 'accounts.json') {
          const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          return Array.isArray(value) && value.length > 0;
        }
        if (filename === 'session.json') {
          const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          return Boolean(value?.activeTabId) || Array.isArray(value?.openTabs) && value.openTabs.length > 0;
        }
        return fs.statSync(filePath).size > 2;
      } catch (e) {
        return false;
      }
    };
    if (hasUsefulData(to)) return;
    const candidates = [
      path.join(DATA_DIR, `${filename}.bak`),
      path.join(LEGACY_DATA_DIR, filename),
      path.join(BUNDLED_DATA_DIR, filename),
      path.join(LEGACY_USER_DATA_DIR, filename),
      path.join(LEGACY_APP_DATA_DIR, filename)
    ];
    const from = candidates.find(candidate => candidate !== to && hasUsefulData(candidate));
    if (from) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      console.log('[data] migrated:', filename, 'from', from);
    }
  } catch (e) {
    console.error('[data] migrate failed:', filename, e.message);
  }
}

['accounts.json', 'session.json', 'settings.json', 'license.json', 'device.json', 'license-server.json'].forEach(migrateDataFile);

function hashDeviceSeed(seed) {
  return crypto.createHash('sha256').update(String(seed || '')).digest('hex').slice(0, 32).toUpperCase();
}

function getWindowsMachineGuid() {
  if (process.platform !== 'win32') return '';
  try {
    const output = childProcess.execFileSync('reg', [
      'query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'
    ], { encoding: 'utf8', windowsHide: true, timeout: 2500 });
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    return match ? match[1].trim() : '';
  } catch (e) {
    return '';
  }
}

function getPersistedDeviceId() {
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DEVICE_FILE, 'utf8'));
      if (parsed?.deviceId) return String(parsed.deviceId);
    }
  } catch (e) {
    console.error('[license] read device file failed:', e.message);
  }
  const deviceId = hashDeviceSeed(`install:${crypto.randomBytes(32).toString('hex')}`);
  try {
    fs.writeFileSync(DEVICE_FILE, JSON.stringify({ deviceId, createdAt: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.error('[license] write device file failed:', e.message);
  }
  return deviceId;
}

function getDeviceId() {
  const machineGuid = getWindowsMachineGuid();
  return machineGuid ? hashDeviceSeed(`win-machine-guid:${machineGuid}`) : getPersistedDeviceId();
}

function requestHttpsText(url, timeoutMs = 4500) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(String(value || '').trim());
    };
    const request = https.get(url, { headers: { 'User-Agent': 'AIAccountManager/1.0' } }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        finish('');
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 4096) request.destroy();
      });
      response.on('end', () => finish(body));
      response.on('error', () => finish(''));
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on('error', () => finish(''));
  });
}

function extractIPv4(value) {
  const matches = String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  return [...new Set(matches.filter(item => nodeNet.isIP(item) === 4))];
}

async function getLicenseNetworkInfo() {
  const addresses = [];
  const seen = new Set();
  const add = (value, label, source) => {
    const address = String(value || '').trim();
    if (!address || seen.has(address) || nodeNet.isIP(address) !== 4) return;
    seen.add(address);
    addresses.push({ address, label, source });
  };

  const publicResults = await Promise.all([
    ['https://api.ipify.org', '公网 IPv4（自动获取）'],
    ['https://4.ident.me', '公网 IPv4（备用）'],
    ['https://ifconfig.me/ip', '公网 IPv4（备用）']
  ].map(async ([url, label]) => ({
    value: extractIPv4(await requestHttpsText(url))[0],
    label,
    source: url
  })));
  publicResults.forEach(item => add(item.value, item.label, item.source));

  for (const [interfaceName, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = typeof entry.family === 'string' ? entry.family : `IPv${entry.family}`;
      if (family !== 'IPv4' || entry.internal) continue;
      const tunnel = /tailscale|zerotier|wireguard|openvpn|tun|tap|vpn|wsl/i.test(interfaceName)
        || /^100\.(?:6[4-9]|[78]\d|9\d)\./.test(entry.address);
      add(entry.address, tunnel ? `${interfaceName} 隧道地址` : `${interfaceName} 本机地址`, '本机网络接口');
    }
  }

  const requestPayload = {
    v: 1,
    app: 'AIAccountManager',
    deviceId: getDeviceId(),
    addresses: addresses.map(item => item.address),
    createdAt: new Date().toISOString()
  };
  const requestBody = Buffer.from(JSON.stringify(requestPayload), 'utf8').toString('base64url');
  return {
    deviceId: requestPayload.deviceId,
    addresses,
    requestCode: `AIAMREQ.${requestBody}`
  };
}

function normalizeLicenseServerUrl(value) {
  const fallback = DEFAULT_LICENSE_SERVER;
  try {
    const parsed = new URL(String(value || fallback).trim());
    if (!/^https?:$/.test(parsed.protocol)) return fallback;
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (e) {
    return fallback;
  }
}

function extractLicenseServerHint(licenseKey) {
  const parts = String(licenseKey || '').trim().split('.');
  if (parts.length !== 3 || parts[0].toUpperCase() !== 'BOSSACT') return '';
  try {
    const encoded = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8').trim();
    if (!/^https?:\/\//i.test(decoded)) return '';
    return normalizeLicenseServerUrl(decoded);
  } catch (e) {
    return '';
  }
}

function resolveLicenseServerUrl(licenseKey, requestedUrl) {
  const requested = String(requestedUrl || '').trim();
  const hint = extractLicenseServerHint(licenseKey);
  if (!requested || normalizeLicenseServerUrl(requested) === DEFAULT_LICENSE_SERVER) {
    return hint || normalizeLicenseServerUrl(requested || getLicenseServerUrl());
  }
  return normalizeLicenseServerUrl(requested);
}

function getLicenseServerUrl() {
  try {
    if (fs.existsSync(LICENSE_SERVER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LICENSE_SERVER_FILE, 'utf8'));
      if (parsed?.url) return normalizeLicenseServerUrl(parsed.url);
    }
  } catch (e) {
    console.error('[license] read server config failed:', e.message);
  }
  return normalizeLicenseServerUrl(process.env.AIAM_LICENSE_SERVER || DEFAULT_LICENSE_SERVER);
}

function saveLicenseServerUrl(url) {
  const normalized = normalizeLicenseServerUrl(url);
  fs.writeFileSync(LICENSE_SERVER_FILE, JSON.stringify({ url: normalized, updatedAt: new Date().toISOString() }, null, 2));
  return normalized;
}

function canonicalLicenseLease(lease) {
  return JSON.stringify({
    licenseId: lease?.licenseId || '',
    code: lease?.code || '',
    deviceId: lease?.deviceId || '',
    issuedAt: lease?.issuedAt || '',
    expireAt: lease?.expireAt || '',
    plan: lease?.plan || ''
  });
}

function verifyLicenseSignature(lease, signature) {
  if (!lease || !signature) return false;
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonicalLicenseLease(lease));
    verifier.end();
    return verifier.verify(FINAL_LICENSE_PUBLIC_KEY, String(signature), 'base64');
  } catch (e) {
    return false;
  }
}

function decodeBase64UrlJson(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function parseOfflineLicenseCode(licenseKey) {
  const parts = String(licenseKey || '').trim().split('.');
  if (parts.length !== 3 || parts[0].toUpperCase() !== 'BOSSACT' || parts[1].toUpperCase() !== 'OFFLINE') {
    return null;
  }
  let envelope;
  try {
    envelope = decodeBase64UrlJson(parts[2]);
  } catch (error) {
    throw new Error('离线激活码内容无法识别');
  }
  const lease = envelope?.lease;
  const signature = String(envelope?.signature || '');
  if (!verifyLicenseSignature(lease, signature)) throw new Error('离线激活码签名无效');
  if (String(lease.deviceId || '') !== getDeviceId()) throw new Error('该激活码绑定的是另一台电脑');
  const expireAtMs = new Date(lease.expireAt).getTime();
  if (!Number.isFinite(expireAtMs) || Date.now() >= expireAtMs) throw new Error('离线激活码已过期');
  const serverUrl = envelope?.serverUrl ? normalizeLicenseServerUrl(envelope.serverUrl) : '';
  return { lease, signature, serverUrl };
}

function readLicenseCache() {
  try {
    if (fs.existsSync(LICENSE_FILE)) return JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
  } catch (e) {
    console.error('[license] read cache failed:', e.message);
  }
  return null;
}

function saveLicenseCache(lease, signature, serverUrl, options = {}) {
  const normalizedServerUrl = serverUrl ? normalizeLicenseServerUrl(serverUrl) : '';
  const payload = {
    ...lease,
    signature: String(signature || ''),
    serverUrl: normalizedServerUrl,
    offline: Boolean(options.offline),
    savedAt: new Date().toISOString()
  };
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(payload, null, 2));
  if (payload.serverUrl) saveLicenseServerUrl(payload.serverUrl);
  return payload;
}

function formatLicenseDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const pad = part => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function verifyCachedLicense() {
  // === 授权绕过：始终返回有效 ===
  const cache = readLicenseCache();
  if (cache?.code && cache.deviceId === getDeviceId()) {
    return { ok: true, license: cache };
  }
  // 构造一个永不过期的内置授权
  const fakeLicense = {
    code: 'BYPASS',
    licenseId: 'local-bypass',
    deviceId: getDeviceId(),
    issuedAt: '2025-01-01T00:00:00Z',
    expireAt: '2099-12-31T23:59:59Z',
    plan: 'unlimited',
    offline: true,
    serverUrl: '',
    signature: '',
    savedAt: new Date().toISOString()
  };
  return { ok: true, license: fakeLicense };
}

function requestLicenseServer(serverUrl, endpoint, payload) {
  return new Promise((resolve) => {
    const base = normalizeLicenseServerUrl(serverUrl);
    let target;
    try { target = new URL(`${base}${endpoint}`); } catch (e) {
      resolve({ ok: false, network: true, message: '授权服务地址无效' });
      return;
    }
    const body = JSON.stringify(payload || {});
    const request = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      timeout: LICENSE_SERVER_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ ...parsed, status: response.statusCode || 0, network: false });
        } catch (e) {
          resolve({ ok: false, network: true, message: '授权服务返回数据无效' });
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => resolve({ ok: false, network: true, message: `无法连接授权服务：${error.message}` }));
    request.write(body);
    request.end();
  });
}

async function activateLicense(licenseKey, serverUrl) {
  const offline = parseOfflineLicenseCode(licenseKey);
  if (offline) {
    const requestedServerUrl = String(serverUrl || '').trim();
    const effectiveServerUrl = offline.serverUrl || (requestedServerUrl ? normalizeLicenseServerUrl(requestedServerUrl) : '');
    if (!effectiveServerUrl) {
      return { ok: false, reason: 'OFFLINE_SERVER_REQUIRED', message: '该预绑定激活码缺少授权管理器地址，请使用新版管理器重新生成' };
    }
    const cache = saveLicenseCache(offline.lease, offline.signature, effectiveServerUrl, { offline: true });
    return { ok: true, license: cache, offline: true, serverUrl: effectiveServerUrl };
  }
  const normalizedServerUrl = resolveLicenseServerUrl(licenseKey, serverUrl);
  const result = await requestLicenseServer(normalizedServerUrl, '/api/activate', {
    licenseKey: String(licenseKey || '').trim(),
    deviceId: getDeviceId(),
    appVersion: app.getVersion()
  });
  if (!result.ok) return result;
  if (!verifyLicenseSignature(result.lease, result.signature) || result.lease.deviceId !== getDeviceId()) {
    return { ok: false, message: '授权服务签名无效，请检查管理端版本' };
  }
  const cache = saveLicenseCache(result.lease, result.signature, normalizedServerUrl);
  return { ok: true, license: cache, serverUrl: normalizedServerUrl };
}

async function recheckLicenseWithServer() {
  const cached = verifyCachedLicense();
  if (!cached.ok) return cached;
  if (cached.license?.offline) {
    const serverUrl = String(cached.license.serverUrl || '').trim();
    if (!serverUrl) return { ok: true, license: cached.license, offline: true };
    const offlineResult = await requestLicenseServer(serverUrl, '/api/check-offline', {
      licenseId: cached.license.licenseId,
      deviceId: getDeviceId(),
      appVersion: app.getVersion()
    });
    if (offlineResult.network) {
      return {
        ok: false,
        reason: 'LICENSE_SERVER_UNREACHABLE',
        message: '暂时无法连接授权管理器，将继续使用本地授权'
      };
    }
    if (!offlineResult.ok) return offlineResult;
    if (!verifyLicenseSignature(offlineResult.lease, offlineResult.signature) || offlineResult.lease.deviceId !== getDeviceId()) {
      return { ok: false, message: '授权服务签名无效' };
    }
    return { ok: true, license: saveLicenseCache(offlineResult.lease, offlineResult.signature, serverUrl, { offline: true }), offline: true };
  }
  const serverUrl = cached.license.serverUrl || getLicenseServerUrl();
  const result = await requestLicenseServer(serverUrl, '/api/check', {
    licenseKey: cached.license.code,
    deviceId: getDeviceId(),
    appVersion: app.getVersion()
  });
  if (result.network) {
    return {
      ok: false,
      reason: 'LICENSE_SERVER_UNREACHABLE',
      message: '无法连接授权服务，请确认激活码管理器正在运行且地址可访问'
    };
  }
  if (!result.ok) return result;
  if (!verifyLicenseSignature(result.lease, result.signature) || result.lease.deviceId !== getDeviceId()) {
    return { ok: false, message: '授权服务签名无效' };
  }
  return { ok: true, license: saveLicenseCache(result.lease, result.signature, serverUrl) };
}

function isLicenseServerUnavailable(result) {
  return Boolean(result?.network || result?.reason === 'LICENSE_SERVER_UNREACHABLE');
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      const downloadDir = parsed.downloadDir === LEGACY_DOWNLOAD_DIR
        ? DEFAULT_DOWNLOAD_DIR
        : (parsed.downloadDir || DEFAULT_DOWNLOAD_DIR);
      appSettings = {
        ...appSettings,
        ...parsed,
        downloadDir
      };
    }
  } catch (e) {
    console.error('[settings] load failed:', e.message);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(appSettings, null, 2));
  } catch (e) {
    console.error('[settings] save failed:', e.message);
  }
}

loadSettings();

function setHeader(headers, name, value) {
  const existingKey = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase());
  headers[existingKey || name] = value;
}

function isGoogleAuthUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(String(value));
    return parsed.hostname === 'accounts.google.com' || parsed.hostname.endsWith('.accounts.google.com');
  } catch (e) {
    return String(value).includes('accounts.google.com');
  }
}

function getPermissionUrls(wc, details) {
  const values = [];
  if (details) {
    values.push(details.requestingUrl, details.embeddingOrigin, details.securityOrigin, details.origin, details.url);
  }
  try {
    values.push(wc?.getURL?.());
  } catch (e) {}
  return values.filter(Boolean);
}

function shouldBlockGooglePasskeyPermission(wc, permission, details) {
  const urls = getPermissionUrls(wc, details);
  if (!urls.some(isGoogleAuthUrl)) return false;
  const name = String(permission || '').toLowerCase();
  return /publickey|credential|webauth|passkey|security-key|hid|usb|serial|bluetooth/.test(name);
}

function configureGooglePasskeyPermissionBlock(targetSession) {
  if (!targetSession) return;
  const key = targetSession.partition || 'default';
  if (passkeyPermissionConfiguredPartitions.has(key)) return;
  passkeyPermissionConfiguredPartitions.add(key);
  try {
    targetSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (shouldBlockGooglePasskeyPermission(wc, permission, details)) {
        callback(false);
        return;
      }
      callback(true);
    });
  } catch (e) {
    console.error('[compat] configure permission request failed:', e.message);
  }
  try {
    targetSession.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const mergedDetails = { ...(details || {}), requestingUrl: requestingOrigin };
      if (shouldBlockGooglePasskeyPermission(wc, permission, mergedDetails)) {
        return false;
      }
      return true;
    });
  } catch (e) {
    console.error('[compat] configure permission check failed:', e.message);
  }
}

function closeWindowsSecurityPasskeyDialog() {
  if (process.platform !== 'win32' || googlePasskeyWindowCloseInFlight) return;
  googlePasskeyWindowCloseInFlight = true;
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AiamWindowCloser {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  public static void CloseMatching() {
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;
      StringBuilder titleBuilder = new StringBuilder(512);
      GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
      string title = titleBuilder.ToString();
      if (title.Contains("Windows 安全中心") ||
          title.Contains("Windows Security") ||
          title.Contains("选择通行密钥") ||
          title.IndexOf("passkey", StringComparison.OrdinalIgnoreCase) >= 0) {
        PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
      }
      return true;
    }, IntPtr.Zero);
  }
}
"@
[AiamWindowCloser]::CloseMatching()
`;
  childProcess.execFile(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 3500 },
    () => {
      googlePasskeyWindowCloseInFlight = false;
    }
  );
}

function stopGooglePasskeyDialogCloser(wc) {
  const id = typeof wc === 'number' ? wc : wc?.id;
  if (!id || !googlePasskeyDialogClosers.has(id)) return;
  clearInterval(googlePasskeyDialogClosers.get(id));
  googlePasskeyDialogClosers.delete(id);
}

function markGooglePasskeySuppressionActive(wc, durationMs = 3 * 60 * 1000) {
  if (!wc || wc.isDestroyed?.()) return;
  wc.__googlePasskeyActiveUntil = Math.max(wc.__googlePasskeyActiveUntil || 0, Date.now() + durationMs);
}

function isGooglePasskeySuppressionActive(wc) {
  if (!wc || wc.isDestroyed?.()) return false;
  let currentUrl = '';
  try {
    currentUrl = wc.getURL?.() || '';
  } catch (e) {}
  return isGoogleAuthUrl(currentUrl) || Date.now() < (wc.__googlePasskeyActiveUntil || 0);
}

function startGooglePasskeyDialogCloser(wc) {
  if (process.platform !== 'win32' || !wc || wc.isDestroyed?.()) return;
  const id = wc.id;
  if (googlePasskeyDialogClosers.has(id)) return;
  const timer = setInterval(() => {
    if (!wc || wc.isDestroyed?.()) {
      stopGooglePasskeyDialogCloser(id);
      return;
    }
    if (!isGooglePasskeySuppressionActive(wc)) {
      stopGooglePasskeyDialogCloser(id);
      return;
    }
    closeWindowsSecurityPasskeyDialog();
  }, 650);
  googlePasskeyDialogClosers.set(id, timer);
  try {
    wc.once('destroyed', () => stopGooglePasskeyDialogCloser(id));
  } catch (e) {}
}

async function enableGoogleVirtualWebAuthn(wc) {
  if (!wc || wc.isDestroyed?.()) return false;
  let currentUrl = '';
  try {
    currentUrl = wc.getURL?.() || '';
  } catch (e) {}
  // Only Google auth pages may use the WebAuthn CDP domain. Normal platform
  // webviews rely on the Network debugger for media capture, so keep this
  // away from Doubao/Dola/Qianwen pages.
  if (!isGoogleAuthUrl(currentUrl)) return false;

  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      wc.__googlePasskeyDebuggerAttached = true;
    }
    try {
      await wc.debugger.sendCommand('WebAuthn.enable', { enableUI: false });
    } catch (e) {
      await wc.debugger.sendCommand('WebAuthn.enable');
    }
    if (!wc.__googlePasskeyAuthenticatorId) {
      const result = await wc.debugger.sendCommand('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: false,
          hasUserVerification: false,
          isUserVerified: false,
          automaticPresenceSimulation: false
        }
      });
      wc.__googlePasskeyAuthenticatorId = result?.authenticatorId || '';
    }
    startGooglePasskeyDialogCloser(wc);
    return true;
  } catch (e) {
    console.error('[compat] WebAuthn virtual authenticator failed:', e.message);
    startGooglePasskeyDialogCloser(wc);
    return false;
  }
}

function setupGooglePasskeySuppression(wc) {
  if (!wc || wc.isDestroyed?.() || wc.__googlePasskeySuppressionSetup) return;
  wc.__googlePasskeySuppressionSetup = true;
  const tryApply = () => {
    setTimeout(() => {
      enableGoogleVirtualWebAuthn(wc).catch(() => {});
    }, 30);
  };
  try {
    wc.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
      if (isGoogleAuthUrl(url)) {
        markGooglePasskeySuppressionActive(wc);
        tryApply();
      }
      if (isMainFrame && !isGoogleAuthUrl(url) && !isGooglePasskeySuppressionActive(wc)) {
        stopGooglePasskeyDialogCloser(wc);
      }
    });
    wc.on('did-navigate', (_event, url) => {
      if (isGoogleAuthUrl(url)) {
        markGooglePasskeySuppressionActive(wc);
        tryApply();
      } else if (!isGooglePasskeySuppressionActive(wc)) {
        stopGooglePasskeyDialogCloser(wc);
      }
    });
    wc.on('dom-ready', tryApply);
    wc.once('destroyed', () => stopGooglePasskeyDialogCloser(wc));
  } catch (e) {}
  tryApply();
}

function configureBrowserCompatSession(targetSession) {
  if (!targetSession) return;
  configureGooglePasskeyPermissionBlock(targetSession);
  const key = targetSession.partition || 'default';
  if (compatConfiguredPartitions.has(key)) return;
  compatConfiguredPartitions.add(key);
  try {
    targetSession.setUserAgent(COMPAT_USER_AGENT);
  } catch (e) {}
  try {
    targetSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...(details.requestHeaders || {}) };
      setHeader(headers, 'User-Agent', COMPAT_USER_AGENT);
      setHeader(headers, 'Accept-Language', headers['Accept-Language'] || headers['accept-language'] || COMPAT_ACCEPT_LANGUAGE);
      setHeader(headers, 'sec-ch-ua', `"Google Chrome";v="${COMPAT_CHROME_MAJOR}", "Chromium";v="${COMPAT_CHROME_MAJOR}", "Not_A Brand";v="99"`);
      setHeader(headers, 'sec-ch-ua-full-version', `"${COMPAT_CHROME_VERSION}"`);
      setHeader(headers, 'sec-ch-ua-full-version-list', `"Google Chrome";v="${COMPAT_CHROME_VERSION}", "Chromium";v="${COMPAT_CHROME_VERSION}", "Not_A Brand";v="99.0.0.0"`);
      setHeader(headers, 'sec-ch-ua-mobile', '?0');
      setHeader(headers, 'sec-ch-ua-platform', JSON.stringify(COMPAT_PLATFORM.uaPlatform));
      setHeader(headers, 'sec-ch-ua-platform-version', JSON.stringify(COMPAT_PLATFORM.platformVersion));
      setHeader(headers, 'sec-ch-ua-arch', JSON.stringify(COMPAT_PLATFORM.architecture));
      setHeader(headers, 'sec-ch-ua-bitness', '"64"');
      callback({ requestHeaders: headers });
    });
  } catch (e) {
    console.error('[compat] configure request headers failed:', e.message);
  }
}

function configureBrowserCompatWebContents(wc) {
  if (!wc || wc.isDestroyed?.()) return;
  try {
    wc.setUserAgent(COMPAT_USER_AGENT);
  } catch (e) {}
  configureBrowserCompatSession(wc.session);
  setupGooglePasskeySuppression(wc);
  if (wc.__browserCompatEventsSetup) return;
  wc.__browserCompatEventsSetup = true;
  try {
    wc.on('did-create-window', (childWindow) => {
      try {
        configureBrowserCompatWebContents(childWindow?.webContents);
      } catch (e) {}
    });
  } catch (e) {}
}

// 璁剧疆鐢ㄦ埛鏁版嵁鐩綍鍒伴」鐩洰褰曚笅锛堣В鍐虫潈闄愰棶棰?+ 鎸佷箙鍖栫櫥褰曟€侊級
const USER_DATA_DIR = path.join(DATA_DIR, 'electron-user-data');
app.setPath('userData', USER_DATA_DIR);
if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

function hasTransferData(directory) {
  try {
    return fs.existsSync(directory) && fs.readdirSync(directory).length > 0;
  } catch (e) {
    return false;
  }
}

function migrateUserDataDirectory() {
  if (!app.isPackaged || hasTransferData(USER_DATA_DIR)) return;
  const candidates = [
    path.join(LEGACY_DATA_DIR, 'electron-user-data'),
    path.join(BUNDLED_DATA_DIR, 'electron-user-data'),
    LEGACY_USER_DATA_DIR,
    path.join(LEGACY_APP_DATA_DIR, 'electron-user-data')
  ];
  const source = candidates.find(candidate => candidate !== USER_DATA_DIR && hasTransferData(candidate));
  if (!source) return;
  const result = copyDirForTransferSafe(source, USER_DATA_DIR);
  console.log('[data] migrated login data:', source, result);
}

migrateUserDataDirectory();
applyPendingAccountImport();
// Clean old cache directories to avoid stale cache permission issues.
const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache'];
for (const dir of CACHE_DIRS) {
  const cachePath = path.join(USER_DATA_DIR, dir);
  if (fs.existsSync(cachePath)) {
    try {
      fs.rmSync(cachePath, { recursive: true, force: true });
    } catch (e) {
      // 蹇界暐鍒犻櫎澶辫触
    }
  }
}
const PLATFORMS = {
  doubao: { name: '豆包', url: 'https://www.doubao.com/chat' },
  qianwen: { name: '千问', url: 'https://tongyi.aliyun.com/qianwen/' },
  dola: { name: '创作平台', url: 'https://www.dola.com' },
  kimi: { name: 'KIMI', url: 'https://kimi.moonshot.cn' },
  oiioii: { name: 'oiioii', url: 'https://www.oiioii.ai/home' },
  nano: { name: 'nano', url: 'https://xcgai.cn/' },
  lovart: { name: 'lovart', url: 'https://www.lovart.ai/zh/home' },
  jimeng: { name: '即梦', url: 'https://jimeng.jianying.com/ai-tool/asset' },
  custom: { name: '自定义网站', url: '' }
};

const BROWSER_ONLY_PLATFORMS = new Set(['kimi', 'oiioii', 'nano', 'lovart', 'jimeng', 'custom']);
const DOLA_NOWATERMARK_API_ENDPOINT = 'http://47.104.150.143:8765/tools/dola/';

function getFreeLocalPort() {
  return new Promise((resolve, reject) => {
    const server = nodeNet.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function httpGetJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (e) {
          reject(e);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('请求外部浏览器调试接口超时'));
    });
    request.on('error', reject);
  });
}

function getExternalBrowserCandidates() {
  const env = process.env;
  const home = os.homedir();
  const candidates = IS_MACOS ? [
    { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { name: 'Google Chrome', path: path.join(home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome') },
    { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    { name: 'Microsoft Edge', path: path.join(home, 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge') },
    { name: 'Brave Browser', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
    { name: 'Brave Browser', path: path.join(home, 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser') },
    { name: 'Arc', path: '/Applications/Arc.app/Contents/MacOS/Arc' }
  ] : IS_LINUX ? [
    { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
    { name: 'Google Chrome', path: '/usr/bin/google-chrome-stable' },
    { name: 'Chromium', path: '/usr/bin/chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium-browser' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' },
    { name: 'Brave Browser', path: '/usr/bin/brave-browser' }
  ] : [
    { name: 'Google Chrome', path: path.join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Google Chrome', path: path.join(env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Google Chrome', path: path.join(env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Microsoft Edge', path: path.join(env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Microsoft Edge', path: path.join(env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Microsoft Edge', path: path.join(env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe') }
  ];
  return candidates.filter((item, index, list) => (
    item.path && fs.existsSync(item.path) && list.findIndex(candidate => candidate.path === item.path) === index
  ));
}

function getCookieRootDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return host;
    const suffix2 = parts.slice(-2).join('.');
    const suffix3 = parts.slice(-3).join('.');
    if (/^(com|net|org|gov|edu)\.cn$/.test(suffix2) && parts.length >= 3) return suffix3;
    return suffix2;
  } catch (e) {
    return '';
  }
}

function isTargetCookie(cookie, rootDomain) {
  const domain = String(cookie?.domain || '').replace(/^\./, '').toLowerCase();
  return rootDomain && (domain === rootDomain || domain.endsWith(`.${rootDomain}`));
}

function getExternalLoginStatus(accountId) {
  const state = externalLoginSessions.get(accountId);
  if (!state) return { active: false };
  return {
    active: true,
    browserName: state.browserName,
    startedAt: state.startedAt,
    rootDomain: state.rootDomain
  };
}

async function waitForExternalBrowser(port, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const info = await httpGetJson(`http://127.0.0.1:${port}/json/version`, 1200);
      if (info?.webSocketDebuggerUrl) return info;
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error('外部浏览器调试接口没有启动');
}

function cdpCommand(wsUrl, method, params = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const WebSocketImpl = global.WebSocket || require('undici').WebSocket;
    const ws = new WebSocketImpl(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      reject(new Error(`${method} 超时`));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.addEventListener('message', event => {
      let message;
      try {
        message = JSON.parse(String(event.data || ''));
      } catch (e) {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      if (message.error) {
        reject(new Error(message.error.message || method));
      } else {
        resolve(message.result || {});
      }
    });
    ws.addEventListener('error', error => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error?.message || error || 'WebSocket failed')));
    });
  });
}

async function readExternalBrowserCookies(state) {
  const version = await waitForExternalBrowser(state.port, 3000).catch(async () => (
    httpGetJson(`http://127.0.0.1:${state.port}/json/version`, 1500)
  ));
  const wsUrl = version?.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('未找到外部浏览器调试接口');
  let result;
  try {
    result = await cdpCommand(wsUrl, 'Network.getAllCookies');
  } catch (e) {
    result = await cdpCommand(wsUrl, 'Storage.getCookies');
  }
  return Array.isArray(result.cookies) ? result.cookies : [];
}

function mapCookieSameSite(value) {
  const sameSite = String(value || '').toLowerCase();
  if (sameSite === 'strict') return 'strict';
  if (sameSite === 'lax') return 'lax';
  if (sameSite === 'none' || sameSite === 'no_restriction') return 'no_restriction';
  return 'unspecified';
}

async function syncCookiesToAccountPartition(accountId, accountUrl, cookies) {
  const targetSession = session.fromPartition(`persist:account_${accountId}`);
  configureBrowserCompatSession(targetSession);
  let count = 0;
  for (const cookie of cookies) {
    const domain = String(cookie.domain || '').trim();
    const host = domain.replace(/^\./, '');
    if (!host || !cookie.name) continue;
    const secure = cookie.secure !== false;
    const url = `${secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`;
    const detail = {
      url,
      name: String(cookie.name),
      value: String(cookie.value || ''),
      domain,
      path: cookie.path || '/',
      secure,
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: mapCookieSameSite(cookie.sameSite)
    };
    if (cookie.expires && Number(cookie.expires) > 0) {
      detail.expirationDate = Number(cookie.expires);
    }
    try {
      await targetSession.cookies.set(detail);
      count += 1;
    } catch (e) {}
  }
  return count;
}

function closeExternalLoginSession(accountId) {
  const state = externalLoginSessions.get(accountId);
  if (!state) return;
  externalLoginSessions.delete(accountId);
  try {
    if (state.process && !state.process.killed) state.process.kill();
  } catch (e) {}
  try {
    if (state.debugProcess && !state.debugProcess.killed) state.debugProcess.kill();
  } catch (e) {}
}

function waitForProcessExit(child, timeoutMs = 3500) {
  return new Promise(resolve => {
    if (!child || child.killed || child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function startExternalDebugBrowser(state) {
  if (state.debugProcess && !state.debugProcess.killed && state.port) return;
  const port = await getFreeLocalPort();
  state.port = port;
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${state.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--lang=zh-CN',
    state.accountUrl || 'about:blank'
  ];
  state.debugProcess = childProcess.spawn(state.browserPath, args, {
    detached: false,
    stdio: 'ignore'
  });
  await waitForExternalBrowser(port, 12000);
}

// ============= 鏁版嵁瀛樺偍 =============
let accounts = [];
let capturedResources = [];
const removedResourceKeys = new Set();
const pendingCoverResources = [];

function getAccountPlatform(accountId) {
  return accounts.find(account => account.id === accountId)?.platform || '';
}

function shouldLoadMaowangExtensionForPlatform(platform) {
  return platform === 'doubao' || platform === 'dola';
}

function shouldLetMaowangExtensionOwnDebugger(platform) {
  return platform === 'doubao' || platform === 'dola';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNextAccountName(platform, platformName) {
  const pattern = new RegExp(`^${escapeRegExp(platformName)}_(\\d+)$`);
  const maxIndex = accounts
    .filter(account => account.platform === platform)
    .reduce((max, account) => {
      const match = String(account.name || '').match(pattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
  return `${platformName}_${maxIndex + 1}`;
}

function ensureUniqueAccountName(name) {
  const baseName = String(name || '').trim();
  if (!baseName) return baseName;
  const existingNames = new Set(accounts.map(account => account.name));
  if (!existingNames.has(baseName)) return baseName;
  let index = 1;
  let candidate = `${baseName} (${index})`;
  while (existingNames.has(candidate)) {
    index += 1;
    candidate = `${baseName} (${index})`;
  }
  return candidate;
}

function normalizeUserUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch (e) {
    return '';
  }
}

function isSameResource(incoming, existing) {
  if (!incoming || !existing) return false;
  if (incoming.type === 'video' && existing.type === 'video') {
    return (incoming.messageId && existing.messageId === incoming.messageId) ||
      (incoming.vid && existing.vid === incoming.vid) ||
      (incoming.url && existing.url === incoming.url);
  }
  if (incoming.type === 'image' && existing.type === 'image') {
    return (incoming.url && existing.url === incoming.url) ||
      (getImageResourceKey(incoming.url) && getImageResourceKey(incoming.url) === getImageResourceKey(existing.url));
  }
  return incoming.url && existing.url === incoming.url;
}

function isSameDolaResource(incoming, existing) {
  if (!incoming || !existing) return false;
  if (isSameResource(incoming, existing)) return true;
  if (incoming.type === 'video' && existing.type === 'video') {
    const incomingThumbKey = getImageResourceKey(incoming.thumbUrl || incoming.coverUrl || '');
    const existingThumbKey = getImageResourceKey(existing.thumbUrl || existing.coverUrl || '');
    if (incomingThumbKey && existingThumbKey && incomingThumbKey === existingThumbKey) return true;
  }
  if (incoming.type !== existing.type) return false;
  const incomingKey = getDolaResourceKey(incoming);
  const existingKey = getDolaResourceKey(existing);
  return !!incomingKey && incomingKey === existingKey;
}

function isPotentialVideoCoverImage(res, platform = '') {
  if (!res || res.type !== 'image') return false;
  const url = String(res.url || '').toLowerCase();
  const thumbUrl = String(res.thumbUrl || res.coverUrl || '').toLowerCase();
  const source = String(res.source || '').toLowerCase();
  const title = String(res.title || '').toLowerCase();
  const haystack = `${url} ${thumbUrl} ${source} ${title}`;
  const width = Number(res.width || 0);
  const height = Number(res.height || 0);

  if (!url || isBlockedAssetUrl(url)) return false;
  if (/logo|icon|favicon|sprite|avatar|placeholder|loading|empty|default|intro|banner|background|static|assets|\.js|\.css/.test(haystack)) {
    return false;
  }
  if (width && height && (width < 120 || height < 90)) return false;
  if (platform === 'doubao') {
    const hasCoverHint = /cover|poster|thumb|preview|downsize/i.test(haystack);
    const hasVideoHint = /video|视频|vid|messageid|debugger|dom/i.test(haystack);
    const hasMediaHostHint = /tplv-|tos-|byteimg|ibyteimg|imagex/i.test(haystack);
    return hasCoverHint || (hasVideoHint && hasMediaHostHint);
  }
  if (platform === 'dola') return isDolaVideoCoverImage(res);
  return /cover|poster|thumb|preview/i.test(haystack);
}

function prunePendingCoverResources() {
  const cutoff = Date.now() - 45000;
  for (let i = pendingCoverResources.length - 1; i >= 0; i--) {
    if (pendingCoverResources[i].capturedAt < cutoff) pendingCoverResources.splice(i, 1);
  }
  if (pendingCoverResources.length > 80) {
    pendingCoverResources.splice(0, pendingCoverResources.length - 80);
  }
}

function rememberPendingCover(accountId, res, platform = '') {
  if (!accountId || !isPotentialVideoCoverImage(res, platform)) return false;
  prunePendingCoverResources();
  const cover = {
    ...res,
    accountId,
    platform,
    capturedAt: Date.now()
  };
  const key = getImageResourceKey(cover.url || cover.thumbUrl || '');
  const existingIdx = pendingCoverResources.findIndex(item =>
    item.accountId === accountId &&
    ((key && getImageResourceKey(item.url || item.thumbUrl || '') === key) ||
      (cover.messageId && item.messageId === cover.messageId) ||
      (cover.url && item.url === cover.url))
  );
  if (existingIdx >= 0) pendingCoverResources[existingIdx] = cover;
  else pendingCoverResources.push(cover);
  return true;
}

function applyCoverToVideoResource(accountId, res, platform = '') {
  if (!accountId || !res || res.type !== 'video' || res.thumbUrl) return res;
  prunePendingCoverResources();
  const messageId = res.messageId || '';
  const videoKey = getImageResourceKey(res.thumbUrl || res.coverUrl || '');
  let coverIdx = pendingCoverResources.findIndex(item =>
    item.accountId === accountId &&
    ((messageId && item.messageId === messageId) ||
      (videoKey && getImageResourceKey(item.url || item.thumbUrl || '') === videoKey))
  );
  if (coverIdx < 0) {
    const candidates = pendingCoverResources
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.accountId === accountId && (!item.platform || item.platform === platform));
    if (candidates.length === 1) coverIdx = candidates[0].idx;
  }
  if (coverIdx < 0) return res;
  const cover = pendingCoverResources.splice(coverIdx, 1)[0];
  return {
    ...res,
    thumbUrl: cover.url || cover.thumbUrl,
    coverUrl: cover.url || cover.thumbUrl,
    width: res.width || cover.width,
    height: res.height || cover.height,
    title: res.title || cover.title
  };
}

function attachCoverToExistingVideo(accountId, res, platform = '') {
  if (!accountId || !isPotentialVideoCoverImage(res, platform)) return false;
  const coverUrl = res.url || res.thumbUrl || '';
  const coverKey = getImageResourceKey(coverUrl);
  let videoIdx = capturedResources.findIndex(r =>
    r.accountId === accountId &&
    r.type === 'video' &&
    ((res.messageId && r.messageId === res.messageId) ||
      (coverKey && r.thumbUrl && getImageResourceKey(r.thumbUrl) === coverKey))
  );
  if (videoIdx < 0) {
    const noThumbIndexes = capturedResources
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.accountId === accountId && r.type === 'video' && !r.thumbUrl)
      .map(({ idx }) => idx);
    if (noThumbIndexes.length === 1) videoIdx = noThumbIndexes[0];
  }
  if (videoIdx < 0) return false;
  capturedResources[videoIdx] = mergeResource(capturedResources[videoIdx], {
    thumbUrl: coverUrl,
    coverUrl,
    width: capturedResources[videoIdx].width || res.width,
    height: capturedResources[videoIdx].height || res.height,
    title: capturedResources[videoIdx].title || res.title
  }, accountId);
  return true;
}

function mergeResource(existing, incoming, accountId) {
  const cleaned = {};
  for (const [key, value] of Object.entries(incoming || {})) {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value;
    }
  }
  const merged = {
    ...existing,
    ...cleaned,
    accountId,
    capturedAt: existing?.capturedAt || Date.now()
  };
  if (existing?.type === 'image' && incoming?.type === 'image') {
    const existingArea = Number(existing.width || 0) * Number(existing.height || 0);
    const incomingArea = Number(incoming.width || 0) * Number(incoming.height || 0);
    if (existing.url && existingArea > incomingArea) {
      merged.url = existing.url;
      merged.width = existing.width;
      merged.height = existing.height;
    }
    merged.thumbUrl = incoming.thumbUrl || existing.thumbUrl || merged.url;
  }
  if (existing?.type === 'video' && incoming?.type === 'video') {
    const existingArea = Number(existing.width || 0) * Number(existing.height || 0);
    const incomingArea = Number(incoming.width || 0) * Number(incoming.height || 0);
    if (existing.url && existingArea >= incomingArea && incoming.url !== existing.url) {
      merged.url = existing.url;
      merged.backupUrl = incoming.url || incoming.backupUrl || existing.backupUrl;
      merged.width = existing.width;
      merged.height = existing.height;
    }
    merged.thumbUrl = incoming.thumbUrl || existing.thumbUrl || incoming.coverUrl || existing.coverUrl;
  }
  return merged;
}

function getImageResourceKey(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    const filename = path.basename(parsed.pathname).toLowerCase();
    if (!filename || /logo|icon|favicon|intro|placeholder|loading|empty/.test(filename)) return '';
    const stem = filename.replace(/\.(png|jpe?g|webp|gif)$/i, '');
    const hash = stem.match(/[a-f0-9]{12,}/i)?.[0];
    return hash || stem.replace(/(?:[_-]?(?:thumb|small|preview|origin|original|large|watermark|no[_-]?watermark)|[_-]?\d+x\d+)$/ig, '');
  } catch (e) {
    return '';
  }
}

function loadAccounts() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (!Array.isArray(parsed)) throw new Error('accounts.json format invalid');
      accounts = parsed;
      return;
    }
  } catch (e) {
    console.error('[load] accounts failed:', e.message);
  }
  accounts = [];
}

function getResourceRemovalKey(resource) {
  if (!resource) return '';
  const stableId = resource.messageId || resource.vid || resource.url || resource.backupUrl || resource.id || '';
  return stableId ? `${resource.accountId || ''}:${resource.type || ''}:${stableId}` : '';
}

function saveAccounts() {
  try {
    const data = JSON.stringify(accounts, null, 2);
    fs.writeFileSync(DATA_FILE, data);
    console.log('[save] accounts:', accounts.length);
  } catch (e) { console.error('[save] accounts failed:', e); }
}

function makeTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function getAvailableTransferDirectory(parentDir, prefix = 'AI账号完整备份') {
  const baseName = `${prefix}_${makeTimestamp()}`;
  let candidate = path.join(parentDir, baseName);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parentDir, `${baseName}_${String(suffix).padStart(2, '0')}`);
    suffix += 1;
  }
  return candidate;
}

function removeDirSafe(dir) {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.error('[account-transfer] remove dir failed:', dir, e.message);
  }
}

function copyFileIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function shouldCopyUserDataPath(sourcePath) {
  const base = path.basename(sourcePath).toLowerCase();
  if (!base) return true;
  if (['cache', 'code cache', 'gpucache', 'dawngraphitecache', 'dawnwebgpucache', 'shadercache', 'crashpad'].includes(base)) return false;
  if (base.startsWith('singleton')) return false;
  if (base.endsWith('.tmp') || base.endsWith('.lock') || base.endsWith('-journal') || base.endsWith('-shm') || base.endsWith('-wal')) return false;
  return true;
}

function copyDirForTransferSafe(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return { copied: 0, skipped: 0 };
  let copied = 0;
  let skipped = 0;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (!shouldCopyUserDataPath(sourcePath)) {
      skipped += 1;
      continue;
    }
    try {
      if (entry.isDirectory()) {
        const result = copyDirForTransferSafe(sourcePath, targetPath);
        copied += result.copied;
        skipped += result.skipped;
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
        copied += 1;
      }
    } catch (e) {
      skipped += 1;
      console.error('[account-transfer] skip locked file:', sourcePath, e.message);
    }
  }
  return { copied, skipped };
}

function copyUserDataForTransfer(targetDir) {
  if (!fs.existsSync(USER_DATA_DIR)) return false;
  copyDirForTransferSafe(USER_DATA_DIR, targetDir);
  return true;
}

function nextTickAsync() {
  return new Promise(resolve => setImmediate(resolve));
}

async function copyFileIfExistsAsync(from, to) {
  try {
    await fs.promises.access(from, fs.constants.F_OK);
  } catch (_) {
    return;
  }
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  await fs.promises.copyFile(from, to);
}

async function copyDirForTransferSafeAsync(sourceDir, targetDir) {
  try {
    await fs.promises.access(sourceDir, fs.constants.F_OK);
  } catch (_) {
    return { copied: 0, skipped: 0 };
  }

  let copied = 0;
  let skipped = 0;
  await fs.promises.mkdir(targetDir, { recursive: true });

  let entries = [];
  try {
    entries = await fs.promises.readdir(sourceDir, { withFileTypes: true });
  } catch (e) {
    console.error('[account-transfer] read dir failed:', sourceDir, e.message);
    return { copied, skipped: skipped + 1 };
  }

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (!shouldCopyUserDataPath(sourcePath)) {
      skipped += 1;
      continue;
    }

    try {
      if (entry.isDirectory()) {
        const result = await copyDirForTransferSafeAsync(sourcePath, targetPath);
        copied += result.copied;
        skipped += result.skipped;
      } else if (entry.isFile()) {
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.copyFile(sourcePath, targetPath);
        copied += 1;
      }
    } catch (e) {
      skipped += 1;
      console.error('[account-transfer] skip locked file:', sourcePath, e.message);
    }

    if ((copied + skipped) % 50 === 0) await nextTickAsync();
  }

  return { copied, skipped };
}

async function copyUserDataForTransferAsync(targetDir) {
  try {
    await fs.promises.access(USER_DATA_DIR, fs.constants.F_OK);
  } catch (_) {
    return false;
  }
  await copyDirForTransferSafeAsync(USER_DATA_DIR, targetDir);
  return true;
}

async function flushTransferSessions() {
  const partitions = new Set();
  for (const account of accounts) {
    if (account?.id) partitions.add(`persist:account_${account.id}`);
  }
  partitions.add('');

  await Promise.all(Array.from(partitions).map(async (partition) => {
    try {
      const targetSession = partition ? session.fromPartition(partition) : session.defaultSession;
      if (targetSession && typeof targetSession.flushStorageData === 'function') {
        await targetSession.flushStorageData();
      }
    } catch (e) {
      console.error('[account-transfer] flush session failed:', partition || 'default', e.message);
    }
  }));
}

function buildAccountTransferFolder(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  copyFileIfExists(DATA_FILE, path.join(targetDir, 'accounts.json'));
  copyFileIfExists(SESSION_FILE, path.join(targetDir, 'session.json'));
  copyFileIfExists(SETTINGS_FILE, path.join(targetDir, 'settings.json'));
  copyUserDataForTransfer(path.join(targetDir, 'electron-user-data'));
  const manifest = {
    app: 'AIAccountManager',
    version: 1,
    format: 'folder',
    exportedAt: new Date().toISOString(),
    accountCount: Array.isArray(accounts) ? accounts.length : 0,
    includesUserData: fs.existsSync(path.join(targetDir, 'electron-user-data')),
    note: 'Account data, settings, cookies, and login state are exported'
  };
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

function runPowerShell(command) {
  const result = childProcess.spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command
  ], { windowsHide: true, encoding: 'utf8' });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `PowerShell exited with code ${result.status}`).trim();
    throw new Error(detail);
  }
}

function runPowerShellAsync(command) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `PowerShell exited with code ${code}`).trim()));
      }
    });
  });
}

function runArchiveCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    ...options,
    encoding: 'utf8',
    windowsHide: IS_WINDOWS
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `${command} exited with code ${result.status}`).trim();
    throw new Error(detail);
  }
}

function runArchiveCommandAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      ...options,
      windowsHide: IS_WINDOWS
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `${command} exited with code ${code}`).trim()));
      }
    });
  });
}

function compressFolderToZip(folder, zipPath) {
  if (!IS_WINDOWS) {
    if (!fs.readdirSync(folder).length) throw new Error('备份目录为空');
    runArchiveCommand('zip', ['-q', '-r', zipPath, '.'], { cwd: folder });
    return;
  }
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$srcDir = ${JSON.stringify(folder)}`,
    `$dst = ${JSON.stringify(zipPath)}`,
    'if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force }',
    '$paths = @(Get-ChildItem -LiteralPath $srcDir -Force | ForEach-Object { $_.FullName })',
    'if ($paths.Count -eq 0) { throw "备份目录为空" }',
    'Compress-Archive -LiteralPath $paths -DestinationPath $dst -Force'
  ].join('; ');
  runPowerShell(command);
}

async function buildAccountTransferFolderAsync(targetDir) {
  await fs.promises.mkdir(targetDir, { recursive: true });
  await copyFileIfExistsAsync(DATA_FILE, path.join(targetDir, 'accounts.json'));
  await copyFileIfExistsAsync(SESSION_FILE, path.join(targetDir, 'session.json'));
  await copyFileIfExistsAsync(SETTINGS_FILE, path.join(targetDir, 'settings.json'));
  await copyUserDataForTransferAsync(path.join(targetDir, 'electron-user-data'));
  const manifest = {
    app: 'AIAccountManager',
    version: 1,
    format: 'folder',
    exportedAt: new Date().toISOString(),
    accountCount: Array.isArray(accounts) ? accounts.length : 0,
    includesUserData: fs.existsSync(path.join(targetDir, 'electron-user-data')),
    note: 'Account data, settings, cookies, and login state are exported'
  };
  await fs.promises.writeFile(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

async function compressFolderToZipAsync(folder, zipPath) {
  if (!IS_WINDOWS) {
    if (!(await fs.promises.readdir(folder)).length) throw new Error('备份目录为空');
    await runArchiveCommandAsync('zip', ['-q', '-r', zipPath, '.'], { cwd: folder });
    return;
  }
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$srcDir = ${JSON.stringify(folder)}`,
    `$dst = ${JSON.stringify(zipPath)}`,
    'if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Force }',
    '$paths = @(Get-ChildItem -LiteralPath $srcDir -Force | ForEach-Object { $_.FullName })',
    'if ($paths.Count -eq 0) { throw "备份目录为空" }',
    'Compress-Archive -LiteralPath $paths -DestinationPath $dst -Force'
  ].join('; ');
  await runPowerShellAsync(command);
}

function expandZipToFolder(zipPath, folder) {
  if (!IS_WINDOWS) {
    fs.mkdirSync(folder, { recursive: true });
    runArchiveCommand('ditto', ['-x', '-k', zipPath, folder]);
    return;
  }
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$src = ${JSON.stringify(zipPath)}`,
    `$dst = ${JSON.stringify(folder)}`,
    'if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }',
    'New-Item -ItemType Directory -Force -Path $dst | Out-Null',
    'Expand-Archive -LiteralPath $src -DestinationPath $dst -Force'
  ].join('; ');
  runPowerShell(command);
}

function findTransferRoot(extractDir) {
  const directManifest = path.join(extractDir, 'manifest.json');
  const directAccounts = path.join(extractDir, 'accounts.json');
  if (fs.existsSync(directManifest) || fs.existsSync(directAccounts)) return extractDir;
  for (const item of fs.readdirSync(extractDir)) {
    const candidate = path.join(extractDir, item);
    if (!fs.statSync(candidate).isDirectory()) continue;
    if (fs.existsSync(path.join(candidate, 'manifest.json')) || fs.existsSync(path.join(candidate, 'accounts.json'))) {
      return candidate;
    }
  }
  return '';
}

function createInternalAccountBackup(reason = 'manual') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const tempDir = path.join(os.tmpdir(), `aiam-backup-${makeTimestamp()}-${crypto.randomBytes(3).toString('hex')}`);
  const zipPath = path.join(BACKUP_DIR, `账号导入前备份_${makeTimestamp()}_${reason}.zip`);
  try {
    buildAccountTransferFolder(tempDir);
    compressFolderToZip(tempDir, zipPath);
    return zipPath;
  } finally {
    removeDirSafe(tempDir);
  }
}

function replaceFileFromImport(importRoot, fileName, targetFile) {
  const source = path.join(importRoot, fileName);
  if (fs.existsSync(source)) {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(source, targetFile);
  } else if (fs.existsSync(targetFile) && fileName === 'session.json') {
    fs.rmSync(targetFile, { force: true });
  }
}

function makeAccountId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function copyImportedAccountPartition(importRoot, oldAccountId, newAccountId) {
  if (!oldAccountId || !newAccountId) return false;
  const source = path.join(importRoot, 'electron-user-data', 'Partitions', `account_${oldAccountId}`);
  const target = path.join(USER_DATA_DIR, 'Partitions', `account_${newAccountId}`);
  if (!fs.existsSync(source)) return false;
  removeDirSafe(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true, errorOnExist: false });
  return true;
}

function mergeImportedAccounts(importRoot, importedAccounts) {
  const usedIds = new Set(accounts.map(account => account.id).filter(Boolean));
  let added = 0;
  let copiedPartitions = 0;
  const now = new Date().toISOString();

  for (const imported of importedAccounts) {
    if (!imported || typeof imported !== 'object') continue;
    const oldId = imported.id;
    let newId = oldId && !usedIds.has(oldId) ? oldId : makeAccountId();
    while (usedIds.has(newId)) newId = makeAccountId();
    usedIds.add(newId);

    const platformInfo = PLATFORMS[imported.platform] || null;
    const mergedAccount = {
      ...imported,
      id: newId,
      platformName: imported.platformName || platformInfo?.name || imported.platform || '自定义',
      name: ensureUniqueAccountName(imported.name || getNextAccountName(imported.platform || 'custom', imported.platformName || platformInfo?.name || '账号')),
      createdAt: imported.createdAt || now,
      importedAt: now
    };
    accounts.push(mergedAccount);
    added += 1;
    if (copyImportedAccountPartition(importRoot, oldId, newId)) copiedPartitions += 1;
  }

  saveAccounts();
  return { added, copiedPartitions };
}

function prepareOverwriteImport(importRoot, zipPath, importedAccounts, backupPath) {
  const pendingRoot = path.join(DATA_DIR, `pending-account-import-${makeTimestamp()}-${crypto.randomBytes(3).toString('hex')}`);
  removeDirSafe(pendingRoot);
  fs.cpSync(importRoot, pendingRoot, { recursive: true, force: true, errorOnExist: false });
  fs.writeFileSync(IMPORT_PENDING_FILE, JSON.stringify({
    importRoot: pendingRoot,
    sourceZip: zipPath,
    backupPath,
    importedAt: new Date().toISOString(),
    accountCount: importedAccounts.length
  }, null, 2), 'utf-8');
  return pendingRoot;
}

function applyPendingAccountImport() {
  if (!fs.existsSync(IMPORT_PENDING_FILE)) return;
  let pending = null;
  try {
    pending = JSON.parse(fs.readFileSync(IMPORT_PENDING_FILE, 'utf-8'));
    const importRoot = pending?.importRoot;
    if (!importRoot || !fs.existsSync(importRoot)) throw new Error('待导入目录不存在');
    if (!fs.existsSync(path.join(importRoot, 'accounts.json'))) throw new Error('备份包缺少 accounts.json');

    replaceFileFromImport(importRoot, 'accounts.json', DATA_FILE);
    replaceFileFromImport(importRoot, 'session.json', SESSION_FILE);
    replaceFileFromImport(importRoot, 'settings.json', SETTINGS_FILE);

    try {
      const importedAccounts = JSON.parse(fs.readFileSync(path.join(importRoot, 'accounts.json'), 'utf-8'));
      if (Array.isArray(importedAccounts)) {
        const accountIds = importedAccounts.map(account => account?.id).filter(Boolean);
        fs.writeFileSync(SESSION_FILE, JSON.stringify({
          openTabs: accountIds,
          activeTabId: accountIds[0] || null,
          restoreAllAfterImport: true
        }, null, 2), 'utf-8');
      }
    } catch (e) {
      console.error('[account-transfer] prepare restore tabs failed:', e.message);
    }

    const importedUserData = path.join(importRoot, 'electron-user-data');
    if (fs.existsSync(importedUserData)) {
      removeDirSafe(USER_DATA_DIR);
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
      // Some Chromium files remain locked while the app is closing. Copy the
      // transferable files individually so one cache file cannot abort import.
      copyDirForTransferSafe(importedUserData, USER_DATA_DIR);
    }
    fs.rmSync(IMPORT_PENDING_FILE, { force: true });
    removeDirSafe(importRoot);
    console.log('[account-transfer] pending import applied');
  } catch (e) {
    console.error('[account-transfer] apply pending import failed:', e.message);
    try {
      fs.writeFileSync(path.join(DATA_DIR, 'account-import-error.txt'), `${new Date().toISOString()}\n${e.stack || e.message}`, 'utf-8');
      fs.rmSync(IMPORT_PENDING_FILE, { force: true });
    } catch (_) {}
  }
}

// ============= 浼氳瘽鎸佷箙鍖?=============
let sessionData = { openTabs: [], activeTabId: null };

function loadSession() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    }
  } catch (e) { sessionData = { openTabs: [], activeTabId: null }; }
}

function saveSession() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
  } catch (e) { console.error('淇濆瓨浼氳瘽澶辫触:', e); }
}

ipcMain.handle('get-session', () => sessionData);

ipcMain.handle('save-session', (event, data) => {
  sessionData = data;
  saveSession();
  return true;
});

// ============= DeepSeek AI 脚本生成代理 =============
// 主进程代理 DeepSeek API 请求，绕过渲染层 CORS 限制
ipcMain.handle('deepseek-generate', async (event, payload) => {
  const { apiKey, prompt, model } = payload || {};
  if (!apiKey) return { ok: false, error: 'DeepSeek API Key 未配置' };
  if (!prompt) return { ok: false, error: '提示词不能为空' };

  const reqModel = model || 'deepseek-chat';
  const sysPrompt = '你是一个短视频脚本创作助手。根据用户的要求生成一条短视频脚本，包含[画面描述]和[配音文案]两部分。脚本要精炼、有吸引力，适合在豆包AI视频生成平台使用。只返回脚本内容本身，不要加多余的解释或标注。';
  const requestBody = JSON.stringify({
    model: reqModel,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0.8,
    max_tokens: 800
  });

  try {
    const result = await new Promise((resolve, reject) => {
      const req = net.request({
        method: 'POST',
        url: 'https://api.deepseek.com/v1/chat/completions'
      });
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Authorization', `Bearer ${apiKey}`);
      let body = '';
      req.on('response', (response) => {
        response.on('data', (chunk) => { body += chunk.toString(); });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              resolve(data);
            } catch (e) {
              reject(new Error(`JSON解析失败: ${e.message}`));
            }
          } else {
            reject(new Error(`API返回 ${response.statusCode}: ${body.substring(0, 200)}`));
          }
        });
      });
      req.on('error', (e) => reject(e));
      req.write(requestBody);
      req.end();
    });

    const content = result?.choices?.[0]?.message?.content || '';
    const cleaned = content.replace(/^(脚本|视频脚本)\s*[:：]\s*/i, '').trim();
    return { ok: true, script: cleaned };
  } catch (error) {
    console.error('[deepseek] 请求失败:', error.message);
    return { ok: false, error: error.message || 'DeepSeek请求失败' };
  }
});

// ============= WebView -> AccountId 鏄犲皠 =============
// renderer 鍦?webview did-attach 鏃堕€氳繃 IPC 娉ㄥ唽
const webviewAccountMap = new Map();

ipcMain.on('register-webview', (event, { accountId, webContentsId }) => {
  if (accountId && webContentsId) {
    webviewAccountMap.set(webContentsId, accountId);
    console.log('[map] webContents[' + webContentsId + '] -> account[' + accountId + ']');
    const wc = webContents.fromId(Number(webContentsId));
    const platform = getAccountPlatform(accountId);
    if (shouldLoadMaowangExtensionForPlatform(platform)) {
      ensureMaowangExtensionLoaded(wc?.session || session.fromPartition(`persist:account_${accountId}`), accountId)
        .then(result => {
          if (result?.ok && !result.cached && wc && !wc.isDestroyed()) wc.reloadIgnoringCache();
        })
        .catch(e => console.error('[extensions] webview extension load failed:', e.message));
    }
    if (wc && !wc.isDestroyed() && wc.getType() === 'webview' && !wc.__debuggerSetup) {
      wc.__debuggerSetup = true;
      setupWebViewSession(wc);
    }
  }
});

ipcMain.handle('get-webview-map', () => {
  const result = {};
  for (const [wcId, accId] of webviewAccountMap) {
    result[wcId] = accId;
  }
  return result;
});

ipcMain.handle('get-compat-user-agent', () => COMPAT_USER_AGENT);

function getAccountWebContentsUrl(accountId) {
  for (const [wcId, accId] of webviewAccountMap) {
    if (accId !== accountId) continue;
    const wc = webContents.fromId(Number(wcId));
    if (wc && !wc.isDestroyed()) return wc.getURL() || '';
  }
  return '';
}

function isOAuthPopupUrl(url) {
  const value = String(url || '');
  if (!/^https?:\/\//i.test(value)) return false;
  return /accounts\.google\.com|oauth|signin|login|authorize/i.test(value);
}

function createAuthPopup(url, parentWebContents) {
  const parentSession = parentWebContents?.session || session.defaultSession;
  configureBrowserCompatSession(parentSession);
  const authWindow = new BrowserWindow({
    width: 560,
    height: 720,
    minWidth: 460,
    minHeight: 580,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    show: true,
    title: '登录',
    webPreferences: {
      preload: path.join(__dirname, 'oauth-preload.js'),
      session: parentSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  try {
    authWindow.webContents.setUserAgent(COMPAT_USER_AGENT);
  } catch (e) {}
  configureBrowserCompatWebContents(authWindow.webContents);
  configureBrowserCompatSession(authWindow.webContents.session);

  authWindow.webContents.setWindowOpenHandler(({ url: childUrl }) => {
    if (isOAuthPopupUrl(childUrl)) {
      createAuthPopup(childUrl, parentWebContents);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  authWindow.webContents.on('did-navigate', (_event, nextUrl) => {
    const target = String(nextUrl || '');
    if (/dola\.com|tongyi\.aliyun\.com|qianwen|doubao\.com/i.test(target) && !/accounts\.google\.com/i.test(target)) {
      setTimeout(() => {
        if (!authWindow.isDestroyed()) authWindow.close();
        try {
          if (parentWebContents && !parentWebContents.isDestroyed()) parentWebContents.reload();
        } catch (e) {}
      }, 1200);
    }
  });

  authWindow.loadURL(url);
  return authWindow;
}

function setupOAuthPopupHandler(wc) {
  if (!wc || wc.isDestroyed?.() || wc.__oauthPopupHandlerSetup) return;
  wc.__oauthPopupHandlerSetup = true;
  try {
    wc.setWindowOpenHandler(({ url }) => {
      if (isOAuthPopupUrl(url)) {
        createAuthPopup(url, wc);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
  } catch (e) {
    console.error('[oauth] setup popup handler failed:', e.message);
  }
}

function getDolaResourceKey(res) {
  if (!res) return '';
  const imageKey = getImageResourceKey(res.thumbUrl || res.coverUrl || (res.type === 'image' ? res.url : ''));
  if (imageKey) return `image:${imageKey}`;
  const url = String(res.url || '').toLowerCase();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname
      .replace(/\/(origin|original|large|small|thumb|preview|watermark|downsize)\//ig, '/')
      .replace(/[_-]?(?:\d+x\d+|720p|1080p|144p|preview|thumb|cover|watermark|no[_-]?watermark)/ig, '');
    const stem = path.basename(pathname).replace(/\.(mp4|webm|mov|m4v|png|jpe?g|webp|gif)$/i, '');
    const hash = stem.match(/[a-z0-9_-]{12,}/i)?.[0] || stem;
    return hash ? `url:${parsed.hostname}:${hash}` : '';
  } catch (e) {
    return '';
  }
}

function isDolaCreateImageUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)dola\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith('/chat/create-image');
  } catch (e) {
    return false;
  }
}

function getResourcePageUrl(res) {
  return String(
    res?.pageUrl ||
    res?.referer ||
    res?.referrer ||
    res?.currentUrl ||
    res?.sourceUrl ||
    ''
  );
}

// ============= 璧勬簮鎹曡幏绠＄悊 =============
function addCapturedResources(accountId, resources) {
  if (!Array.isArray(resources)) return;
  const platform = getAccountPlatform(accountId);
  if (platform === 'doubao' && resources.some(res => res?.replaceDoubaoCreationScan || res?.source === 'doubao-creation-resource-panel')) {
    capturedResources = capturedResources.filter(res => !(
      res.accountId === accountId &&
      res.type === 'video' &&
      String(res.source || '').toLowerCase() === 'doubao-creation-resource-panel'
    ));
  }
  for (let res of resources) {
    res = normalizeCapturedResource(res, platform);
    if (removedResourceKeys.has(getResourceRemovalKey({ ...res, accountId }))) continue;

    if (res?.type === 'video') {
      res = applyCoverToVideoResource(accountId, res, platform);
    }

    if (!shouldKeepResourceForPlatform(res, platform)) continue;
    if (!shouldKeepResource(res, platform)) continue;

    if (platform === 'dola' && res.type === 'image' && isDolaVideoCoverImage(res)) {
      const coverKey = getImageResourceKey(res.url || res.thumbUrl);
      let videoIdx = capturedResources.findIndex(r =>
        r.accountId === accountId &&
        r.type === 'video' &&
        (!r.thumbUrl || (coverKey && getImageResourceKey(r.thumbUrl) === coverKey))
      );
      if (videoIdx < 0) {
        const dolaVideoIndexes = capturedResources
          .map((r, idx) => ({ r, idx }))
          .filter(({ r }) =>
            r.accountId === accountId &&
            r.type === 'video' &&
            (String(r.source || '').toLowerCase().includes('dola') || String(r.url || '').toLowerCase().includes('dola'))
          )
          .map(({ idx }) => idx);
        if (dolaVideoIndexes.length === 1) videoIdx = dolaVideoIndexes[0];
      }
      if (videoIdx >= 0) {
        capturedResources[videoIdx] = mergeResource(capturedResources[videoIdx], {
          thumbUrl: res.url,
          coverUrl: res.url,
          width: capturedResources[videoIdx].width || res.width,
          height: capturedResources[videoIdx].height || res.height
        }, accountId);
        continue;
      }
    }

    if (platform === 'dola' && res.type === 'video' && !res.thumbUrl) {
      const coverIdx = capturedResources.findIndex(r =>
        r.accountId === accountId &&
        r.type === 'image' &&
        isDolaVideoCoverImage(r)
      );
      if (coverIdx >= 0) {
        res.thumbUrl = capturedResources[coverIdx].url || capturedResources[coverIdx].thumbUrl;
        capturedResources.splice(coverIdx, 1);
      } else {
        const coveredVideoIndexes = capturedResources
          .map((r, idx) => ({ r, idx }))
          .filter(({ r }) =>
            r.accountId === accountId &&
            r.type === 'video' &&
            r.thumbUrl &&
            (String(r.source || '').toLowerCase().includes('dola') || String(r.url || '').toLowerCase().includes('dola'))
          )
          .map(({ idx }) => idx);
        if (coveredVideoIndexes.length === 1) {
          const existingCoveredVideoIdx = coveredVideoIndexes[0];
          capturedResources[existingCoveredVideoIdx] = mergeResource(capturedResources[existingCoveredVideoIdx], res, accountId);
          continue;
        }
        const existingBareVideoIdx = capturedResources.findIndex(r =>
          r.accountId === accountId &&
          r.type === 'video' &&
          !r.thumbUrl &&
          (String(r.source || '').toLowerCase().includes('dola') || String(r.url || '').toLowerCase().includes('dola'))
        );
        if (existingBareVideoIdx >= 0) {
          capturedResources[existingBareVideoIdx] = mergeResource(capturedResources[existingBareVideoIdx], res, accountId);
          continue;
        }
      }
    }

    if (platform === 'dola' && res.type === 'video' && res.thumbUrl) {
      const thumbKey = getImageResourceKey(res.thumbUrl);
      const coverIdx = capturedResources.findIndex(r =>
        r.accountId === accountId &&
        r.type === 'image' &&
        isDolaVideoCoverImage(r) &&
        thumbKey &&
        getImageResourceKey(r.url || r.thumbUrl) === thumbKey
      );
      if (coverIdx >= 0) capturedResources.splice(coverIdx, 1);
    }

    // 濡傛灉鏂拌祫婧愭湁瀹為檯 URL 涓旀槸瑙嗛锛岀Щ闄ゅ悓 vid 鐨勫緟鑾峰彇鍗犱綅
    if (res.type === 'video' && res.url && (res.vid || res.messageId)) {
      const pendingIdx = capturedResources.findIndex(r =>
        r.type === 'video' && !r.url &&
        ((res.vid && r.vid === res.vid) || (res.messageId && r.messageId === res.messageId))
      );
      if (pendingIdx >= 0) {
        res = mergeResource(capturedResources[pendingIdx], res, accountId);
        capturedResources.splice(pendingIdx, 1);
      }
    }
    const dupIdx = capturedResources.findIndex(r =>
      r.accountId === accountId &&
      (platform === 'dola' ? isSameDolaResource(res, r) : isSameResource(res, r))
    );
    if (dupIdx >= 0) {
      capturedResources[dupIdx] = mergeResource(capturedResources[dupIdx], res, accountId);
    } else {
      capturedResources.push({
        ...res,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        accountId,
        capturedAt: Date.now()
      });
    }
  }
  // 閫氱煡娓叉煋杩涚▼鏇存柊
  maybeSaveResourceSnapshot();
  if (mainWindow) {
    mainWindow.webContents.send('resources-updated', capturedResources);
  }
}

function isDolaVideoCoverImage(res) {
  if (!res || res.type !== 'image') return false;
  const width = Number(res.width || 0);
  const height = Number(res.height || 0);
  const url = String(res.url || res.thumbUrl || '').toLowerCase();
  if (!width || !height || width > 900 || height > 1600) return false;
  return /tos-mya-p-|vodimg|cover|poster|downsize|tplv-0es2k971ck/.test(url);
}

function shouldKeepResourceForPlatform(res, platform) {
  if (!res || !platform) return true;
  const source = String(res.source || '').toLowerCase();
  const url = String(res.url || res.thumbUrl || '').toLowerCase();

  if (BROWSER_ONLY_PLATFORMS.has(platform)) return false;

  if (platform === 'dola') {
    if (res.type === 'video') {
      return false;
    }
    if (res.type === 'image' && isDolaCreateImageUrl(getResourcePageUrl(res))) {
      return false;
    }
    if (res.type === 'image') return isLikelyDolaGeneratedImage(res);
    if (isNoisyDolaResource(res)) return false;
  }

  if (platform === 'doubao') {
    if (res.type === 'video') {
      return [
        'doubao-creation-resource-panel',
        'doubao-current-conversation',
        'doubao_download_info',
        'doubao-chat-download'
      ].includes(source) && Boolean(res.confirmedNoWatermark);
    }
    // Doubao has a dedicated extension flow. Generic debugger/DOM capture sees
    // covers, app assets, and playback requests as standalone resources.
    if (source.includes('dola') || source.includes('generic') || source.includes('debugger')) {
      return false;
    }
    if (
      res.type === 'image' &&
      !isLikelyDoubaoGeneratedImage(res)
    ) {
      return false;
    }
  }

  if (platform === 'qianwen' && res.type === 'image') {
    return isLikelyQianwenGeneratedImage(res);
  }

  return true;
}

function isLikelyDoubaoGeneratedImage(res) {
  if (!res || res.type !== 'image') return false;
  const url = String(res.url || '').toLowerCase();
  const thumbUrl = String(res.thumbUrl || '').toLowerCase();
  const source = String(res.source || '').toLowerCase();
  const title = String(res.title || '').toLowerCase();
  const haystack = `${url} ${thumbUrl} ${source} ${title}`;
  const width = Number(res.width || 0);
  const height = Number(res.height || 0);

  if (!url || isBlockedAssetUrl(url)) return false;
  if (/app_icon|favicon|logo|icon|sprite|avatar|placeholder|empty|default|loading|intro|banner|background|toolbar|button|\.svg|\.js|\.css/i.test(haystack)) {
    return false;
  }
  if (source.includes('doubao-creation-resource-panel') || source.includes('doubao-current-conversation')) {
    if ((width && width < 240) || (height && height < 180)) return false;
    return true;
  }
  if (/rc_gen_image|image[_-]?ori|image[_-]?raw|raw_image|no[_-]?watermark|origin|original|tplv|tos-|byteimg|ibyteimg|imagex/i.test(haystack)) {
    if ((width && width < 240) || (height && height < 180)) return false;
    return true;
  }
  if (source.includes('image-data-extracted') && width && height) return width >= 512 && height >= 512;
  return false;
}

function isLikelyDolaGeneratedImage(res) {
  if (!res || res.type !== 'image') return false;
  const url = String(res.url || '').toLowerCase();
  const thumbUrl = String(res.thumbUrl || '').toLowerCase();
  const source = String(res.source || '').toLowerCase();
  const title = String(res.title || '').toLowerCase();
  const haystack = `${url} ${thumbUrl} ${source} ${title}`;
  const width = Number(res.width || 0);
  const height = Number(res.height || 0);

  if (!url || isBlockedAssetUrl(url)) return false;
  if (/favicon|logo|icon|sprite|avatar|placeholder|empty|default|loading|intro|banner|background|static|assets|\.js|\.css/.test(haystack)) {
    return false;
  }
  if (/dola\s*视频|生成视频|下载视频|原视频|video|播放|预览/.test(title) && /cover|poster|vodimg|tplv-0es2k971ck|tos-mya-p-|ck-do/.test(url + ' ' + thumbUrl)) {
    return false;
  }
  if (/video|vod|poster|cover|play|stream|mime_type=video|mp4|webm|mov|m4v/.test(url) && !/image|img|png|jpe?g|webp/.test(url)) {
    return false;
  }
  if (source.includes('debugger-network') && !source.includes('creation')) {
    return false;
  }
  if (source.includes('dola-creation-image')) {
    if (!width || !height) return false;
    return width >= 512 && height >= 512;
  }
  if (/image[_-]?ori|raw|origin|no[_-]?watermark|ck-image|ck-ima|png|jpe?g|webp/.test(haystack)) {
    if (!width || !height) return false;
    return width >= 512 && height >= 512;
  }
  if (width && height) {
    if (width < 512 || height < 512) return false;
    return true;
  }
  return false;
}

function isLikelyQianwenGeneratedImage(res) {
  if (!res || res.type !== 'image') return false;
  const url = String(res.url || '').toLowerCase();
  const thumbUrl = String(res.thumbUrl || '').toLowerCase();
  const title = String(res.title || '').toLowerCase();
  const source = String(res.source || '').toLowerCase();
  const haystack = `${url} ${thumbUrl} ${title} ${source}`;
  const width = Number(res.width || 0);
  const height = Number(res.height || 0);

  if (!url || isBlockedAssetUrl(url)) return false;
  if (/svg|favicon|logo|icon|sprite|avatar|placeholder|empty|default|loading|toolbar|menu|button|plugin|ppt|translate|agent|appcenter|app_center|static|assets|_next|chunk|bundle|\.js|\.css/.test(haystack)) {
    return false;
  }

  // Qianwen's home/chat UI contains many 64-384px feature icons. Generated
  // images are normally much larger, so unknown or small sizes are treated as
  // chrome rather than downloadable content.
  if (!width || !height) return false;
  if (width < 512 || height < 512) return false;

  const area = width * height;
  if (area < 512 * 512) return false;
  return true;
}

function isNoisyDolaResource(res) {
  if (!res) return true;
  const source = String(res.source || '').toLowerCase();
  const url = String(res.url || '').toLowerCase();
  const thumbUrl = String(res.thumbUrl || res.coverUrl || '').toLowerCase();
  const title = String(res.title || '').trim();
  const width = Number(res.width || 0);
  const height = Number(res.height || 0);

  if (res.type === 'video') {
    // Dola does not have a safe manual "fetch by messageId" path in the side
    // panel. Empty URL entries are usually internal placeholders and create a
    // long list of useless "get link" cards.
    if (!res.url) return true;

    // The DOM scanner can see tiny preview placeholders or transient player
    // blobs before the real generated video is available.
    if (source.includes('generic-dom-video')) {
      if (url.startsWith('blob:') && !thumbUrl) return true;
      if ((width && width < 240) || (height && height < 180)) return true;
    }

    // Ignore app/player chrome instead of user generated media.
    if (/logo|icon|favicon|sprite|placeholder|loading|empty|intro|banner|background|avatar/i.test(url + ' ' + thumbUrl + ' ' + title)) {
      return true;
    }
  }

  return false;
}

function maybeSaveResourceSnapshot() {
  if (process.env.AIAM_DEBUG_MEDIA !== '1') return;
  if (!capturedResources.some(r => String(r.source || '').toLowerCase().includes('dola') || String(r.url || '').toLowerCase().includes('dola'))) return;
  try {
    const dir = path.join(DATA_DIR, 'debug-dola-media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'last-resources.json'), JSON.stringify({
      capturedAt: new Date().toISOString(),
      total: capturedResources.length,
      resources: capturedResources
    }, null, 2));
  } catch (e) {
    console.error('[debugger] save resource snapshot failed:', e.message);
  }
}

function normalizeCapturedResource(res, platform = '') {
  if (!res || typeof res !== 'object') return res;
  const type = res.type;
  const url = pickUrlValue(res.url);
  const backupUrl = pickUrlValue(res.backupUrl);
  const rawTitle = normalizeResourceTitle(res.title || res.name || res.prompt || res.description);
  const category = inferResourceCategory(rawTitle);
  const shouldPreferNoWatermark = type === 'video' && shouldPreferNoWatermarkForPlatform(platform) && !res.confirmedNoWatermark;
  let finalUrl = shouldPreferNoWatermark ? (makeNoWatermarkVariants(url)[0] || url) : url;
  let finalBackupUrl = shouldPreferNoWatermark ? (makeNoWatermarkVariants(backupUrl)[0] || backupUrl) : backupUrl;

  if (platform === 'dola') {
    if (isNoWatermarkVariantUrl(finalUrl) && backupUrl && !isNoWatermarkVariantUrl(backupUrl)) {
      finalUrl = backupUrl;
      finalBackupUrl = url;
    }
    if (finalBackupUrl && isNoWatermarkVariantUrl(finalBackupUrl)) {
      finalBackupUrl = '';
    }
  }

  return {
    ...res,
    url: type === 'video' ? finalUrl : url,
    thumbUrl: pickUrlValue(res.thumbUrl || res.coverUrl || res.posterUrl),
    backupUrl: type === 'video' ? finalBackupUrl : backupUrl,
    title: buildResourceTitle(rawTitle, type, platform),
    category
  };
}

function shouldPreferNoWatermarkForPlatform(platform) {
  return platform === 'doubao' || platform === 'qianwen';
}

function isNoWatermarkVariantUrl(url) {
  return typeof url === 'string' && /no[_-]?watermark|without[_-]?watermark|video_gen_no_watermark/i.test(url);
}

function pickUrlValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return decodeMaybeBase64Url(value) || value;
  if (typeof value !== 'object') return '';
  return pickUrlValue(
    value.url ||
    value.url_v2 ||
    value.image_thumb ||
    value.image_preview ||
    value.preview_img ||
    value.cover ||
    value.cover_image ||
    value.coverImage ||
    value.poster ||
    value.thumb ||
    value.main_url ||
    value.mainUrl ||
    value.play_url ||
    value.playUrl ||
    value.download_url ||
    value.downloadUrl ||
    value.source_url ||
    value.sourceUrl
  );
}

function decodeMaybeBase64Url(value) {
  if (!value || typeof value !== 'string') return '';
  const text = value.trim();
  if (/^https?:\/\//i.test(text) || /^blob:/i.test(text)) return text;
  if (!/^[A-Za-z0-9+/=_-]{24,}$/.test(text)) return '';
  try {
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim();
    return /^https?:\/\//i.test(decoded) ? decoded : '';
  } catch (e) {
    return '';
  }
}

function normalizeResourceTitle(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^[{\[]/.test(text) || /"block_type"|"creation_block"|"content_block"/.test(text)) return '';
    return text.replace(/\s+/g, ' ').slice(0, 120);
  }
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'object') return '';
  return normalizeResourceTitle(
    value.text ||
    value.prompt ||
    value.description ||
    value.title ||
    value.name ||
    value.content
  );
}

function inferResourceKeywords(text = '') {
  const source = String(text || '').toLowerCase();
  if (!source) return [];
  const rules = [
    ['机器人', /机器人|機器人|robot|mecha|机甲/i],
    ['人物', /人物|人像|女孩|男孩|女人|男人|美女|帅哥|girl|boy|woman|man|portrait/i],
    ['跳舞', /跳舞|舞蹈|舞者|dance|dancing/i],
    ['吃饭', /吃饭|用餐|进食|美食|食物|餐厅|做饭|烹饪|eat|eating|food|meal|cooking/i],
    ['石头', /石头|岩石|石块|山石|stone|rock/i],
    ['飞行', /飞行|飞翔|起飞|天空|翅膀|flight|flying|fly/i],
    ['唱歌', /唱歌|歌唱|麦克风|sing|singing|microphone/i],
    ['运动', /运动|跑步|健身|篮球|足球|游泳|sport|running|basketball|football|swim/i],
    ['古装', /古装|汉服|侠客|书生|宫廷|唐装|ancient|hanfu|costume/i],
    ['夜景', /夜景|夜晚|雨夜|霓虹|灯光|街灯|night|neon|rainy night/i],
    ['河流', /河流|小溪|溪流|湖泊|湖水|水面|river|stream|creek|lake/i],
    ['落叶', /落叶|枫叶|秋天|秋季|树叶|leaf|leaves|autumn|fall/i],
    ['风景', /风景|自然|山|海|湖|森林|夕阳|日落|城市|景色|landscape|nature|mountain|sea|forest|sunset|city/i],
    ['动物', /动物|猫|狗|鸟|老虎|狮子|马|animal|cat|dog|bird|tiger|lion|horse/i],
    ['建筑', /建筑|房子|室内|街道|大楼|architecture|building|house|interior|street/i],
    ['汽车', /汽车|车辆|跑车|车|car|vehicle/i],
    ['产品', /产品|商品|手表|包|鞋|衣服|product|watch|bag|shoes|clothes/i],
    ['文字', /文字|字幕|标语|logo|text|typography/i]
  ];
  const keywords = [];
  for (const [label, pattern] of rules) {
    if (pattern.test(source) && !keywords.includes(label)) keywords.push(label);
    if (keywords.length >= 3) break;
  }
  return keywords;
}

function inferResourceCategory(text = '') {
  return inferResourceKeywords(text)[0] || '';
}

function isGenericResourceTitle(text = '') {
  const value = String(text || '').trim();
  if (!value) return true;
  return /^(video|video\.mp4|download|下载视频|原视频|dola\s*视频|dola\s*无水印视频|豆包视频|千问视频|未命名)$/i.test(value);
}

function buildResourceTitle(rawTitle, type = '', platform = '') {
  const suffix = type === 'image' ? '图片' : type === 'video' ? '视频' : '资源';
  const platformLabel = getPlatformResourceLabel(platform);
  const keywords = inferResourceKeywords(rawTitle);
  if (keywords.length) return [platformLabel, ...keywords, suffix].filter(Boolean).join('_');
  if (rawTitle && !isGenericResourceTitle(rawTitle)) return [platformLabel, rawTitle, suffix].filter(Boolean).join('_');
  return [platformLabel, '未分类', suffix].filter(Boolean).join('_');
}

function getPlatformResourceLabel(platform = '') {
  if (platform === 'doubao') return '豆包';
  if (platform === 'qianwen') return '千问';
  if (platform === 'dola') return '创作平台';
  return '';
}

function shouldKeepResource(res, platform = '') {
  if (!res || !res.type) return false;
  if (res.type === 'video') {
    const source = String(res.source || '').toLowerCase();
    if (platform === 'doubao') {
      return [
        'doubao-creation-resource-panel',
        'doubao-current-conversation',
        'doubao_download_info',
        'doubao-chat-download'
      ].includes(source) && !!res.url && Boolean(res.confirmedNoWatermark) && isDownloadableVideoUrl(res.url, res, platform);
    }
    if (res.url) return isDownloadableVideoUrl(res.url, res, platform);
    return !!res.messageId && source.includes('doubao');
  }
  if (res.type === 'image') {
    if (!res.url) return false;
    if (isBlockedAssetUrl(res.url)) return false;
    const width = Number(res.width || 0);
    const height = Number(res.height || 0);
    if (platform === 'doubao') return isLikelyDoubaoGeneratedImage(res);
    if (platform === 'dola') return isLikelyDolaGeneratedImage(res);
    if ((width && width < 240) || (height && height < 180)) return false;
    if (!width && !height && /image[^/]*$/i.test(res.url)) return false;
    return true;
  }
  return !!res.url;
}

function isDownloadableVideoUrl(url, res = {}, platform = '') {
  if (!url || typeof url !== 'string') return false;
  const lowerUrl = url.toLowerCase();
  const source = String(res.source || '').toLowerCase();
  const isDolaResource = platform === 'dola' ||
    source.includes('dola') ||
    source.includes('generic-dom-video') ||
    lowerUrl.includes('dola.com') ||
    lowerUrl.includes('ciciai.com');
  if (lowerUrl.startsWith('blob:')) {
    return isDolaResource || source.includes('generic-dom-video');
  }
  if (lowerUrl.startsWith('data:')) return false;
  if (isBlockedAssetUrl(url)) return false;
  if (/\.(png|jpe?g|webp|gif|svg|css|js|json|html?)(\?|#|$)/i.test(lowerUrl)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('dola.com') && /^\/im\//i.test(parsed.pathname) && !isDolaResource) return false;
  } catch (e) {
    return false;
  }
  if (!/(video|vod|media|tos|ciciai|byteimg|ibyteimg|mp4|webm|mov|m4v|mime_type=video|play|stream)/i.test(lowerUrl)) return false;
  const width = Number(res.width || 0);
  const height = Number(res.height || 0);
  if (isDolaResource) return true;
  if ((width && width < 240) || (height && height < 180)) return false;
  return true;
}

ipcMain.on('resource-captured', (event, { accountId, resources }) => {
  addCapturedResources(accountId, resources);
});

ipcMain.handle('get-resources', () => capturedResources);

ipcMain.handle('remove-resource', (_event, payload = {}) => {
  const resourceId = String(payload.resourceId || payload.id || '').trim();
  if (!resourceId) return { ok: false, message: '资源标识缺失' };

  const before = capturedResources.length;
  capturedResources
    .filter(resource => String(resource?.id || '') === resourceId)
    .forEach(resource => {
      const removalKey = getResourceRemovalKey(resource);
      if (removalKey) removedResourceKeys.add(removalKey);
    });
  capturedResources = capturedResources.filter(resource => String(resource?.id || '') !== resourceId);
  const removed = before - capturedResources.length;
  if (removed > 0) {
    maybeSaveResourceSnapshot();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('resources-updated', capturedResources);
    }
  }
  return { ok: true, removed };
});

ipcMain.handle('get-download-dir', () => getDownloadDir());

ipcMain.handle('open-download-dir', async () => {
  const downloadDir = ensureDownloadDir(getDownloadDir());
  const error = await shell.openPath(downloadDir);
  return { ok: !error, downloadDir, message: error || '' };
});

ipcMain.handle('choose-download-dir', async () => {
  if (!mainWindow) return { canceled: true, downloadDir: getDownloadDir() };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择下载保存目录',
    defaultPath: getDownloadDir(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true, downloadDir: getDownloadDir() };
  }
  appSettings.downloadDir = result.filePaths[0];
  saveSettings();
  ensureDownloadDir(appSettings.downloadDir);
  return { canceled: false, downloadDir: appSettings.downloadDir };
});

function getDesktopShortcutPath() {
  return path.join(app.getPath('desktop'), DESKTOP_SHORTCUT_NAME);
}

function getShortcutIconPath() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'app-icon.ico') : '',
    path.join(__dirname, '..', 'app-icon.ico')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (e) {}
  }
  return process.execPath;
}

function getMacAppBundlePath() {
  return path.resolve(process.execPath, '..', '..', '..');
}

function hasDesktopShortcutPath(shortcutPath) {
  try {
    fs.lstatSync(shortcutPath);
    return true;
  } catch (e) {
    return false;
  }
}

function removeDesktopShortcutPath(shortcutPath) {
  try {
    const stat = fs.lstatSync(shortcutPath);
    if (stat.isDirectory() && !stat.isSymbolicLink()) return false;
    fs.unlinkSync(shortcutPath);
    return true;
  } catch (e) {
    return false;
  }
}

function createWindowsShortcutWithPowerShell({ shortcutPath, target, cwd, icon }) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$shortcutPath = [Environment]::GetEnvironmentVariable("AIAM_SHORTCUT_PATH")',
    '$target = [Environment]::GetEnvironmentVariable("AIAM_SHORTCUT_TARGET")',
    '$cwd = [Environment]::GetEnvironmentVariable("AIAM_SHORTCUT_CWD")',
    '$icon = [Environment]::GetEnvironmentVariable("AIAM_SHORTCUT_ICON")',
    'if ([string]::IsNullOrWhiteSpace($shortcutPath)) { throw "快捷方式路径为空" }',
    'if ([string]::IsNullOrWhiteSpace($target) -or -not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "应用程序路径不存在" }',
    '$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)',
    '$shortcut.TargetPath = $target',
    '$shortcut.WorkingDirectory = $cwd',
    '$shortcut.Description = "千思链"',
    '$shortcut.WindowStyle = 1',
    'if (-not [string]::IsNullOrWhiteSpace($icon)) { $shortcut.IconLocation = $icon + ",0" }',
    '$shortcut.Save()',
    'if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw "Windows 未生成快捷方式文件" }'
  ].join('\n');
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  const result = childProcess.spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedCommand
  ], {
    windowsHide: true,
    timeout: 10000,
    encoding: 'utf8',
    env: {
      ...process.env,
      AIAM_SHORTCUT_PATH: shortcutPath,
      AIAM_SHORTCUT_TARGET: target,
      AIAM_SHORTCUT_CWD: cwd,
      AIAM_SHORTCUT_ICON: icon || ''
    }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(detail || `PowerShell 创建快捷方式失败（退出码 ${result.status}）`);
  }
  return true;
}

function createDesktopShortcut(options = {}) {
  if (!IS_WINDOWS && !IS_MACOS) {
    return { ok: false, message: '当前系统不支持桌面快捷方式' };
  }
  if (!app.isPackaged) {
    return { ok: false, message: '开发模式下不会创建桌面快捷方式' };
  }

  const shortcutPath = getDesktopShortcutPath();
  if (IS_MACOS) {
    const appBundlePath = getMacAppBundlePath();
    if (!fs.existsSync(appBundlePath)) {
      return { ok: false, shortcutPath, message: '未找到当前 macOS 应用包' };
    }
    if (hasDesktopShortcutPath(shortcutPath)) {
      if (!options.replace) return { ok: true, shortcutPath, alreadyExists: true };
      if (!removeDesktopShortcutPath(shortcutPath)) {
        return { ok: false, shortcutPath, message: '桌面图标已存在且无法替换' };
      }
    }
    try {
      fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
      fs.symlinkSync(appBundlePath, shortcutPath, 'dir');
      return { ok: true, shortcutPath, target: appBundlePath };
    } catch (e) {
      return { ok: false, shortcutPath, message: e.message || '桌面图标创建失败' };
    }
  }

  const target = process.execPath;
  const icon = getShortcutIconPath();
  if (!target || !fs.existsSync(target)) {
    return { ok: false, shortcutPath, message: '未找到当前应用程序文件' };
  }

  let electronFailure = '';
  try {
    fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
    const created = shell.writeShortcutLink(shortcutPath, options.replace ? 'replace' : 'create', {
      target,
      cwd: path.dirname(target),
      icon,
      iconIndex: 0,
      description: '千思链'
    });
    if (created) return { ok: true, shortcutPath };
    electronFailure = 'Electron 快捷方式接口未成功写入文件';
  } catch (e) {
    electronFailure = e.message || 'Electron 快捷方式接口调用失败';
  }

  try {
    createWindowsShortcutWithPowerShell({
      shortcutPath,
      target,
      cwd: path.dirname(target),
      icon
    });
    return { ok: true, shortcutPath, fallback: 'powershell' };
  } catch (e) {
    const fallbackFailure = e.message || 'Windows 系统快捷方式接口调用失败';
    return {
      ok: false,
      shortcutPath,
      message: `桌面图标创建失败：${electronFailure}；备用方式：${fallbackFailure}`
    };
  }
}

function ensureDesktopShortcut() {
  if (!IS_WINDOWS && !IS_MACOS) return;
  try {
    for (const legacyName of LEGACY_DESKTOP_SHORTCUT_NAMES) {
      const legacyPath = path.join(app.getPath('desktop'), legacyName);
      if (legacyPath !== getDesktopShortcutPath() && hasDesktopShortcutPath(legacyPath)) {
        removeDesktopShortcutPath(legacyPath);
      }
    }
    const result = createDesktopShortcut({ replace: true });
    if (!result.ok) console.warn('[shortcut] create skipped:', result.message);
  } catch (e) {
    console.warn('[shortcut] create failed:', e.message);
  }
}

async function promptForDesktopShortcut() {
  if (!IS_WINDOWS && !IS_MACOS) return;
  if (appSettings.desktopShortcutPrompted === true) {
    if (appSettings.desktopShortcutChoice === 'declined') return;
    if (hasDesktopShortcutPath(getDesktopShortcutPath())) return;
  }

  const result = await dialog.showMessageBox({
    type: 'question',
    title: '创建桌面快捷图标',
    message: '是否创建“千思链”桌面快捷图标？',
    detail: '选择“是”后，可以从桌面快速启动软件。',
    buttons: ['是', '否'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });

  if (result.response !== 0) {
    appSettings.desktopShortcutPrompted = true;
    appSettings.desktopShortcutChoice = 'declined';
    saveSettings();
    return;
  }
  const shortcut = createDesktopShortcut({ replace: true });
  if (!shortcut.ok) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '创建桌面快捷图标失败',
      message: shortcut.message || '桌面快捷图标创建失败，请稍后重试。'
    });
    return;
  }
  appSettings.desktopShortcutPrompted = true;
  appSettings.desktopShortcutChoice = 'created';
  saveSettings();
}

ipcMain.handle('create-desktop-shortcut', async () => {
  return createDesktopShortcut({ replace: true });
});

function getDownloadFileType(ext) {
  const value = String(ext || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'].includes(value)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv'].includes(value)) return 'video';
  return 'file';
}

function getDownloadFilePlatform(filename) {
  const text = String(filename || '').toLowerCase();
  if (/^(豆包|doubao)[_\s-]/i.test(filename) || text.includes('doubao')) return '豆包';
  if (/^(dola|创作平台)[_\s-]/i.test(filename) || text.includes('dola')) return '创作平台';
  if (/^(千问|qianwen)[_\s-]/i.test(filename) || text.includes('qianwen')) return '千问';
  if (/^(即梦|jimeng)[_\s-]/i.test(filename) || text.includes('jimeng')) return '即梦';
  return '其他';
}

ipcMain.handle('list-download-files', async () => {
  const downloadDir = ensureDownloadDir(getDownloadDir());
  const entries = await fs.promises.readdir(downloadDir, { withFileTypes: true }).catch(() => []);
  const files = (await Promise.all(entries
    .filter(entry => entry.isFile())
    .map(async entry => {
    const filePath = path.join(downloadDir, entry.name);
    try {
      const stat = await fs.promises.stat(filePath);
      const ext = path.extname(entry.name);
      const type = getDownloadFileType(ext);
      return {
        name: entry.name,
        path: filePath,
        fileUrl: pathToFileURL(filePath).toString(),
        ext,
        type,
        platform: getDownloadFilePlatform(entry.name),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        mtime: stat.mtime.toISOString()
      };
    } catch (e) {
      // Ignore files that disappear while reading the folder.
      return null;
    }
  }))).filter(Boolean);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { ok: true, downloadDir, files };
});

ipcMain.handle('open-download-file', async (_event, filePath) => {
  const resolved = resolveDownloadFilePath(filePath);
  if (!fs.existsSync(resolved)) return { ok: false, message: '文件不存在' };
  const error = await shell.openPath(resolved);
  if (error) {
    shell.showItemInFolder(resolved);
    return { ok: false, message: error || '系统没有找到可打开该文件的默认程序' };
  }
  return { ok: true, message: '' };
});

ipcMain.handle('reveal-download-file', (_event, filePath) => {
  const resolved = resolveDownloadFilePath(filePath);
  if (!fs.existsSync(resolved)) return { ok: false, message: '文件不存在' };
  shell.showItemInFolder(resolved);
  return { ok: true };
});

ipcMain.handle('delete-download-file', async (_event, filePath) => {
  const resolved = resolveDownloadFilePath(filePath);
  if (!fs.existsSync(resolved)) return { ok: false, message: '文件不存在' };
  try {
    if (typeof shell.trashItem === 'function') {
      await shell.trashItem(resolved);
    } else {
      await fs.promises.unlink(resolved);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message || '删除失败' };
  }
});

ipcMain.handle('copy-download-file-path', (_event, filePath) => {
  const resolved = resolveDownloadFilePath(filePath);
  if (!fs.existsSync(resolved)) return { ok: false, message: '文件不存在' };
  clipboard.writeText(resolved);
  return { ok: true };
});

ipcMain.on('start-download-file-drag', (event, filePath) => {
  try {
    const resolved = resolveDownloadFilePath(filePath);
    if (!fs.existsSync(resolved)) return;
    const icon = getDragIconImage();
    event.sender.startDrag({ file: resolved, icon });
  } catch (e) {
    console.error('[download-library] start drag failed:', e.message);
  }
});

ipcMain.handle('clear-resources', () => {
  capturedResources = [];
  removedResourceKeys.clear();
  if (mainWindow) {
    mainWindow.webContents.send('resources-updated', []);
  }
  return true;
});

function extractDolaKeySeed(raw) {
  const text = String(raw || '').replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const match = text.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i) ||
    text.match(/["']key_seed["']\s*:\s*["']([^"']+)/i) ||
    text.match(/["']keySeed["']\s*:\s*["']([^"']+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    return match[1];
  }
}

function findDolaKeySeed(value, depth = 0, seen = new WeakSet()) {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') return extractDolaKeySeed(value);
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  if (typeof value.key_seed === 'string' && value.key_seed) return value.key_seed;
  if (typeof value.keySeed === 'string' && value.keySeed) return value.keySeed;
  const values = Array.isArray(value) ? value.slice(0, 80) : Object.values(value).slice(0, 120);
  for (const item of values) {
    const found = findDolaKeySeed(item, depth + 1, seen);
    if (found) return found;
  }
  return '';
}

function normalizeDolaUrl(raw) {
  return String(raw || '').replace(/&amp;/g, '&').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
}

function defaultDolaFilename(raw) {
  try {
    const url = new URL(raw);
    const id = url.pathname.split('/').filter(Boolean).pop() || 'video';
    return sanitizeFilename(`创作平台_无水印_视频_${id}.mp4`);
  } catch (e) {
    return `创作平台_无水印_视频_${Date.now()}.mp4`;
  }
}

function ensureDolaFilename(filename) {
  const clean = sanitizeFilename(filename || '');
  if (!clean) return '';
  return /^(dola|创作平台)[_\s-]/i.test(clean) ? clean.replace(/^dola/i, '创作平台') : `创作平台_${clean}`;
}

async function requestDolaNowatermarkApi(message = {}) {
  const fplayUrl = normalizeDolaUrl(message.fplayUrl || message.fplay_url || '');
  const videoInfo = message.videoInfo && typeof message.videoInfo === 'object' ? message.videoInfo : null;
  const referer = String(message.referer || 'https://www.dola.com/');
  const directVideoUrl = normalizeDolaUrl(message.videoUrl || message.video_url || '');

  if (message.type === 'DOLA_BG_DOWNLOAD_DIRECT' || message.type === 'DOLA_BG_OPEN_DIRECT') {
    if (!/^https?:\/\//i.test(directVideoUrl)) throw new Error('当前页面没有可下载视频，请刷新页面后重试。');
    return {
    ok: true,
    videoUrl: directVideoUrl,
    filename: ensureDolaFilename(message.filename || '') || defaultDolaFilename(directVideoUrl)
    };
  }

  if (!videoInfo && !/\/video\/fplay\//i.test(fplayUrl)) {
    throw new Error('当前页面没有读到可解析的视频线索，请刷新页面后重试。');
  }

  const payload = { referer, mode: 'nowatermark' };
  if (videoInfo) payload.video_info = JSON.stringify(videoInfo);
  else payload.fplay_url = fplayUrl;
  const keySeed = extractDolaKeySeed(fplayUrl) || findDolaKeySeed(videoInfo);
  if (keySeed) payload.key_seed = keySeed;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  let response;
  try {
    response = await net.fetch(DOLA_NOWATERMARK_API_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } finally {
    clearTimeout(timeoutId);
  }
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('解析接口返回异常');
  }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.msg || data?.error || `解析失败: HTTP ${response.status}`);
  }
  const videoUrl = normalizeDolaUrl(data.download_url || data.video_url || data.url || data.data?.download_url || '');
  if (!/^https?:\/\//i.test(videoUrl)) throw new Error('解析接口没有返回视频地址');
  return {
    ok: true,
    videoUrl,
    filename: ensureDolaFilename(data.data?.filename || message.filename || '') || defaultDolaFilename(fplayUrl || referer)
  };
}

ipcMain.handle('resolve-dola-nowatermark', async (_event, message) => {
  try {
    return await requestDolaNowatermarkApi(message || {});
  } catch (e) {
    console.error('[dola-nowatermark] resolve failed:', e.message);
    return { ok: false, error: e.message || '解析失败' };
  }
});

// ============= 涓嬭浇绠＄悊 =============
function buildDownloadCandidates(url, backupUrl = '') {
  return Array.from(new Set([url, backupUrl].map(item => String(item || '').trim()).filter(Boolean)));
}

async function fetchWithTimeout(fetcher, url, options, timeoutMs, label = 'fetch') {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.log(`[download] ${label} timeout (${timeoutMs}ms), aborting`);
    controller.abort();
  }, timeoutMs);
  try {
    return await fetcher(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probeDownloadCandidate(fetcher, url, headers) {
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(fetcher, url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        ...headers,
        Range: 'bytes=0-262143'
      }
    }, 9000, 'probe');
    if (!response.ok && response.status !== 206) {
      return { url, ok: false, score: 0, status: response.status };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const elapsed = Math.max(1, Date.now() - startedAt);
    return {
      url,
      ok: buffer.length > 0,
      score: buffer.length / elapsed,
      bytes: buffer.length,
      elapsed,
      status: response.status
    };
  } catch (error) {
    return { url, ok: false, score: 0, error: error.message || String(error) };
  }
}

async function chooseFastestDownloadUrl(fetcher, candidates, headers) {
  if (candidates.length <= 1) return candidates[0] || '';
  const probes = await Promise.all(candidates.map(candidate => probeDownloadCandidate(fetcher, candidate, headers)));
  probes.forEach((probe, index) => {
    console.log('[download] probe candidate:', index + 1, {
      ok: probe.ok,
      status: probe.status,
      bytes: probe.bytes,
      elapsed: probe.elapsed,
      score: Number(probe.score || 0).toFixed(2),
      error: probe.error || '',
      host: (() => {
        try { return new URL(probe.url).hostname; } catch (e) { return ''; }
      })()
    });
  });
  const fastest = probes
    .filter(probe => probe.ok)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
  return fastest?.url || candidates[0];
}

async function writeResponseToFile(response, finalPath) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(finalPath, buffer);
    return buffer.length;
  }
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
  const reader = response.body.getReader();
  const stream = fs.createWriteStream(finalPath);
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (!stream.write(chunk)) {
        await new Promise((resolve, reject) => {
          stream.once('drain', resolve);
          stream.once('error', reject);
        });
      }
    }
    await new Promise((resolve, reject) => {
      stream.end(error => error ? reject(error) : resolve());
    });
    return total;
  } catch (error) {
    stream.destroy();
    try { fs.unlinkSync(finalPath); } catch (e) {}
    throw error;
  }
}

ipcMain.handle('download-resource', async (event, payload) => {
  let url = typeof payload === 'string' ? payload : payload?.url;
  const accountId = typeof payload === 'string' ? '' : payload?.accountId;
  const backupUrl = typeof payload === 'string' ? '' : payload?.backupUrl;
  const requestedFilename = typeof payload === 'string' ? '' : payload?.filename;
  const payloadSource = typeof payload === 'string' ? '' : String(payload?.source || '');
  const confirmedNoWatermark = typeof payload !== 'string' && Boolean(payload?.confirmedNoWatermark);
  const platform = accountId ? getAccountPlatform(accountId) : '';
  console.log('[涓嬭浇] ===== IPC download-resource 宸茶繘鍏?main 杩涚▼ =====');
  console.log('[涓嬭浇] url:', url ? url.slice(0, 200) : 'null');

  try {
    if (!url) {
      console.log('[涓嬭浇] url 涓虹┖');
      return { ok: false, reason: 'URL_EMPTY', message: 'URL 为空' };
    }

    const downloadDir = ensureDownloadDir(getDownloadDir());
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
      console.log('[涓嬭浇] 鍒涘缓涓嬭浇鐩綍:', downloadDir);
    }

    // 鍒ゆ柇 URL 绫诲瀷
    if (url.startsWith('blob:')) {
      console.log('[涓嬭浇] URL 鏄?blob: 鍗忚锛宮ain 杩涚▼鏃犳硶鐩存帴涓嬭浇');
      console.log('[涓嬭浇] 闇€瑕?webview preload 鍦ㄩ〉闈㈠唴 fetch blob 鍚庝紶 buffer');
      return { ok: false, reason: 'BLOB_URL', message: 'blob URL must be handled in webview', url };
    }

    if (url.startsWith('data:')) {
      console.log('[涓嬭浇] URL 鏄?data: 鍗忚锛宮ain 杩涚▼鏃犳硶鐩存帴涓嬭浇');
      return { ok: false, reason: 'DATA_URL', message: 'data URL is not supported', url };
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.log('[涓嬭浇] URL 鍗忚涓嶆敮鎸?', url.slice(0, 50));
      return { ok: false, reason: 'UNSUPPORTED_PROTOCOL', message: `不支持的协议: ${url.slice(0, 30)}`, url };
    }
    markProgrammaticDownload(accountId, url);

    // HTTP(S) URL - 浣跨敤 net.fetch锛堝甫 Referer 鍜岃秴鏃讹級
    console.log('[涓嬭浇] URL 鏄?https://锛屽皾璇?net.fetch');
    console.log('[涓嬭浇] 寮€濮?net.fetch:', url.slice(0, 120));

    // 浠?URL 鎺ㄦ柇 Referer
    let referer = 'https://www.doubao.com/';
    let fetchSession = session.defaultSession;
    try {
      const u = new URL(url);
      if (u.hostname.includes('doubao.com')) referer = 'https://www.doubao.com/';
      else if (u.hostname.includes('qianwen') || u.hostname.includes('tongyi.aliyun.com')) referer = 'https://www.qianwen.com/';
      else if (u.hostname.includes('dola.com')) referer = 'https://www.dola.com/';
      else if (u.hostname.includes('jimeng.jianying.com') || u.hostname.includes('jianying.com')) referer = 'https://jimeng.jianying.com/ai-tool/asset';
      if (accountId) {
        fetchSession = session.fromPartition(`persist:account_${accountId}`);
      }
    } catch (e) {}

    let response = null;
    const fetcher = fetchSession && typeof fetchSession.fetch === 'function'
      ? fetchSession.fetch.bind(fetchSession)
      : net.fetch;
    const requestHeaders = {
      'Referer': referer,
      'User-Agent': COMPAT_USER_AGENT,
      'Accept': '*/*',
      'Accept-Language': COMPAT_ACCEPT_LANGUAGE
    };
    const shouldOptimizeDoubaoCreationDownload =
      platform === 'doubao' &&
      confirmedNoWatermark &&
      payloadSource === 'doubao-creation-resource-panel';
    const candidates = shouldOptimizeDoubaoCreationDownload
      ? buildDownloadCandidates(url, backupUrl)
      : [url];
    const selectedUrl = shouldOptimizeDoubaoCreationDownload
      ? await chooseFastestDownloadUrl(fetcher, candidates, requestHeaders)
      : url;
    const retryUrls = [selectedUrl, ...candidates.filter(candidate => candidate !== selectedUrl)];
    try {
      let lastError = null;
      for (const candidateUrl of retryUrls) {
        try {
          console.log('[download] selected fetch url:', candidateUrl.slice(0, 160));
          response = await fetchWithTimeout(fetcher, candidateUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: requestHeaders
          }, 30000, 'net.fetch');
          if (response.ok) {
            url = candidateUrl;
            break;
          }
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
          console.log('[download] selected url failed:', lastError.message);
        } catch (error) {
          lastError = error;
          console.log('[download] selected url exception:', error.message || String(error));
        }
      }
      if (!response?.ok && lastError) throw lastError;
      console.log('[涓嬭浇] net.fetch 鍝嶅簲鐘舵€?', response.status, response.statusText);
    } catch (fetchError) {
      console.error('[涓嬭浇] net.fetch 璇锋眰寮傚父:', fetchError.message);
      return { ok: false, reason: 'FETCH_ERROR', message: fetchError.message };
    }

    if (!response.ok) {
      const errMsg = `HTTP ${response.status}: ${response.statusText}`;
      console.log('[涓嬭浇] net.fetch 澶辫触:', errMsg);
      return { ok: false, reason: 'HTTP_ERROR', message: errMsg, status: response.status };
    }

    // 鑾峰彇 Content-Type 鍜?Content-Disposition
    const contentType = response.headers.get('content-type') || '';
    const contentDisposition = response.headers.get('content-disposition') || '';
    console.log('[涓嬭浇] Content-Type:', contentType);
    console.log('[涓嬭浇] Content-Disposition:', contentDisposition);

    // Extract filename from URL.
    let filename = sanitizeFilename(requestedFilename || '');
    try {
      if (!filename) {
        const urlObj = new URL(url);
        const urlPath = urlObj.pathname;
        filename = urlPath.split('/').pop() || '';
        if (filename.includes('?')) filename = filename.split('?')[0];
      }
    } catch (e) {
      console.log('[涓嬭浇] URL 瑙ｆ瀽澶辫触:', e.message);
    }
    if (!filename) filename = `download_${Date.now()}`;

    // Prefer filename from Content-Disposition.
    if (!requestedFilename && contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
      if (match) {
        const cdFilename = match[1].replace(/['"]/g, '').trim();
        if (cdFilename) filename = cdFilename;
      }
    }

    // Add extension when missing.
    if (!filename.includes('.')) {
      let queryMime = '';
      try { queryMime = new URL(url).searchParams.get('mime_type') || ''; } catch (e) {}
      if (contentType.includes('video/mp4') || queryMime.includes('video_mp4')) filename += '.mp4';
      else if (contentType.includes('video/')) filename += '.mp4';
      else if (contentType.includes('image/png')) filename += '.png';
      else if (contentType.includes('image/jpeg')) filename += '.jpg';
      else if (contentType.includes('image/webp')) filename += '.webp';
      else if (contentType.includes('image/gif')) filename += '.gif';
      else filename += '.bin';
    }

    const finalPath = getDownloadSavePath(downloadDir, filename, accountId);
    filename = path.basename(finalPath);
    console.log('[涓嬭浇] 淇濆瓨璺緞:', finalPath);

    const size = await writeResponseToFile(response, finalPath);
    console.log('[download] file written:', size, 'bytes', `(${(size / 1024 / 1024).toFixed(2)} MB)`);

    if (mainWindow) {
      mainWindow.webContents.send('file-downloaded', {
        filename,
        path: finalPath,
        url
      });
    }

    console.log('[涓嬭浇] ===== 涓嬭浇鎴愬姛 =====');
    return { ok: true, filePath: finalPath, size };
  } catch (e) {
    console.error('[涓嬭浇] ===== 涓嬭浇寮傚父 =====');
    console.error('[涓嬭浇] 寮傚父绫诲瀷:', e.constructor.name);
    console.error('[涓嬭浇] 寮傚父娑堟伅:', e.message);
    console.error('[涓嬭浇] 寮傚父鏍?', e.stack);
    return { ok: false, reason: 'EXCEPTION', message: e.message, stack: e.stack };
  }
});

// Save blob data sent from the webview preload.
ipcMain.handle('save-blob', async (event, { filename, mime, buffer, accountId }) => {
  console.log('[涓嬭浇] ===== IPC save-blob 宸茶繘鍏?main 杩涚▼ =====');
  console.log('[涓嬭浇] filename:', filename, 'mime:', mime, 'buffer length:', buffer?.length);

  try {
    if (!buffer || !buffer.length) {
      return { ok: false, message: 'buffer 为空' };
    }

    const downloadDir = ensureDownloadDir(getDownloadDir());
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const finalPath = getDownloadSavePath(downloadDir, filename || `download_${Date.now()}`, accountId);
    filename = path.basename(finalPath);
    fs.writeFileSync(finalPath, Buffer.from(buffer));
    console.log('[涓嬭浇] blob 淇濆瓨鎴愬姛:', finalPath, `(${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

    if (mainWindow) {
      mainWindow.webContents.send('file-downloaded', {
        filename,
        path: finalPath,
        url: `blob:${filename}`
      });
    }

    return { ok: true, filePath: finalPath };
  } catch (e) {
    console.error('[涓嬭浇] save-blob 寮傚父:', e.message);
    return { ok: false, message: e.message };
  }
});

// ============= 璐﹀彿绠＄悊 IPC =============
ipcMain.handle('get-accounts', () => accounts);

ipcMain.handle('export-accounts', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择账号备份保存位置',
    defaultPath: app.getPath('desktop'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }

  const exportDir = getAvailableTransferDirectory(result.filePaths[0]);
  try {
    saveAccounts();
    saveSession();
    saveSettings();
    await flushTransferSessions();
    await buildAccountTransferFolderAsync(exportDir);
    return {
      ok: true,
      folderPath: exportDir,
      accountCount: accounts.length,
      message: `已导出 ${accounts.length} 个账号及登录状态`
    };
  } catch (e) {
    console.error('[account-transfer] export failed:', e.message);
    removeDirSafe(exportDir);
    return { ok: false, message: e.message || '导出失败' };
  }
});

ipcMain.handle('import-accounts', async (event, options = {}) => {
  const mode = options?.mode === 'merge' ? 'merge' : 'overwrite';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择账号备份文件夹',
    filters: [{ name: '账号备份包', extensions: ['zip'] }],
    properties: ['openFile', 'openDirectory']
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }

  const selectedPath = result.filePaths[0];
  let extractDir = '';
  let pendingRoot = '';
  try {
    const selectedStat = fs.statSync(selectedPath);
    let importRoot = selectedPath;
    if (selectedStat.isFile()) {
      if (path.extname(selectedPath).toLowerCase() !== '.zip') {
        throw new Error('请选择账号备份文件夹或 ZIP 备份包');
      }
      extractDir = path.join(os.tmpdir(), `aiam-import-${makeTimestamp()}-${crypto.randomBytes(3).toString('hex')}`);
      expandZipToFolder(selectedPath, extractDir);
      importRoot = findTransferRoot(extractDir);
    } else if (selectedStat.isDirectory()) {
      importRoot = findTransferRoot(selectedPath);
    }
    if (!importRoot) throw new Error('未找到有效的账号备份数据');
    const accountsPath = path.join(importRoot, 'accounts.json');
    if (!fs.existsSync(accountsPath)) throw new Error('备份包缺少 accounts.json');
    const importedAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    if (!Array.isArray(importedAccounts)) throw new Error('accounts.json 格式不正确');

    await flushTransferSessions();
    const backupPath = createInternalAccountBackup('import');

    if (mode === 'merge') {
      const mergeResult = mergeImportedAccounts(importRoot, importedAccounts);
      loadAccounts();
      return {
        ok: true,
        restartRequired: false,
        mode,
        accountCount: importedAccounts.length,
        addedCount: mergeResult.added,
        copiedPartitions: mergeResult.copiedPartitions,
        backupPath,
        message: `已合并导入 ${mergeResult.added} 个账号`
      };
    }

    pendingRoot = prepareOverwriteImport(importRoot, selectedPath, importedAccounts, backupPath);

    return {
      ok: true,
      restartRequired: true,
      mode,
      accountCount: importedAccounts.length,
      backupPath,
      message: `已准备导入 ${importedAccounts.length} 个账号，重启软件后生效`
    };
  } catch (e) {
    console.error('[account-transfer] import failed:', e.message);
    if (pendingRoot) removeDirSafe(pendingRoot);
    return { ok: false, message: e.message || '导入失败' };
  } finally {
    if (extractDir) removeDirSafe(extractDir);
  }
});

ipcMain.handle('add-account', (event, { platform, name, url, group, remark, count }) => {
  const platformInfo = PLATFORMS[platform];
  if (!platformInfo) return { success: false, error: '未知平台' };
  const accountUrl = platform === 'custom' ? normalizeUserUrl(url) : platformInfo.url;
  if (!accountUrl) return { success: false, error: '请输入正确的网站地址' };

  const requestedCount = Number(count);
  const createCount = Number.isFinite(requestedCount)
    ? Math.min(50, Math.max(1, Math.floor(requestedCount)))
    : 1;
  const newAccounts = [];
  for (let index = 0; index < createCount; index += 1) {
    const accountName = ensureUniqueAccountName(name || getNextAccountName(platform, platformInfo.name));
    const newAccount = {
      id: makeAccountId(),
      platform,
      platformName: platformInfo.name,
      name: accountName,
      url: accountUrl,
      customUrl: platform === 'custom' ? accountUrl : undefined,
      group: String(group || '').trim() || undefined,
      remark: String(remark || '').trim() || undefined,
      createdAt: new Date().toISOString()
    };
    accounts.push(newAccount);
    newAccounts.push(newAccount);
  }
  saveAccounts();
  return {
    success: true,
    account: newAccounts[0],
    accounts: newAccounts,
    count: newAccounts.length
  };
});

ipcMain.handle('update-account', (event, { id, patch }) => {
  const account = accounts.find(a => a.id === id);
  if (!account) return { success: false, error: '账号不存在' };
  const nextName = String(patch?.name || '').trim();
  if (nextName && nextName !== account.name) {
    const duplicate = accounts.some(a => a.id !== id && a.name === nextName);
    if (duplicate) return { success: false, error: '账号名称已存在' };
    account.name = nextName;
  }
  account.group = String(patch?.group || '').trim() || undefined;
  account.remark = String(patch?.remark || '').trim() || undefined;
  account.updatedAt = new Date().toISOString();
  saveAccounts();
  return { success: true, account };
});

ipcMain.handle('delete-account', (event, id) => {
  accounts = accounts.filter(a => a.id !== id);
  capturedResources = capturedResources.filter(r => r.accountId !== id);
  sessionData.openTabs = (sessionData.openTabs || []).filter(tabId => tabId !== id);
  if (sessionData.activeTabId === id) sessionData.activeTabId = sessionData.openTabs[0] || null;
  for (const [wcId, accountId] of webviewAccountMap) {
    if (accountId === id) webviewAccountMap.delete(wcId);
  }
  saveAccounts();
  saveSession();
  maybeSaveResourceSnapshot();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('resources-updated', capturedResources);
  }
  return { success: true };
});

ipcMain.handle('get-platforms', () => {
  return Object.entries(PLATFORMS).map(([key, val]) => ({
    id: key,
    name: val.name,
    url: val.url
  }));
});

ipcMain.handle('license-status', () => {
  // === 授权绕过：始终返回已激活 ===
  return {
    deviceId: getDeviceId(),
    serverUrl: '',
    cache: null,
    active: true,
    message: ''
  };
});

ipcMain.handle('license-activate', async (_event, payload = {}) => {
  // === 授权绕过：任何输入都直接通过 ===
  licenseApproved = true;
  if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
  if (!mainWindow) {
    loadAccounts();
    loadSession();
    preloadMaowangExtensionsForAccounts().catch(e => console.error('[extensions] preload failed:', e.message));
    createWindow();
  }
  startLicenseMonitor();
  return { ok: true, message: '激活成功' };
});

ipcMain.handle('license-copy-device', (_event, deviceId) => {
  clipboard.writeText(String(deviceId || getDeviceId()));
  return true;
});

ipcMain.handle('license-network-info', () => getLicenseNetworkInfo());

ipcMain.handle('external-login-status', (_event, accountId) => {
  return getExternalLoginStatus(String(accountId || ''));
});

ipcMain.handle('external-login-close', (_event, accountId) => {
  closeExternalLoginSession(String(accountId || ''));
  return { ok: true };
});

ipcMain.handle('external-login-start', async (_event, accountId) => {
  const id = String(accountId || '');
  const account = accounts.find(item => item.id === id);
  if (!account) return { ok: false, message: '未找到当前账号' };
  const targetUrl = account.url || PLATFORMS[account.platform]?.url || '';
  if (!/^https?:\/\//i.test(targetUrl)) {
    return { ok: false, message: '当前账号没有有效网址' };
  }
  if (externalLoginSessions.has(id)) {
    return { ok: true, alreadyStarted: true, ...getExternalLoginStatus(id) };
  }

  const browsers = getExternalBrowserCandidates();
  if (!browsers.length) {
    return { ok: false, message: '没有找到 Chrome 或 Edge，请先安装或更新浏览器' };
  }
  const browser = browsers[0];
  const profileDir = path.join(DATA_DIR, 'external-login-profiles', id);
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--start-maximized',
    '--lang=zh-CN',
    targetUrl
  ];
  const child = childProcess.spawn(browser.path, args, {
    detached: false,
    stdio: 'ignore'
  });
  child.once('exit', () => {
    const state = externalLoginSessions.get(id);
    if (state?.process === child) externalLoginSessions.delete(id);
  });
  const rootDomain = getCookieRootDomain(targetUrl);
  externalLoginSessions.set(id, {
    accountId: id,
    accountUrl: targetUrl,
    rootDomain,
    browserName: browser.name,
    browserPath: browser.path,
    port: 0,
    process: child,
    debugProcess: null,
    profileDir,
    startedAt: Date.now()
  });
  return { ok: true, browserName: browser.name, rootDomain, lowRiskMode: true };
});

ipcMain.handle('external-login-sync', async (_event, accountId) => {
  const id = String(accountId || '');
  const state = externalLoginSessions.get(id);
  const account = accounts.find(item => item.id === id);
  if (!state || !account) {
    return { ok: false, message: '请先点击登录辅助并完成浏览器登录' };
  }
  try {
    try {
      if (state.process && !state.process.killed) state.process.kill();
    } catch (e) {}
    await waitForProcessExit(state.process, 3500);
    await startExternalDebugBrowser(state);
    const allCookies = await readExternalBrowserCookies(state);
    const targetCookies = allCookies.filter(cookie => isTargetCookie(cookie, state.rootDomain));
    if (!targetCookies.length) {
      return { ok: false, message: `没有读取到 ${state.rootDomain} 的登录 Cookie，请确认外部浏览器里已登录成功` };
    }
    const count = await syncCookiesToAccountPartition(id, state.accountUrl, targetCookies);
    if (count <= 0) {
      return { ok: false, message: 'Cookie 同步失败，请重试' };
    }
    closeExternalLoginSession(id);
    for (const [wcId, mappedAccountId] of webviewAccountMap) {
      if (mappedAccountId !== id) continue;
      const wc = webContents.fromId(Number(wcId));
      if (wc && !wc.isDestroyed()) {
        try { wc.reload(); } catch (e) {}
      }
    }
    return { ok: true, count, rootDomain: state.rootDomain };
  } catch (e) {
    return { ok: false, message: `同步失败：${e.message}` };
  }
});

const EXTENSIONS_DIR = path.join(__dirname, '..', 'extensions');
let extensionScriptsCache = null;
const loadedExtensionSessionKeys = new Set();

function getLoadableExtensionDir(name) {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions', name) : '',
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'extensions', name) : '',
    path.join(PROJECT_DIR, 'resources', 'app-asar-extracted', 'extensions', name),
    path.join(PROJECT_DIR, 'app-asar-extracted', 'extensions', name),
    path.join(__dirname, '..', 'extensions', name)
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate.includes('.asar') || !fs.existsSync(candidate)) continue;
    if (fs.existsSync(path.join(candidate, 'manifest.json'))) return candidate;
  }
  return '';
}

async function ensureMaowangExtensionLoaded(targetSession, accountId = '') {
  if (!targetSession) return { ok: false, reason: 'NO_SESSION' };
  const sessionKey = targetSession.partition || 'default';
  if (loadedExtensionSessionKeys.has(sessionKey)) return { ok: true, cached: true };

  const extensionDir = getLoadableExtensionDir('maowang-doubao');
  if (!extensionDir) {
    console.warn('[extensions] maowang-doubao load skipped: directory not found');
    return { ok: false, reason: 'EXTENSION_DIR_NOT_FOUND' };
  }

  try {
    const extension = await targetSession.loadExtension(extensionDir, { allowFileAccess: true });
    loadedExtensionSessionKeys.add(sessionKey);
    console.log('[extensions] loaded maowang-doubao:', extension?.id || '', 'session:', sessionKey, 'account:', accountId);
    return { ok: true, id: extension?.id || '', path: extensionDir };
  } catch (e) {
    console.error('[extensions] load maowang-doubao failed:', sessionKey, e.message);
    return { ok: false, reason: e.message };
  }
}

async function preloadMaowangExtensionsForAccounts() {
  const targets = accounts.filter(account => shouldLoadMaowangExtensionForPlatform(account?.platform));
  for (const account of targets) {
    const targetSession = session.fromPartition(`persist:account_${account.id}`);
    configureBrowserCompatSession(targetSession);
    await ensureMaowangExtensionLoaded(targetSession, account.id);
  }
}

ipcMain.handle('get-extension-scripts', async () => {
  if (extensionScriptsCache) return extensionScriptsCache;

  const scripts = {};
  const missing = [];
  const readScript = (name, filePath) => {
    try {
      scripts[name] = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      missing.push({ name, filePath, error: e.message });
      console.error('[extensions] failed to read script:', name, e.message);
    }
  };

  readScript('polyfill', path.join(__dirname, 'webview-polyfill.js'));
  readScript('doubao-download-content', path.join(EXTENSIONS_DIR, 'doubao-download', 'content.js'));
  readScript('doubao-download-forwarder', path.join(EXTENSIONS_DIR, 'doubao-download', 'forwarder.js'));
  readScript('doubao-creation-download', path.join(__dirname, 'doubao-creation-download.js'));
  readScript('generic-video-capture', path.join(__dirname, 'generic-video-capture.js'));
  readScript('doubao-video-15s', path.join(EXTENSIONS_DIR, 'doubao-video-15s', 'content.js'));
  readScript('dola-electron-bridge', path.join(__dirname, 'dola-electron-bridge.js'));
  readScript('dola-nowatermark-page-hook', path.join(EXTENSIONS_DIR, 'dola-nowatermark', 'page_hook.js'));
  readScript('dola-nowatermark-content', path.join(EXTENSIONS_DIR, 'dola-nowatermark', 'content.js'));
  readScript('jimeng-image-download', path.join(__dirname, 'jimeng-image-download.js'));

  scripts.__meta = {
    available: Object.keys(scripts).filter(key => !key.startsWith('__')),
    missing
  };

  if (missing.length) {
    console.warn('[extensions] missing scripts:', missing.map(item => item.name).join(', '));
  }
  extensionScriptsCache = scripts;
  return extensionScriptsCache;
});

// ============= 绐楀彛绠＄悊 =============
let mainWindow = null;
let licenseWindow = null;
let licenseApproved = false;
let licenseMonitorTimer = null;
let windowIpcRegistered = false;

function showLicenseGate(message = '请先输入激活码') {
  licenseApproved = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    mainWindow = null;
  }
  if (!licenseWindow || licenseWindow.isDestroyed()) createLicenseWindow(message);
}

async function enforceLicenseNow() {
  // === 授权绕过：跳过所有检查 ===
  return;
}

function startLicenseMonitor() {
  if (licenseMonitorTimer) return;
  licenseMonitorTimer = setInterval(() => {
    enforceLicenseNow().catch(error => console.error('[license] recheck failed:', error.message));
  }, LICENSE_RECHECK_MS);
}

function createLicenseWindow(message = '') {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.focus();
    return;
  }
  licenseWindow = new BrowserWindow({
    width: 540,
    height: 760,
    show: false,
    resizable: false,
    title: '激活验证',
    icon: path.join(__dirname, '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  licenseWindow.loadFile(path.join(__dirname, '..', 'renderer', 'license.html'), { query: { message } });
  licenseWindow.once('ready-to-show', () => {
    licenseWindow.show();
    licenseWindow.focus();
  });
  licenseWindow.on('closed', () => {
    licenseWindow = null;
    if (!mainWindow && !licenseApproved) app.quit();
  });
}

function createWindow() {
  // === 授权绕过：不再检查 licenseApproved ===
  if (!mainWindow && !licenseApproved) licenseApproved = true;
  console.log('[main] createWindow');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: '千思链',
    icon: path.join(__dirname, '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    },
    show: false,
    frame: false,
    backgroundColor: '#ffffff'
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 涓?main window 鐨?session 娉ㄥ唽涓嬭浇澶勭悊
  mainWindow.webContents.session.on('will-download', (event, item) => {
    const filename = item.getFilename();
    const url = item.getURL();
    if (shouldCancelDuplicateWillDownload('', url)) {
      console.log('[下载][main-window] cancel duplicate will-download:', url?.slice(0, 120));
      event.preventDefault();
      try { item.cancel(); } catch (e) {}
      return;
    }
    const downloadDir = ensureDownloadDir(getDownloadDir());
    console.log('[涓嬭浇][main-window] will-download 瑙﹀彂:', { url: url?.slice(0, 120), filename });
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    const filePath = getDownloadSavePath(downloadDir, filename, '');
    const finalFilename = path.basename(filePath);
    item.setSavePath(filePath);
    console.log('[涓嬭浇][main-window] 璁剧疆淇濆瓨璺緞:', filePath);
    item.on('done', (e, state) => {
      console.log('[涓嬭浇][main-window] done:', state, filePath);
      if (state === 'completed') {
        if (mainWindow) {
          mainWindow.webContents.send('file-downloaded', {
            filename: finalFilename,
            path: filePath,
            url: item.getURL()
          });
        }
      }
    });
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[main] Window ready-to-show');
    mainWindow.show();
    mainWindow.focus();
  });

  // 鍏滃簳锛氬鏋?ready-to-show 涓€鐩翠笉瑙﹀彂锛?绉掑悗寮哄埗鏄剧ず
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log('[main] Force show window');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 5000);

  // 绐楀彛鎺у埗 IPC
  if (!windowIpcRegistered) {
    windowIpcRegistered = true;
    ipcMain.on('window-minimize', () => mainWindow?.minimize());
    ipcMain.on('window-maximize', () => {
      if (!mainWindow) return;
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    });
    ipcMain.on('window-close', () => mainWindow?.close());
    ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() || false);
  }
}

async function openAuthorizedMainWindow() {
  // === 授权绕过：直接打开主窗口 ===
  licenseApproved = true;
  loadAccounts();
  loadSession();
  preloadMaowangExtensionsForAccounts().catch(e => console.error('[extensions] preload failed:', e.message));
  createWindow();
  startLicenseMonitor();
  return true;
}

app.whenReady().then(async () => {
  console.log('[main] App ready');
  configureBrowserCompatSession(session.defaultSession);
  // Recreate the shortcut silently so it always targets this executable.
  // The authorization gate below still runs before the main window is created.
  ensureDesktopShortcut();
  app.on('web-contents-created', (event, wc) => {
    console.log('[涓嬭浇][web-contents-created] 绫诲瀷:', wc.getType(), 'URL:', wc.getURL()?.slice(0, 80));
    configureBrowserCompatWebContents(wc);
    setupOAuthPopupHandler(wc);
    // WebView media capture must start after renderer registers accountId.
    // Starting it on first navigation can race with did-attach and drop all
    // captured resources because accountId is still empty.
  });
  try {
    await openAuthorizedMainWindow();
  } catch (error) {
    console.error('[license] startup check failed:', error.message);
    createLicenseWindow('授权服务检查失败，请确认激活码管理器正在运行');
  }
});

app.on('before-quit', () => {
  saveAccounts();
  saveSession();
});

app.on('window-all-closed', () => {
  saveAccounts();
  saveSession();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length !== 0) return;
  openAuthorizedMainWindow().catch(error => {
    console.error('[license] activate check failed:', error.message);
    createLicenseWindow('授权服务检查失败，请确认激活码管理器正在运行');
  });
});

// ============= WebView 绠＄悊 =============
function setupWebViewSession(wc) {
  console.log('[涓嬭浇][setupWebViewSession] 姝ｅ湪涓?webview 璁剧疆 session, URL:', wc.getURL()?.slice(0, 80), 'webContentsId:', wc.id);
  try {
    wc.setUserAgent(COMPAT_USER_AGENT);
  } catch (e) {}
  configureBrowserCompatSession(wc.session);
  setupOAuthPopupHandler(wc);
  setupGooglePasskeySuppression(wc);

  // 浠庢槧灏勮〃鑾峰彇 accountId锛堟瘮瑙ｆ瀽 session.partition 鏇村彲闈狅級
  let accountId = webviewAccountMap.get(wc.id) || '';
  // 鍏滃簳锛氬皾璇曚粠 partition 瑙ｆ瀽
  if (!accountId) {
    const partition = wc.session.partition || '';
    accountId = partition.replace('persist:account_', '');
  }
  console.log('[debugger] webContentsId:', wc.id, '-> accountId:', accountId);

  const platform = getAccountPlatform(accountId);

  // === Debugger锛氭嫤鎴?API 鍝嶅簲锛屾彁鍙栬棰戞暟鎹紙缁曡繃 CORB锛?===
  let debuggerAttached = false;
  if (shouldLetMaowangExtensionOwnDebugger(platform)) {
    console.log('[debugger] skip main attach for maowang extension platform:', platform);
  } else {
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3');
      }
      debuggerAttached = true;
      console.log('[debugger] 宸查檮鍔犲埌 webContents');
    } catch (e) {
      console.log('[debugger] 闄勫姞澶辫触锛堝彲蹇界暐锛屽悗缁噸璇曪級:', e.message);
    }
  }

  if (debuggerAttached) {
    const pendingRequests = new Map();

    wc.debugger.on('detach', (event, reason) => {
      console.log('[debugger] 宸插垎绂?', reason);
    });

    wc.debugger.sendCommand('Network.enable').then(() => {
      console.log('[debugger] Network 鍩熷凡鍚敤');

      wc.debugger.on('message', (event, method, params) => {
        // 璁板綍鍝嶅簲
        if (method === 'Network.responseReceived') {
          const url = (params.response?.url || '');
          const currentAccountId = webviewAccountMap.get(wc.id) || accountId || '';
          const currentPlatform = getAccountPlatform(currentAccountId);
          const currentPageUrl = typeof wc.getURL === 'function' ? wc.getURL() : '';
          const networkResource = currentPlatform === 'doubao' || BROWSER_ONLY_PLATFORMS.has(currentPlatform)
            ? null
            : extractResourceFromNetworkResponse(url, params.response);
          if (networkResource) {
            networkResource.pageUrl = networkResource.pageUrl || currentPageUrl;
            networkResource.referer = networkResource.referer || currentPageUrl;
            if (currentAccountId) addCapturedResources(currentAccountId, [networkResource]);
          }
          if (shouldInspectApiResponse(url, params.response)) {
            pendingRequests.set(params.requestId, {
              url,
              mimeType: params.response?.mimeType || '',
              status: params.response?.status || 0
            });
            console.log('[debugger] inspect:', params.response?.status || 0, url.slice(0, 180));
          }
        }

        // 鍝嶅簲鍔犺浇瀹屾垚鍚庤鍙?body
        if (method === 'Network.loadingFinished') {
          if (pendingRequests.has(params.requestId)) {
            const requestInfo = pendingRequests.get(params.requestId);
            const url = requestInfo.url;
            pendingRequests.delete(params.requestId);

            wc.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId })
              .then(result => {
                if (!result || !result.body) return;
                let rawBody = result.body;
                let videos = [];

                // 灏濊瘯瑙ｆ瀽 JSON
                try {
                  const json = JSON.parse(rawBody);
                  videos = extractVideosFromJson(json);
                } catch (jsonErr) {
                  // Parse SSE data lines.
                  const dataLines = rawBody.split('\n')
                    .filter(l => l.startsWith('data: '))
                    .map(l => {
                      try { return JSON.parse(l.slice(6)); } catch(e) { return null; }
                    })
                    .filter(d => d !== null);
                  for (const data of dataLines) {
                    videos.push(...extractVideosFromJson(data));
                  }
                }

                rawBody = decodeDebuggerBody(result);
                maybeSaveDolaMediaSample(url, rawBody);
                maybeSaveDoubaoVideoProbe(url, rawBody);
                videos = extractVideosFromApiBody(rawBody);
                const directResources = extractResourcesFromApiBody(rawBody);

                if ((videos.length > 0 || directResources.length > 0) && mainWindow && !mainWindow.isDestroyed()) {
                  console.log('[debugger] API resources:', { videos: videos.length, direct: directResources.length, url: url.slice(0, 100) });
                  const currentAccountId = webviewAccountMap.get(wc.id) || accountId || '';
                  if (!currentAccountId) {
                    console.log('[debugger] resource detected but accountId is empty, webContentsId:', wc.id);
                    return;
                  }
                  const enriched = videos.map(v => ({ ...v, accountId: currentAccountId }));
                  if (enriched.length) mainWindow.webContents.send('debugger-video-detected', enriched);
                  if (directResources.length) {
                    const currentPageUrl = typeof wc.getURL === 'function' ? wc.getURL() : '';
                    addCapturedResources(currentAccountId, directResources.map(resource => ({
                      ...resource,
                      pageUrl: resource.pageUrl || currentPageUrl,
                      referer: resource.referer || currentPageUrl
                    })));
                  }
                }
              })
              .catch(err => {
                // Response body may be unavailable for some requests.
              });
          }
        }
      });
    }).catch(e => {
      console.log('[debugger] 鍚敤 Network 澶辫触:', e.message);
    });
  }

  if (!wc.session.__aiamDownloadHandlerAttached) {
    wc.session.__aiamDownloadHandlerAttached = true;
    wc.session.on('will-download', (event, item) => {
      const filename = item.getFilename();
      const url = item.getURL();
      const downloadDir = ensureDownloadDir(getDownloadDir());
      const accountId = webviewAccountMap.get(wc.id) || webviewAccountMap.get(String(wc.id)) || '';
      if (shouldCancelDuplicateWillDownload(accountId, url)) {
        console.log('[下载][webview-session] cancel duplicate will-download:', url?.slice(0, 120));
        event.preventDefault();
        try { item.cancel(); } catch (e) {}
        return;
      }
      const filePath = getDownloadSavePath(downloadDir, filename, accountId);
      const finalFilename = path.basename(filePath);
      console.log('[涓嬭浇][webview-session] will-download 瑙﹀彂! URL:', url?.slice(0, 120), 'filename:', filename);
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }
      item.setSavePath(filePath);
      console.log('[涓嬭浇][webview-session] 淇濆瓨璺緞:', filePath);
      item.on('done', (e, state) => {
        console.log('[涓嬭浇][webview-session] done:', state, filePath);
        if (state === 'completed') {
          if (mainWindow) {
            mainWindow.webContents.send('file-downloaded', {
              filename: finalFilename,
              path: filePath,
              url: item.getURL()
            });
          }
        }
      });
    });
  }
}

// Recursively search JSON for video data (vid + messageId).
function extractVideosFromJson(obj, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== 'object') return [];
  let results = [];
  try {
    if (Array.isArray(obj)) {
      for (const item of obj) results.push(...extractVideosFromJson(item, depth + 1));
    } else {
      const vid = obj.vid || obj.video_id || '';
      const messageId = obj.message_id || obj.messageId || '';
      if (vid && typeof vid === 'string' && vid.startsWith('v0') &&
          messageId && String(messageId) !== '0') {
        results.push({ vid, messageId: String(messageId) });
      }
      // Check patch_value from SSE payloads.
      if (obj.patch_op && obj.patch_value) {
        if (Array.isArray(obj.patch_value)) {
          for (const pv of obj.patch_value) {
            results.push(...extractVideosFromJson(pv, depth + 1));
          }
        } else {
          results.push(...extractVideosFromJson(obj.patch_value, depth + 1));
        }
      }
      // Recurse into child objects while skipping large binary-like fields.
      const skipKeys = ['raw_data', 'audio', 'image_data'];
      if (obj.patch_op) skipKeys.push('patch_op', 'patch_value');
      for (const key of Object.keys(obj)) {
        if (skipKeys.includes(key)) continue;
        const val = obj[key];
        if (val && typeof val === 'object') {
          results.push(...extractVideosFromJson(val, depth + 1));
        }
      }
    }
  } catch(e) {}
  return results;
}

// ============= 绐楀彛鎺у埗 IPC =============
function shouldInspectApiResponse(url, response = {}) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  const mimeType = String(response.mimeType || '').toLowerCase();
  const isDoubaoApi =
    lowerUrl.includes('doubao.com') ||
    lowerUrl.includes('bytedance') ||
    lowerUrl.includes('byteintl') ||
    lowerUrl.includes('dola.com') ||
    lowerUrl.includes('tongyi.aliyun.com') ||
    lowerUrl.includes('qianwen') ||
    lowerUrl.includes('aliyun') ||
    lowerUrl.includes('alicdn');
  if (!isDoubaoApi) return false;

  const endpointHints = [
    '/chat/completion',
    '/chain/single',
    '/batch_get_conv',
    '/pull_singe_chain',
    '/pull_single_chain',
    '/conversation',
    '/message',
    '/multimodal',
    '/video',
    '/generate',
    '/image',
    '/media',
    '/file',
    '/task',
    '/result'
  ];
  const mimeLooksReadable = mimeType.includes('json') || mimeType.includes('event-stream') || mimeType.includes('text');
  return endpointHints.some(hint => lowerUrl.includes(hint)) ||
    (mimeLooksReadable && /vid|video|image|media|chain|message|conversation|completion|task|result/.test(lowerUrl));
}

function extractResourceFromNetworkResponse(url, response = {}) {
  if (!url || typeof url !== 'string') return null;
  const mimeType = String(response.mimeType || '').toLowerCase();
  const lowerUrl = url.toLowerCase();
  const isKnownHost = /doubao\.com|dola\.com|ciciai\.com|ibyteimg\.com|byteimg\.com|byteintl|bytedance|tongyi\.aliyun\.com|qianwen|alicdn|aliyun/i.test(lowerUrl);
  if (!isKnownHost) return null;
  const isDolaHost = /dola\.com|ciciai\.com/i.test(lowerUrl);
  const looksLikeVideoRequest = mimeType.startsWith('video/') ||
    /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(lowerUrl) ||
    /mime_type=video|\/video\/|video_mp4|play_url|download_url|stream|vod|media/i.test(lowerUrl);
  if (/^https:\/\/www\.dola\.com\/im\//i.test(url) && !looksLikeVideoRequest) return null;

  if (looksLikeVideoRequest) {
    const sizeMatch = lowerUrl.match(/(?:^|[?&_/.-])(\d{2,4})[x*](\d{2,4})(?:[?&#_/.-]|$)/i);
    const qualityMatch = lowerUrl.match(/(?:^|[?&_/.-])(720|1080|144|480|540)p(?:[?&#_/.-]|$)/i);
    return {
      type: 'video',
      url,
      title: isDolaHost || lowerUrl.includes('ibyteimg') ? '创作平台视频' : '',
      width: sizeMatch ? Number(sizeMatch[1]) : undefined,
      height: sizeMatch ? Number(sizeMatch[2]) : undefined,
      quality: qualityMatch ? `${qualityMatch[1]}p` : undefined,
      source: isDolaHost ? 'dola-debugger-network-video' : 'debugger-network-media'
    };
  }

  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(lowerUrl)) {
    if (isBlockedAssetUrl(url)) return null;
    return {
      type: 'image',
      url,
      thumbUrl: url,
      title: '',
      source: 'debugger-network-media'
    };
  }

  return null;
}

function decodeDebuggerBody(result) {
  if (!result || !result.body) return '';
  if (!result.base64Encoded) return result.body;
  try {
    return Buffer.from(result.body, 'base64').toString('utf8');
  } catch (e) {
    return result.body;
  }
}

function maybeSaveDolaMediaSample(url, rawBody) {
  if (process.env.AIAM_DEBUG_MEDIA !== '1') return;
  if (!url || !rawBody || !url.toLowerCase().includes('dola.com')) return;
  if (!/video|watermark|original|play_url|main_url|media/i.test(rawBody)) return;
  try {
    const dir = path.join(DATA_DIR, 'debug-dola-media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => ({ name, file: path.join(dir, name), mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    while (existing.length >= 30) {
      const oldest = existing.shift();
      try { fs.unlinkSync(oldest.file); } catch (e) {}
    }
    const file = path.join(dir, `${Date.now()}-${existing.length + 1}.json`);
    fs.writeFileSync(file, JSON.stringify({
      url,
      capturedAt: new Date().toISOString(),
      snippet: makeBodySnippet(rawBody),
      body: rawBody
    }, null, 2));
  } catch (e) {
    console.error('[debugger] save dola sample failed:', e.message);
  }
}

function maybeSaveDoubaoVideoProbe(url, rawBody) {
  if (!DEBUG_LOG_ENABLED) return;
  const lowerUrl = String(url || '').toLowerCase();
  if (!lowerUrl.includes('doubao.com') || !rawBody) return;
  if (!/get_play_info|chat\/completion|chain\/single|video|media/.test(lowerUrl) &&
      !/original_media_info|play_infos|video_gen_|main_url|backup_url|vid|video_id/i.test(rawBody)) {
    return;
  }

  try {
    const dir = path.join(DATA_DIR, 'debug-doubao-video');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    pruneDebugFiles(dir, 80);

    const payloads = parseApiPayloads(rawBody);
    const candidates = [];
    const seen = new Set();
    for (const payload of payloads) {
      collectDoubaoVideoCandidates(payload, '', candidates, seen);
    }

    const file = path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);
    fs.writeFileSync(file, JSON.stringify({
      url,
      capturedAt: new Date().toISOString(),
      payloadCount: payloads.length,
      bodySnippet: makeBodySnippet(rawBody),
      candidates: candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, 120)
    }, null, 2), 'utf-8');
    console.log('[doubao-probe] saved:', file, 'candidates:', candidates.length);
  } catch (e) {
    console.error('[doubao-probe] save failed:', e.message);
  }
}

function pruneDebugFiles(dir, limit) {
  try {
    const files = fs.readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => ({ name, file: path.join(dir, name), mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }))
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    while (files.length >= limit) {
      const oldest = files.shift();
      try { fs.unlinkSync(oldest.file); } catch (e) {}
    }
  } catch (e) {}
}

function collectDoubaoVideoCandidates(value, pathName, out, seen, depth = 0) {
  if (depth > 12 || value == null) return;

  if (typeof value === 'string') {
    const url = normalizeMediaUrl(value);
    if (!url || !inferMediaType(url, pathName).includes('video')) return;
    const key = `${pathName}:${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      path: pathName,
      url: url.slice(0, 1200),
      host: safeUrlHost(url),
      queryKeys: safeUrlQueryKeys(url),
      hasNoWatermarkSignal: /no[_-]?watermark|without[_-]?watermark|video_gen_no_watermark/i.test(`${pathName} ${url}`),
      hasWatermarkSignal: /watermark|wm=|lr=video_gen_watermark/i.test(`${pathName} ${url}`),
      score: scoreMediaUrl(pathName, url, 'video')
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectDoubaoVideoCandidates(item, `${pathName}[${index}]`, out, seen, depth + 1));
    return;
  }

  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = pathName ? `${pathName}.${key}` : key;
    collectDoubaoVideoCandidates(child, nextPath, out, seen, depth + 1);
  }
}

function safeUrlHost(url) {
  try { return new URL(url).host; } catch (e) { return ''; }
}

function safeUrlQueryKeys(url) {
  try { return Array.from(new URL(url).searchParams.keys()).slice(0, 40); } catch (e) { return []; }
}

function extractVideosFromApiBody(rawBody) {
  const videos = [];
  const seen = new Set();
  for (const payload of parseApiPayloads(rawBody)) {
    for (const video of extractVideosFromJson(payload)) {
      const key = `${video.vid}:${video.messageId}`;
      if (!seen.has(key)) {
        seen.add(key);
        videos.push(video);
      }
    }
  }
  return videos;
}

function extractResourcesFromApiBody(rawBody) {
  const resources = [];
  const seen = new Set();
  for (const payload of parseApiPayloads(rawBody)) {
    for (const resource of extractResourcesFromJson(payload)) {
      const key = `${resource.type}:${resource.url}`;
      if (!resource.url || seen.has(key)) continue;
      seen.add(key);
      resources.push(resource);
    }
  }
  return resources;
}

function extractResourcesFromJson(obj, depth = 0, context = {}, seenObjects = new WeakSet()) {
  if (depth > 24 || obj == null) return [];

  if (typeof obj === 'string') {
    const text = obj.trim();
    const parsed = looksLikeMediaPayload(text) ? tryParseJson(text) : null;
    if (parsed !== null) return extractResourcesFromJson(parsed, depth + 1, context, seenObjects);
    const url = normalizeMediaUrl(text);
    if (!url) return [];
    const type = inferMediaType(url, context.key || '');
    return type ? [{ type, url, title: context.title || '', source: 'debugger-api-url' }] : [];
  }

  if (typeof obj !== 'object') return [];
  if (seenObjects.has(obj)) return [];
  seenObjects.add(obj);

  const results = [];
  if (Array.isArray(obj)) {
    for (const item of obj) results.push(...extractResourcesFromJson(item, depth + 1, context, seenObjects));
    return dedupeExtractedResources(results);
  }

  results.push(...extractDolaPlayInfoResources(obj, context));
  results.push(...extractDolaCreationResources(obj, context));
  results.push(...extractDolaVideoObjectResources(obj, context));

  const title =
    normalizeResourceTitle(obj.title) ||
    normalizeResourceTitle(obj.name) ||
    normalizeResourceTitle(obj.prompt) ||
    normalizeResourceTitle(obj.text) ||
    normalizeResourceTitle(obj.content) ||
    normalizeResourceTitle(context.title);
  const bestVideo = pickBestMediaUrl(obj, 'video', false, context.key || '');
  const bestImage = pickBestMediaUrl(obj, 'image', false, context.key || '');
  const thumbUrl = pickBestMediaUrl(obj, 'image', true, context.key || '');
  if (bestVideo) {
    results.push({
      type: 'video',
      url: bestVideo,
      backupUrl: pickBackupMediaUrl(obj, bestVideo),
      title,
      thumbUrl,
      source: 'debugger-api-direct'
    });
  }
  if (bestImage) {
    results.push({
      type: 'image',
      url: bestImage,
      thumbUrl: thumbUrl || bestImage,
      title,
      source: 'debugger-api-direct'
    });
  }

  const skipKeys = new Set(['raw_data', 'rawData', 'audio', 'audio_data', 'binary', 'bytes']);
  for (const [key, val] of Object.entries(obj)) {
    if (skipKeys.has(key)) continue;
    results.push(...extractResourcesFromJson(val, depth + 1, { ...context, key, title }, seenObjects));
  }
  return dedupeExtractedResources(results);
}

function extractDolaCreationResources(obj, context = {}) {
  const creationBlock = obj?.creation_block || obj?.creationBlock || obj;
  const creations = Array.isArray(creationBlock?.creations) ? creationBlock.creations : null;
  if (!creations) return [];

  const resources = [];
  for (const creation of creations) {
    const title =
      normalizeResourceTitle(creation?.gen_params?.prompt) ||
      normalizeResourceTitle(creation?.image?.gen_params?.prompt) ||
      normalizeResourceTitle(creation?.video?.gen_params?.prompt) ||
      normalizeResourceTitle(context.title) ||
      (creation?.video ? '创作平台视频' : '创作平台图片');

    if (creation?.image) {
      const image = creation.image;
      const url = pickUrlValue(image.image_ori_raw) ||
        pickUrlValue(image.raw_image) ||
        pickUrlValue(image.image_ori) ||
        pickUrlValue(image.image_preview) ||
        pickUrlValue(image.image_thumb);
      const thumbUrl = pickUrlValue(image.image_thumb) || pickUrlValue(image.image_preview) || url;
      if (url) {
        resources.push({
          type: 'image',
          url,
          thumbUrl,
          width: image.image_ori_raw?.width || image.image_ori?.width || image.image_thumb?.width,
          height: image.image_ori_raw?.height || image.image_ori?.height || image.image_thumb?.height,
          title,
          source: 'dola-creation-image'
        });
      }
    }

    if (creation?.video) {
      const video = creation.video;
      const modelResource = extractDolaVideoModelResource(video, context);
      const url = pickUrlValue(video.download_url) ||
        pickUrlValue(video.downloadUrl) ||
        pickUrlValue(video.watermark_url) ||
        pickUrlValue(video.watermarkUrl) ||
        pickUrlValue(video.video_ori_raw) ||
        pickUrlValue(video.video_ori) ||
        pickUrlValue(video.origin_url) ||
        pickUrlValue(video.original_url) ||
        pickUrlValue(video.play_url) ||
        pickUrlValue(video.main_url) ||
        pickUrlValue(video.url) ||
        modelResource?.url ||
        pickUrlValue(video.no_watermark_url) ||
        pickUrlValue(video.noWatermarkUrl);
      const thumbUrl = pickUrlValue(video.cover) ||
        pickUrlValue(video.cover_image) ||
        pickUrlValue(video.coverImage) ||
        pickUrlValue(video.poster) ||
        pickUrlValue(video.thumb) ||
        modelResource?.thumbUrl;
      if (url) {
        resources.push({
          type: 'video',
          url,
          backupUrl: modelResource?.backupUrl || '',
          thumbUrl,
          width: video.width,
          height: video.height,
          vid: video.vid,
          title: title && title !== normalizeResourceTitle(context.title) ? title : '创作平台视频',
          source: 'dola-creation-video'
        });
      }
    }
  }
  return resources;
}

function extractDolaVideoModelResource(video, context = {}) {
  const model = parseNestedJsonValue(video?.video_model || video?.videoModel);
  if (!model || typeof model !== 'object') return null;

  const videoList = model.video_list || model.videoList || {};
  const candidates = [];
  for (const item of Object.values(videoList)) {
    if (!item || typeof item !== 'object') continue;
    const mainUrl = pickUrlValue(item.main_url || item.mainUrl || item.main);
    const backupUrl = pickUrlValue(item.backup_url_1 || item.backup_url || item.backupUrl || item.backup);
    if (mainUrl) {
      candidates.push({
        url: mainUrl,
        backupUrl,
        width: item.vwidth || item.width,
        height: item.vheight || item.height,
        bitrate: item.bitrate || item.real_bitrate || 0
      });
    }
  }

  candidates.sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  const best = candidates[0];
  const fallbackUrl = pickUrlValue(model.fallback_api || model.fallbackApi);
  const posterUrl = pickUrlValue(model.poster_url || model.posterUrl);
  if (!best && !fallbackUrl) return null;
  return {
    type: 'video',
    url: best?.url || fallbackUrl,
    backupUrl: best?.backupUrl || fallbackUrl || '',
    thumbUrl: posterUrl,
    width: best?.width,
    height: best?.height,
    vid: video?.vid || model.video_id || model.videoId,
    title: normalizeResourceTitle(context.title) || '创作平台视频',
    source: 'dola-video-model'
  };
}

function parseNestedJsonValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try {
    return JSON.parse(text);
  } catch (e) {
    return value;
  }
}

function extractDolaPlayInfoResources(obj, context = {}) {
  const playInfos = Array.isArray(obj?.data?.play_infos) ? obj.data.play_infos :
    Array.isArray(obj?.play_infos) ? obj.play_infos :
    Array.isArray(obj?.playInfos) ? obj.playInfos :
    null;
  if (!playInfos) return [];

  const resources = [];
  for (const info of playInfos) {
    const mainUrl = pickUrlValue(info.main) || pickUrlValue(info.main_url) || pickUrlValue(info.play_url) || pickUrlValue(info.url);
    if (!mainUrl) continue;
    const backupUrl = pickUrlValue(info.backup) || pickUrlValue(info.backup_url);
    resources.push({
      type: 'video',
      url: mainUrl,
      backupUrl,
      width: info.width,
      height: info.height,
      definition: info.definition,
      title: normalizeResourceTitle(context.title) || '创作平台视频',
      source: 'dola-get-play-info'
    });
  }
  return resources;
}

function extractDolaVideoObjectResources(obj, context = {}) {
  if (!obj || typeof obj !== 'object') return [];
  const modelResource = extractDolaVideoModelResource(obj, context);
  const rawUrl = pickUrlValue(obj.download_url) ||
    pickUrlValue(obj.downloadUrl) ||
    pickUrlValue(obj.play_url) ||
    pickUrlValue(obj.playUrl) ||
    pickUrlValue(obj.main_url) ||
    pickUrlValue(obj.mainUrl) ||
    pickUrlValue(obj.url) ||
    modelResource?.url;
  if (!rawUrl) return [];

  const looksLikeDolaVideo =
    obj.vid ||
    obj.video_type ||
    obj.videoType ||
    obj.duration ||
    obj.download_filehash ||
    /v\d+-dola\.dola\.com|mime_type=video_mp4|\/video\/tos\/mya\//i.test(rawUrl);
  if (!looksLikeDolaVideo) return [];

  const url = rawUrl;
  const thumbUrl =
    pickUrlValue(obj.cover) ||
    pickUrlValue(obj.cover_image) ||
    pickUrlValue(obj.coverImage) ||
    pickUrlValue(obj.poster) ||
    pickUrlValue(obj.thumb) ||
    modelResource?.thumbUrl;

  return [{
    type: 'video',
    url,
    backupUrl: modelResource?.backupUrl || '',
    thumbUrl,
    width: obj.width,
    height: obj.height,
    duration: obj.duration,
    vid: obj.vid,
    title: normalizeResourceTitle(context.title) || '创作平台视频',
    source: 'dola-video-object'
  }];
}

function pickBestMediaUrl(obj, wantedType, allowCover = false, parentKey = '') {
  const candidates = [];
  for (const [key, val] of Object.entries(obj || {})) {
    collectMediaCandidates(parentKey ? `${parentKey}.${key}` : key, val, candidates, allowCover);
  }
  return candidates
    .filter(item => item.type === wantedType)
    .sort((a, b) => b.score - a.score)[0]?.url || '';
}

function pickBackupMediaUrl(obj, primaryUrl) {
  const candidates = [];
  for (const [key, val] of Object.entries(obj || {})) {
    collectMediaCandidates(key, val, candidates, true);
  }
  return candidates
    .filter(item => item.type === 'video' && item.url !== primaryUrl)
    .sort((a, b) => b.score - a.score)[0]?.url || '';
}

function collectMediaCandidates(key, val, candidates, allowCover) {
  if (typeof val === 'string') {
    const url = normalizeMediaUrl(val);
    if (!url) return;
    const type = inferMediaType(url, key);
    if (!type) return;
    if (!allowCover && /cover|poster|thumb/i.test(key)) return;
    candidates.push({ type, url, score: scoreMediaUrl(key, url, type) });
    if (shouldGenerateNoWatermarkVariantForUrl(url)) {
      for (const variant of makeNoWatermarkVariants(url)) {
        candidates.push({ type, url: variant, score: scoreMediaUrl(`${key} no_watermark`, variant, type) });
      }
    }
    return;
  }
  if (Array.isArray(val)) {
    for (const item of val) collectMediaCandidates(key, item, candidates, allowCover);
  }
}

function normalizeMediaUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim().replace(/\\u0026/g, '&');
  if (!url || url.startsWith('data:')) return '';
  if (isBlockedAssetUrl(url)) return '';
  if (/^https?:\/\//i.test(url) || /^blob:/i.test(url)) return url;
  return '';
}

function inferMediaType(url, key = '') {
  const haystack = `${key} ${url}`.toLowerCase();
  if (isBlockedAssetUrl(url) || /css-var|stylesheet|script|favicon|logo|icon/.test(haystack)) return '';
  if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url) || /image|img|cover|poster|thumb/.test(haystack)) return 'image';
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) || /video|play|media|stream|download|source|watermark|origin|original_media|main_url|backup_url|vod/.test(haystack)) return 'video';
  return '';
}

function scoreMediaUrl(key, url, type) {
  const text = `${key} ${url}`.toLowerCase();
  let score = 1;
  if (/no[_-]?watermark|without[_-]?watermark|watermark=false|remove[_-]?watermark/.test(text)) score += 100;
  if (/original_media_info|original|origin|source|raw|download|main_url|高清|原/.test(text)) score += 40;
  if (/main|master|play|url/.test(text)) score += 12;
  if (/backup|fallback|thumb|cover|poster/.test(text)) score -= type === 'video' ? 30 : 5;
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) score += 15;
  if (/\.(png|jpe?g|webp)(\?|#|$)/i.test(url)) score += 15;
  return score;
}

function isBlockedAssetUrl(url) {
  return /(?:logo|icon|favicon|sprite|avatar|placeholder|loading|empty|default|intro|banner|background|app_icon|10server|\.css|\.js|\.map)(?:[._\/-]|\?|#|$)/i.test(url) ||
    /\/image(?:\?|#|$)/i.test(url);
}

function makeNoWatermarkVariants(url) {
  if (!url || !/watermark|wm=|lr=/i.test(url)) return [];
  const variants = new Set();
  if (/[?&]lr=/i.test(url)) {
    variants.add(url.replace(/([?&]lr=)[^&]*/gi, '$1video_gen_no_watermark'));
  }
  variants.add(url
    .replace(/([?&](?:watermark|with_watermark|wm)=)(?:1|true|yes)/gi, '$1false')
    .replace(/([?&](?:no_watermark|without_watermark)=)(?:0|false|no)/gi, '$1true')
    .replace(/lr=[^&]*watermark[^&]*/gi, 'lr=video_gen_no_watermark')
    .replace(/watermark_dyn/gi, 'no_watermark')
    .replace(/watermark/gi, 'no_watermark'));
  variants.delete(url);
  return Array.from(variants);
}

function shouldGenerateNoWatermarkVariantForUrl(url) {
  return false;
}

function looksLikeMediaPayload(rawBody) {
  return typeof rawBody === 'string' && /https?:\/\/|no[_-]?watermark|video[_-]?url|play[_-]?url|image[_-]?url|origin|original/i.test(rawBody);
}

function dedupeExtractedResources(resources) {
  const seen = new Set();
  return resources.filter(item => {
    const key = `${item.type}:${item.url}`;
    if (!item.url || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseApiPayloads(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return [];
  const payloads = [];
  const parsedWhole = tryParseJson(rawBody.trim());
  if (parsedWhole !== null) payloads.push(parsedWhole);

  for (const eventText of parseSseEvents(rawBody)) {
    const text = eventText.trim();
    if (!text || text === '[DONE]') continue;
    const parsed = tryParseJson(text);
    if (parsed !== null) payloads.push(parsed);
  }
  return payloads;
}

function parseSseEvents(rawBody) {
  const events = [];
  let dataLines = [];
  for (const line of rawBody.split(/\r?\n/)) {
    if (line === '') {
      if (dataLines.length) {
        events.push(dataLines.join('\n'));
        dataLines = [];
      }
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length) events.push(dataLines.join('\n'));
  return events;
}

function tryParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function extractVideosFromJson(obj, depth = 0, context = {}, seenObjects = new WeakSet()) {
  if (depth > 24 || obj == null) return [];

  if (typeof obj === 'string') {
    if (!looksLikeVideoPayload(obj)) return [];
    const parsed = tryParseJson(obj.trim());
    return parsed === null ? [] : extractVideosFromJson(parsed, depth + 1, context, seenObjects);
  }

  if (typeof obj !== 'object') return [];
  if (seenObjects.has(obj)) return [];
  seenObjects.add(obj);

  const results = [];
  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...extractVideosFromJson(item, depth + 1, context, seenObjects));
    }
    return results;
  }

  const localMessageId = normalizeMessageId(
    obj.message_id || obj.messageId || obj.msg_id || obj.msgId || obj.item_message_id || obj.itemMessageId || context.messageId
  );
  const localContext = { ...context, messageId: localMessageId || context.messageId };
  const vid = normalizeVid(obj.vid || obj.video_id || obj.videoId || obj.item_vid || obj.itemVid || obj.video_vid);
  if (vid && localContext.messageId) {
    const thumbUrl =
      pickUrlValue(obj.cover) ||
      pickUrlValue(obj.cover_image) ||
      pickUrlValue(obj.coverImage) ||
      pickUrlValue(obj.poster) ||
      pickUrlValue(obj.thumb) ||
      pickBestMediaUrl(obj, 'image', true, localContext.key || '');
    const title =
      normalizeResourceTitle(obj.title) ||
      normalizeResourceTitle(obj.name) ||
      normalizeResourceTitle(obj.prompt) ||
      normalizeResourceTitle(obj.text) ||
      normalizeResourceTitle(localContext.title);
    results.push({ vid, messageId: localContext.messageId, thumbUrl, title });
  }

  const skipKeys = new Set(['raw_data', 'rawData', 'audio', 'audio_data', 'image_data', 'binary', 'bytes']);
  for (const [key, val] of Object.entries(obj)) {
    if (skipKeys.has(key)) continue;
    results.push(...extractVideosFromJson(val, depth + 1, { ...localContext, key }, seenObjects));
  }
  return results;
}

function normalizeVid(value) {
  if (typeof value !== 'string') return '';
  const vid = value.trim();
  if (!vid || vid.length < 4) return '';
  if (/^https?:\/\//i.test(vid) || /^blob:/i.test(vid) || /^data:/i.test(vid)) return '';
  return vid;
}

function normalizeMessageId(value) {
  if (value == null) return '';
  const messageId = String(value).trim();
  if (!messageId || messageId === '0' || messageId.toLowerCase() === 'null') return '';
  return messageId;
}

function looksLikeVideoPayload(rawBody) {
  return typeof rawBody === 'string' && /"?(vid|video_id|videoId|item_vid)"?\s*:|video/i.test(rawBody);
}

function makeBodySnippet(rawBody) {
  return String(rawBody || '').replace(/\s+/g, ' ').slice(0, 260);
}

ipcMain.handle('get-platform-url', (event, platformId) => {
  const p = PLATFORMS[platformId];
  return p ? p.url : null;
});

// ============= WebView 涓嬭浇澶勭悊鍣紙鏄惧紡娉ㄥ唽锛屼笉渚濊禆 web-contents-created锛?=============
ipcMain.on('setup-download-handler', (event, accountId) => {
  const partition = `persist:account_${accountId}`;
  const downloadDir = ensureDownloadDir(getDownloadDir());

  try {
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const partitionSession = session.fromPartition(partition);
    const platform = getAccountPlatform(accountId);
    if (shouldLoadMaowangExtensionForPlatform(platform)) {
      ensureMaowangExtensionLoaded(partitionSession, accountId)
        .catch(e => console.error(`[extensions] load for ${partition} failed:`, e.message));
    }

    // 绉婚櫎鏃х洃鍚櫒閬垮厤閲嶅娉ㄥ唽
    partitionSession.removeAllListeners('will-download');
    partitionSession.__aiamDownloadHandlerAttached = true;

    partitionSession.on('will-download', (event, item) => {
      const filename = item.getFilename();
      const url = item.getURL();
      if (shouldCancelDuplicateWillDownload(accountId, url)) {
        console.log(`[下载][${accountId}] cancel duplicate will-download:`, url?.slice(0, 120));
        event.preventDefault();
        try { item.cancel(); } catch (e) {}
        return;
      }
      const filePath = getDownloadSavePath(downloadDir, filename, accountId);
      const finalFilename = path.basename(filePath);

      item.setSavePath(filePath);
      console.log(`[涓嬭浇][${accountId}] 淇濆瓨: ${filePath}`);

      item.on('done', (e, state) => {
        if (state === 'completed') {
          console.log(`[涓嬭浇][${accountId}] 瀹屾垚: ${filePath}`);
          if (mainWindow) {
            mainWindow.webContents.send('file-downloaded', {
              filename: finalFilename,
              path: filePath,
              url: item.getURL()
            });
          }
        } else {
          console.log(`[涓嬭浇][${accountId}] 澶辫触(${state}): ${filename}`);
        }
      });
    });

    console.log(`[涓嬭浇] 宸蹭负 ${partition} 娉ㄥ唽 will-download`);
  } catch (e) {
    console.error(`[涓嬭浇] 娉ㄥ唽 partition ${partition} 澶辫触:`, e.message);
  }
});

// 榛樿 session 鍏滃簳锛堟崟鑾烽儴鍒嗘湭鍒嗗尯鐨勪笅杞斤級
try {
  const defaultSess = session.defaultSession;
  defaultSess.removeAllListeners('will-download');
  defaultSess.on('will-download', (event, item) => {
    const filename = item.getFilename();
    const url = item.getURL();
    if (shouldCancelDuplicateWillDownload('', url)) {
      console.log('[下载][default-session] cancel duplicate will-download:', url?.slice(0, 120));
      event.preventDefault();
      try { item.cancel(); } catch (e) {}
      return;
    }
    const downloadDir = ensureDownloadDir(getDownloadDir());
    console.log('[涓嬭浇][default-session] will-download 瑙﹀彂! URL:', url?.slice(0, 120), 'filename:', filename);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    const filePath = getDownloadSavePath(downloadDir, filename, '');
    const finalFilename = path.basename(filePath);
    item.setSavePath(filePath);
    console.log('[涓嬭浇][default-session] 淇濆瓨璺緞:', filePath);
    item.on('done', (e, state) => {
      console.log('[涓嬭浇][default-session] done:', state, filePath);
      if (state === 'completed' && mainWindow) {
        mainWindow.webContents.send('file-downloaded', {
          filename: finalFilename,
          path: filePath,
          url: item.getURL()
        });
      }
    });
  });
} catch (e) {
  console.error('[涓嬭浇] 娉ㄥ唽 defaultSession 澶辫触:', e.message);
}

// ============= 发布模块 =============

const PUBLISH_URLS = {
  douyin:      'https://creator.douyin.com/creator-micro/content/upload',
  kuaishou:    'https://cp.kuaishou.com/article/publish/video',
  xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish',
  bilibili:    'https://member.bilibili.com/platform/upload/video/frame',
};

const PUBLISH_PLATFORM_NAMES = {
  douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', bilibili: 'B站'
};

const publishTasks = new Map();
let publishTaskCounter = 0;

// ============= 发布记录存储 =============
const PUBLISH_RECORDS_FILE = path.join(DATA_DIR, 'publish_records.json');

function _loadPublishRecords() {
  try {
    if (fs.existsSync(PUBLISH_RECORDS_FILE)) {
      return JSON.parse(fs.readFileSync(PUBLISH_RECORDS_FILE, 'utf8'));
    }
  } catch (e) { console.error('[publish-records] load error:', e.message); }
  return [];
}

function _savePublishRecords(records) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PUBLISH_RECORDS_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (e) { console.error('[publish-records] save error:', e.message); }
}

function _addPublishRecord(record) {
  const records = _loadPublishRecords();
  records.unshift(record);
  if (records.length > 500) records.length = 500;
  _savePublishRecords(records);
}

function _updatePublishRecord(recordId, patch) {
  const records = _loadPublishRecords();
  const idx = records.findIndex(r => r.id === recordId);
  if (idx >= 0) {
    Object.assign(records[idx], patch);
    _savePublishRecords(records);
  }
}

ipcMain.handle('publish-records-list', () => {
  return { ok: true, records: _loadPublishRecords() };
});

ipcMain.handle('publish-records-update', (event, payload) => {
  const { recordId, patch } = payload || {};
  if (!recordId) return { ok: false, error: 'recordId 不能为空' };
  _updatePublishRecord(recordId, patch || {});
  return { ok: true };
});

ipcMain.handle('publish-records-delete', (event, payload) => {
  const { recordId } = payload || {};
  const records = _loadPublishRecords();
  const filtered = records.filter(r => r.id !== recordId);
  if (filtered.length === records.length) return { ok: false, error: '记录不存在' };
  _savePublishRecords(filtered);
  return { ok: true };
});

function _pubDelay(ms) { return new Promise(r => setTimeout(r, ms)); }

function _pubProgress(taskId, progress, message, status) {
  const task = publishTasks.get(taskId);
  if (task) { task.progress = progress; task.message = message; task.status = status || (progress >= 100 ? 'completed' : 'running'); }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('publish-progress', { taskId, progress, message, status: status || (progress >= 100 ? 'completed' : 'running') });
  }
}

ipcMain.handle('publish-get-platforms', () => {
  return Object.entries(PUBLISH_URLS).map(([id, url]) => ({ id, name: PUBLISH_PLATFORM_NAMES[id], url }));
});

ipcMain.handle('publish-ai-content', async (event, payload) => {
  const { apiKey, scriptText, platform, videoTitle } = payload || {};
  if (!apiKey) return { ok: false, error: 'API Key 未配置' };
  if (!scriptText) return { ok: false, error: '脚本内容为空' };

  const hints = {
    douyin: '抖音：标题吸睛、有悬念、15字以内；文案口语化、有互动感',
    kuaishou: '快手：接地气、真实感强；标题朴实直接',
    xiaohongshu: '小红书：种草风格、标题带emoji、文案有干货感',
    bilibili: 'B站：有趣有梗、标题有信息量；文案可稍长',
  };

  const prompt = '你是一位资深短视频运营，请根据以下脚本内容生成发布所需的标题、文案和标签。\n\n'
    + '平台风格要求：' + (hints[platform] || '') + '\n'
    + '视频文件名：' + (videoTitle || '') + '\n\n'
    + '脚本内容：\n' + scriptText.slice(0, 2000) + '\n\n'
    + '请严格按以下JSON格式输出（不要加markdown代码块标记）：\n'
    + '{"title":"标题(15字以内)","caption":"文案(80字以内，可带emoji)","tags":"标签1,标签2,标签3,标签4,标签5"}';

  try {
    const result = await new Promise((resolve, reject) => {
      const req = net.request({ method: 'POST', url: 'https://api.deepseek.com/v1/chat/completions' });
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Authorization', 'Bearer ' + apiKey);
      let body = '';
      req.on('response', (resp) => {
        resp.on('data', (chunk) => { body += chunk.toString(); });
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('JSON解析失败')); }
          } else { reject(new Error('API ' + resp.statusCode + ': ' + body.slice(0, 200))); }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: '你是资深短视频运营专家' }, { role: 'user', content: prompt }],
        temperature: 0.7, max_tokens: 500
      }));
      req.end();
    });

    let content = (result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || '';
    content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const m = content.match(/\{[\s\S]*\}/);
    if (m) content = m[0];
    return { ok: true, data: JSON.parse(content) };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('publish-to-platform', async (event, payload) => {
  const { videoPath, platform, title, desc, tags } = payload || {};
  if (!videoPath || !fs.existsSync(videoPath)) return { ok: false, error: '视频文件不存在: ' + (videoPath || '(空)') };
  if (!platform || !PUBLISH_URLS[platform]) return { ok: false, error: '无效的发布平台' };

  const taskId = 'pub_' + (++publishTaskCounter);
  const recordId = 'rec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const record = {
    id: recordId,
    taskId: taskId,
    videoPath: videoPath,
    videoName: path.basename(videoPath),
    platform: platform,
    platformName: PUBLISH_PLATFORM_NAMES[platform] || platform,
    title: title || '',
    desc: desc || '',
    tags: tags || '',
    status: 'publishing',
    createdAt: new Date().toISOString(),
    publishedAt: null,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    statsUpdatedAt: null
  };
  _addPublishRecord(record);
  publishTasks.set(taskId, { status: 'running', progress: 0, message: '准备发布...', platform, recordId });
  _doPublish(taskId, payload).catch(err => _pubProgress(taskId, 0, '发布失败: ' + err.message, 'error'));
  return { ok: true, taskId, recordId };
});

ipcMain.handle('publish-status', (event, taskId) => {
  const t = publishTasks.get(taskId);
  return t ? { status: t.status, progress: t.progress, message: t.message } : { status: 'not_found' };
});

async function _doPublish(taskId, params) {
  var videoPath = params.videoPath, platform = params.platform, title = params.title || '', desc = params.desc || '', tags = params.tags || '';
  var pname = PUBLISH_PLATFORM_NAMES[platform] || platform;

  _pubProgress(taskId, 5, '正在打开' + pname + '发布页面...');

  var publishSession = session.fromPartition('persist:publish');
  configureBrowserCompatSession(publishSession);

  var win = new BrowserWindow({
    width: 1000, height: 700, show: true,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    title: '发布到' + pname,
    webPreferences: { partition: 'persist:publish', contextIsolation: true, nodeIntegration: false }
  });

  try {
    await win.loadURL(PUBLISH_URLS[platform]);
    await _pubDelay(3000);

    _pubProgress(taskId, 10, '检查登录状态...');
    var html = await win.webContents.executeJavaScript('document.documentElement.innerHTML');
    if (html.indexOf('扫码登录') >= 0 || html.indexOf('请登录') >= 0) {
      _pubProgress(taskId, 10, '请在打开的窗口中登录' + pname + '，登录后将继续发布', 'waiting_login');
      var loginWaitStart = Date.now();
      while (Date.now() - loginWaitStart < 120000) {
        await _pubDelay(5000);
        html = await win.webContents.executeJavaScript('document.documentElement.innerHTML');
        if (html.indexOf('扫码登录') < 0 && html.indexOf('请登录') < 0) break;
      }
      if (html.indexOf('扫码登录') >= 0 || html.indexOf('请登录') >= 0) {
        throw new Error('登录超时，请先在' + pname + '创作者平台登录');
      }
    }

    _pubProgress(taskId, 15, '准备上传文件...');
    var wc = win.webContents;
    if (!wc.debugger.isAttached()) { try { await wc.debugger.attach('1.3'); } catch(e) { throw new Error('调试器附加失败: ' + e.message); } }
    await wc.debugger.sendCommand('DOM.enable');

    var doc = await wc.debugger.sendCommand('DOM.getDocument');
    var qr = await wc.debugger.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    if (!qr || !qr.nodeId) throw new Error('未找到文件上传入口');

    _pubProgress(taskId, 30, '正在上传视频文件...');
    await wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: qr.nodeId, files: [videoPath] });

    _pubProgress(taskId, 50, '等待视频上传完成...');
    await _waitUpload(wc, platform, taskId);

    _pubProgress(taskId, 70, '填写标题和文案...');
    await _fillForm(wc, platform, title, desc, tags);

    _pubProgress(taskId, 85, '点击发布按钮...');
    await _clickPublish(wc, platform);

    _pubProgress(taskId, 95, '验证发布结果...');
    await _pubDelay(5000);

    var pageUrl = await wc.executeJavaScript('window.location.href');
    var phtml = await wc.executeJavaScript('document.documentElement.innerHTML');

    var ok = false;
    if (platform === 'douyin') ok = pageUrl.indexOf('content/manage') >= 0 || phtml.indexOf('发布成功') >= 0;
    else ok = phtml.indexOf('发布失败') < 0;

    if (ok) {
      var task = publishTasks.get(taskId);
      if (task && task.recordId) {
        _updatePublishRecord(task.recordId, {
          status: 'published',
          publishedAt: new Date().toISOString()
        });
      }
      _pubProgress(taskId, 100, '发布成功！', 'completed');
    }
    else {
      var task2 = publishTasks.get(taskId);
      if (task2 && task2.recordId) {
        _updatePublishRecord(task2.recordId, { status: 'failed' });
      }
      _pubProgress(taskId, 95, '发布可能未成功，请检查打开的窗口', 'error');
    }
  } finally {
    try { if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch(e) {}
    setTimeout(function() { try { win.close(); } catch(e) {} }, 5000);
  }
}

async function _waitUpload(wc, platform, taskId) {
  var maxWait = 300000, interval = 3000, start = Date.now();
  var doneChecks = {
    douyin: '!!document.querySelector("input.semi-input")',
    kuaishou: '!!document.querySelector("textarea") || document.documentElement.innerHTML.indexOf("作品描述") >= 0',
    xiaohongshu: '!!document.querySelector("input[placeholder*=\\"标题\\"], input[placeholder*=\\"title\\"]") || document.documentElement.innerHTML.indexOf("填写标题") >= 0',
    bilibili: '!!document.querySelector("input[placeholder*=\\"标题\\"], input[placeholder*=\\"title\\"]") && document.documentElement.innerHTML.indexOf("正在上传") < 0'
  };
  var failCheck = 'document.documentElement.innerHTML.indexOf("上传失败") >= 0';

  while (Date.now() - start < maxWait) {
    await _pubDelay(interval);
    var failed = await wc.executeJavaScript(failCheck);
    if (failed) throw new Error('视频上传失败');
    var done = await wc.executeJavaScript(doneChecks[platform] || doneChecks.douyin);
    if (done) return;
    var elapsed = Date.now() - start;
    _pubProgress(taskId, Math.min(50 + Math.floor(elapsed / maxWait * 20), 69), '上传中...');
  }
  throw new Error('视频上传超时');
}

async function _fillForm(wc, platform, title, desc, tags) {
  var tagList = tags ? tags.split(/[,，]/).map(function(t) { return t.trim(); }).filter(function(t) { return t; }) : [];

  function reactSetInput(selector, value) {
    var js = '(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');if(!el)return false;'
      + 'var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;'
      + 'if(s){s.call(el,' + JSON.stringify(value) + ');}else{el.value=' + JSON.stringify(value) + ';}'
      + 'el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return true;})()';
    return wc.executeJavaScript(js);
  }
  function reactSetTextarea(selector, value) {
    var js = '(function(){var el=document.querySelector(' + JSON.stringify(selector) + ');if(!el)return false;'
      + 'var s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
      + 'if(s){s.call(el,' + JSON.stringify(value) + ');}else{el.value=' + JSON.stringify(value) + ';}'
      + 'el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return true;})()';
    return wc.executeJavaScript(js);
  }

  if (platform === 'douyin') {
    await reactSetInput('input.semi-input', title);
    var descText = desc + ' ' + tagList.map(function(t) { return '#' + t; }).join(' ');
    await wc.executeJavaScript('var d=document.querySelector("div[contenteditable=true].editor-kit-container, div[contenteditable=true]");if(d)d.innerText=' + JSON.stringify(descText) + ';');
  } else if (platform === 'kuaishou') {
    var combined = title + '\\n' + desc + ' ' + tagList.map(function(t) { return '#' + t; }).join(' ');
    await reactSetTextarea('textarea', combined);
  } else if (platform === 'xiaohongshu') {
    var ok = await reactSetInput('input[placeholder*="标题"]', title);
    if (!ok) await reactSetInput('input[type=text]', title);
    var tagStr = tagList.map(function(t) { return '#' + t + '[话题] '; }).join('');
    var xhsDesc = desc + ' ' + tagStr;
    await wc.executeJavaScript('(function(){var ta=document.querySelector("textarea");if(ta){ta.value=' + JSON.stringify(xhsDesc) + ';ta.dispatchEvent(new Event("input",{bubbles:true}));return;}var d=document.querySelector("div[contenteditable=true]");if(d)d.innerText=' + JSON.stringify(xhsDesc) + ';})()');
  } else if (platform === 'bilibili') {
    var ok2 = await reactSetInput('input[placeholder*="标题"], input[placeholder*="title"]', title);
    if (!ok2) await reactSetInput('input[type=text]', title);
    await reactSetTextarea('textarea', desc);
    for (var i = 0; i < Math.min(tagList.length, 3); i++) {
      await wc.executeJavaScript('(function(){var input=document.querySelector("input[placeholder*=\\"标签\\"], input[placeholder*=\\"tag\\"]");if(input){var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;s.call(input,' + JSON.stringify(tagList[i]) + ');input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"Enter"}));}})()');
      await _pubDelay(500);
    }
  }
}

async function _clickPublish(wc, platform) {
  var excludeTouGao = platform === 'bilibili' ? ' && t.indexOf("投稿") < 0' : '';
  await wc.executeJavaScript('(function(){var btns=document.querySelectorAll("button, [role=button]");for(var i=0;i<btns.length;i++){var t=(btns[i].textContent||"").trim();if(t.indexOf("发布") >= 0' + excludeTouGao + ' && !btns[i].disabled){btns[i].click();return true;}}return false;})()');
}

// ============= 项目管理模块 =============

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

function _loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    }
  } catch (e) { console.error('[projects] load error:', e.message); }
  return [];
}

function _saveProjects(projects) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf8');
  } catch (e) { console.error('[projects] save error:', e.message); }
}

function _projectId() {
  return 'proj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _scriptId() {
  return 'scr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

ipcMain.handle('project-create', (event, payload) => {
  const { name, framework, scriptCount } = payload || {};
  if (!name || !name.trim()) return { ok: false, error: '项目名称不能为空' };

  const projects = _loadProjects();
  const project = {
    id: _projectId(),
    name: name.trim(),
    framework: (framework || '').trim(),
    scriptCount: Math.max(1, Math.min(50, parseInt(scriptCount) || 1)),
    scripts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  projects.unshift(project);
  _saveProjects(projects);
  return { ok: true, project };
});

ipcMain.handle('project-list', () => {
  return { ok: true, projects: _loadProjects() };
});

ipcMain.handle('project-get', (event, projectId) => {
  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: '项目不存在' };
  return { ok: true, project };
});

ipcMain.handle('project-update', (event, payload) => {
  const { projectId, patch } = payload || {};
  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: '项目不存在' };

  if (patch.name !== undefined) project.name = patch.name;
  if (patch.framework !== undefined) project.framework = patch.framework;
  if (patch.scriptCount !== undefined) project.scriptCount = patch.scriptCount;
  project.updatedAt = new Date().toISOString();
  _saveProjects(projects);
  return { ok: true, project };
});

ipcMain.handle('project-delete', (event, projectId) => {
  const projects = _loadProjects();
  const filtered = projects.filter(p => p.id !== projectId);
  if (filtered.length === projects.length) return { ok: false, error: '项目不存在' };
  _saveProjects(filtered);
  return { ok: true };
});

ipcMain.handle('project-generate-scripts', async (event, payload) => {
  const { projectId, apiKey, model } = payload || {};
  if (!apiKey) return { ok: false, error: 'DeepSeek API Key 未配置' };

  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: '项目不存在' };

  const count = project.scriptCount || 1;
  const framework = project.framework || project.name;
  if (!framework.trim()) return { ok: false, error: '项目框架为空，请先设置框架' };

  const sysPrompt = '你是一个短视频脚本创作助手。根据用户提供的框架要求，生成一条完整的短视频脚本。'
    + '脚本包含[画面描述]和[配音文案]两部分，要精炼、有吸引力、适合AI视频生成平台使用。'
    + '只返回脚本内容本身，不要加多余的解释或标注。'
    + '每次生成要有不同角度和创意，避免与之前生成的雷同。';

  const scripts = [];
  for (let i = 0; i < count; i++) {
    const userPrompt = '项目框架：' + framework + '\n\n请生成第 ' + (i + 1) + ' 条脚本（共 ' + count + ' 条），要有独特的角度和创意。';
    try {
      const result = await new Promise((resolve, reject) => {
        const req = net.request({ method: 'POST', url: 'https://api.deepseek.com/v1/chat/completions' });
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Authorization', 'Bearer ' + apiKey);
        let body = '';
        req.on('response', (resp) => {
          resp.on('data', (chunk) => { body += chunk.toString(); });
          resp.on('end', () => {
            if (resp.statusCode >= 200 && resp.statusCode < 300) {
              try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('JSON解析失败')); }
            } else { reject(new Error('API ' + resp.statusCode + ': ' + body.slice(0, 200))); }
          });
        });
        req.on('error', reject);
        req.write(JSON.stringify({
          model: model || 'deepseek-chat',
          messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.8 + Math.random() * 0.15,
          max_tokens: 800
        }));
        req.end();
      });

      let content = (result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || '';
      content = content.replace(/^(脚本|视频脚本)\s*[:：]\s*/i, '').trim();
      scripts.push({ id: _scriptId(), content, status: 'generated', createdAt: new Date().toISOString() });

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project-gen-progress', { projectId, current: i + 1, total: count, message: '已生成 ' + (i + 1) + '/' + count + ' 条脚本' });
      }
    } catch (e) {
      scripts.push({ id: _scriptId(), content: '', status: 'error', error: e.message, createdAt: new Date().toISOString() });
    }
  }

  project.scripts = scripts;
  project.updatedAt = new Date().toISOString();
  _saveProjects(projects);
  return { ok: true, scripts };
});

ipcMain.handle('project-update-script', (event, payload) => {
  const { projectId, scriptId, content } = payload || {};
  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: '项目不存在' };

  const script = project.scripts.find(s => s.id === scriptId);
  if (!script) return { ok: false, error: '脚本不存在' };

  script.content = content;
  script.status = 'modified';
  script.modifiedAt = new Date().toISOString();
  project.updatedAt = new Date().toISOString();
  _saveProjects(projects);
  return { ok: true, script };
});

ipcMain.handle('project-ai-modify-script', async (event, payload) => {
  const { projectId, scriptId, apiKey, instruction, model } = payload || {};
  if (!apiKey) return { ok: false, error: 'DeepSeek API Key 未配置' };
  if (!instruction || !instruction.trim()) return { ok: false, error: '修改指令不能为空' };

  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: '项目不存在' };

  const script = project.scripts.find(s => s.id === scriptId);
  if (!script) return { ok: false, error: '脚本不存在' };

  const sysPrompt = '你是一个短视频脚本修改助手。根据用户的修改指令，对给定的脚本进行修改。'
    + '保持脚本的基本结构（[画面描述]和[配音文案]），只按用户指令调整内容。'
    + '只返回修改后的完整脚本内容，不要加解释。';

  const userPrompt = '修改指令：' + instruction + '\n\n原始脚本：\n' + script.content;

  try {
    const result = await new Promise((resolve, reject) => {
      const req = net.request({ method: 'POST', url: 'https://api.deepseek.com/v1/chat/completions' });
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Authorization', 'Bearer ' + apiKey);
      let body = '';
      req.on('response', (resp) => {
        resp.on('data', (chunk) => { body += chunk.toString(); });
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('JSON解析失败')); }
          } else { reject(new Error('API ' + resp.statusCode + ': ' + body.slice(0, 200))); }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        model: model || 'deepseek-chat',
        messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
        temperature: 0.6,
        max_tokens: 800
      }));
      req.end();
    });

    let content = (result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || '';
    content = content.replace(/^(脚本|视频脚本)\s*[:：]\s*/i, '').trim();

    script.content = content;
    script.status = 'ai_modified';
    script.modifiedAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();
    _saveProjects(projects);
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('project-delete-script', (event, payload) => {
  const { projectId, scriptId } = payload || {};
  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: '项目不存在' };

  project.scripts = project.scripts.filter(s => s.id !== scriptId);
  project.updatedAt = new Date().toISOString();
  _saveProjects(projects);
  return { ok: true };
});

ipcMain.handle('project-send-to-dialogue', (event, payload) => {
  const { projectId, scriptIds } = payload || {};
  const projects = _loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return { ok: false, error: '项目不存在' };

  const scripts = (scriptIds && scriptIds.length > 0)
    ? project.scripts.filter(s => scriptIds.includes(s.id))
    : project.scripts.filter(s => s.content && s.status !== 'error');

  const drafts = scripts.map(s => s.content).filter(c => c);
  if (drafts.length === 0) return { ok: false, error: '没有可用的脚本内容' };

  return { ok: true, scripts: drafts };
});

// ============= 数据看板 =============

ipcMain.handle('dashboard-summary', async () => {
  const summary = {
    accounts: { total: 0, byPlatform: {} },
    resources: { total: 0, videos: 0, images: 0, byPlatform: {} },
    downloads: { total: 0, videos: 0, images: 0, totalSizeMB: 0, byPlatform: {} },
    projects: { total: 0, totalScripts: 0 },
    publishRecords: { total: 0, published: 0, failed: 0, totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0, byPlatform: {}, recent: [] },
    recent: []
  };

  // 账号统计
  for (const acc of accounts) {
    summary.accounts.total++;
    const p = acc.platform || 'unknown';
    const pName = (PLATFORMS[p] && PLATFORMS[p].name) || p || '未知';
    summary.accounts.byPlatform[pName] = (summary.accounts.byPlatform[pName] || 0) + 1;
  }

  // 资源统计
  for (const res of capturedResources) {
    summary.resources.total++;
    if (res.type === 'video') summary.resources.videos++;
    else if (res.type === 'image') summary.resources.images++;
    const acc = accounts.find(a => a.id === res.accountId);
    const p = acc ? ((PLATFORMS[acc.platform] && PLATFORMS[acc.platform].name) || acc.platform || '未知') : '未知';
    summary.resources.byPlatform[p] = (summary.resources.byPlatform[p] || 0) + 1;
  }

  // 下载文件统计
  try {
    const downloadDir = ensureDownloadDir(getDownloadDir());
    const entries = await fs.promises.readdir(downloadDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const filePath = path.join(downloadDir, entry.name);
        const stat = await fs.promises.stat(filePath);
        const ext = path.extname(entry.name);
        const type = getDownloadFileType(ext);
        const platform = getDownloadFilePlatform(entry.name);
        summary.downloads.total++;
        summary.downloads.totalSizeMB += stat.size / 1024 / 1024;
        if (type === 'video') summary.downloads.videos++;
        else if (type === 'image') summary.downloads.images++;
        summary.downloads.byPlatform[platform] = (summary.downloads.byPlatform[platform] || 0) + 1;

        summary.recent.push({
          name: entry.name,
          type,
          platform,
          sizeMB: stat.size / 1024 / 1024,
          mtime: stat.mtime.toISOString()
        });
      } catch (e) {}
    }
  } catch (e) {}

  summary.downloads.totalSizeMB = Math.round(summary.downloads.totalSizeMB * 10) / 10;

  // 项目统计
  try {
    const projects = _loadProjects();
    summary.projects.total = projects.length;
    for (const p of projects) {
      summary.projects.totalScripts += (p.scripts || []).length;
    }
  } catch (e) {}

  // 发布记录统计
  try {
    const records = _loadPublishRecords();
    summary.publishRecords.total = records.length;
    for (const r of records) {
      if (r.status === 'published') {
        summary.publishRecords.published++;
        summary.publishRecords.totalViews += (r.views || 0);
        summary.publishRecords.totalLikes += (r.likes || 0);
        summary.publishRecords.totalComments += (r.comments || 0);
        summary.publishRecords.totalShares += (r.shares || 0);
        const pName = r.platformName || r.platform || '未知';
        if (!summary.publishRecords.byPlatform[pName]) {
          summary.publishRecords.byPlatform[pName] = { count: 0, views: 0, likes: 0, comments: 0, shares: 0 };
        }
        summary.publishRecords.byPlatform[pName].count++;
        summary.publishRecords.byPlatform[pName].views += (r.views || 0);
        summary.publishRecords.byPlatform[pName].likes += (r.likes || 0);
        summary.publishRecords.byPlatform[pName].comments += (r.comments || 0);
        summary.publishRecords.byPlatform[pName].shares += (r.shares || 0);
      } else if (r.status === 'failed') {
        summary.publishRecords.failed++;
      }
    }
    summary.publishRecords.recent = records.slice(0, 30);
  } catch (e) {}

  // 最近文件按时间排序，取前20条
  summary.recent.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  summary.recent = summary.recent.slice(0, 20);

  return { ok: true, summary };
});
