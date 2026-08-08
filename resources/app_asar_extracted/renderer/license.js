const $ = id => document.getElementById(id);
const serverUrl = $('serverUrl');
const licenseKey = $('licenseKey');
const deviceId = $('deviceId');
const activateBtn = $('activateBtn');
const copyDeviceBtn = $('copyDeviceBtn');
const embeddedServerUrl = $('embeddedServerUrl');
const copyEmbeddedServerBtn = $('copyEmbeddedServerBtn');
const message = $('message');
const licenseState = $('licenseState');
const licenseExpire = $('licenseExpire');
const authorizationRequest = $('authorizationRequest');
const localNetworkInfo = $('localNetworkInfo');
const getNetworkBtn = $('getNetworkBtn');
const copyRequestBtn = $('copyRequestBtn');

let embeddedUrl = '';
let networkInfo = null;

function setMessage(text, ok = false) {
  message.textContent = text || '';
  message.className = `message${ok ? ' ok' : ''}`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('zh-CN', { hour12: false });
}

function isOfflineActivationCode(value) {
  const parts = String(value || '').trim().split('.');
  return parts.length === 3 && parts[0].toUpperCase() === 'BOSSACT' && parts[1].toUpperCase() === 'OFFLINE';
}

function renderNetworkInfo(info) {
  networkInfo = info || null;
  authorizationRequest.value = info?.requestCode || '';
  authorizationRequest.placeholder = info?.requestCode ? '' : '点击“获取本机地址”后生成';
  copyRequestBtn.disabled = !info?.requestCode;
  const values = info?.addresses || [];
  localNetworkInfo.innerHTML = values.length
    ? values.map(item => `<div class="network-item"><strong>${String(item.label || '')}</strong><code>${String(item.address || '')}</code></div>`).join('')
    : '<span class="network-empty">未检测到可展示的公网或隧道地址，仍可使用设备码生成授权请求。</span>';
}

async function loadNetworkInfo(copy = false) {
  getNetworkBtn.disabled = true;
  getNetworkBtn.textContent = '获取中...';
  try {
    const info = await window.electronAPI.licenseNetworkInfo();
    renderNetworkInfo(info);
    if (copy && info?.requestCode) {
      await window.electronAPI.copyText(info.requestCode);
      setMessage('授权请求码已复制，请发给管理者', true);
    }
  } catch (error) {
    setMessage(error.message || '获取本机地址失败');
  } finally {
    getNetworkBtn.disabled = false;
    getNetworkBtn.textContent = '获取本机地址';
  }
}

function decodeServerHint(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 3 || parts[0].toUpperCase() !== 'BOSSACT') return '';
  try {
    const encoded = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const decoded = atob(padded).trim();
    return /^https?:\/\//i.test(decoded) ? decoded.replace(/\/+$/, '') : '';
  } catch (e) {
    return '';
  }
}

function decodeOfflineServerHint(value) {
  const parts = String(value || '').trim().split('.');
  if (parts.length !== 3 || parts[0].toUpperCase() !== 'BOSSACT' || parts[1].toUpperCase() !== 'OFFLINE') return '';
  try {
    const encoded = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const envelope = JSON.parse(atob(padded));
    return /^https?:\/\//i.test(envelope?.serverUrl || '')
      ? String(envelope.serverUrl).replace(/\/+$/, '')
      : '';
  } catch (e) {
    return '';
  }
}

function renderEmbeddedServerHint() {
  if (isOfflineActivationCode(licenseKey.value)) {
    embeddedUrl = decodeOfflineServerHint(licenseKey.value);
    if (embeddedUrl) {
      embeddedServerUrl.textContent = embeddedUrl;
      embeddedServerUrl.className = 'available';
      copyEmbeddedServerBtn.disabled = false;
      serverUrl.value = embeddedUrl;
    } else {
      embeddedServerUrl.textContent = '该旧版预绑定激活码缺少授权管理器地址，请重新生成';
      embeddedServerUrl.className = 'unavailable';
      copyEmbeddedServerBtn.disabled = true;
      serverUrl.value = '';
    }
    return;
  }
  embeddedUrl = decodeServerHint(licenseKey.value);
  if (embeddedUrl) {
    embeddedServerUrl.textContent = embeddedUrl;
    embeddedServerUrl.className = 'available';
    copyEmbeddedServerBtn.disabled = false;
    serverUrl.value = embeddedUrl;
    return;
  }
  embeddedServerUrl.textContent = '输入激活码后自动读取';
  embeddedServerUrl.className = '';
  copyEmbeddedServerBtn.disabled = true;
}

function renderStatus(status) {
  deviceId.textContent = status?.deviceId || '--';
  serverUrl.value = status?.serverUrl || '';
  const cache = status?.cache;
  if (!cache?.code) {
    licenseState.textContent = '未激活';
    licenseState.className = 'muted';
    licenseExpire.textContent = '--';
    return;
  }
  licenseState.textContent = status.active ? '已激活' : (status.message || '授权无效');
  licenseState.className = status.active ? 'ok' : 'danger';
  licenseExpire.textContent = formatDate(cache.expireAt);
}

async function copyValue(value, successText) {
  if (!value) return;
  await window.electronAPI.copyText(value);
  setMessage(successText, true);
}

async function loadStatus() {
  const status = await window.electronAPI.licenseStatus();
  renderStatus(status);
  const startupMessage = new URLSearchParams(location.search).get('message') || status.message || '';
  if (startupMessage) setMessage(startupMessage);
  licenseKey.focus();
}

copyDeviceBtn.addEventListener('click', () => copyValue(deviceId.textContent, '设备码已复制'));
copyEmbeddedServerBtn.addEventListener('click', () => copyValue(embeddedUrl, '公网/隧道地址已复制'));

licenseKey.addEventListener('input', renderEmbeddedServerHint);
getNetworkBtn.addEventListener('click', () => loadNetworkInfo(false));
copyRequestBtn.addEventListener('click', async () => {
  if (!networkInfo?.requestCode) await loadNetworkInfo(true);
  else {
    await window.electronAPI.copyText(networkInfo.requestCode);
    setMessage('授权请求码已复制，请发给管理者', true);
  }
});
activateBtn.addEventListener('click', async () => {
  const key = licenseKey.value.trim();
  if (!key) {
    setMessage('请输入激活码');
    licenseKey.focus();
    return;
  }
  activateBtn.disabled = true;
  activateBtn.textContent = '验证中...';
  setMessage('');
  try {
    const result = await window.electronAPI.activateLicense({
      licenseKey: key,
      serverUrl: embeddedUrl || serverUrl.value.trim()
    });
    if (!result?.ok) {
      setMessage(result?.message || '激活失败，请检查激活码和授权服务');
      return;
    }
    setMessage('验证成功，正在进入...', true);
  } catch (error) {
    setMessage(error.message || '激活失败，请重试');
  } finally {
    activateBtn.disabled = false;
    activateBtn.textContent = '验证并进入';
  }
});

licenseKey.addEventListener('keydown', event => {
  if (event.key === 'Enter') activateBtn.click();
});

loadStatus().catch(error => setMessage(error.message || '读取授权状态失败'));
