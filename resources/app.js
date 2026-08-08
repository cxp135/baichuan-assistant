﻿// ============= 搴旂敤鐘舵€?=============
const DEBUG_LOG_ENABLED = location.search.includes('debug=1');
if (!DEBUG_LOG_ENABLED) {
  console.log = () => {};
}

const state = {
  accounts: [],
  resources: [],
  activeAccountId: null,
  openTabs: [],       // { accountId, webview }
  activeTabId: null,
  platforms: [],
  accountFilter: 'all',
  accountGroupFilter: 'all',
  accountSearch: '',
  captureMode: 'all',
  compatUserAgent: '',
  videoNoticeByAccount: {},
  editingAccountId: null,
  downloadLibraryFiles: [],
  downloadLibraryLoaded: false,
  downloadLibrarySearch: '',
  downloadLibraryType: 'all',
  downloadLibraryPlatform: 'all',
  downloadLibraryPage: 1,
  downloadLibraryPageSize: 16
};

// ============= DOM 寮曠敤 =============
const $ = id => document.getElementById(id);
const accountList = $('accountList');
const accountCount = $('accountCount');
const accountFilter = $('accountFilter');
const accountSearch = $('accountSearch');
const accountGroupFilter = $('accountGroupFilter');
const tabBar = $('tabBar');
const browserWrapper = $('browserWrapper');
const emptyState = $('emptyState');
const resourceList = $('resourceList');
const resourceCount = $('resourceCount');
const resourceCaptureMode = $('resourceCaptureMode');
const statusText = $('statusBar')?.querySelector('.status-text');
const pageTitle = $('pageTitle');
const modalOverlay = $('modalOverlay');
const modalTitle = modalOverlay?.querySelector('.modal-header h3');
const modalConfirm = $('modalConfirm');
const selectPlatform = $('selectPlatform');
const inputName = $('inputName');
const inputGroup = $('inputGroup');
const inputRemark = $('inputRemark');
const inputCustomUrl = $('inputCustomUrl');
const customUrlGroup = $('customUrlGroup');
const namePreview = $('namePreview');
const btnRefreshPage = $('btnRefreshPage');
const btnOpenDownloadDir = $('btnOpenDownloadDir');
const btnDownloadLibrary = $('btnDownloadLibrary');
const btnLoginAssist = $('btnLoginAssist');
const btnAutoDialogue = $('btnAutoDialogue');
const btnAutoDialogueSend = $('btnAutoDialogueSend');
const btnJimengOriginal = $('btnJimengOriginal');
const btnExportAccounts = $('btnExportAccounts');
const btnImportAccounts = $('btnImportAccounts');
const btnOpenFilteredAccounts = $('btnOpenFilteredAccounts');
const btnRefreshOpenTabs = $('btnRefreshOpenTabs');
const btnToggleAccountTools = $('btnToggleAccountTools');
const accountToolsPanel = $('accountToolsPanel');
const downloadLibraryOverlay = $('downloadLibraryOverlay');
const downloadLibraryClose = $('downloadLibraryClose');
const downloadLibraryList = $('downloadLibraryList');
const downloadLibraryEmpty = $('downloadLibraryEmpty');
const downloadLibraryPath = $('downloadLibraryPath');
const downloadLibrarySearch = $('downloadLibrarySearch');
const downloadLibraryTypeFilter = $('downloadLibraryTypeFilter');
const downloadLibraryPlatformFilter = $('downloadLibraryPlatformFilter');
const downloadLibraryRefresh = $('downloadLibraryRefresh');
const downloadLibraryOpenFolder = $('downloadLibraryOpenFolder');
const downloadLibraryFooter = $('downloadLibraryFooter');
const downloadLibrarySummary = $('downloadLibrarySummary');
const downloadLibraryPageInfo = $('downloadLibraryPageInfo');
const downloadLibraryPrev = $('downloadLibraryPrev');
const downloadLibraryNext = $('downloadLibraryNext');
const toastLayer = $('toastLayer');

const resourceReportQueues = new Map();
const resourceReportTimers = new Map();
const knownVideoResourceKeys = new Set();
const generatedVideoNoticeKeys = new Set();
const pendingResourceDownloadButtons = new Map();
const resourceDownloadStateByKey = new Map();
const resourceDownloadRecoveryTimers = new WeakMap();
const RESOURCE_REPORT_DELAY_MS = 800;
const FALLBACK_COMPAT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.175 Safari/537.36';
let downloadLibraryRefreshTimer = null;
let downloadVideoObserver = null;
const AUTO_DIALOGUE_DRAFTS_PER_ACCOUNT = 3;
const AUTO_DIALOGUE_POLL_MS = 2200;
const AUTO_DIALOGUE_DRAFTS = [
  '帮我整理一下今天适合发布的内容方向，给我三个简单思路。',
  '帮我把这个想法改得更自然一点，语气轻松、适合日常表达。',
  '给我一个短视频开头文案，要求直接、有吸引力，不要太夸张。',
  '帮我列一个适合新手执行的小计划，步骤清楚一点。',
  '用简洁的话总结一下这个主题的重点，方便我后面继续扩展。',
  '帮我想三个不同角度的标题，风格自然一点。',
  '把下面这个方向改成更像真实聊天的表达，口吻温和一点。',
  '给我一个适合图片说明的简短文案，不要太营销化。',
  '帮我扩写成一段自然的说明文字，控制在一百字以内。',
  '从用户角度帮我提出三个可能会关心的问题。'
];
const autoDialogue = {
  enabled: false,
  sendEnabled: false,
  running: false,
  queue: [],
  accountIndex: 0,
  draftIndex: 0,
  waitingText: '',
  waitingAccountId: '',
  waitingSendClicked: false,
  timer: null,
  seed: 0
};

// ============= 窗口控制 =============
$('btnMinimize')?.addEventListener('click', () => window.electronAPI.minimize());
$('btnMaximize')?.addEventListener('click', () => window.electronAPI.maximize());
$('btnClose')?.addEventListener('click', () => window.electronAPI.close());

btnRefreshPage?.addEventListener('click', () => {
  const tab = state.openTabs.find(t => t.accountId === state.activeTabId);
  if (!tab?.webview) {
    setStatus('当前没有可刷新的页面');
    return;
  }
  try {
    tab.webview.reload();
    setStatus('正在刷新当前页面...');
  } catch (e) {
    setStatus(`刷新失败: ${e.message}`);
  }
});

btnOpenDownloadDir?.addEventListener('click', async () => {
  const result = await window.electronAPI.openDownloadDir();
  if (result?.ok) {
    setStatus(`已打开下载文件夹: ${result.downloadDir}`);
  } else {
    setStatus(`打开下载文件夹失败: ${result?.message || '未知错误'}`);
  }
});

btnDownloadLibrary?.addEventListener('click', () => {
  openDownloadLibrary();
});

btnLoginAssist?.addEventListener('click', async () => {
  const accountId = state.activeTabId || state.activeAccountId;
  const account = state.accounts.find(item => item.id === accountId);
  if (!account) {
    setStatus('请先打开需要登录的账号');
    return;
  }

  btnLoginAssist.disabled = true;
  try {
    const status = await window.electronAPI.externalLoginStatus(account.id);
    if (status?.active) {
      setStatus('正在同步外部浏览器登录态...');
      const result = await window.electronAPI.externalLoginSync(account.id);
      if (result?.ok) {
        setStatus(`已同步 ${result.count || 0} 个登录 Cookie，正在刷新页面`);
        showDownloadToast('登录态已同步，页面正在刷新', 'success');
      } else {
        alert(result?.message || '同步登录态失败');
        setStatus('同步登录态失败');
      }
    } else {
      const result = await window.electronAPI.externalLoginStart(account.id);
      if (result?.ok) {
        const browserName = result.browserName || '浏览器';
        setStatus(`已打开 ${browserName}，请完成登录后回到软件点击“同步登录”`);
        showDownloadToast('请在外部浏览器完成登录，再点同步登录', 'success');
      } else {
        alert(result?.message || '启动登录辅助失败');
        setStatus('启动登录辅助失败');
      }
    }
  } catch (e) {
    alert(`登录辅助失败：${e.message}`);
    setStatus('登录辅助失败');
  } finally {
    btnLoginAssist.disabled = false;
    await updateLoginAssistButton();
  }
});

btnAutoDialogue?.addEventListener('click', () => {
  if (autoDialogue.enabled) {
    stopAutoDialogue('已关闭自动对话');
  } else {
    startAutoDialogue();
  }
});

btnAutoDialogueSend?.addEventListener('click', () => {
  autoDialogue.sendEnabled = !autoDialogue.sendEnabled;
  autoDialogue.waitingSendClicked = false;
  updateAutoDialogueButton();
  setStatus(autoDialogue.sendEnabled
    ? '对话发送已开启，自动对话填入草稿后会自动点击发送'
    : '已关闭对话发送，自动对话将停在草稿确认');
  if (autoDialogue.enabled) scheduleAutoDialogue(300);
});

downloadLibraryClose?.addEventListener('click', closeDownloadLibrary);
downloadLibraryOverlay?.addEventListener('click', (e) => {
  if (e.target === downloadLibraryOverlay) closeDownloadLibrary();
});
downloadLibraryRefresh?.addEventListener('click', () => refreshDownloadLibrary(true));
downloadLibraryOpenFolder?.addEventListener('click', async () => {
  await window.electronAPI.openDownloadDir();
});
downloadLibrarySearch?.addEventListener('input', () => {
  state.downloadLibrarySearch = downloadLibrarySearch.value.trim().toLowerCase();
  state.downloadLibraryPage = 1;
  renderDownloadLibrary();
});
downloadLibraryTypeFilter?.addEventListener('change', () => {
  state.downloadLibraryType = downloadLibraryTypeFilter.value || 'all';
  state.downloadLibraryPage = 1;
  renderDownloadLibrary();
});
downloadLibraryPlatformFilter?.addEventListener('change', () => {
  state.downloadLibraryPlatform = downloadLibraryPlatformFilter.value || 'all';
  state.downloadLibraryPage = 1;
  renderDownloadLibrary();
});
downloadLibraryPrev?.addEventListener('click', () => {
  state.downloadLibraryPage = Math.max(1, state.downloadLibraryPage - 1);
  renderDownloadLibrary();
});
downloadLibraryNext?.addEventListener('click', () => {
  state.downloadLibraryPage += 1;
  renderDownloadLibrary();
});

btnToggleAccountTools?.addEventListener('click', () => {
  const sidebar = document.querySelector('.sidebar-left');
  const collapsed = !sidebar?.classList.contains('tools-collapsed');
  sidebar?.classList.toggle('tools-collapsed', collapsed);
  localStorage.setItem('accountToolsCollapsed', collapsed ? '1' : '0');
});

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isDoubaoDialogueAccount(account) {
  if (!account) return false;
  const text = [
    account.platform,
    account.platformName,
    account.name,
    account.url
  ].join(' ').toLowerCase();
  return account.platform === 'doubao' || text.includes('doubao') || text.includes('豆包');
}

function getAutoDialogueAccounts() {
  return getVisibleAccounts().filter(isDoubaoDialogueAccount);
}

function updateAutoDialogueButton() {
  const hasDoubaoAccount = state.accounts.some(isDoubaoDialogueAccount);
  if (btnAutoDialogue) {
    btnAutoDialogue.classList.toggle('hidden', !hasDoubaoAccount);
    btnAutoDialogue.classList.toggle('is-active', autoDialogue.enabled);
    btnAutoDialogue.classList.toggle('is-working', autoDialogue.running);
    btnAutoDialogue.textContent = '自动对话';
    btnAutoDialogue.title = autoDialogue.enabled
      ? (autoDialogue.sendEnabled ? '自动对话已开启：草稿填入后会自动点击发送' : '自动对话已开启：填入草稿后需要手动发送，再继续下一条')
      : '自动生成并填入对话草稿，发送前需要手动确认';
  }
  if (btnAutoDialogueSend) {
    btnAutoDialogueSend.classList.toggle('hidden', !hasDoubaoAccount);
    btnAutoDialogueSend.classList.toggle('is-active', autoDialogue.sendEnabled);
    btnAutoDialogueSend.classList.toggle('is-working', autoDialogue.running && autoDialogue.sendEnabled);
    btnAutoDialogueSend.textContent = '对话发送';
    btnAutoDialogueSend.title = autoDialogue.sendEnabled
      ? '对话发送已开启：自动对话填入草稿后会自动点击蓝色发送按钮'
      : '开启后，自动对话填入草稿并检测到发送按钮可用时自动点击发送';
  }
}

function startAutoDialogue() {
  const queue = getAutoDialogueAccounts();
  if (!queue.length) {
    setStatus('请先选择或添加豆包项目，再开启自动对话');
    return;
  }

  const activeIndex = queue.findIndex(account => account.id === state.activeTabId || account.id === state.activeAccountId);
  autoDialogue.enabled = true;
  autoDialogue.running = false;
  autoDialogue.queue = queue;
  autoDialogue.accountIndex = activeIndex >= 0 ? activeIndex : 0;
  autoDialogue.draftIndex = 0;
  autoDialogue.waitingText = '';
  autoDialogue.waitingAccountId = '';
  autoDialogue.waitingSendClicked = false;
  autoDialogue.seed = Math.floor(Math.random() * AUTO_DIALOGUE_DRAFTS.length);
  clearTimeout(autoDialogue.timer);
  updateAutoDialogueButton();
  setStatus('自动对话已开启，正在准备第一条草稿...');
  runAutoDialogue();
}

function stopAutoDialogue(message = '自动对话已停止') {
  autoDialogue.enabled = false;
  autoDialogue.running = false;
  autoDialogue.queue = [];
  autoDialogue.accountIndex = 0;
  autoDialogue.draftIndex = 0;
  autoDialogue.waitingText = '';
  autoDialogue.waitingAccountId = '';
  autoDialogue.waitingSendClicked = false;
  clearTimeout(autoDialogue.timer);
  updateAutoDialogueButton();
  setStatus(message);
}

function scheduleAutoDialogue(ms = AUTO_DIALOGUE_POLL_MS) {
  clearTimeout(autoDialogue.timer);
  if (!autoDialogue.enabled) return;
  autoDialogue.timer = setTimeout(() => {
    runAutoDialogue();
  }, ms);
}

function generateAutoDialogueDraft(account, draftIndex) {
  const baseIndex = (autoDialogue.seed + autoDialogue.accountIndex * 3 + draftIndex + Math.floor(Math.random() * AUTO_DIALOGUE_DRAFTS.length)) % AUTO_DIALOGUE_DRAFTS.length;
  const templates = [
    AUTO_DIALOGUE_DRAFTS[baseIndex],
    `我想做一段更自然的日常内容，帮我围绕“${getAccountDisplayName(account)}”给一个简短思路。`,
    '帮我把这个主题整理成一段适合聊天继续追问的问题，语气自然一点。',
    '给我一个适合今天使用的内容灵感，要求真实、简单、容易执行。',
    '帮我从用户视角提出一个有价值的问题，并给出简短回答方向。'
  ];
  return templates[(baseIndex + draftIndex) % templates.length];
}

async function ensureAutoDialogueAccountReady(account) {
  const hadTab = state.openTabs.some(tab => tab.accountId === account.id);
  openAccountTab(account.id);
  await delay(hadTab ? 450 : 1200);
  const tab = state.openTabs.find(item => item.accountId === account.id);
  if (!tab?.webview) return null;

  const url = tab.webview.getURL?.() || tab.webview.src || '';
  const accountUrl = account.url || 'https://www.doubao.com/chat/';
  if (/doubao\.com/i.test(accountUrl) && (!/doubao\.com/i.test(url) || /\/chat\/create-image/i.test(url))) {
    if (typeof tab.webview.loadURL === 'function') {
      tab.webview.loadURL(accountUrl);
    } else {
      tab.webview.src = accountUrl;
    }
    await waitForWebviewLoad(tab.webview, 12000);
  }
  return tab;
}

function buildAutoDialogueInputScript({ mode, text }) {
  return `
    (() => {
      const mode = ${JSON.stringify(mode)};
      const draft = ${JSON.stringify(text || '')};
      const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const selectors = [
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="发送"]',
        'textarea[placeholder*="输入"]',
        'textarea',
        '[contenteditable="true"][data-placeholder*="发消息"]',
        '[contenteditable="true"][aria-label*="消息"]',
        '[contenteditable="true"][placeholder*="发消息"]',
        '[role="textbox"]',
        '[contenteditable="true"]',
        'input[type="text"]'
      ];
      const seen = new Set();
      const nodes = [];
      for (const selector of selectors) {
        for (const node of document.querySelectorAll(selector)) {
          if (seen.has(node)) continue;
          seen.add(node);
          nodes.push(node);
        }
      }
      const candidates = nodes
        .filter(node => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width >= 120 &&
            rect.height >= 18 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            !node.disabled &&
            node.getAttribute('aria-hidden') !== 'true';
        })
        .map(node => {
          const rect = node.getBoundingClientRect();
          const hint = [
            node.getAttribute('placeholder'),
            node.getAttribute('aria-label'),
            node.getAttribute('data-placeholder'),
            node.textContent
          ].join(' ');
          const hintScore = /发消息|发送|输入|问问|对话|message|chat/i.test(hint) ? 10000 : 0;
          return { node, score: hintScore + rect.bottom * 2 + rect.width * 0.1 };
        })
        .sort((a, b) => b.score - a.score);
      const target = candidates[0]?.node || null;
      if (!target) return { ok: false, message: '未找到对话输入框' };

      const isFormField = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT';
      const readValue = () => isFormField ? String(target.value || '') : String(target.innerText || target.textContent || '');
      const dispatchInput = () => {
        try { target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: draft })); } catch (e) {}
        try { target.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
        try { target.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      };

      if (mode === 'state') {
        const current = readValue();
        return {
          ok: true,
          hasAnyText: normalize(current).length > 0,
          hasExpected: Boolean(draft) && normalize(current).includes(normalize(draft)),
          currentLength: normalize(current).length
        };
      }

      target.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      target.focus?.();
      if (isFormField) {
        const proto = target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(target, draft);
        else target.value = draft;
        dispatchInput();
      } else {
        try {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(target);
          range.deleteContents();
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          document.execCommand('insertText', false, draft);
        } catch (e) {}
        if (!normalize(readValue()).includes(normalize(draft))) {
          target.textContent = draft;
        }
        dispatchInput();
      }
      return {
        ok: normalize(readValue()).includes(normalize(draft)),
        hasAnyText: normalize(readValue()).length > 0,
        currentLength: normalize(readValue()).length
      };
    })()
  `;
}

async function getAutoDialogueInputState(webview, expectedText = '') {
  return webview.executeJavaScript(buildAutoDialogueInputScript({ mode: 'state', text: expectedText }));
}

async function fillAutoDialogueDraft(webview, text) {
  return webview.executeJavaScript(buildAutoDialogueInputScript({ mode: 'fill', text }));
}

function buildAutoDialogueSendScript({ text, timeoutMs = 6000 }) {
  return `
    (() => new Promise(resolve => {
      const expected = ${JSON.stringify(text || '')};
      const timeoutMs = ${Number(timeoutMs) || 6000};
      const startedAt = Date.now();
      const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const inputSelectors = [
        'textarea[placeholder*="发消息"]',
        'textarea[placeholder*="发送"]',
        'textarea[placeholder*="输入"]',
        'textarea',
        '[contenteditable="true"][data-placeholder*="发消息"]',
        '[contenteditable="true"][aria-label*="消息"]',
        '[contenteditable="true"][placeholder*="发消息"]',
        '[role="textbox"]',
        '[contenteditable="true"]',
        'input[type="text"]'
      ];
      const buttonSelectors = [
        'button',
        '[role="button"]',
        '[aria-label*="发送"]',
        '[title*="发送"]',
        '[data-testid*="send" i]',
        '[aria-label*="send" i]',
        '[title*="send" i]',
        '[class*="send" i]'
      ];
      const isVisible = node => {
        if (!node || typeof node.getBoundingClientRect !== 'function') return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width >= 18 && rect.height >= 18 &&
          style.visibility !== 'hidden' && style.display !== 'none' &&
          Number(style.opacity || '1') > 0.05 && node.getAttribute('aria-hidden') !== 'true';
      };
      const isDisabled = node => Boolean(node.disabled) || node.hasAttribute?.('disabled') || node.getAttribute('aria-disabled') === 'true';
      const readValue = node => {
        const isFormField = node.tagName === 'TEXTAREA' || node.tagName === 'INPUT';
        return isFormField ? String(node.value || '') : String(node.innerText || node.textContent || '');
      };
      const collect = selectors => {
        const seen = new Set();
        const nodes = [];
        for (const selector of selectors) {
          try {
            for (const node of document.querySelectorAll(selector)) {
              if (!seen.has(node)) { seen.add(node); nodes.push(node); }
            }
          } catch (e) {}
        }
        return nodes;
      };
      const parseRgb = value => {
        const match = String(value || '').match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
      };
      const isBlue = value => {
        const rgb = parseRgb(value);
        if (!rgb) return false;
        const [r, g, b] = rgb;
        return b >= 145 && b >= r + 35 && b >= g + 12;
      };
      const hasBlueSignal = node => {
        const colors = [];
        const addColors = item => {
          const style = window.getComputedStyle(item);
          colors.push(style.backgroundColor, style.color, style.borderColor, style.fill, style.stroke);
        };
        addColors(node);
        for (const child of node.querySelectorAll?.('*') || []) addColors(child);
        return colors.some(isBlue);
      };
      const getHint = node => [node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-testid'), node.getAttribute('data-test-id'), node.getAttribute('data-e2e'), node.getAttribute('class'), node.textContent].join(' ');
      const findInput = () => collect(inputSelectors)
        .filter(node => isVisible(node) && !isDisabled(node))
        .map(node => {
          const rect = node.getBoundingClientRect();
          const hint = [node.getAttribute('placeholder'), node.getAttribute('aria-label'), node.getAttribute('data-placeholder'), node.textContent].join(' ');
          const value = readValue(node);
          const hintScore = /发消息|发送|输入|问问|对话|message|chat/i.test(hint) ? 10000 : 0;
          const expectedScore = expected && normalize(value).includes(normalize(expected)) ? 5000 : 0;
          return { node, rect, value, score: hintScore + expectedScore + rect.bottom * 2 + rect.width * 0.1 };
        })
        .sort((a, b) => b.score - a.score)[0] || null;
      const findSendButton = input => {
        const inputRect = input?.rect || null;
        return collect(buttonSelectors)
          .filter(node => isVisible(node) && !isDisabled(node))
          .map(node => {
            const rect = node.getBoundingClientRect();
            const hint = getHint(node);
            const blue = hasBlueSignal(node);
            const sendHint = /发送|send|submit|arrow.?up/i.test(hint);
            const nearInput = !inputRect || (rect.right >= inputRect.left && rect.left <= inputRect.right + 170 && rect.bottom >= inputRect.top - 44 && rect.top <= inputRect.bottom + 92);
            const centerY = rect.top + rect.height / 2;
            const inputCenterY = inputRect ? inputRect.top + inputRect.height / 2 : centerY;
            let score = 0;
            if (blue) score += 12000;
            if (sendHint) score += 8000;
            if (rect.width <= 88 && rect.height <= 88) score += 1200;
            if (nearInput) score += 5000;
            if (inputRect) score += Math.max(0, 140 - Math.abs(centerY - inputCenterY)) * 18;
            return { node, nearInput, blue, sendHint, score };
          })
          .filter(item => item.nearInput && (item.blue || item.sendHint))
          .sort((a, b) => b.score - a.score)[0] || null;
      };
      const clickButton = item => {
        const node = item.node;
        node.scrollIntoView?.({ block: 'center', inline: 'center' });
        try { node.click?.(); } catch (e) {}
      };
      const tick = () => {
        const input = findInput();
        if (!input) return resolve({ ok: false, clicked: false, message: '未找到对话输入框' });
        if (!normalize(input.value) && expected) return resolve({ ok: true, clicked: false, empty: true, message: '输入框已清空，可能已经发送' });
        const button = findSendButton(input);
        if (button) {
          clickButton(button);
          return resolve({ ok: true, clicked: true, message: '已点击发送按钮' });
        }
        if (Date.now() - startedAt >= timeoutMs) return resolve({ ok: false, clicked: false, message: '发送按钮尚未变为可点击状态' });
        setTimeout(tick, 180);
      };
      tick();
    }))()
  `;
}

async function sendAutoDialogueDraft(webview, text) {
  return webview.executeJavaScript(buildAutoDialogueSendScript({ text }));
}

async function runAutoDialogue() {
  if (!autoDialogue.enabled || autoDialogue.running) return;
  const account = autoDialogue.queue[autoDialogue.accountIndex];
  if (!account) {
    stopAutoDialogue('自动对话已完成全部项目');
    return;
  }

  autoDialogue.running = true;
  updateAutoDialogueButton();
  try {
    const tab = await ensureAutoDialogueAccountReady(account);
    if (!tab?.webview) {
      setStatus(`自动对话未找到项目窗口: ${getAccountDisplayName(account)}`);
      return;
    }

    if (autoDialogue.waitingText && autoDialogue.waitingAccountId === account.id) {
      const inputState = await getAutoDialogueInputState(tab.webview, autoDialogue.waitingText);
      if (!inputState?.ok) {
        setStatus(inputState?.message || '自动对话未找到对话输入框');
        return;
      }
      if (inputState.hasExpected || inputState.hasAnyText) {
        if (autoDialogue.sendEnabled) {
          if (autoDialogue.waitingSendClicked) {
            setStatus(`${getAccountDisplayName(account)} 已点击发送，等待输入框清空后继续`);
          } else {
            const sendResult = await sendAutoDialogueDraft(tab.webview, autoDialogue.waitingText);
            if (sendResult?.clicked) {
              autoDialogue.waitingSendClicked = true;
              setStatus(`${getAccountDisplayName(account)} 第 ${autoDialogue.draftIndex + 1}/${AUTO_DIALOGUE_DRAFTS_PER_ACCOUNT} 条已自动点击发送`);
            } else if (sendResult?.empty) {
              setStatus(`${getAccountDisplayName(account)} 输入框已清空，自动对话准备继续`);
            } else {
              setStatus(sendResult?.message || '对话发送等待发送按钮可用');
            }
          }
        } else {
          setStatus(`${getAccountDisplayName(account)} 第 ${autoDialogue.draftIndex + 1}/${AUTO_DIALOGUE_DRAFTS_PER_ACCOUNT} 条草稿已填入，请手动发送或清空`);
        }
        return;
      }
      autoDialogue.waitingText = '';
      autoDialogue.waitingAccountId = '';
      autoDialogue.waitingSendClicked = false;
      autoDialogue.draftIndex += 1;
      if (autoDialogue.draftIndex >= AUTO_DIALOGUE_DRAFTS_PER_ACCOUNT) {
        autoDialogue.accountIndex += 1;
        autoDialogue.draftIndex = 0;
        if (autoDialogue.accountIndex >= autoDialogue.queue.length) {
          stopAutoDialogue('自动对话已完成全部项目');
          return;
        }
      }
      scheduleAutoDialogue(500);
      return;
    }

    const inputState = await getAutoDialogueInputState(tab.webview, '');
    if (inputState?.ok && inputState.hasAnyText) {
      setStatus(`${getAccountDisplayName(account)} 输入框已有内容，发送或清空后自动对话会继续`);
      return;
    }

    const draft = generateAutoDialogueDraft(account, autoDialogue.draftIndex);
    const result = await fillAutoDialogueDraft(tab.webview, draft);
    if (!result?.ok) {
      setStatus(result?.message || '自动对话未找到对话输入框');
      return;
    }

    autoDialogue.waitingText = draft;
    autoDialogue.waitingAccountId = account.id;
    autoDialogue.waitingSendClicked = false;
    if (autoDialogue.sendEnabled) {
      const sendResult = await sendAutoDialogueDraft(tab.webview, draft);
      if (sendResult?.clicked) {
        autoDialogue.waitingSendClicked = true;
        setStatus(`${getAccountDisplayName(account)} 已填入第 ${autoDialogue.draftIndex + 1}/${AUTO_DIALOGUE_DRAFTS_PER_ACCOUNT} 条并自动点击发送`);
      } else if (sendResult?.empty) {
        setStatus(`${getAccountDisplayName(account)} 已发送，自动对话准备继续`);
      } else {
        setStatus(sendResult?.message || `${getAccountDisplayName(account)} 已填入自动对话，等待发送按钮可用`);
      }
    } else {
      setStatus(`${getAccountDisplayName(account)} 已填入第 ${autoDialogue.draftIndex + 1}/${AUTO_DIALOGUE_DRAFTS_PER_ACCOUNT} 条自动对话，请手动发送`);
    }
  } catch (e) {
    setStatus(`自动对话失败: ${e.message}`);
  } finally {
    autoDialogue.running = false;
    updateAutoDialogueButton();
    scheduleAutoDialogue();
  }
}

const DOUBAO_CREATION_SCAN_URL = 'https://www.doubao.com/chat/create-image?tab=myCreation';

function waitForWebviewLoad(webview, timeoutMs = 15000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      webview.removeEventListener('did-finish-load', finish);
      webview.removeEventListener('dom-ready', finish);
      webview.removeEventListener('did-fail-load', finish);
      setTimeout(resolve, 900);
    };
    const timer = setTimeout(finish, timeoutMs);
    webview.addEventListener('did-finish-load', finish);
    webview.addEventListener('dom-ready', finish);
    webview.addEventListener('did-fail-load', finish);
  });
}

async function waitForDoubaoCreationReady(webview, timeoutMs = 18000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = await webview.executeJavaScript(`
        (() => {
          const href = location.href;
          const text = document.body?.innerText || '';
          const videoCoverCount = Array.from(document.querySelectorAll('img,video,source')).filter(node => {
            const rect = node.getBoundingClientRect();
            const src = String(node.currentSrc || node.src || node.poster || node.srcset || '');
            return rect.width >= 80 && rect.height >= 80 && /tos-cn-p-9ecd54|tplv-noop|videoweb/i.test(src);
          }).length;
          return {
            href,
            ready: /\\/chat\\/create-image/i.test(location.pathname) &&
              /(?:^|[?&])tab=myCreation(?:&|$)/i.test(location.search || '') &&
              (/我的创作|全部创作/.test(text) || videoCoverCount > 0),
            videoCoverCount
          };
        })()
      `);
      if (state?.ready && state.videoCoverCount > 0) return state;
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  return null;
}

async function ensureDoubaoCreationPage(webview) {
  const currentUrl = webview.getURL?.() || webview.src || '';
  if (/doubao\.com\/chat\/create-image/i.test(currentUrl) && /(?:[?&]tab=myCreation\b|myCreation)/i.test(currentUrl)) {
    await waitForDoubaoCreationReady(webview, 6000);
    return;
  }
  setStatus('正在打开豆包“我的创作”页面...');
  if (typeof webview.loadURL === 'function') {
    webview.loadURL(DOUBAO_CREATION_SCAN_URL);
  } else {
    webview.src = DOUBAO_CREATION_SCAN_URL;
  }
  await waitForWebviewLoad(webview);
  await waitForDoubaoCreationReady(webview);
}

btnJimengOriginal?.addEventListener('click', async () => {
  const tab = state.openTabs.find(t => t.accountId === state.activeTabId);
  const account = state.accounts.find(a => a.id === state.activeTabId);
  if (!tab?.webview || !['jimeng', 'doubao'].includes(account?.platform || '')) {
    setStatus('请先打开即梦或豆包账号');
    return;
  }

  btnJimengOriginal.disabled = true;
  try {
    if (account.platform === 'doubao') {
      await ensureDoubaoCreationPage(tab.webview);
      setStatus('正在扫描豆包“我的创作”最新视频...');
    }
    const scripts = await window.electronAPI.getExtensionScripts();
    const scriptName = account.platform === 'doubao' ? 'doubao-creation-download' : 'jimeng-image-download';
    const starterName = account.platform === 'doubao' ? '__AIAM_DOUBAO_CREATION_SCAN_TO_RESOURCE_PANEL__' : '__AIAM_JIMENG_START_SELECT__';
    const code = scripts?.[scriptName];
    if (code) {
      await tab.webview.executeJavaScript(code + ';void 0;');
    }
    const ok = await tab.webview.executeJavaScript(`
      if (window[${JSON.stringify(starterName)}]) {
        window[${JSON.stringify(starterName)}]();
        true;
      } else {
        false;
      }
    ` + ';void 0;');
    if (ok) {
      if (account.platform === 'doubao') {
        const count = typeof ok === 'object' ? Number(ok.count || 0) : 0;
        setStatus(count ? `已扫描最新 ${count} 个豆包无水印视频到右侧资源栏` : '豆包无水印扫描完成，请查看右侧资源栏');
        showDownloadToast(count ? `已加入最新 ${count} 个豆包无水印视频` : '豆包无水印扫描完成', 'success');
      } else {
        setStatus('即梦原图选择已开启，请在页面里点一张图片');
        showDownloadToast('即梦原图选择已开启，请点击要下载的图片', 'success');
      }
    } else {
      setStatus(`${account.platform === 'doubao' ? '豆包无水印下载' : '即梦原图'}脚本未生效，请关闭软件后重新打开`);
    }
  } catch (e) {
    setStatus(`选择模式启动失败: ${e.message}`);
  } finally {
    btnJimengOriginal.disabled = false;
  }
});

btnExportAccounts?.addEventListener('click', async () => {
  btnExportAccounts.disabled = true;
  setStatus('正在导出账号备份...');
  try {
    const result = await window.electronAPI.exportAccounts();
    if (result?.canceled) {
      setStatus('已取消导出账号');
      return;
    }
    if (result?.ok) {
      setStatus(result.message || '账号导出完成');
      showDownloadToast(`账号备份已导出：${result.accountCount || 0} 个账号`, 'success');
    } else {
      alert(`导出失败：${result?.message || '未知错误'}`);
      setStatus('账号导出失败');
    }
  } catch (e) {
    alert(`导出失败：${e.message}`);
    setStatus('账号导出失败');
  } finally {
    btnExportAccounts.disabled = false;
  }
});

btnImportAccounts?.addEventListener('click', async () => {
  const useMerge = window.confirm('导入账号备份请选择方式：\n\n确定：合并追加到当前账号\n取消：进入覆盖恢复确认');
  let mode = 'merge';
  if (!useMerge) {
    const overwrite = window.confirm('覆盖恢复会在下次启动时替换当前账号列表和登录数据。\n\n程序会先自动备份当前数据。确定使用覆盖恢复吗？');
    if (!overwrite) return;
    mode = 'overwrite';
  }
  btnImportAccounts.disabled = true;
  setStatus('正在导入账号备份...');
  try {
    const result = await window.electronAPI.importAccounts({ mode });
    if (result?.canceled) {
      setStatus('已取消导入账号');
      return;
    }
    if (result?.ok) {
      if (result.restartRequired) {
        const message = `${result.message || '账号导入已准备完成'}\n\n当前数据已自动备份到：\n${result.backupPath || 'backups 文件夹'}\n\n请关闭并重新打开软件。`;
        alert(message);
        setStatus(`账号导入已准备完成，重启后生效`);
      } else {
        state.accounts = await window.electronAPI.getAccounts();
        renderAccountFilter();
        renderAccountGroupFilter();
        renderAccounts();
        const message = `${result.message || '账号导入完成'}，登录态目录复制 ${result.copiedPartitions || 0} 个。\n\n当前数据已自动备份到：\n${result.backupPath || 'backups 文件夹'}`;
        alert(message);
        setStatus(result.message || '账号导入完成');
      }
    } else {
      alert(`导入失败：${result?.message || '未知错误'}`);
      setStatus('账号导入失败');
    }
  } catch (e) {
    alert(`导入失败：${e.message}`);
    setStatus('账号导入失败');
  } finally {
    btnImportAccounts.disabled = false;
  }
});

accountSearch?.addEventListener('input', () => {
  state.accountSearch = accountSearch.value.trim();
  renderAccounts();
});

accountGroupFilter?.addEventListener('change', () => {
  state.accountGroupFilter = accountGroupFilter.value || 'all';
  renderAccounts();
});

btnOpenFilteredAccounts?.addEventListener('click', () => {
  const accounts = getVisibleAccounts();
  if (!accounts.length) {
    setStatus('当前筛选下没有账号可打开');
    return;
  }
  accounts.slice(0, 12).forEach(account => openAccountTab(account.id));
  setStatus(`已打开 ${Math.min(accounts.length, 12)} 个筛选账号`);
});

btnRefreshOpenTabs?.addEventListener('click', () => {
  if (!state.openTabs.length) {
    setStatus('当前没有已打开的账号');
    return;
  }
  let count = 0;
  for (const tab of state.openTabs) {
    try {
      tab.webview?.reload();
      count += 1;
    } catch (e) {}
  }
  setStatus(`已刷新 ${count} 个已打开页面`);
});


resourceCaptureMode?.addEventListener('click', (event) => {
  const btn = event.target.closest('.capture-mode-btn');
  if (!btn) return;
  state.captureMode = btn.dataset.mode || 'all';
  renderCaptureMode();
  renderResources();
  setStatus(`资源捕获模式: ${getCaptureModeLabel(state.captureMode)}`);
});

function formatFileSize(size) {
  const bytes = Number(size || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatLibraryTime(ms) {
  const value = Number(ms || 0);
  if (!value) return '';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

// ============= 浼氳瘽淇濆瓨 =============
async function setupDownloadDirButton() {
  const actions = document.querySelector('.resource-actions');
  if (!actions || $('btnChooseDownloadDir')) return;

  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost btn-sm';
  btn.id = 'btnChooseDownloadDir';
  btn.textContent = '下载路径';
  btn.title = await window.electronAPI.getDownloadDir();
  btn.addEventListener('click', async () => {
    const result = await window.electronAPI.chooseDownloadDir();
    if (!result?.canceled && result.downloadDir) {
      btn.title = result.downloadDir;
      state.downloadLibraryLoaded = false;
      state.downloadLibraryFiles = [];
      if (downloadLibraryPath) downloadLibraryPath.textContent = result.downloadDir;
      setStatus(`下载路径: ${result.downloadDir}`);
    }
  });

  const clearBtn = $('btnClearResources');
  actions.insertBefore(btn, clearBtn || null);
}

function openDownloadLibrary() {
  if (!downloadLibraryOverlay) return;
  document.body.classList.add('modal-open');
  downloadLibraryOverlay.classList.remove('hidden');
  if (!state.downloadLibraryLoaded) {
    refreshDownloadLibrary(true);
  } else {
    renderDownloadLibrary();
  }
}

function closeDownloadLibrary() {
  downloadLibraryOverlay?.classList.add('hidden');
  if (downloadVideoObserver) {
    downloadVideoObserver.disconnect();
    downloadVideoObserver = null;
  }
  document.body.classList.remove('modal-open');
  restoreActiveWebview();
}

async function refreshDownloadLibrary(showLoading = false) {
  if (!downloadLibraryList) return;
  if (showLoading) {
    downloadLibraryList.innerHTML = '<div class="download-library-empty">正在读取下载目录...</div>';
  }
  try {
    const result = await window.electronAPI.listDownloadFiles();
    if (!result?.ok) throw new Error(result?.message || '读取失败');
    state.downloadLibraryFiles = Array.isArray(result.files) ? result.files : [];
    state.downloadLibraryLoaded = true;
    if (downloadLibraryPath) downloadLibraryPath.textContent = result.downloadDir || '';
    renderDownloadLibrary();
  } catch (e) {
    downloadLibraryList.innerHTML = `<div class="download-library-empty">读取下载库失败：${escapeHtml(e.message || '未知错误')}</div>`;
  }
}

function getFilteredDownloadFiles() {
  const keyword = state.downloadLibrarySearch;
  return state.downloadLibraryFiles.filter(file => {
    if (state.downloadLibraryType !== 'all' && file.type !== state.downloadLibraryType) return false;
    if (state.downloadLibraryPlatform !== 'all' && scrubVisibleName(file.platform) !== state.downloadLibraryPlatform) return false;
    if (keyword && !String(file.name || '').toLowerCase().includes(keyword)) return false;
    return true;
  });
}

function renderDownloadLibrary() {
  if (!downloadLibraryList || !downloadLibraryEmpty) return;
  const files = getFilteredDownloadFiles();
  const pageSize = state.downloadLibraryPageSize;
  const totalPages = Math.max(1, Math.ceil(files.length / pageSize));
  if (state.downloadLibraryPage > totalPages) state.downloadLibraryPage = totalPages;
  if (state.downloadLibraryPage < 1) state.downloadLibraryPage = 1;
  const start = (state.downloadLibraryPage - 1) * pageSize;
  const visibleFiles = files.slice(start, start + pageSize);
  downloadLibraryEmpty.classList.toggle('hidden', files.length > 0);
  if (downloadLibraryFooter) downloadLibraryFooter.classList.toggle('hidden', files.length === 0);
  if (downloadLibrarySummary) {
    const from = files.length ? start + 1 : 0;
    const to = Math.min(start + visibleFiles.length, files.length);
    downloadLibrarySummary.textContent = `共 ${files.length} 个文件，当前 ${from}-${to}`;
  }
  if (downloadLibraryPageInfo) downloadLibraryPageInfo.textContent = `${state.downloadLibraryPage} / ${totalPages}`;
  if (downloadLibraryPrev) downloadLibraryPrev.disabled = state.downloadLibraryPage <= 1;
  if (downloadLibraryNext) downloadLibraryNext.disabled = state.downloadLibraryPage >= totalPages;
  if (!files.length) {
    downloadLibraryList.innerHTML = '';
    return;
  }

  downloadLibraryList.innerHTML = visibleFiles.map(file => {
    let thumb = '';
    if (file.type === 'image') {
      thumb = `<img src="${escapeHtml(file.fileUrl)}" alt="" loading="lazy" decoding="async">`;
    } else if (file.type === 'video') {
      thumb = `
        <video class="download-file-video" data-src="${escapeHtml(file.fileUrl)}" muted preload="none" playsinline></video>
        <div class="download-file-video-fallback">▶</div>
      `;
    } else {
      thumb = '<div class="download-file-icon">FILE</div>';
    }
    return `
      <div class="download-file-card" draggable="true" data-path="${escapeHtml(file.path)}" data-file-url="${escapeHtml(file.fileUrl)}" title="单击打开，拖拽到其他软件或网页上传区">
        <div class="download-file-thumb ${file.type === 'video' ? 'video' : ''}">${thumb}</div>
        <div class="download-file-info">
          <div class="download-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
          <div class="download-file-meta">
            <span class="download-file-platform">${escapeHtml(scrubVisibleName(file.platform || '其他'))}</span>
            <span>${escapeHtml(formatFileSize(file.size))}</span>
          </div>
          <div class="download-file-meta">
            <span>${escapeHtml(formatLibraryTime(file.mtimeMs))}</span>
          </div>
        </div>
        <div class="download-file-actions">
          <button type="button" data-action="open">打开</button>
          <button type="button" data-action="reveal">位置</button>
          <button type="button" data-action="copy">复制</button>
          <button type="button" class="danger" data-action="delete">删除</button>
        </div>
      </div>
    `;
  }).join('');

  bindDownloadLibraryItems();
  setupDownloadVideoLazyLoad();
}

function bindDownloadLibraryItems() {
  downloadLibraryList?.querySelectorAll('.download-file-card').forEach(card => {
    const filePath = card.dataset.path || '';
    const fileUrl = card.dataset.fileUrl || '';
    let dragStarted = false;
    card.addEventListener('click', async (event) => {
      if (event.target.closest('button')) return;
      if (dragStarted) {
        dragStarted = false;
        return;
      }
      await openLibraryFile(filePath);
    });
    card.addEventListener('dragstart', event => {
      dragStarted = true;
      event.preventDefault();
      try {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', filePath);
        if (fileUrl) event.dataTransfer.setData('text/uri-list', fileUrl);
      } catch (e) {}
      window.electronAPI.startDownloadFileDrag(filePath);
    });
    card.querySelectorAll('button[data-action]').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        const action = button.dataset.action;
        if (action === 'open') {
          await openLibraryFile(filePath);
        } else if (action === 'reveal') {
          await window.electronAPI.revealDownloadFile(filePath);
        } else if (action === 'copy') {
          const result = await window.electronAPI.copyDownloadFilePath(filePath);
          if (result?.ok) showDownloadToast('已复制文件路径', 'success');
        } else if (action === 'delete') {
          const file = state.downloadLibraryFiles.find(item => item.path === filePath);
          if (!window.confirm(`确定删除这个文件吗？\n${file?.name || filePath}`)) return;
          const result = await window.electronAPI.deleteDownloadFile(filePath);
          if (result?.ok) {
            state.downloadLibraryFiles = state.downloadLibraryFiles.filter(item => item.path !== filePath);
            renderDownloadLibrary();
            showDownloadToast('文件已删除', 'success');
          } else {
            alert(result?.message || '删除失败');
          }
        }
      });
    });
  });
}

async function openLibraryFile(filePath) {
  const result = await window.electronAPI.openDownloadFile(filePath);
  if (!result?.ok) {
    alert(`打开失败：${result?.message || '未知错误'}\n\n已尝试为你定位到文件。`);
    await window.electronAPI.revealDownloadFile(filePath);
  }
}

function setupDownloadVideoLazyLoad() {
  if (downloadVideoObserver) {
    downloadVideoObserver.disconnect();
    downloadVideoObserver = null;
  }
  const videos = Array.from(downloadLibraryList?.querySelectorAll('video.download-file-video') || []);
  if (!videos.length) return;
  downloadVideoObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const video = entry.target;
      if (!video.src && video.dataset.src) {
        video.src = video.dataset.src;
        video.load();
        video.addEventListener('loadeddata', () => {
          try {
            video.currentTime = 0.1;
          } catch (e) {}
          video.classList.add('ready');
        }, { once: true });
        video.addEventListener('error', () => {
          video.classList.add('error');
        }, { once: true });
      }
      downloadVideoObserver?.unobserve(video);
    });
  }, { root: downloadLibraryList, rootMargin: '220px' });
  videos.forEach(video => downloadVideoObserver.observe(video));
}

function scheduleDownloadLibraryRefresh() {
  if (!state.downloadLibraryLoaded || downloadLibraryOverlay?.classList.contains('hidden')) return;
  clearTimeout(downloadLibraryRefreshTimer);
  downloadLibraryRefreshTimer = setTimeout(() => refreshDownloadLibrary(false), 700);
}

function restoreAccountToolsCollapsed() {
  const sidebar = document.querySelector('.sidebar-left');
  const collapsed = localStorage.getItem('accountToolsCollapsed') === '1';
  sidebar?.classList.toggle('tools-collapsed', collapsed);
}

async function saveSession() {
  await window.electronAPI.saveSession({
    openTabs: state.openTabs.map(t => t.accountId),
    activeTabId: state.activeTabId
  });
}

// ============= 鍒濆鍖?=============
async function init() {
  try {
    state.compatUserAgent = await window.electronAPI.getCompatUserAgent();
  } catch (e) {
    state.compatUserAgent = FALLBACK_COMPAT_USER_AGENT;
  }
  state.platforms = await window.electronAPI.getPlatforms();
  state.accounts = await window.electronAPI.getAccounts();
  state.resources = await window.electronAPI.getResources();
  seedKnownVideoResources(state.resources);

  renderPlatforms();
  renderAccountFilter();
  renderAccountGroupFilter();
  renderAccounts();
  renderCaptureMode();
  renderResources();
  setupDownloadDirButton();
  restoreAccountToolsCollapsed();
  updateLoginAssistButton();
  updateAutoDialogueButton();

  // 监听资源更新
  window.electronAPI.onResourcesUpdated((resources) => {
    handleNewVideoResources(resources);
    state.resources = resources;
    renderResources();
  });

  // 监听 debugger 检测到的视频
  window.electronAPI.onDebuggerVideoDetected((videos) => {
    console.log('[download-link] debugger detected videos:', videos.length);
    // 直接转发到主进程资源管理器
    const accountId = videos[0]?.accountId || '';
    if (accountId && videos.length > 0) {
      reportCapturedResources(accountId, videos.map(v => ({
        type: v.type || 'video',
        url: v.url,
        backupUrl: v.backupUrl,
        vid: v.vid,
        messageId: v.messageId,
        title: v.title,
        thumbUrl: v.thumbUrl,
        source: v.source || 'debugger',
        status: v.url ? 'ready' : 'pending'
      })));
    }
  });

  // 监听文件下载完成
  window.electronAPI.onFileDownloaded((data) => {
    setStatus(`已下载 ${data.filename}`);
    markDownloadFinished(data.filename || '文件', data.path || '');
    showDownloadToast(data.filename || '文件', 'download');
    scheduleDownloadLibraryRefresh();
  });

  // 从会话恢复：自动打开上次活跃的 Tab
  const session = await window.electronAPI.getSession();
  if (session && session.activeTabId && state.accounts.some(a => a.id === session.activeTabId)) {
    openAccountTab(session.activeTabId);
  }
}

// ============= 平台选择渲染 =============
function renderPlatforms() {
  selectPlatform.innerHTML = '<option value="">请选择平台</option>' +
    state.platforms.map(p => `<option value="${p.id}">${getPlatformName(p.id)}</option>`).join('');

  selectPlatform.addEventListener('change', () => {
    selectPlatform.style.borderColor = '';
    updateCustomUrlVisibility();
    updateNamePreview();
  });
  inputName.addEventListener('input', updateNamePreview);
  inputCustomUrl?.addEventListener('input', () => {
    inputCustomUrl.style.borderColor = '';
    updateNamePreview();
  });
}

function getPlatformName(platformId) {
  if (platformId === 'dola') return '创作平台';
  return scrubVisibleName(state.platforms.find(p => p.id === platformId)?.name || platformId || '未知');
}

function renderAccountFilter() {
  if (!accountFilter) return;
  const platformIds = Array.from(new Set(state.accounts.map(account => account.platform).filter(Boolean)));
  const visiblePlatformIds = state.platforms
    .map(platform => platform.id)
    .filter(id => platformIds.includes(id));
  const filters = [
    { id: 'all', name: '全部', count: state.accounts.length },
    ...visiblePlatformIds.map(id => ({
      id,
      name: getPlatformName(id),
      count: state.accounts.filter(account => account.platform === id).length
    }))
  ];
  if (state.accountFilter !== 'all' && !filters.some(item => item.id === state.accountFilter)) {
    state.accountFilter = 'all';
  }
  accountFilter.innerHTML = filters.map(item => `
    <button class="account-filter-btn ${state.accountFilter === item.id ? 'active' : ''}" data-platform="${escapeHtml(item.id)}">
      <span>${escapeHtml(item.name)}</span>
      <b>${item.count}</b>
    </button>
  `).join('');
  accountFilter.querySelectorAll('.account-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.accountFilter = btn.dataset.platform || 'all';
      renderAccountFilter();
      renderAccounts();
    });
  });
}

function updateNamePreview() {
  const platformId = selectPlatform.value;
  const customName = inputName.value.trim();
  if (!platformId) {
    namePreview.textContent = '';
    return;
  }
  const platform = state.platforms.find(p => p.id === platformId);
  if (!platform) return;
  const previewName = customName || getNextAccountName(platformId, getPlatformName(platformId));
  if (platformId === 'custom') {
    const url = normalizeCustomUrl(inputCustomUrl?.value || '');
    namePreview.textContent = url
      ? `最终名称: ${previewName}，地址: ${url}`
      : `最终名称: ${previewName}`;
    return;
  }
  namePreview.textContent = `最终名称: ${previewName}`;
}

function getAccountGroup(account) {
  return String(account?.group || account?.tag || '').trim();
}

function getAccountRemark(account) {
  return String(account?.remark || account?.note || '').trim();
}

function renderAccountGroupFilter() {
  if (!accountGroupFilter) return;
  const groups = Array.from(new Set(state.accounts.map(getAccountGroup).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (state.accountGroupFilter !== 'all' && !groups.includes(state.accountGroupFilter)) {
    state.accountGroupFilter = 'all';
  }
  accountGroupFilter.innerHTML = [
    `<option value="all">全部分组</option>`,
    `<option value="ungrouped">未分组</option>`,
    ...groups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)
  ].join('');
  accountGroupFilter.value = state.accountGroupFilter;
}

function getVisibleAccounts() {
  const keyword = String(state.accountSearch || '').trim().toLowerCase();
  return state.accounts.filter(acc => {
    if (state.accountFilter !== 'all' && acc.platform !== state.accountFilter) return false;
    const group = getAccountGroup(acc);
    if (state.accountGroupFilter === 'ungrouped' && group) return false;
    if (state.accountGroupFilter !== 'all' && state.accountGroupFilter !== 'ungrouped' && group !== state.accountGroupFilter) return false;
    if (keyword) {
      const haystack = [
        acc.name,
        acc.platformName,
        getPlatformName(acc.platform),
        group,
        getAccountRemark(acc),
        acc.url
      ].join(' ').toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

function updateCustomUrlVisibility() {
  const isCustom = selectPlatform.value === 'custom';
  customUrlGroup?.classList.toggle('hidden', !isCustom);
  if (!isCustom && inputCustomUrl) {
    inputCustomUrl.value = '';
    inputCustomUrl.style.borderColor = '';
  }
}

function normalizeCustomUrl(value) {
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNextAccountName(platformId, platformName) {
  const pattern = new RegExp(`^${escapeRegExp(platformName)}_(\\d+)$`);
  const maxIndex = state.accounts
    .filter(account => account.platform === platformId)
    .reduce((max, account) => {
      const match = String(account.name || '').match(pattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
  return `${platformName}_${maxIndex + 1}`;
}

function getInjectOrderForPlatform(platform) {
  if (platform === 'dola') {
    return [
      'polyfill',
      'dola-electron-bridge',
      'dola-nowatermark-page-hook',
      'dola-nowatermark-content',
      'doubao-video-15s',
      'generic-video-capture'
    ];
  }
  if (platform === 'jimeng') {
    return ['polyfill', 'jimeng-image-download'];
  }
  if (['kimi', 'oiioii', 'nano', 'lovart', 'custom'].includes(platform)) {
    return ['polyfill'];
  }
  if (platform === 'doubao') {
    return [
      'polyfill',
      'doubao-download-content',
      'doubao-download-forwarder',
      'doubao-video-15s'
    ];
  }
  return ['polyfill', 'doubao-download-content', 'doubao-download-forwarder', 'generic-video-capture'];
}

function getExtensionProfileLabel(platform) {
  if (platform === 'doubao') return '豆包图片 + 15秒能力 + 创作原视频';
  if (platform === 'dola') return '创作平台资源 + 15秒';
  if (platform === 'jimeng') return '即梦原图下载';
  if (platform === 'qianwen') return '千问资源识别';
  if (['kimi', 'oiioii', 'nano', 'lovart', 'custom'].includes(platform)) return '普通浏览';
  return '通用资源识别';
}

async function injectExtensionScripts(webview, account) {
  const scripts = await window.electronAPI.getExtensionScripts();
  const injectOrder = getInjectOrderForPlatform(account.platform);
  if (!scripts) return { injected: [], detected: [], missing: injectOrder };

  const injected = [];
  const missing = [];
  for (const name of injectOrder) {
    const code = scripts[name];
    if (!code) {
      missing.push(name);
      continue;
    }
    await webview.executeJavaScript(`
      window.__AIAM_INJECTED_EXTENSIONS = window.__AIAM_INJECTED_EXTENSIONS || [];
      if (!window.__AIAM_INJECTED_EXTENSIONS.includes(${JSON.stringify(name)})) {
        window.__AIAM_INJECTED_EXTENSIONS.push(${JSON.stringify(name)});
      }
    ` + ';void 0;');
    if (name.endsWith('-css') && typeof webview.insertCSS === 'function') {
      await webview.insertCSS(code);
    } else {
      await webview.executeJavaScript(code + ';void 0;');
    }
    if (name === 'dola-nowatermark-page-hook') {
      await webview.executeJavaScript(`
        if (document.documentElement) {
          document.documentElement.dataset.dolaApiHookInjected = "1";
        }
      ` + ';void 0;');
    }
    injected.push(name);
  }

  const detected = await webview.executeJavaScript(`
    Array.isArray(window.__AIAM_INJECTED_EXTENSIONS)
      ? window.__AIAM_INJECTED_EXTENSIONS.slice()
      : []
  `);

  const metaMissing = Array.isArray(scripts.__meta?.missing)
    ? scripts.__meta.missing.map(item => item.name)
    : [];

  return {
    injected,
    detected,
    missing: Array.from(new Set([...missing, ...metaMissing.filter(name => injectOrder.includes(name))]))
  };
}

async function injectBrowserCompat(webview) {
  try {
    await webview.executeJavaScript(`
      try {
        if (/accounts\\.google\\.com$/i.test(location.hostname)) {
          const makePasskeyBlockedError = () => {
            try {
              return new DOMException("Passkey disabled in this embedded login flow", "NotAllowedError");
            } catch (e) {
              const err = new Error("Passkey disabled in this embedded login flow");
              err.name = "NotAllowedError";
              return err;
            }
          };
          const wrapCredentialMethod = (target, name) => {
            if (!target || !target[name]) return;
            const original = target[name].bind(target);
            const wrapped = (options) => {
              if (options && options.publicKey) {
                return Promise.reject(makePasskeyBlockedError());
              }
              return original(options);
            };
            try {
              Object.defineProperty(target, name, { value: wrapped, configurable: true, writable: true });
            } catch (e) {
              try { target[name] = wrapped; } catch (ignore) {}
            }
          };
          if (navigator.credentials) {
            wrapCredentialMethod(navigator.credentials, "get");
            wrapCredentialMethod(navigator.credentials, "create");
          }
          if (window.CredentialsContainer && window.CredentialsContainer.prototype) {
            wrapCredentialMethod(window.CredentialsContainer.prototype, "get");
            wrapCredentialMethod(window.CredentialsContainer.prototype, "create");
          }
          if (window.PublicKeyCredential) {
            try {
              Object.defineProperty(window.PublicKeyCredential, "isUserVerifyingPlatformAuthenticatorAvailable", {
                value: () => Promise.resolve(false),
                configurable: true
              });
            } catch (e) {}
            try {
              Object.defineProperty(window.PublicKeyCredential, "isConditionalMediationAvailable", {
                value: () => Promise.resolve(false),
                configurable: true
              });
            } catch (e) {}
          }
          window.__AIAM_BROWSER_COMPAT = window.__AIAM_BROWSER_COMPAT || "google-low-interference";
        } else {
        Object.defineProperty(navigator, "webdriver", { get: () => false, configurable: true });
        Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"], configurable: true });
        Object.defineProperty(navigator, "language", { get: () => "zh-CN", configurable: true });
        Object.defineProperty(navigator, "platform", { get: () => "Win32", configurable: true });
        if (!window.chrome) window.chrome = {};
        window.chrome.app = window.chrome.app || { isInstalled: false };
        window.chrome.csi = window.chrome.csi || function () { return {}; };
        window.chrome.loadTimes = window.chrome.loadTimes || function () { return {}; };
        window.__AIAM_BROWSER_COMPAT = true;
        }
      } catch (e) {}
    ` + ';void 0;');
  } catch (e) {
    console.warn('[compat] browser env injection failed:', e.message);
  }
}

// ============= 璐﹀彿绠＄悊 =============
async function injectDolaVideoGeneratedWatcher(webview) {
  await webview.executeJavaScript(`
    (function () {
      if (window.__AIAM_DOLA_VIDEO_GENERATED_WATCHER) return;
      window.__AIAM_DOLA_VIDEO_GENERATED_WATCHER = true;
      const seen = new Set();
      let baselineReady = false;
      let pendingSeenAt = 0;
      let generatingWasVisible = false;
      function cleanText(value) { return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 80); }
      function isVisible(node) {
        if (!node || !node.isConnected) return false;
        const rect = node.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 120;
      }
      function getImageUrl(root) {
        const img = root && root.querySelector && root.querySelector('img[src],img[data-src]');
        return img ? (img.currentSrc || img.src || img.getAttribute('data-src') || '') : '';
      }
      function getVideoKey(root, video) {
        const src = video && (video.currentSrc || video.src || video.poster || '');
        const image = getImageUrl(root);
        const text = cleanText(root && root.innerText);
        const rect = root && root.getBoundingClientRect ? root.getBoundingClientRect() : { width: 0, height: 0 };
        return src || image || text || Math.round(rect.width) + 'x' + Math.round(rect.height);
      }
      function findVideoRoots() {
        const roots = new Set();
        document.querySelectorAll('video').forEach(video => {
          let root = video;
          for (let i = 0; i < 6 && root && root !== document.body; i++) {
            const text = cleanText(root.innerText);
            if (/下载视频|原视频|生成好|video/i.test(text) || root.querySelector('button,[role="button"],a')) break;
            root = root.parentElement;
          }
          if (root) roots.add(root);
        });
        document.querySelectorAll('button,[role="button"],a').forEach(btn => {
          const text = cleanText(btn.innerText || btn.textContent);
          if (!/下载视频|原视频|打开链接/i.test(text)) return;
          let root = btn;
          for (let i = 0; i < 6 && root && root !== document.body; i++) {
            if (root.querySelector('video,img')) break;
            root = root.parentElement;
          }
          if (root) roots.add(root);
        });
        return Array.from(roots);
      }
      function hasActiveGeneratingText() {
        const text = cleanText(document.body && document.body.innerText);
        return /正在.*生成视频|正在为您生成视频|预计等待|生成中|视频生成中|消耗\\s*\\d+\\s*个视频生成额度/.test(text);
      }
      function markExistingVideos() {
        let existingCount = 0;
        for (const root of findVideoRoots()) {
          if (!isVisible(root)) continue;
          const video = root.querySelector && root.querySelector('video');
          const key = getVideoKey(root, video);
          if (key) {
            seen.add(key);
            existingCount += 1;
          }
        }
        generatingWasVisible = hasActiveGeneratingText();
        pendingSeenAt = generatingWasVisible && existingCount === 0 ? Date.now() : 0;
        baselineReady = true;
      }
      function scan() {
        if (!baselineReady) {
          markExistingVideos();
          return;
        }
        const generatingNow = hasActiveGeneratingText();
        if (generatingNow && !generatingWasVisible) pendingSeenAt = Date.now();
        generatingWasVisible = generatingNow;
        const canNotify = pendingSeenAt && Date.now() - pendingSeenAt < 30 * 60 * 1000;
        if (!canNotify) return;
        for (const root of findVideoRoots()) {
          if (!isVisible(root)) continue;
          const video = root.querySelector && root.querySelector('video');
          const key = getVideoKey(root, video);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          if (seen.size > 80) seen.delete(seen.values().next().value);
          window.postMessage({
            type: 'AIAM_VIDEO_GENERATED_NOTICE',
            data: { platform: 'dola', key, title: cleanText(root.innerText), thumbUrl: getImageUrl(root) }
          }, '*');
        }
      }
      const schedule = () => {
        clearTimeout(window.__AIAM_DOLA_VIDEO_GENERATED_TIMER);
        window.__AIAM_DOLA_VIDEO_GENERATED_TIMER = setTimeout(scan, 500);
      };
      new MutationObserver(schedule).observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'poster', 'style', 'class']
      });
      window.addEventListener('loadedmetadata', schedule, true);
      window.addEventListener('load', schedule, true);
      setInterval(scan, 2500);
      setTimeout(markExistingVideos, 250);
      setTimeout(scan, 800);
      setTimeout(scan, 2200);
    })();
  ` + ';void 0;');
}

function attachWebviewIpcBridge(webview, accountId) {
  if (webview.__ipcBridgeAttached) return;
  webview.__ipcBridgeAttached = true;

  webview.addEventListener('ipc-message', (event) => {
    console.log('[webview-ipc] message:', event.channel, 'args:', JSON.stringify(event.args).slice(0, 300));

    if (event.channel === 'captured-resources') {
      const resources = event.args[0];
      if (Array.isArray(resources) && resources.length > 0) {
        console.log('[webview-ipc] captured-resources count:', resources.length);
        reportCapturedResources(accountId, resources);
      }
    } else if (event.channel === 'video-metadata') {
      const videos = event.args[0];
      if (Array.isArray(videos) && videos.length > 0) {
        console.log('[webview-ipc] video-metadata count:', videos.length);
        reportCapturedResources(accountId, videos);
      }
    } else if (event.channel === 'video-generated-notice') {
      handleGeneratedVideoNotice(accountId, event.args[0] || {});
    } else if (event.channel === 'download-request') {
      const payload = event.args[0] || {};
      const { url, backupUrl, filename } = payload;
      console.log('[webview-ipc] download-request:', { url: url?.slice(0, 100), filename });
      if (url) {
        if (shouldBlockDoubaoWatermarkedVideoDownload(accountId, payload)) {
          const message = '未获取到豆包无水印视频链接，已停止下载';
          const taskId = addDownloadTask({ filename: filename || '豆包视频', accountId, type: 'video', status: 'error', message });
          updateDownloadTask(taskId, { status: 'error', message });
          resetResourceDownloadButton(accountId, filename);
          showDownloadToast(message, 'error');
          setStatus(message);
          return;
        }
        const taskId = addDownloadTask({ filename: filename || '页面下载', accountId, type: 'page-download' });
        window.electronAPI.downloadResource({ url, backupUrl, accountId, filename }).then(result => {
          console.log('[webview-ipc] downloadResource result:', JSON.stringify(result));
          if (!result?.ok) {
            updateDownloadTask(taskId, { status: 'error', message: result?.message || result?.reason || '下载失败' });
            resetResourceDownloadButton(accountId, filename);
          } else {
            updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : filename });
            finishResourceDownloadButton(accountId, filename);
          }
        }).catch(err => {
          updateDownloadTask(taskId, { status: 'error', message: err.message || '下载失败' });
          resetResourceDownloadButton(accountId, filename);
          console.error('[webview-ipc] downloadResource error:', err);
        });
      }
    } else if (event.channel === 'download-blob') {
      const data = event.args[0];
      console.log('[webview-ipc] download-blob:', data?.filename, 'size:', data?.buffer?.length, 'bytes');
      if (data && data.buffer) {
        const taskId = addDownloadTask({ filename: data.filename || 'blob-download', accountId, type: 'blob' });
        window.electronAPI.saveBlob({ ...data, accountId }).then(result => {
          console.log('[webview-ipc] saveBlob result:', JSON.stringify(result));
          if (!result?.ok) {
            updateDownloadTask(taskId, { status: 'error', message: result?.message || '保存失败' });
            resetResourceDownloadButton(accountId, data.filename);
          } else {
            updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : data.filename });
            finishResourceDownloadButton(accountId, data.filename);
          }
        }).catch(err => {
          updateDownloadTask(taskId, { status: 'error', message: err.message || '保存失败' });
          resetResourceDownloadButton(accountId, data.filename);
          console.error('[webview-ipc] saveBlob error:', err);
        });
      }
    } else if (event.channel === 'download-error') {
      const error = event.args[0] || {};
      console.error('[webview-ipc] webview download error:', JSON.stringify(error));
      resetResourceDownloadButton(accountId, error.filename || '');
      showDownloadToast(error.error || error.message || '下载链接解析失败', 'error');
    } else if (event.channel === 'dola-bg-request') {
      const payload = event.args[0] || {};
      handleDolaBackgroundRequest(webview, accountId, payload).catch((error) => {
        console.error('[dola-nowatermark] request failed:', error);
      });
    }
  });
}

async function sendDolaBackgroundResponse(webview, requestId, response) {
  if (!requestId || !webview) return;
  await webview.executeJavaScript(`
    window.postMessage({
      type: "AIAM_DOLA_BG_RESPONSE",
      requestId: ${JSON.stringify(requestId)},
      response: ${JSON.stringify(response || { ok: false, error: '解析失败' })}
    }, "*");
  ` + ';void 0;');
}

async function handleDolaBackgroundRequest(webview, accountId, payload) {
  const requestId = payload.requestId;
  const message = payload.message || {};
  let response = { ok: false, error: '解析失败' };

  try {
    if (message.type === 'DOLA_BG_DOWNLOAD_NOWATERMARK' || message.type === 'DOLA_BG_DOWNLOAD_DIRECT') {
      const resolved = message.type === 'DOLA_BG_DOWNLOAD_DIRECT'
        ? { ok: true, videoUrl: message.videoUrl, filename: message.filename || `创作平台_视频_${Date.now()}.mp4` }
        : await window.electronAPI.resolveDolaNowatermark(message);
      if (!resolved?.ok || !resolved.videoUrl) throw new Error(resolved?.error || '解析失败');
      await downloadDolaResolvedVideo(webview, accountId, resolved);
      response = { ok: true, downloadId: Date.now(), url: resolved.videoUrl };
    } else if (message.type === 'DOLA_BG_OPEN_NOWATERMARK' || message.type === 'DOLA_BG_OPEN_DIRECT') {
      const resolved = message.type === 'DOLA_BG_OPEN_DIRECT'
        ? { ok: true, videoUrl: message.videoUrl }
        : await window.electronAPI.resolveDolaNowatermark(message);
      if (!resolved?.ok || !resolved.videoUrl) throw new Error(resolved?.error || '解析失败');
      await webview.executeJavaScript(`window.open(${JSON.stringify(resolved.videoUrl)}, "_blank");` + ';void 0;');
      response = { ok: true, url: resolved.videoUrl };
    } else {
      response = { ok: true };
    }
  } catch (error) {
    response = { ok: false, error: error.message || '处理失败' };
    showDownloadToast(response.error, 'error');
  }

  await sendDolaBackgroundResponse(webview, requestId, response);
}

async function downloadDolaResolvedVideo(webview, accountId, resolved) {
  const filename = scrubVisibleName(resolved.filename || `创作平台_无水印视频_${Date.now()}.mp4`);
  const taskId = addDownloadTask({ filename, accountId, type: 'video' });
  let downloadResult = await window.electronAPI.downloadResource({
    url: resolved.videoUrl,
    filename,
    accountId
  });

  if (!downloadResult?.ok) {
    const message = String(downloadResult?.message || downloadResult?.reason || '');
    const shouldFallback = /ERR_BLOCKED_BY_CLIENT|FETCH_ERROR|HTTP_ERROR|blocked/i.test(message);
    if (!shouldFallback || typeof webview.downloadURL !== 'function') {
      updateDownloadTask(taskId, { status: 'error', message: message || '下载失败' });
      throw new Error(message || '下载失败');
    }
    webview.downloadURL(resolved.videoUrl);
    downloadResult = { ok: true, fallback: 'webview-download' };
  } else {
    updateDownloadTask(taskId, { status: 'success', message: downloadResult.filePath || '已完成', filename: downloadResult.filePath ? downloadResult.filePath.split(/[\\/]/).pop() : filename });
  }

  reportCapturedResources(accountId, [{
    type: 'video',
    url: resolved.videoUrl,
    title: '创作平台无水印视频',
    source: 'dola-nowatermark-plugin',
    status: 'ready'
  }]);

  return downloadResult;
}

$('btnAddAccount').addEventListener('click', () => {
  openAccountModal();
});

function openAccountModal(account = null) {
  const isEdit = Boolean(account?.id);
  state.editingAccountId = isEdit ? account.id : null;
  if (modalTitle) modalTitle.textContent = isEdit ? '编辑账号' : '添加新账号';
  if (modalConfirm) modalConfirm.textContent = isEdit ? '保存修改' : '确定添加';
  inputName.value = isEdit ? (account.name || '') : '';
  if (inputGroup) inputGroup.value = isEdit ? getAccountGroup(account) : '';
  if (inputRemark) inputRemark.value = isEdit ? getAccountRemark(account) : '';
  if (inputCustomUrl) inputCustomUrl.value = isEdit ? (account.customUrl || account.url || '') : '';
  selectPlatform.value = isEdit ? (account.platform || '') : '';
  selectPlatform.disabled = isEdit;
  if (inputCustomUrl) inputCustomUrl.disabled = isEdit;
  selectPlatform.style.borderColor = '';
  inputCustomUrl && (inputCustomUrl.style.borderColor = '');
  updateCustomUrlVisibility();
  namePreview.textContent = isEdit ? '正在编辑账号名称、分组和备注，平台和登录数据不会改变。' : '';
  document.body.classList.add('modal-open');
  modalOverlay.classList.remove('hidden');
  setTimeout(() => (isEdit ? inputName : selectPlatform).focus(), 0);
}

function closeAccountModal() {
  modalOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  state.editingAccountId = null;
  if (modalTitle) modalTitle.textContent = '添加新账号';
  if (modalConfirm) modalConfirm.textContent = '确定添加';
  selectPlatform.disabled = false;
  if (inputCustomUrl) inputCustomUrl.disabled = false;
  selectPlatform.style.borderColor = '';
  restoreActiveWebview();
}

$('modalClose').addEventListener('click', closeAccountModal);
$('modalCancel').addEventListener('click', closeAccountModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeAccountModal();
});

modalConfirm?.addEventListener('click', async () => {
  const platform = selectPlatform.value;
  const name = inputName.value.trim() || undefined;
  const group = inputGroup?.value.trim() || '';
  const remark = inputRemark?.value.trim() || '';
  const customUrl = platform === 'custom' ? normalizeCustomUrl(inputCustomUrl?.value || '') : '';
  const editingAccountId = state.editingAccountId;

  if (editingAccountId) {
    const result = await window.electronAPI.updateAccount(editingAccountId, {
      name: name || '',
      group,
      remark
    });
    if (result?.success) {
      state.accounts = await window.electronAPI.getAccounts();
      renderAccountFilter();
      renderAccountGroupFilter();
      renderAccounts();
      renderTabs();
      closeAccountModal();
      setStatus(`已更新账号 ${result.account?.name || ''}`);
    } else {
      alert(result?.error || '更新账号失败');
    }
    return;
  }

  if (!platform) {
    selectPlatform.focus();
    selectPlatform.style.borderColor = 'var(--danger)';
    setTimeout(() => selectPlatform.style.borderColor = '', 2000);
    return;
  }

  if (platform === 'custom' && !customUrl) {
    inputCustomUrl.focus();
    inputCustomUrl.style.borderColor = 'var(--danger)';
    setTimeout(() => inputCustomUrl.style.borderColor = '', 2000);
    namePreview.textContent = '请输入正确的网站地址';
    return;
  }

  const result = await window.electronAPI.addAccount({ platform, name, url: customUrl, group, remark });
  if (result.success) {
    state.accounts = await window.electronAPI.getAccounts();
    renderAccountFilter();
    renderAccountGroupFilter();
    renderAccounts();
    closeAccountModal();
    setStatus(`已添加账号 ${getAccountDisplayName(result.account)}`);
  } else {
    alert(result.error);
  }
});

function renderAccounts() {
  const visibleAccounts = getVisibleAccounts();

  accountList.innerHTML = visibleAccounts.map(acc => `
    <div class="account-card ${state.activeAccountId === acc.id ? 'active' : ''} ${state.videoNoticeByAccount[acc.id] ? 'has-video-notice' : ''}" data-id="${acc.id}">
      <div class="account-card-info">
        <div class="account-card-name">
          <span>${escapeHtml(getAccountDisplayName(acc))}</span>
          ${state.videoNoticeByAccount[acc.id] ? `<span class="video-notice-badge">${state.videoNoticeByAccount[acc.id] > 9 ? '9+' : state.videoNoticeByAccount[acc.id]} 新视频</span>` : ''}
        </div>
        <div class="account-card-time">${new Date(acc.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
        ${(getAccountGroup(acc) || getAccountRemark(acc)) ? `
          <div class="account-card-meta">
            ${getAccountGroup(acc) ? `<span class="account-group-pill" title="${escapeHtml(getAccountGroup(acc))}">${escapeHtml(getAccountGroup(acc))}</span>` : ''}
            ${getAccountRemark(acc) ? `<span class="account-remark-text" title="${escapeHtml(getAccountRemark(acc))}">${escapeHtml(getAccountRemark(acc))}</span>` : ''}
          </div>
        ` : ''}
      </div>
      <div class="account-card-actions">
        <button class="account-card-edit" data-id="${acc.id}" title="编辑分组和备注">✎</button>
        <button class="account-card-delete" data-id="${acc.id}" title="删除账号">×</button>
      </div>
    </div>
  `).join('');

  accountCount.textContent = visibleAccounts.length === state.accounts.length
    ? `共 ${state.accounts.length} 个账号`
    : `显示 ${visibleAccounts.length} / ${state.accounts.length} 个`;
  updateAutoDialogueButton();

  // 点击账号卡片
  accountList.querySelectorAll('.account-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.account-card-delete') || e.target.closest('.account-card-edit')) return;
      const accountId = card.dataset.id;
      openAccountTab(accountId);
    });
  });

  accountList.querySelectorAll('.account-card-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      const account = state.accounts.find(acc => acc.id === id);
      if (!account) return;
      openAccountModal(account);
    });
  });

  // 鍒犻櫎璐﹀彿
  accountList.querySelectorAll('.account-card-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const account = state.accounts.find(acc => acc.id === id);
      const name = account?.name || '该账号';
      const confirmed = window.confirm(`确定要删除账号“${name}”吗？\n\n删除后该账号会从列表移除，已打开的标签页也会关闭。`);
      if (!confirmed) return;
      const result = await window.electronAPI.deleteAccount(id);
      if (!result?.success) {
        alert(result?.error || '删除账号失败');
        return;
      }
      state.accounts = await window.electronAPI.getAccounts();
      closeTab(id);
      if (state.activeAccountId === id) state.activeAccountId = null;
      if (state.activeTabId === id) state.activeTabId = null;
      delete state.videoNoticeByAccount[id];
      state.resources = state.resources.filter(r => r.accountId !== id);
      renderResources();
      renderAccountFilter();
      renderAccountGroupFilter();
      renderAccounts();
      updateNamePreview();
    });
  });
}

// ============= Tab 鏍囩椤电鐞?=============
function openAccountTab(accountId) {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) return;

  // If this account already has a tab, switch to it.
  if (state.openTabs.some(t => t.accountId === accountId)) {
    activateTab(accountId);
    return;
  }

  // Create a new webview for this account.
  const webview = document.createElement('webview');
  webview.setAttribute('useragent', state.compatUserAgent || FALLBACK_COMPAT_USER_AGENT);
  webview.setAttribute('src', account.url);
  webview.setAttribute('partition', `persist:account_${accountId}`);
  webview.setAttribute('preload', '../src/webview-preload.js');
  webview.setAttribute('allowpopups', 'true');
  attachWebviewIpcBridge(webview, accountId);
  webview.style.visibility = 'hidden';
  webview.style.pointerEvents = 'none';

  // Register the webContents id after the webview attaches.
  webview.addEventListener('did-attach', () => {
    try {
      const wcId = webview.getWebContentsId();
      if (wcId) {
        window.electronAPI.registerWebview(accountId, wcId);
        console.log(`[webview-map] registered webview[${wcId}] -> ${account.name}[${accountId}]`);
      }
    } catch (e) {
      console.error('[webview-map] register failed:', e.message);
    }
  });

  // 监听 webview 事件
  webview.addEventListener('dom-ready', async () => {
    setStatus(`已加载 ${getAccountDisplayName(account)}`);
    
    // 设置缩放为 100%
    try {
      webview.setZoomLevel(0);
    } catch (e) {}

    await injectBrowserCompat(webview);

    // 注入扩展脚本
    try {
      const result = await injectExtensionScripts(webview, account);
      const profile = getExtensionProfileLabel(account.platform);
      if (result.missing.length) {
        setStatus(`${getAccountDisplayName(account)} 扩展缺失: ${result.missing.join(', ')}`);
        console.warn(`[app] missing extension scripts for ${account.name}: ${result.missing.join(', ')}`);
      } else {
        setStatus(`${getAccountDisplayName(account)} 已启用 ${profile}`);
      }

      // 豆包聊天页只保留图片捕获；视频只通过“扫描豆包下载无水印版”按钮进入右侧资源栏。
      if (account.platform === 'dola') {
        await injectDolaVideoGeneratedWatcher(webview);
      }
      console.log(`[app] injected scripts for ${account.name}: ${result.injected.join(', ')}; detected: ${(result.detected || []).join(', ')}`);
    } catch (e) {
      console.error('[app] script injection failed:', e);
    }

    // Forward resource and download IPC from webview to main process.
    if (!webview.__ipcBridgeAttached) webview.addEventListener('ipc-message', (event) => {
      console.log('[download-route] ipc-message:', event.channel, 'args:', JSON.stringify(event.args).slice(0, 300));

      if (event.channel === 'captured-resources') {
        const resources = event.args[0];
        if (Array.isArray(resources) && resources.length > 0) {
          console.log('[download-route] captured-resources count:', resources.length);
          reportCapturedResources(accountId, resources);
        }
      } else if (event.channel === 'video-metadata') {
        // Metadata from scanners can be pending and may not include a direct URL yet.
        const videos = event.args[0];
        if (Array.isArray(videos) && videos.length > 0) {
          console.log('[download-route] video-metadata count:', videos.length);
          reportCapturedResources(accountId, videos);
        }
      } else if (event.channel === 'download-request') {
        // Download request from page-side buttons.
        const payload = event.args[0] || {};
        const { url, backupUrl, filename } = payload;
        console.log('[download-route] download-request:', { url: url?.slice(0, 100), filename });
        if (url) {
          if (shouldBlockDoubaoWatermarkedVideoDownload(accountId, payload)) {
            const message = '未获取到豆包无水印视频链接，已停止下载';
            const taskId = addDownloadTask({ filename: filename || '豆包视频', accountId, type: 'video', status: 'error', message });
            updateDownloadTask(taskId, { status: 'error', message });
            resetResourceDownloadButton(accountId, filename);
            showDownloadToast(message, 'error');
            setStatus(message);
            return;
          }
          const taskId = addDownloadTask({ filename: filename || '页面下载', accountId, type: 'page-download' });
          window.electronAPI.downloadResource({ url, backupUrl, accountId, filename }).then(result => {
            console.log('[download-route] downloadResource result:', JSON.stringify(result));
            if (!result?.ok) {
              updateDownloadTask(taskId, { status: 'error', message: result?.message || result?.reason || '下载失败' });
              resetResourceDownloadButton(accountId, filename);
            } else {
              updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : filename });
              finishResourceDownloadButton(accountId, filename);
            }
          }).catch(err => {
            updateDownloadTask(taskId, { status: 'error', message: err.message || '下载失败' });
            resetResourceDownloadButton(accountId, filename);
            console.error('[download-route] downloadResource error:', err);
          });
        }
      } else if (event.channel === 'download-blob') {
        // Blob data forwarded from the webview.
        const data = event.args[0];
        console.log('[download-route] download-blob:', data?.filename, 'size:', data?.buffer?.length, 'bytes');
        if (data && data.buffer) {
          const taskId = addDownloadTask({ filename: data.filename || 'blob-download', accountId, type: 'blob' });
          window.electronAPI.saveBlob({ ...data, accountId }).then(result => {
            console.log('[download-route] saveBlob result:', JSON.stringify(result));
            if (!result?.ok) {
              updateDownloadTask(taskId, { status: 'error', message: result?.message || '保存失败' });
              resetResourceDownloadButton(accountId, data.filename);
            } else {
              updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : data.filename });
              finishResourceDownloadButton(accountId, data.filename);
            }
          }).catch(err => {
            updateDownloadTask(taskId, { status: 'error', message: err.message || '保存失败' });
            resetResourceDownloadButton(accountId, data.filename);
            console.error('[download-route] saveBlob error:', err);
          });
        }
      } else if (event.channel === 'download-error') {
        const error = event.args[0] || {};
        console.error('[download-route] webview download error:', JSON.stringify(error));
        resetResourceDownloadButton(accountId, error.filename || '');
        showDownloadToast(error.error || error.message || '下载链接解析失败', 'error');
      }
    });

    // 鐩戝惉椤甸潰鏍囬鍙樺寲
    try {
      const title = webview.getTitle();
      if (title) pageTitle.textContent = scrubVisibleName(title);
    } catch (e) {}
  });

  webview.addEventListener('page-title-updated', (e) => {
    if (state.activeTabId === accountId) {
      pageTitle.textContent = scrubVisibleName(e.title);
    }
  });

  webview.addEventListener('did-start-loading', () => {
    if (state.activeTabId === accountId) {
      setStatus(`正在加载: ${getAccountDisplayName(account)}...`);
    }
  });

  webview.addEventListener('did-stop-loading', () => {
    if (state.activeTabId === accountId) {
      setStatus(`已加载 ${getAccountDisplayName(account)}`);
    }
  });

  browserWrapper.appendChild(webview);

  // 显式注册该 webview partition 的下载处理器
  window.electronAPI.setupDownloadHandler(accountId);

  state.openTabs.push({ accountId, webview });
  hideEmptyState();
  renderTabs();
  activateTab(accountId);
  saveSession();
}

function closeTab(accountId) {
  const tab = state.openTabs.find(t => t.accountId === accountId);
  const wasActive = state.activeTabId === accountId;

  if (tab) {
    try {
      tab.webview.style.visibility = 'hidden';
      tab.webview.style.pointerEvents = 'none';
      if (typeof tab.webview.stop === 'function') tab.webview.stop();
      tab.webview.setAttribute('src', 'about:blank');
    } catch (e) {}
    tab.webview.remove();
    state.openTabs = state.openTabs.filter(t => t.accountId !== accountId);
  }

  if (wasActive) {
    if (state.openTabs.length > 0) {
      activateTab(state.openTabs[state.openTabs.length - 1].accountId);
    } else {
      state.activeTabId = null;
      state.activeAccountId = null;
      showEmptyState();
      pageTitle.textContent = '浏览区域';
      setStatus('就绪');
      updateLoginAssistButton();
      updateAutoDialogueButton();
    }
  }

  renderTabs();
  renderAccounts(); // 鏇存柊楂樹寒鐘舵€?  saveSession();
}

function restoreActiveWebview() {
  state.openTabs.forEach(t => {
    t.webview.style.visibility = 'hidden';
    t.webview.style.pointerEvents = 'none';
  });
  if (!state.activeTabId) return;
  const tab = state.openTabs.find(t => t.accountId === state.activeTabId);
  if (!tab) return;
  tab.webview.style.visibility = 'visible';
  tab.webview.style.pointerEvents = 'auto';
}

function activateTab(accountId) {
  // 隐藏所有 webview
  state.openTabs.forEach(t => {
    t.webview.style.visibility = 'hidden';
    t.webview.style.pointerEvents = 'none';
  });

  // 鏄剧ず鐩爣 webview
  const tab = state.openTabs.find(t => t.accountId === accountId);
  if (tab) {
    tab.webview.style.visibility = 'visible';
    tab.webview.style.pointerEvents = 'auto';
    state.activeTabId = accountId;
    state.activeAccountId = accountId;
    delete state.videoNoticeByAccount[accountId];

    // 鑾峰彇椤甸潰鏍囬
    try {
      const title = tab.webview.getTitle();
      pageTitle.textContent = scrubVisibleName(title) || '浏览区域';
    } catch (e) {
      pageTitle.textContent = '浏览区域';
    }

    renderTabs();
    renderAccounts();
    hideEmptyState();
    updateLoginAssistButton();
    updateAutoDialogueButton();
    saveSession();
  }
}

async function updateLoginAssistButton() {
  if (!btnLoginAssist) return;
  const accountId = state.activeTabId || state.activeAccountId;
  const account = state.accounts.find(item => item.id === accountId);
  btnLoginAssist.classList.toggle('hidden', !account);
  if (!account) {
    btnLoginAssist.textContent = '登录辅助';
    btnLoginAssist.title = '使用真实 Chrome/Edge 辅助完成 Google 登录';
    return;
  }
  try {
    const status = await window.electronAPI.externalLoginStatus(account.id);
    if (status?.active) {
      btnLoginAssist.textContent = '同步登录';
      btnLoginAssist.title = `同步 ${status.browserName || '外部浏览器'} 登录态到当前账号`;
    } else {
      btnLoginAssist.textContent = '登录辅助';
      btnLoginAssist.title = '使用真实 Chrome/Edge 辅助完成 Google 登录';
    }
  } catch (e) {
    btnLoginAssist.textContent = '登录辅助';
  }
}

function renderTabs() {
  tabBar.innerHTML = state.openTabs.map(tab => {
    const account = state.accounts.find(a => a.id === tab.accountId);
    return `
      <div class="tab-item ${state.activeTabId === tab.accountId ? 'active' : ''} ${state.videoNoticeByAccount[tab.accountId] ? 'has-video-notice' : ''}" data-id="${tab.accountId}">
        ${state.videoNoticeByAccount[tab.accountId] ? '<span class="tab-video-dot" title="有新视频"></span>' : ''}
        <span>${account ? escapeHtml(getAccountDisplayName(account)) : '未知'}</span>
        <button class="tab-close" data-id="${tab.accountId}">×</button>
      </div>
    `;
  }).join('');

  // Tab 鐐瑰嚮鍒囨崲
  tabBar.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;
      activateTab(item.dataset.id);
    });
  });

  // Tab 鍏抽棴鎸夐挳
  tabBar.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(btn.dataset.id);
    });
  });
}

// ============= 绌虹姸鎬?=============
function hideEmptyState() {
  emptyState.style.display = 'none';
  updatePlatformTools();
}

function showEmptyState() {
  emptyState.style.display = '';
  updatePlatformTools();
}

function updatePlatformTools() {
  const account = state.accounts.find(a => a.id === state.activeTabId);
  const platform = account?.platform || '';
  const showAssetTool = platform === 'jimeng' || platform === 'doubao';
  btnJimengOriginal?.classList.toggle('hidden', !showAssetTool);
  if (btnJimengOriginal) {
    if (platform === 'doubao') {
      btnJimengOriginal.textContent = '扫描豆包下载无水印版';
      btnJimengOriginal.title = '扫描豆包我的创作视频到右侧资源栏，下载明确无水印的视频';
    } else {
      btnJimengOriginal.textContent = '即梦原图';
      btnJimengOriginal.title = '即梦资产页选择图片下载无水印原图';
    }
  }
}

// ============= 鐘舵€佹爮 =============
function setStatus(msg) {
  if (statusText) statusText.textContent = msg;
}

function getCaptureModeLabel(mode = state.captureMode) {
  if (mode === 'image') return '只抓图片';
  if (mode === 'video') return '只抓视频';
  return '全抓';
}

function shouldShowResourceByCaptureMode(resource) {
  if (!resource || state.captureMode === 'all') return true;
  return resource.type === state.captureMode;
}

function filterResourcesByCaptureMode(resources) {
  if (!Array.isArray(resources)) return [];
  if (state.captureMode === 'all') return resources;
  return resources.filter(resource => resource?.type === state.captureMode);
}

function getVideoResourceKey(resource) {
  if (!resource || resource.type !== 'video') return '';
  const accountId = resource.accountId || '';
  const stableId = resource.messageId || resource.vid || resource.url || resource.backupUrl || resource.id || '';
  return stableId ? `${accountId}:video:${stableId}` : '';
}

function seedKnownVideoResources(resources) {
  knownVideoResourceKeys.clear();
  for (const resource of Array.isArray(resources) ? resources : []) {
    const key = getVideoResourceKey(resource);
    if (key) knownVideoResourceKeys.add(key);
  }
}

function getAccountDisplayName(accountId) {
  return state.accounts.find(account => account.id === accountId)?.name || '当前账号';
}

function handleNewVideoResources(resources) {
  const list = Array.isArray(resources) ? resources : [];
  if (!list.length) {
    knownVideoResourceKeys.clear();
    state.videoNoticeByAccount = {};
    renderTabs();
    renderAccounts();
    return;
  }

  for (const resource of list) {
    if (!resource || resource.type !== 'video') continue;
    const key = getVideoResourceKey(resource);
    if (!key || knownVideoResourceKeys.has(key)) continue;
    knownVideoResourceKeys.add(key);
  }
}

function handleGeneratedVideoNotice(accountId, notice = {}) {
  if (!accountId) return;
  const key = `${accountId}:${notice.key || notice.url || notice.thumbUrl || notice.title || Date.now()}`;
  if (generatedVideoNoticeKeys.has(key)) return;
  generatedVideoNoticeKeys.add(key);
  if (generatedVideoNoticeKeys.size > 300) {
    generatedVideoNoticeKeys.delete(generatedVideoNoticeKeys.values().next().value);
  }

  state.videoNoticeByAccount[accountId] = (state.videoNoticeByAccount[accountId] || 0) + 1;
  const name = getAccountDisplayName(accountId);
  const title = notice.title && !/下载视频|生成视频|你的视频生成好/i.test(notice.title)
    ? `：${notice.title}`
    : '';
  showDownloadToast(`${name} 新视频已生成${title}`, 'video');
  setStatus(`${name} 新视频已生成`);
  showVideoGeneratedAlert(accountId, {
    title: '新视频已生成',
    message: `${name}${title || ''}`
  });
  renderTabs();
  renderAccounts();
}

function showVideoGeneratedAlert(accountId, notice = {}) {
  if (!document.body) return;
  let layer = document.querySelector('.video-alert-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'video-alert-layer';
    document.body.appendChild(layer);
  }

  const selector = `[data-account-id="${CSS.escape(accountId)}"]`;
  const existing = layer.querySelector(selector);
  if (existing) existing.remove();

  const card = document.createElement('div');
  card.className = 'video-alert-card';
  card.dataset.accountId = accountId;
  card.innerHTML = `
    <div class="video-alert-icon">▶</div>
    <div class="video-alert-content">
      <div class="video-alert-title">${escapeHtml(notice.title || '新视频已生成')}</div>
      <div class="video-alert-message">${escapeHtml(notice.message || getAccountDisplayName(accountId))}</div>
    </div>
    <div class="video-alert-actions">
      <button class="video-alert-view" type="button">查看</button>
      <button class="video-alert-dismiss" type="button" title="忽略">×</button>
    </div>
  `;

  card.querySelector('.video-alert-view')?.addEventListener('click', () => {
    activateTab(accountId);
    card.remove();
  });
  card.querySelector('.video-alert-dismiss')?.addEventListener('click', () => {
    card.remove();
  });

  layer.appendChild(card);
  requestAnimationFrame(() => card.classList.add('show'));
  clearTimeout(card.__dismissTimer);
  card.__dismissTimer = setTimeout(() => {
    card.classList.remove('show');
    setTimeout(() => card.remove(), 220);
  }, 9000);
}

function reportCapturedResources(accountId, resources) {
  const filtered = filterResourcesByCaptureMode(resources);
  if (!filtered.length || !accountId) return;
  const tab = state.openTabs.find(t => t.accountId === accountId);
  const pageUrl = tab?.webview?.getURL?.() || tab?.webview?.src || '';
  const enriched = filtered.map(resource => ({
    ...resource,
    pageUrl: resource.pageUrl || resource.referer || pageUrl
  }));

  const queued = resourceReportQueues.get(accountId) || [];
  queued.push(...enriched);
  resourceReportQueues.set(accountId, queued);

  if (resourceReportTimers.has(accountId)) return;
  const timer = setTimeout(() => {
    const batch = resourceReportQueues.get(accountId) || [];
    resourceReportQueues.delete(accountId);
    resourceReportTimers.delete(accountId);
    if (batch.length) window.electronAPI.reportCapturedResources(accountId, batch);
  }, RESOURCE_REPORT_DELAY_MS);
  resourceReportTimers.set(accountId, timer);
}

function renderCaptureMode() {
  if (!resourceCaptureMode) return;
  resourceCaptureMode.querySelectorAll('.capture-mode-btn').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.mode || 'all') === state.captureMode);
  });
}

function showDownloadToast(message, tone = 'success') {
  if (!toastLayer) return;
  const toast = document.createElement('div');
  const toastTone = tone === 'error' ? 'error' : tone === 'video' ? 'video' : tone === 'download' ? 'download' : 'success';
  toast.className = `toast ${toastTone}`;
  if (toastTone === 'download') {
    toast.innerHTML = `
      <div class="toast-download-row">
        <div class="toast-download-icon">✓</div>
        <div class="toast-download-content">
          <div class="toast-download-title">下载完成</div>
          <div class="toast-download-file" title="${escapeHtml(message || '文件')}">${escapeHtml(message || '文件')}</div>
        </div>
        <button class="toast-open-folder" type="button">打开文件夹</button>
      </div>
    `;
    const openBtn = toast.querySelector('.toast-open-folder');
    openBtn?.addEventListener('click', async () => {
      await window.electronAPI.openDownloadDir();
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    });
  } else {
    toast.textContent = message || '下载完成';
  }
  toastLayer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 220);
  }, toastTone === 'error' ? 3600 : toastTone === 'video' ? 5000 : toastTone === 'download' ? 4200 : 2400);
}

function addDownloadTask({ filename, accountId, type, status = 'running', message = '' }) {
  return '';
}

function updateDownloadTask(id, patch) {
}

function markDownloadFinished(filename, filePath) {
}

function renderDownloadTasks() {
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scrubVisibleName(value) {
  return String(value || '')
    .replace(/豆包\s*Dola/gi, '豆包')
    .replace(/\bDola\b/gi, '创作平台')
    .replace(/^dola([_\s-])/i, '创作平台$1');
}

function getAccountDisplayName(account) {
  return scrubVisibleName(account?.name || '未命名账号');
}

// ============= 资源面板 =============
function sanitizeDownloadName(value) {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function getResourceDownloadFilename(resource) {
  if (!resource) return '';
  const ext = resource.type === 'image' ? '.png' : resource.type === 'video' ? '.mp4' : '';
  const account = state.accounts.find(item => item.id === resource.accountId);
  const platform = account?.platform || '';
  const platformLabel = platform === 'doubao' ? '豆包' : platform === 'qianwen' ? '千问' : platform === 'dola' ? '创作平台' : (account ? getPlatformName(account.platform) : '资源');
  const accountName = sanitizeDownloadName(getAccountDisplayName(account));
  const suffix = String(resource.messageId || resource.vid || resource.id || resource.url || Date.now().toString(36)).slice(-8);
  const sourceName = resource.title || resource.category || '';
  const cleanName = sanitizeDownloadName(sourceName);
  const genericName = !cleanName || /^(video|video\.mp4|download|下载视频|原视频|未命名)$/i.test(cleanName);
  if (!genericName) {
    const base = sanitizeDownloadName([platformLabel, accountName, cleanName, suffix].filter(Boolean).join('_'));
    return ext && !base.toLowerCase().endsWith(ext) ? `${base}${ext}` : base;
  }
  const fallback = sanitizeDownloadName([platformLabel, accountName, '未分类', resource.type === 'image' ? '图片' : '视频', suffix].filter(Boolean).join('_'));
  return ext && !fallback.toLowerCase().endsWith(ext) ? `${fallback}${ext}` : fallback;
}

function isDolaVideoUrl(url) {
  return /dola\.com|ciciai\.com|vod-urls-mya\.byteintlapi\.com|mime_type=video_mp4/i.test(String(url || ''));
}

function isConfirmedNoWatermarkVideoUrl(url) {
  const text = String(url || '').toLowerCase();
  if (!text) return false;
  try {
    const parsed = new URL(url);
    if (/(^|[.-])videoweb-download\.doubao\.com$/i.test(parsed.hostname) && parsed.searchParams.get('download') === 'true') return true;
    if (/(^|[.-])videoweb\.doubao\.com$/i.test(parsed.hostname) && parsed.searchParams.get('download') === 'true') return true;
    if (parsed.hostname.includes('doubao.com') && parsed.pathname.includes('/download') && parsed.searchParams.get('download') === 'true') return true;
  } catch (e) {}
  return text.includes('nowatermark') || (/download=true/.test(text) && /video_mp4|mime_type=video_mp4/.test(text));
}

function isVideoDownloadPayload(payload = {}) {
  const text = `${payload.type || ''} ${payload.filename || ''} ${payload.url || ''}`.toLowerCase();
  return payload.type === 'video' || /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(text) || /mime_type=video|video_mp4|tos-cn.*\.mp4/i.test(text);
}

function shouldBlockDoubaoWatermarkedVideoDownload(accountId, payload = {}) {
  return isDoubaoAccountId(accountId)
    && isVideoDownloadPayload(payload)
    && !payload.confirmedNoWatermark
    && !isConfirmedNoWatermarkVideoUrl(payload.url);
}

function isDoubaoAccountId(accountId) {
  return state.accounts.find(item => item.id === accountId)?.platform === 'doubao';
}

function downloadInWebview(accountId, url) {
  const webview = document.querySelector(`webview[partition="persist:account_${accountId}"]`);
  if (!webview) {
    throw new Error('未找到对应的 WebView，请先打开该账号');
  }
  if (typeof webview.downloadURL === 'function') {
    webview.downloadURL(url);
    return true;
  }
  webview.executeJavaScript(`
    window.postMessage({
      type: "electronDownload",
      data: { url: ${JSON.stringify(url)}, filename: "" }
    }, "*");
  ` + ';void 0;');
  return true;
}

function getResourceDownloadButtonKey(accountId, filename) {
  if (!accountId || !filename) return '';
  return `${accountId}::${filename}`;
}

function clearResourceButtonRecovery(btn) {
  const timer = resourceDownloadRecoveryTimers.get(btn);
  if (timer) clearTimeout(timer);
  resourceDownloadRecoveryTimers.delete(btn);
}

function setResourceButtonReady(btn, text = '下载') {
  clearResourceButtonRecovery(btn);
  btn.textContent = text;
  btn.disabled = false;
  btn.classList.remove('downloading');
  btn.classList.remove('done');
}

function setResourceButtonLoading(btn) {
  clearResourceButtonRecovery(btn);
  btn.textContent = '下载中';
  btn.disabled = true;
  btn.classList.add('downloading');
  btn.classList.remove('done');
}

function setResourceButtonDone(btn) {
  clearResourceButtonRecovery(btn);
  btn.textContent = '再次下载';
  btn.disabled = false;
  btn.classList.remove('downloading');
  btn.classList.add('done');
}

function rememberResourceDownloadButton(accountId, filename, btn) {
  const key = getResourceDownloadButtonKey(accountId, filename);
  if (key) {
    pendingResourceDownloadButtons.set(key, btn);
    resourceDownloadStateByKey.set(key, 'downloading');
  }
}

function finishResourceDownloadButton(accountId, filename) {
  const key = getResourceDownloadButtonKey(accountId, filename);
  const btn = key ? pendingResourceDownloadButtons.get(key) : null;
  if (key) resourceDownloadStateByKey.set(key, 'done');
  if (btn) {
    setResourceButtonDone(btn);
    pendingResourceDownloadButtons.delete(key);
  }
}

function resetResourceDownloadButton(accountId, filename) {
  const key = getResourceDownloadButtonKey(accountId, filename);
  const btn = key ? pendingResourceDownloadButtons.get(key) : null;
  if (key) resourceDownloadStateByKey.delete(key);
  if (btn) {
    setResourceButtonReady(btn);
    pendingResourceDownloadButtons.delete(key);
  }
}

function scheduleResourceButtonRecovery(accountId, filename, btn) {
  clearResourceButtonRecovery(btn);
  const timer = setTimeout(() => {
    if (btn.disabled && btn.classList.contains('downloading')) {
      setResourceButtonReady(btn);
      const key = getResourceDownloadButtonKey(accountId, filename);
      pendingResourceDownloadButtons.delete(key);
      resourceDownloadStateByKey.delete(key);
      setStatus('下载响应超时，请重试一次');
    }
  }, 60000);
  resourceDownloadRecoveryTimers.set(btn, timer);
}

function renderResources() {
  const visibleResources = state.resources.filter(shouldShowResourceByCaptureMode);
  resourceList.innerHTML = visibleResources.map((r) => {
    const isImage = r.type === 'image';
    const rawUrl = r.url || '';
    const isPending = !rawUrl && r.messageId;
    const sourceText = String(r.source || '').toLowerCase();
    const canFetchPending = isPending && (!sourceText || sourceText.includes('doubao') || sourceText === 'dom');

    let thumbHtml = '';
    if (isImage) {
      thumbHtml = `<img class="resource-thumb" src="${escapeHtml(r.thumbUrl || r.url)}" alt="" loading="lazy" decoding="async">`;
    } else if (r.thumbUrl) {
      thumbHtml = `<img class="resource-thumb video" src="${escapeHtml(r.thumbUrl)}" alt="" loading="lazy" decoding="async">`;
    } else {
      thumbHtml = `<div class="resource-thumb video"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>`;
    }

    let displayName = r.title || '';
    if (!isImage && sourceText.includes('dola') && !sourceText.includes('nowatermark') && !displayName) {
      displayName = '创作平台视频';
    }
    if (!displayName && isPending) displayName = `视频 (${(r.vid || '').slice(-8) || '待获取'})`;
    if (!displayName && rawUrl) {
      const lastSeg = rawUrl.split('/').pop()?.split('?')[0] || '';
      displayName = /^[a-f0-9]{16,}$/i.test(lastSeg) ? 'video.mp4' : (lastSeg || rawUrl.slice(0, 50));
    }
    if (!displayName) displayName = '未命名';
    if (displayName.length > 35) displayName = displayName.slice(0, 16) + '...' + displayName.slice(-16);

    const metaParts = [];
    if (r.width && r.height) metaParts.push(`${r.width}x${r.height}`);
    if (r.definition && r.definition !== 'unknown') metaParts.push(r.definition);
    if (isPending && !canFetchPending) metaParts.push('等待链接');
    const meta = metaParts.join(' · ');
    const downloadFilename = getResourceDownloadFilename(r);
    const downloadKey = getResourceDownloadButtonKey(r.accountId || '', downloadFilename);
    const downloadStatus = downloadKey ? resourceDownloadStateByKey.get(downloadKey) : '';
    const btnText = downloadStatus === 'downloading'
      ? '下载中'
      : downloadStatus === 'done'
        ? '再次下载'
        : (isPending ? (canFetchPending ? '下载' : '等待链接') : '下载');
    const btnClass = `resource-download${isPending ? ' pending' : ''}${downloadStatus === 'downloading' ? ' downloading' : ''}${downloadStatus === 'done' ? ' done' : ''}`;
    const btnDisabled = downloadStatus === 'downloading' ? ' disabled' : '';
    const btnAttrs = `class="${btnClass}"${btnDisabled} data-url="${escapeHtml(r.url || '')}" data-backup-url="${escapeHtml(r.backupUrl || '')}" data-messageid="${escapeHtml(r.messageId || '')}" data-nodeid="${escapeHtml(r.nodeId || '')}" data-accountid="${escapeHtml(r.accountId || '')}" data-vid="${escapeHtml(r.vid || '')}" data-source="${escapeHtml(r.source || '')}" data-filename="${escapeHtml(downloadFilename)}"`;

    return `
      <div class="resource-item ${isPending ? 'pending' : ''}">
        ${thumbHtml}
        <div class="resource-info">
          <span class="resource-type ${isImage ? 'image' : 'video'}">${isImage ? '图片' : '视频'}</span>
          <div class="resource-name" title="${escapeHtml(r.title || r.url || r.vid || r.messageId || '')}">${escapeHtml(displayName)}</div>
          ${meta ? `<div class="resource-meta">${meta}</div>` : ''}
        </div>
        <button ${btnAttrs}>${btnText}</button>
      </div>`;
  }).join('');

  resourceCount.textContent = state.captureMode === 'all'
    ? `共 ${state.resources.length} 项`
    : `${getCaptureModeLabel()} ${visibleResources.length} 项`;

  resourceList.querySelectorAll('.resource-download').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      const backupUrl = btn.dataset.backupUrl;
      const messageId = btn.dataset.messageid;
      const nodeId = btn.dataset.nodeid || '';
      const accountId = btn.dataset.accountid;
      const source = String(btn.dataset.source || '').toLowerCase();
      const filename = btn.dataset.filename || '';
      const account = state.accounts.find(item => item.id === accountId);
      const shouldUseDoubaoPlugin = account?.platform === 'doubao' && !!messageId;

      if (shouldUseDoubaoPlugin || (messageId && !url)) {
        const resource = visibleResources.find(r => r.messageId === messageId && r.accountId === accountId);
        const resourceSource = String(resource?.source || '').toLowerCase();
        const canFetch = shouldUseDoubaoPlugin || (resource && (!resourceSource || resourceSource.includes('doubao') || resourceSource === 'dom'));
        if (!canFetch) {
          alert('该平台的视频链接需要等待自动捕获，当前没有可手动获取的专用接口。');
          return;
        }
        const webview = document.querySelector(`webview[partition="persist:account_${accountId}"]`);
        if (!webview) {
          alert('未找到对应的 WebView，请先打开该账号');
          return;
        }
        setResourceButtonLoading(btn);
        rememberResourceDownloadButton(accountId, filename, btn);
        scheduleResourceButtonRecovery(accountId, filename, btn);
        const taskId = addDownloadTask({ filename: filename || getResourceDownloadFilename(resource), accountId, type: resource?.type || 'video' });
        try {
          await webview.executeJavaScript(`window.postMessage({ type: "startVideoDownloadByMessageId", messageId: ${JSON.stringify(messageId)}, nodeId: ${JSON.stringify(nodeId || resource?.nodeId || '')}, filename: ${JSON.stringify(filename)}, title: ${JSON.stringify(resource?.title || '')}, suppressAutoDownload: true, downloadAfterResolve: true }, "*");` + ';void 0;');
        } catch (e) {
          updateDownloadTask(taskId, { status: 'error', message: e.message || '下载失败' });
          alert(`下载失败: ${e.message}`);
          resetResourceDownloadButton(accountId, filename);
        }
        return;
      }

      if (!url) {
        alert('资源地址不可用');
        return;
      }
      setResourceButtonLoading(btn);
      rememberResourceDownloadButton(accountId, filename, btn);
      const currentResource = visibleResources.find(r =>
        r.accountId === accountId &&
        ((r.url && r.url === url) || (r.backupUrl && r.backupUrl === backupUrl) || (r.messageId && r.messageId === messageId))
      );
      const taskId = addDownloadTask({ filename: filename || getResourceDownloadFilename(currentResource), accountId, type: currentResource?.type || '' });
      try {
        if (url.startsWith('blob:')) {
          const blobFilename = filename || `创作平台_视频_${Date.now()}.mp4`;
          const webview = document.querySelector(`webview[partition="persist:account_${accountId}"]`);
          if (!webview) throw new Error('未找到对应的 WebView，请先打开该账号');
          scheduleResourceButtonRecovery(accountId, filename, btn);
          await webview.executeJavaScript(`window.postMessage({ type: "electronDownload", data: { url: ${JSON.stringify(url)}, filename: ${JSON.stringify(blobFilename)} } }, "*");` + ';void 0;');
          setStatus(`已发起 blob 视频保存: ${filename}`);
        } else if (isDolaVideoUrl(url) && !source.includes('nowatermark')) {
          downloadInWebview(accountId, url);
          setStatus('已交给页面下载，请稍等...');
          finishResourceDownloadButton(accountId, filename);
        } else if (account?.platform === 'doubao' && currentResource?.type === 'video' && !isConfirmedNoWatermarkVideoUrl(url)) {
          throw new Error('未获取到豆包无水印视频链接，已停止下载');
        } else {
          const result = await window.electronAPI.downloadResource({
            url,
            backupUrl,
            accountId,
            filename,
            source: resource?.source || '',
            confirmedNoWatermark: Boolean(resource?.confirmedNoWatermark)
          });
          if (!result?.ok) throw new Error(result?.message || result?.reason || '未知错误');
          updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : filename });
          setStatus(`已下载到: ${result.filePath || ''}`);
          finishResourceDownloadButton(accountId, filename);
        }
      } catch (e) {
        updateDownloadTask(taskId, { status: 'error', message: e.message || '下载失败' });
        alert(`下载失败: ${e.message}`);
        resetResourceDownloadButton(accountId, filename);
      }
    });
  });
}


// 批量下载图片
$('btnDownloadImages').addEventListener('click', async () => {
  const images = state.resources.filter(r => shouldShowResourceByCaptureMode(r) && r.type === 'image' && r.url);
  for (const img of images) {
    const filename = getResourceDownloadFilename(img);
    const taskId = addDownloadTask({ filename, accountId: img.accountId, type: 'image' });
    try {
      const result = await window.electronAPI.downloadResource({ url: img.url, accountId: img.accountId, filename });
      if (!result?.ok) throw new Error(result?.message || result?.reason || '下载失败');
      updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : filename });
    } catch (e) {
      updateDownloadTask(taskId, { status: 'error', message: e.message || '下载失败' });
    }
  }
  setStatus(`已下载 ${images.length} 个图片`);
});

// 批量下载视频
$('btnDownloadVideos').addEventListener('click', async () => {
  const videos = state.resources.filter(r => shouldShowResourceByCaptureMode(r) && r.type === 'video' && r.url);
  for (const v of videos) {
    if (isDolaVideoUrl(v.url)) {
      try {
        addDownloadTask({ filename: getResourceDownloadFilename(v), accountId: v.accountId, type: 'video' });
        downloadInWebview(v.accountId, v.url);
      } catch (e) {
        console.error('[resources] Dola webview download failed:', e);
      }
    } else {
      if (isDoubaoAccountId(v.accountId) && !isConfirmedNoWatermarkVideoUrl(v.url)) {
        addDownloadTask({
          filename: getResourceDownloadFilename(v),
          accountId: v.accountId,
          type: 'video',
          status: 'error',
          message: '未获取到豆包无水印视频链接，已停止下载'
        });
        continue;
      }
      const filename = getResourceDownloadFilename(v);
      const taskId = addDownloadTask({ filename, accountId: v.accountId, type: 'video' });
      try {
        const result = await window.electronAPI.downloadResource({
          url: v.url,
          backupUrl: v.backupUrl,
          accountId: v.accountId,
          filename,
          source: v.source || '',
          confirmedNoWatermark: Boolean(v.confirmedNoWatermark)
        });
        if (!result?.ok) throw new Error(result?.message || result?.reason || '下载失败');
        updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : filename });
      } catch (e) {
        updateDownloadTask(taskId, { status: 'error', message: e.message || '下载失败' });
      }
    }
  }
  setStatus(`已下载 ${videos.length} 个视频`);
});

// 清空资源
$('btnClearResources').addEventListener('click', async () => {
  await window.electronAPI.clearResources();
});

// ============= 诊断面板 =============
const diagOverlay = $('diagOverlay');
const diagContent = $('diagContent');

$('btnDiagnostics')?.addEventListener('click', showDiagnostics);
$('diagRefresh')?.addEventListener('click', showDiagnostics);
$('diagClose')?.addEventListener('click', () => diagOverlay.classList.add('hidden'));
$('diagClose2')?.addEventListener('click', () => diagOverlay.classList.add('hidden'));
diagOverlay?.addEventListener('click', (e) => {
  if (e.target === diagOverlay) diagOverlay.classList.add('hidden');
});

async function showDiagnostics() {
  if (!diagOverlay || !diagContent) return;
  diagOverlay.classList.remove('hidden');
  const mapData = await window.electronAPI.getWebviewMap().catch(() => ({}));
  const images = state.resources.filter(r => r.type === 'image').length;
  const videos = state.resources.filter(r => r.type === 'video').length;
  diagContent.innerHTML = `
    <section class="diag-section">
      <h4>账号</h4>
      <p>共 ${state.accounts.length} 个账号，已打开 ${state.openTabs.length} 个标签页。</p>
    </section>
    <section class="diag-section">
      <h4>资源</h4>
      <p>共 ${state.resources.length} 项，图片 ${images}，视频 ${videos}。</p>
    </section>
    <section class="diag-section">
      <h4>WebView 映射</h4>
      <pre class="diag-pre">${escapeHtml(JSON.stringify(mapData, null, 2))}</pre>
    </section>
  `;
}

// ============= 鍚姩 =============
document.addEventListener('DOMContentLoaded', init);
