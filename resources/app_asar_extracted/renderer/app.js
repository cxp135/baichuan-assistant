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
const projectCountGroup = $('projectCountGroup');
const inputProjectCount = $('inputProjectCount');
const inputName = $('inputName');
const inputGroup = $('inputGroup');
const inputRemark = $('inputRemark');
const inputCustomUrl = $('inputCustomUrl');
const customUrlGroup = $('customUrlGroup');
const namePreview = $('namePreview');
const btnRefreshPage = $('btnRefreshPage');
const btnOpenDownloadDir = $('btnOpenDownloadDir');
const btnChooseDownloadDir = $('btnChooseDownloadDir');
const btnDownloadLibrary = $('btnDownloadLibrary');
const btnLoginAssist = $('btnLoginAssist');
const btnAutoDialogue = $('btnAutoDialogue');
const btnAutoDialogueSend = $('btnAutoDialogueSend');
const btnCheckHumanVerification = $('btnCheckHumanVerification');
const btnJimengOriginal = $('btnJimengOriginal');
const btnDesktopShortcut = $('btnDesktopShortcut');
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

if (inputProjectCount) {
  inputProjectCount.innerHTML = Array.from({ length: 50 }, (_, index) => {
    const count = index + 1;
    return `<option value="${count}">${count} 个</option>`;
  }).join('');
  inputProjectCount.value = '1';
}
const toastLayer = $('toastLayer');

const resourceReportQueues = new Map();
const resourceReportTimers = new Map();
const knownVideoResourceKeys = new Set();
const generatedVideoNoticeKeys = new Set();
const pendingResourceDownloadButtons = new Map();
const resourceDownloadStateByKey = new Map();
const resourceDownloadRecoveryTimers = new WeakMap();
const batchResourceDownloadWaiters = new Map();
const RESOURCE_REPORT_DELAY_MS = 800;
const FALLBACK_COMPAT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.175 Safari/537.36';
let downloadLibraryRefreshTimer = null;
let downloadVideoObserver = null;
const AUTO_DIALOGUE_DRAFTS_PER_ACCOUNT = 3;
const AUTO_DIALOGUE_POLL_MS = 2200;
const AUTO_DIALOGUE_PROJECT_SWITCH_DELAY_MS = 1000;
const AUTO_DIALOGUE_SETTINGS_VERSION = 'send-v6';
const AUTO_DIALOGUE_SAVED_SETTINGS_READY = localStorage.getItem('aiamAutoDialogueSettingsVersion') === AUTO_DIALOGUE_SETTINGS_VERSION;
// 组合空间超过 1000 种，并在一次自动运行中避免重复草稿。
const AUTO_DIALOGUE_TOPICS = [
  '今天适合发布的内容方向',
  '这个项目的下一步计划',
  '适合短视频的创意切入点',
  '一段真实自然的日常分享',
  '新手容易理解的操作方法',
  '用户最可能关心的核心问题',
  '适合图片或视频配套的说明',
  '一个可以持续更新的内容系列',
  '当前主题的实用案例',
  '让内容更有层次的表达方式',
  '适合今天完成的小任务',
  '一个值得继续展开的观点',
  '项目中可以优化的细节',
  '能引起自然交流的提问方式',
  '简洁但有记忆点的内容标题',
  '从用户体验出发的改进方向',
  '适合不同平台发布的内容变化',
  '一个低成本、容易执行的尝试'
];
const AUTO_DIALOGUE_OPENERS = [
  '请围绕“{topic}”，',
  '以“{topic}”为核心，',
  '从“{topic}”这个方向出发，',
  '假设我要做“{topic}”，',
  '针对“{topic}”，',
  '把“{topic}”作为今天的重点，',
  '如果要继续完善“{topic}”，',
  '请站在用户角度思考“{topic}”，',
  '我正在准备“{topic}”，',
  '围绕项目“{account}”里的“{topic}”，'
];
const AUTO_DIALOGUE_ACTIONS = [
  '帮我给出三个可以马上执行的思路',
  '帮我写一段自然的开场表达',
  '帮我设计一个简单的执行步骤',
  '帮我整理成适合继续追问的问题',
  '帮我列出三个容易忽略的要点',
  '帮我改成更像真实聊天的说法',
  '帮我提供一个简短但具体的示例',
  '帮我比较两种不同做法的优缺点',
  '帮我规划一个从今天开始的小任务',
  '帮我补充几个用户可能会关心的问题',
  '帮我提炼出一句容易理解的核心表达',
  '帮我想一个温和、不过度营销的版本'
];
const AUTO_DIALOGUE_STYLES = [
  '，语气自然、清楚，不要使用夸张表达',
  '，像和同事讨论一样，简洁一点',
  '，适合直接拿来继续对话，避免空话',
  '，尽量口语化，但保留重点',
  '，先给结论，再补充必要说明',
  '，控制在一百字以内，内容具体',
  '，给出不同角度，不要只换几个同义词',
  '，让新手也能看懂并照着做',
  '，语气轻松一些，但不要太随意',
  '，避免营销腔，听起来像真实交流'
];
const AUTO_DIALOGUE_OUTPUTS = [
  '。',
  '，并给出一个可直接使用的例句。',
  '，最后补一句下一步建议。',
  '，请同时标出最推荐的一种。',
  '，每一点都配一个简短说明。',
  '，如果有前提条件请一并说清楚。',
  '，优先考虑低成本、容易执行的方案。',
  '，把结果分成“建议”和“示例”两部分。'
];
const autoDialogue = {
  enabled: false,
  mode: 'random',
  customText: localStorage.getItem('aiamAutoDialogueCustomText') || '',
  randomCount: Math.max(1, Math.min(50, Number(localStorage.getItem('aiamAutoDialogueRandomCount')) || 3)),
  customCount: Math.max(1, Math.min(50, Number(localStorage.getItem('aiamAutoDialogueCustomCount')) || 5)),
  publishMode: localStorage.getItem('aiamAutoDialoguePublishMode') === 'batch' ? 'batch' : 'sequential',
  batchSize: Math.max(1, Math.min(50, Number(localStorage.getItem('aiamAutoDialogueBatchSize')) || 3)),
  sendEnabled: AUTO_DIALOGUE_SAVED_SETTINGS_READY
    ? localStorage.getItem('aiamAutoDialogueSendEnabled') === '1'
    : false,
  sendScope: localStorage.getItem('aiamAutoDialogueSendScope') === 'all-open' ? 'all-open' : 'current',
  // 图片只属于自定义对话，随机生成模式不会读取或上传这些图片。
  customImages: [],
  imagesUploadedByAccount: new Set(),
  running: false,
  queue: [],
  accountIndex: 0,
  draftIndex: 0,
  waitingText: '',
  waitingAccountId: '',
  waitingSendClicked: false,
  timer: null,
  generatedDrafts: new Set(),
  batchRun: false
};
const HUMAN_VERIFICATION_MESSAGE = '别弹出人机验证可以吗。';
const HUMAN_VERIFICATION_POST_SEND_WAIT_MS = 8000;
const HUMAN_VERIFICATION_POLL_MS = 350;
const HUMAN_VERIFICATION_SEND_SWITCH_DELAY_MS = 180;
const HUMAN_VERIFICATION_RESOLUTION_POLL_MS = 1200;
const HUMAN_VERIFICATION_RESOLUTION_STABLE_PROBES = 2;
const humanVerification = {
  enabled: false,
  running: false,
  monitoring: false,
  token: 0,
  previousActiveId: null,
  statusByAccount: new Map(),
  resolutionProbes: new Map()
};

// ============= 窗口控制 =============
$('btnMinimize')?.addEventListener('click', () => window.electronAPI.minimize());
$('btnMaximize')?.addEventListener('click', () => window.electronAPI.maximize());
$('btnClose')?.addEventListener('click', () => window.electronAPI.close());

btnDesktopShortcut?.addEventListener('click', async () => {
  btnDesktopShortcut.disabled = true;
  try {
    const result = await window.electronAPI.createDesktopShortcut();
    if (result?.ok) {
      setStatus('桌面快捷图标已创建');
      showDownloadToast('桌面快捷图标已创建，可从桌面启动软件', 'success');
    } else {
      const message = result?.message || '桌面快捷图标创建失败';
      setStatus(message);
      alert(message);
    }
  } catch (error) {
    const message = error?.message || '桌面快捷图标创建失败';
    setStatus(message);
    alert(message);
  } finally {
    btnDesktopShortcut.disabled = false;
  }
});

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

btnChooseDownloadDir?.addEventListener('click', () => chooseDownloadDir(btnChooseDownloadDir));

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
    stopAutoDialogue('自动对话已关闭');
    return;
  }
  openAutoDialogueConfig();
});

btnAutoDialogueSend?.addEventListener('click', () => {
  autoDialogue.sendEnabled = !autoDialogue.sendEnabled;
  persistAutoDialogueSendSettings();
  updateAutoDialogueButton();
  setStatus(autoDialogue.sendEnabled ? '对话自动发送已启动' : '对话自动发送已停止');
});

btnCheckHumanVerification?.addEventListener('click', () => {
  if (humanVerification.enabled) {
    stopHumanVerificationCheck('检查人机验证已关闭');
    return;
  }
  if (autoDialogue.enabled || autoDialogue.running) {
    setStatus('请先关闭自动对话，再检查人机验证');
    return;
  }
  openHumanVerificationConfig();
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

function getOpenedAutoDialogueAccounts() {
  const seenAccountIds = new Set();
  return state.openTabs
    .map(tab => state.accounts.find(account => account.id === tab.accountId))
    .filter(account => {
      if (!isDoubaoDialogueAccount(account) || seenAccountIds.has(account.id)) return false;
      seenAccountIds.add(account.id);
      return true;
    });
}

let autoDialogueEditor = null;

function closeAutoDialogueEditor() {
  autoDialogueEditor?.remove();
  autoDialogueEditor = null;
}

function persistAutoDialogueSendSettings() {
  localStorage.setItem('aiamAutoDialogueSendEnabled', autoDialogue.sendEnabled ? '1' : '0');
  localStorage.setItem('aiamAutoDialogueSendScope', autoDialogue.sendScope);
  localStorage.setItem('aiamAutoDialogueSettingsVersion', AUTO_DIALOGUE_SETTINGS_VERSION);
}

function readAutoDialogueImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name || `image-${Date.now()}.png`,
      type: file.type || 'image/png',
      size: Number(file.size || 0),
      dataUrl: String(reader.result || '')
    });
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function addAutoDialogueImages(files, render) {
  const imageFiles = Array.from(files || []).filter(file => {
    const name = String(file.name || '').toLowerCase();
    return String(file.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
  });
  if (!imageFiles.length) {
    setStatus('请选择图片文件');
    return;
  }
  try {
    const images = await Promise.all(imageFiles.map(readAutoDialogueImage));
    autoDialogue.customImages = [...autoDialogue.customImages, ...images];
    render?.();
    setStatus(`已添加 ${images.length} 张图片`);
  } catch (error) {
    setStatus(`读取图片失败: ${error.message || '未知错误'}`);
  }
}

function openAutoDialogueConfig() {
  closeAutoDialogueEditor();
  const overlay = document.createElement('div');
  overlay.className = 'auto-dialogue-editor-overlay';
  const modeName = `autoDialogueMode-${Date.now()}`;
  const publishName = `autoDialoguePublish-${Date.now()}`;
  overlay.innerHTML = `
    <div class="auto-dialogue-editor auto-dialogue-config" role="dialog" aria-modal="true" aria-label="自动对话设置">
      <div class="auto-dialogue-editor-header">
        <div>
          <div class="auto-dialogue-editor-kicker">自动对话</div>
          <h3>选择发布方式</h3>
        </div>
        <button type="button" class="auto-dialogue-editor-close" aria-label="关闭">×</button>
      </div>
      <div class="auto-dialogue-editor-body">
        <section class="auto-dialogue-config-section">
          <div class="auto-dialogue-config-label">1. 对话内容</div>
          <div class="auto-dialogue-choice-row">
            <label class="auto-dialogue-choice"><input type="radio" name="${modeName}" value="random"><span>随机生成对话内容</span></label>
            <label class="auto-dialogue-choice"><input type="radio" name="${modeName}" value="custom"><span>自定义对话内容</span></label>
          </div>
          <div class="auto-dialogue-random-note">用于养号，不生成视频。</div>
          <div class="auto-dialogue-custom-settings">
            <textarea class="auto-dialogue-editor-input" rows="4" placeholder="输入要发送到各个项目的文字内容"></textarea>
            <div class="auto-dialogue-editor-note">内容会保存在本机，下次可以继续修改和重复使用。</div>
            <div class="auto-dialogue-image-upload">
              <div class="auto-dialogue-image-drop" tabindex="0">
                <strong>添加图片</strong>
                <span>可从桌面拖入，也可以选择文件</span>
                <input class="auto-dialogue-image-input" type="file" accept="image/*" multiple>
              </div>
              <div class="auto-dialogue-image-list"></div>
            </div>
          </div>
        </section>
        <section class="auto-dialogue-config-section">
          <div class="auto-dialogue-config-label">2. 发送次数</div>
          <label class="auto-dialogue-count-single">
            <span class="auto-dialogue-count-mode-label">随机生成对话内容</span>
            <input class="auto-dialogue-count-value" type="number" min="1" max="50" step="1">
          </label>
        </section>
        <section class="auto-dialogue-config-section">
          <div class="auto-dialogue-config-label">3. 发布方式</div>
          <div class="auto-dialogue-choice-row auto-dialogue-publish-row">
            <label class="auto-dialogue-choice"><input type="radio" name="${publishName}" value="sequential"><span>逐个发布</span><small>完成一个项目后继续下一个</small></label>
            <label class="auto-dialogue-choice"><input type="radio" name="${publishName}" value="batch"><span>批量发布</span><small>多个项目按轮次依次发送</small></label>
          </div>
          <label class="auto-dialogue-batch-settings">轮询发送项目数
            <select class="auto-dialogue-batch-size"></select>
          </label>
          <div class="auto-dialogue-batch-hint">操作多个项目时，请先批量打开项目，同时确认对话框里面没有内容，否则容易发送失败。</div>
          <div class="auto-dialogue-batch-hint">特别强调：一定要将项目打开的页面，打开为你开始的第一个项目的页面。</div>
        </section>
        <section class="auto-dialogue-config-section">
          <div class="auto-dialogue-config-label">4. 对话自动发送</div>
          <div class="auto-dialogue-send-fixed"><span>填入内容后自动点击发送</span><strong>已固定开启</strong></div>
          <label class="auto-dialogue-send-scope-setting">发送范围
            <select class="auto-dialogue-send-scope">
              <option value="current">当前项目逐个发送</option>
              <option value="all-open">批量项目轮询发送</option>
            </select>
          </label>
        </section>
      </div>
      <div class="auto-dialogue-editor-footer">
        <button type="button" class="auto-dialogue-editor-cancel">取消</button>
        ${autoDialogue.enabled ? '<button type="button" class="auto-dialogue-editor-stop">停止运行</button>' : ''}
        <button type="button" class="auto-dialogue-editor-save">保存并开始</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  autoDialogueEditor = overlay;
  const input = overlay.querySelector('.auto-dialogue-editor-input');
  const countValue = overlay.querySelector('.auto-dialogue-count-value');
  const countModeLabel = overlay.querySelector('.auto-dialogue-count-mode-label');
  const batchSize = overlay.querySelector('.auto-dialogue-batch-size');
  const imageInput = overlay.querySelector('.auto-dialogue-image-input');
  const imageDrop = overlay.querySelector('.auto-dialogue-image-drop');
  const imageList = overlay.querySelector('.auto-dialogue-image-list');
  const sendScopeSelect = overlay.querySelector('.auto-dialogue-send-scope');
  const customSettings = overlay.querySelector('.auto-dialogue-custom-settings');
  const randomNote = overlay.querySelector('.auto-dialogue-random-note');
  const batchSettings = overlay.querySelector('.auto-dialogue-batch-settings');
  const batchHint = overlay.querySelector('.auto-dialogue-batch-hint');
  const modeInputs = Array.from(overlay.querySelectorAll(`input[name="${modeName}"]`));
  const publishInputs = Array.from(overlay.querySelectorAll(`input[name="${publishName}"]`));
  let editingMode = autoDialogue.mode === 'custom' ? 'custom' : 'random';
  input.value = autoDialogue.customText || '';
  countValue.value = String(editingMode === 'custom' ? autoDialogue.customCount : autoDialogue.randomCount);
  batchSize.innerHTML = Array.from({ length: 50 }, (_, index) => `<option value="${index + 1}">${index + 1} 个项目</option>`).join('');
  batchSize.value = String(autoDialogue.batchSize || 3);
  sendScopeSelect.value = autoDialogue.sendScope || 'current';
  modeInputs.find(item => item.value === autoDialogue.mode)?.click();
  publishInputs.find(item => item.value === autoDialogue.publishMode)?.click();

  const renderImages = () => {
    imageList.innerHTML = autoDialogue.customImages.map((image, index) => `
      <div class="auto-dialogue-image-chip">
        <img src="${escapeHtml(image.dataUrl)}" alt="">
        <span title="${escapeHtml(image.name)}">${escapeHtml(image.name)}</span>
        <button type="button" data-remove-image="${index}" aria-label="移除图片">×</button>
      </div>
    `).join('');
    imageList.querySelectorAll('[data-remove-image]').forEach(button => {
      button.addEventListener('click', () => {
        autoDialogue.customImages.splice(Number(button.dataset.removeImage), 1);
        renderImages();
      });
    });
  };
  const updateMode = (selectedMode = modeInputs.find(item => item.checked)?.value || 'random') => {
    const mode = selectedMode === 'custom' ? 'custom' : 'random';
    if (mode !== editingMode) {
      const currentCount = Math.max(1, Math.min(50, Number(countValue.value) || (editingMode === 'custom' ? 5 : 3)));
      if (editingMode === 'custom') autoDialogue.customCount = currentCount;
      else autoDialogue.randomCount = currentCount;
      editingMode = mode;
    }
    const customMode = mode === 'custom';
    customSettings.classList.toggle('hidden', !customMode);
    randomNote.classList.toggle('hidden', customMode);
    countModeLabel.textContent = customMode ? '自定义对话内容' : '随机生成对话内容';
    countValue.value = String(customMode ? autoDialogue.customCount : autoDialogue.randomCount);
  };
  const updatePublishMode = () => {
    const mode = publishInputs.find(item => item.checked)?.value || 'sequential';
    const batchMode = mode === 'batch';
    batchSettings.classList.toggle('hidden', !batchMode);
    batchHint.classList.toggle('hidden', !batchMode);
    if (batchMode) sendScopeSelect.value = 'all-open';
  };
  modeInputs.forEach(item => item.addEventListener('change', () => updateMode(item.value)));
  publishInputs.forEach(item => item.addEventListener('change', updatePublishMode));
  imageInput?.addEventListener('change', async () => {
    await addAutoDialogueImages(imageInput.files, renderImages);
    imageInput.value = '';
  });
  imageDrop?.addEventListener('click', () => imageInput?.click());
  imageDrop?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') imageInput?.click();
  });
  imageDrop?.addEventListener('dragenter', event => {
    event.preventDefault();
    imageDrop.classList.add('is-dragging');
  });
  imageDrop?.addEventListener('dragover', event => event.preventDefault());
  imageDrop?.addEventListener('dragleave', () => imageDrop.classList.remove('is-dragging'));
  imageDrop?.addEventListener('drop', async event => {
    event.preventDefault();
    imageDrop.classList.remove('is-dragging');
    await addAutoDialogueImages(event.dataTransfer?.files, renderImages);
  });
  overlay.querySelector('.auto-dialogue-editor-close')?.addEventListener('click', closeAutoDialogueEditor);
  overlay.querySelector('.auto-dialogue-editor-cancel')?.addEventListener('click', closeAutoDialogueEditor);
  overlay.querySelector('.auto-dialogue-editor-stop')?.addEventListener('click', () => {
    stopAutoDialogue('自动对话已停止');
    closeAutoDialogueEditor();
  });
  overlay.addEventListener('pointerdown', event => {
    if (event.target === overlay) closeAutoDialogueEditor();
  });
  overlay.querySelector('.auto-dialogue-editor-save')?.addEventListener('click', () => {
    const mode = modeInputs.find(item => item.checked)?.value || 'random';
    const text = String(input.value || '').trim();
    if (mode === 'custom' && !text) {
      input.focus();
      setStatus('请先输入自定义对话内容');
      return;
    }
    autoDialogue.customText = text;
    localStorage.setItem('aiamAutoDialogueCustomText', text);
    const selectedCount = Math.max(1, Math.min(50, Number(countValue.value) || (mode === 'custom' ? 5 : 3)));
    if (mode === 'custom') autoDialogue.customCount = selectedCount;
    else autoDialogue.randomCount = selectedCount;
    autoDialogue.publishMode = publishInputs.find(item => item.checked)?.value === 'batch' ? 'batch' : 'sequential';
    autoDialogue.batchSize = Math.max(1, Math.min(50, Number(batchSize.value) || 3));
    autoDialogue.sendScope = autoDialogue.publishMode === 'batch'
      ? 'all-open'
      : (sendScopeSelect.value === 'all-open' ? 'all-open' : 'current');
    localStorage.setItem('aiamAutoDialogueRandomCount', String(autoDialogue.randomCount));
    localStorage.setItem('aiamAutoDialogueCustomCount', String(autoDialogue.customCount));
    localStorage.setItem('aiamAutoDialoguePublishMode', autoDialogue.publishMode);
    localStorage.setItem('aiamAutoDialogueBatchSize', String(autoDialogue.batchSize));
    persistAutoDialogueSendSettings();
    closeAutoDialogueEditor();
    startAutoDialogue(mode);
  });
  renderImages();
  updateMode();
  updatePublishMode();
  requestAnimationFrame(() => (mode === 'custom' ? input : countValue)?.focus());
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeAutoDialogueEditor();
  }
});

function updateAutoDialogueButton() {
  const hasDoubaoAccount = state.accounts.some(isDoubaoDialogueAccount);
  if (btnAutoDialogue) {
    btnAutoDialogue.classList.toggle('hidden', !hasDoubaoAccount);
    btnAutoDialogue.classList.toggle('is-active', autoDialogue.enabled);
    btnAutoDialogue.classList.toggle('is-working', autoDialogue.running);
    btnAutoDialogue.textContent = '自动对话';
    btnAutoDialogue.title = autoDialogue.enabled
      ? `正在运行：${autoDialogue.batchRun || autoDialogue.publishMode === 'batch' ? '批量发布' : '逐个发布'}，点击可查看设置`
      : '打开自动对话设置，选择内容、次数和发布方式';
  }
  if (btnAutoDialogueSend) {
    btnAutoDialogueSend.classList.toggle('hidden', !hasDoubaoAccount);
    btnAutoDialogueSend.classList.toggle('is-active', autoDialogue.sendEnabled);
    btnAutoDialogueSend.classList.toggle('is-working', autoDialogue.running && autoDialogue.sendEnabled);
    btnAutoDialogueSend.textContent = '对话自动发送';
    btnAutoDialogueSend.title = autoDialogue.sendEnabled
      ? `对话自动发送已开启：${autoDialogue.sendScope === 'all-open' ? '批量项目轮询发送' : '当前项目逐个发送'}`
      : '对话自动发送未启动，点击启动；发送范围在自动对话中设置';
  }
  if (btnCheckHumanVerification) {
    // 人机验证检查统一从“批量打开”菜单进入。
    btnCheckHumanVerification.classList.add('hidden');
    btnCheckHumanVerification.classList.toggle('is-active', humanVerification.enabled);
    btnCheckHumanVerification.classList.toggle('is-working', humanVerification.running);
    btnCheckHumanVerification.textContent = '检查人机验证';
    btnCheckHumanVerification.title = humanVerification.enabled
      ? (humanVerification.running
        ? '正在检查人机验证，点击可停止'
        : humanVerification.monitoring
          ? '正在等待已标红项目通过验证，点击可停止'
          : '检查已完成，点击关闭并恢复项目颜色')
      : '向选定项目发送“别弹出人机验证可以吗。”并检查结果';
  }
  if (btnOpenFilteredAccounts) {
    btnOpenFilteredAccounts.classList.toggle('human-verification-active', humanVerification.enabled);
    btnOpenFilteredAccounts.title = humanVerification.enabled
      ? '人机验证检查已开启，点击关闭并恢复项目颜色'
      : '批量打开项目，可选择是否开启人机验证检查';
  }
}

function getAutoDialogueDraftCount() {
  return autoDialogue.mode === 'custom'
    ? Math.max(1, Math.min(50, Number(autoDialogue.customCount) || 5))
    : Math.max(1, Math.min(50, Number(autoDialogue.randomCount) || AUTO_DIALOGUE_DRAFTS_PER_ACCOUNT));
}

function shouldRunAutoDialogueBatch() {
  return autoDialogue.publishMode === 'batch'
    || autoDialogue.sendScope === 'all-open';
}

function startAutoDialogue(mode = 'random') {
  const nextMode = mode === 'custom' ? 'custom' : 'random';
  if (nextMode === 'custom' && !String(autoDialogue.customText || '').trim()) {
    openAutoDialogueConfig();
    return;
  }
  if (autoDialogue.enabled) stopAutoDialogue('正在重新开始自动对话');
  const available = getAutoDialogueAccounts();
  const activeIndex = available.findIndex(account => account.id === state.activeTabId || account.id === state.activeAccountId);
  const ordered = activeIndex > 0
    ? [...available.slice(activeIndex), ...available.slice(0, activeIndex)]
    : available;
  const openedAccounts = getOpenedAutoDialogueAccounts();
  const batchRun = shouldRunAutoDialogueBatch();
  if (batchRun && !openedAccounts.length) {
    setStatus('批量发布需要先打开项目，请先批量打开要发布的豆包项目');
    return;
  }
  const requestedBatchSize = Math.max(1, Math.min(50, Number(autoDialogue.batchSize) || 3));
  if (batchRun && openedAccounts.length < requestedBatchSize) {
    setStatus(`批量发布需要 ${requestedBatchSize} 个已打开项目，目前只有 ${openedAccounts.length} 个，请先批量打开足够项目`);
    return;
  }
  const queue = batchRun
    ? openedAccounts.slice(0, requestedBatchSize)
    : ordered;
  if (!queue.length) {
    setStatus('请先选择或添加豆包项目，再开启自动对话');
    return;
  }

  // 自动对话的第 4 项是固定开启，启动时同步打开自动点击发送。
  autoDialogue.sendEnabled = true;
  persistAutoDialogueSendSettings();
  autoDialogue.mode = nextMode;
  autoDialogue.enabled = true;
  autoDialogue.running = false;
  autoDialogue.queue = queue;
  autoDialogue.batchRun = batchRun;
  autoDialogue.accountIndex = 0;
  autoDialogue.draftIndex = 0;
  autoDialogue.waitingText = '';
  autoDialogue.waitingAccountId = '';
  autoDialogue.waitingSendClicked = false;
  autoDialogue.imagesUploadedByAccount = new Set();
  autoDialogue.generatedDrafts.clear();
  clearTimeout(autoDialogue.timer);
  updateAutoDialogueButton();
  setStatus(`自动对话已开启，将${batchRun ? `按项目轮询发送 ${queue.length} 个项目` : `逐个发布 ${queue.length} 个项目`}...`);
  runAutoDialogue();
}

function stopAutoDialogue(message = '自动对话已停止') {
  autoDialogue.enabled = false;
  autoDialogue.sendEnabled = false;
  persistAutoDialogueSendSettings();
  autoDialogue.running = false;
  autoDialogue.queue = [];
  autoDialogue.batchRun = false;
  autoDialogue.accountIndex = 0;
  autoDialogue.draftIndex = 0;
  autoDialogue.waitingText = '';
  autoDialogue.waitingAccountId = '';
  autoDialogue.waitingSendClicked = false;
  autoDialogue.imagesUploadedByAccount = new Set();
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

function getHumanVerificationAccounts(scope = 'current', count = null) {
  let accounts = [];
  if (scope === 'current') {
    const account = state.accounts.find(item => item.id === state.activeTabId) ||
      state.accounts.find(item => item.id === state.activeAccountId);
    accounts = account && isDoubaoDialogueAccount(account) ? [account] : [];
  } else if (scope === 'opened') {
    accounts = getOpenedAutoDialogueAccounts();
  } else if (scope === 'visible') {
    accounts = getAutoDialogueAccounts();
  } else {
    accounts = state.accounts.filter(isDoubaoDialogueAccount);
  }
  if (scope === 'current' || count === null || count === undefined) return accounts;
  return accounts.slice(0, Math.max(1, Math.min(accounts.length, Number(count) || 1)));
}

function openHumanVerificationConfig() {
  closeAutoDialogueEditor();
  const overlay = document.createElement('div');
  overlay.className = 'auto-dialogue-editor-overlay human-verification-overlay';
  overlay.innerHTML = `
    <div class="auto-dialogue-editor human-verification-editor" role="dialog" aria-modal="true" aria-label="检查人机验证设置">
      <div class="auto-dialogue-editor-header">
        <div>
          <div class="auto-dialogue-editor-kicker">项目检查</div>
          <h3>检查人机验证</h3>
        </div>
        <button type="button" class="auto-dialogue-editor-close" aria-label="关闭">×</button>
      </div>
      <div class="auto-dialogue-editor-body">
        <section class="auto-dialogue-config-section">
          <div class="auto-dialogue-config-label">检查内容</div>
          <div class="human-verification-message">${HUMAN_VERIFICATION_MESSAGE}</div>
          <div class="auto-dialogue-editor-note">会向选定的豆包项目逐个发送这句话，并根据页面结果标记颜色。</div>
        </section>
        <section class="auto-dialogue-config-section">
          <div class="auto-dialogue-config-label">项目范围</div>
          <label class="human-verification-setting">
            <span>选择项目</span>
            <select class="human-verification-scope">
              <option value="current">当前项目</option>
              <option value="opened">已打开项目</option>
              <option value="visible">当前筛选项目</option>
              <option value="all">全部豆包项目</option>
            </select>
          </label>
          <label class="human-verification-setting human-verification-count-setting">
            <span>检查数量</span>
            <input class="human-verification-count" type="number" min="1" step="1" value="1">
          </label>
          <div class="auto-dialogue-editor-note human-verification-availability"></div>
        </section>
      </div>
      <div class="auto-dialogue-editor-footer">
        <button type="button" class="auto-dialogue-editor-cancel">取消</button>
        <button type="button" class="auto-dialogue-editor-save human-verification-start">开始检查</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const scopeSelect = overlay.querySelector('.human-verification-scope');
  const countInput = overlay.querySelector('.human-verification-count');
  const countSetting = overlay.querySelector('.human-verification-count-setting');
  const availability = overlay.querySelector('.human-verification-availability');
  const savedScope = localStorage.getItem('aiamHumanVerificationScope') || 'current';
  const savedCount = Math.max(1, Number(localStorage.getItem('aiamHumanVerificationCount')) || 1);
  scopeSelect.value = ['current', 'opened', 'visible', 'all'].includes(savedScope) ? savedScope : 'current';

  const updateScope = () => {
    const scope = scopeSelect.value || 'current';
    const available = getHumanVerificationAccounts(scope, null).length;
    const isFixed = scope === 'current' || scope === 'all';
    countSetting.classList.toggle('hidden', isFixed);
    countInput.disabled = isFixed;
    countInput.max = String(Math.max(1, available));
    countInput.value = String(scope === 'current' ? 1 : Math.min(savedCount, Math.max(1, available)));
    availability.textContent = scope === 'current'
      ? `${available ? '当前项目可检查' : '请先打开一个豆包项目'}`
      : scope === 'all'
        ? `共 ${available} 个豆包项目`
        : `当前范围共有 ${available} 个项目`;
  };
  scopeSelect.addEventListener('change', updateScope);
  overlay.querySelector('.auto-dialogue-editor-close')?.addEventListener('click', () => overlay.remove());
  overlay.querySelector('.auto-dialogue-editor-cancel')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('pointerdown', event => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector('.human-verification-start')?.addEventListener('click', () => {
    const scope = scopeSelect.value || 'current';
    const available = getHumanVerificationAccounts(scope, null).length;
    if (!available) {
      setStatus('当前范围没有可检查的豆包项目');
      return;
    }
    const count = scope === 'current' || scope === 'all'
      ? null
      : Math.max(1, Math.min(available, Number(countInput.value) || 1));
    const accounts = getHumanVerificationAccounts(scope, count);
    if (!accounts.length) {
      setStatus('没有选中的豆包项目');
      return;
    }
    localStorage.setItem('aiamHumanVerificationScope', scope);
    localStorage.setItem('aiamHumanVerificationCount', String(count || accounts.length));
    overlay.remove();
    startHumanVerificationCheck(accounts);
  });
  updateScope();
}

async function detectHumanVerification(webview) {
  if (!webview) return false;
  const url = getWebviewUrl(webview);
  if (/(captcha|hcaptcha|recaptcha|challenge|verify[-_]?human)/i.test(url)) return true;
  try {
    const result = await webview.executeJavaScript(`
      (() => {
        const visible = node => {
          if (!node || typeof node.getBoundingClientRect !== 'function') return false;
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
            style.visibility !== 'hidden' && Number(style.opacity || '1') > 0.05;
        };
        const textOf = node => [
          node?.innerText,
          node?.textContent,
          node?.getAttribute?.('aria-label'),
          node?.getAttribute?.('title'),
          node?.getAttribute?.('src'),
          node?.getAttribute?.('class'),
          node?.getAttribute?.('id')
        ]
          .filter(Boolean).join(' ');
        const roots = [];
        const collectRoot = root => {
          if (!root || roots.includes(root)) return;
          roots.push(root);
          for (const node of root.querySelectorAll?.('*') || []) {
            if (node.shadowRoot) collectRoot(node.shadowRoot);
          }
        };
        collectRoot(document);
        const nodes = roots.flatMap(root => Array.from(root.querySelectorAll(
          '[role="dialog"], [class*="captcha" i], [id*="captcha" i], [class*="verify" i], [id*="verify" i], iframe, canvas'
        ))).filter(visible).slice(0, 80);
        const frameNodes = roots.flatMap(root => Array.from(root.querySelectorAll('iframe'))).filter(visible);
        const frameText = frameNodes.map(node => [
          node.getAttribute('src'),
          node.getAttribute('title'),
          node.getAttribute('name'),
          node.getAttribute('class'),
          node.getAttribute('id')
        ].filter(Boolean).join(' ')).join(' ');
        const frameChallenge = frameNodes.some(node => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          const zIndex = Number.parseInt(style.zIndex, 10);
          const source = [
            node.getAttribute('src'),
            node.getAttribute('title'),
            node.getAttribute('name'),
            node.getAttribute('class'),
            node.getAttribute('id')
          ].filter(Boolean).join(' ');
          const vendorSignal = /captcha|verify|verification|challenge|security|risk|human/i.test(source);
          const overlaySignal = rect.width >= 280 && rect.height >= 260 &&
            (style.position === 'fixed' || style.position === 'absolute' || zIndex >= 100);
          return vendorSignal || overlaySignal;
        });
        const shadowText = roots.map(root => root.innerText || root.textContent || '').join(' ');
        const bodyText = String(document.body?.innerText || '')
          .replace(/别\s*弹出\s*人机验证\s*可以吗[。.!！]?/g, '');
        const nodeText = nodes.map(textOf).join(' ');
        const pageText = [document.title, location.href, bodyText, shadowText, nodeText, frameText].join(' ');
        const strongCaptcha = /需要电力驱动的东西|请选择所有符合(?:上文描述)?(?:的)?图片|拖拽到(?:下方|这里)|常见的音乐乐器|captcha|hcaptcha|recaptcha|verify you are human|security check/i.test(pageText);
        const dialogCaptcha = /人机验证|滑块验证|安全验证|请完成验证|请先完成验证|验证码|captcha|hcaptcha|recaptcha/i.test(nodeText);
        const captcha = strongCaptcha || dialogCaptcha || frameChallenge;
        return { captcha, frameChallenge, frameText };
      })()
    `);
    return Boolean(result?.captcha);
  } catch (error) {
    return false;
  }
}

async function waitForHumanVerificationAfterSend(webview, token, timeoutMs = HUMAN_VERIFICATION_POST_SEND_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (humanVerification.enabled && humanVerification.token === token && Date.now() < deadline) {
    if (await detectHumanVerification(webview)) return true;
    await delay(HUMAN_VERIFICATION_POLL_MS);
  }
  return false;
}

async function waitForHumanVerificationInput(webview, account, token) {
  const startedAt = Date.now();
  while (humanVerification.enabled && humanVerification.token === token && Date.now() - startedAt < 18000) {
    if (await detectHumanVerification(webview)) return { captcha: true };
    const inputState = await getAutoDialogueInputState(webview, '');
    if (inputState?.ok && !inputState.hasAnyText) return { ok: true };
    if (!inputState?.ok) setStatus(`${getAccountDisplayName(account)} 正在等待对话输入框加载`);
    else setStatus(`${getAccountDisplayName(account)} 输入框已有内容，请等待清空后检查`);
    await delay(500);
  }
  return { ok: false, message: `${getAccountDisplayName(account)} 对话输入框未准备好` };
}

async function prepareHumanVerificationMessage(account, tab, token) {
  if (!tab?.webview) return { ok: false, message: '未找到项目窗口' };
  if (await detectHumanVerification(tab.webview)) return { captcha: true };
  const ready = await waitForHumanVerificationInput(tab.webview, account, token);
  if (ready.captcha) return ready;
  if (!ready.ok) return ready;
  const filled = await fillAutoDialogueDraft(tab.webview, HUMAN_VERIFICATION_MESSAGE);
  if (!filled?.ok) return { ok: false, message: filled?.message || '未找到对话输入框' };
  return { prepared: true };
}

async function sendPreparedHumanVerificationMessage(account, tab) {
  if (!tab?.webview) return { ok: false, message: '未找到项目窗口' };
  const sent = await sendAutoDialogueDraft(tab.webview, HUMAN_VERIFICATION_MESSAGE);
  if (!sent?.clicked && !sent?.empty) {
    if (await detectHumanVerification(tab.webview)) return { captcha: true };
    return { ok: false, message: sent?.message || '发送按钮未找到' };
  }
  return { sent: true };
}

async function checkHumanVerificationAfterSend(account, tab, token, sendResult) {
  if (sendResult?.captcha) return sendResult;
  if (!sendResult?.sent) return sendResult || { ok: false, message: '发送失败' };
  if (await waitForHumanVerificationAfterSend(tab.webview, token)) return { captcha: true };
  return { ok: true };
}

function stopHumanVerificationCheck(message = '检查人机验证已关闭') {
  humanVerification.token += 1;
  humanVerification.enabled = false;
  humanVerification.running = false;
  humanVerification.monitoring = false;
  humanVerification.statusByAccount.clear();
  humanVerification.resolutionProbes.clear();
  const previousId = humanVerification.previousActiveId;
  humanVerification.previousActiveId = null;
  renderAccounts();
  if (previousId && state.openTabs.some(tab => tab.accountId === previousId)) activateTab(previousId);
  setStatus(message);
}

async function runHumanVerificationCheck(accounts, token) {
  let normalCount = 0;
  let captchaCount = 0;
  const jobs = await Promise.all(accounts.map(async account => {
    if (!humanVerification.enabled || humanVerification.token !== token) return null;
    try {
      const tab = await ensureAutoDialogueAccountReady(account);
      if (!tab?.webview) {
        return { account, tab: null, result: { ok: false, message: '未找到项目窗口' } };
      }
      const result = await prepareHumanVerificationMessage(account, tab, token);
      return { account, tab, result };
    } catch (error) {
      return { account, tab: null, result: { ok: false, message: error.message || '未知错误' } };
    }
  }));

  if (!humanVerification.enabled || humanVerification.token !== token) return;
  const preparedCount = jobs.filter(job => job?.result?.prepared).length;
  setStatus(`已为 ${preparedCount}/${accounts.length} 个项目准备检查文本，开始快速逐个发送...`);

  // 先把所有项目的文本填好，再快速逐个点击发送，不等待回复完成。
  for (const job of jobs) {
    if (!humanVerification.enabled || humanVerification.token !== token) return;
    if (!job) continue;
    const { account, tab } = job;
    try {
      if (!tab?.webview) {
        setStatus(`${getAccountDisplayName(account)} 未找到项目窗口`);
        continue;
      }
      if (!job.result?.prepared) continue;
      activateTab(account.id);
      await delay(HUMAN_VERIFICATION_SEND_SWITCH_DELAY_MS);
      job.sendResult = await sendPreparedHumanVerificationMessage(account, tab);
    } catch (error) {
      job.sendResult = { ok: false, message: error.message || '发送失败' };
    }
  }

  if (!humanVerification.enabled || humanVerification.token !== token) return;
  const sentCount = jobs.filter(job => job?.sendResult?.sent || job?.sendResult?.captcha).length;
  setStatus(`已完成 ${sentCount}/${accounts.length} 个项目发送，开始从第一个项目检测人机验证...`);

  // 全部发送完成后立即启动检测；结果仍按第一个到最后一个项目的顺序更新。
  const detectionJobs = jobs.map(job => {
    if (!job?.tab?.webview) return Promise.resolve({ ok: false, message: '未找到项目窗口' });
    return checkHumanVerificationAfterSend(job.account, job.tab, token, job.sendResult)
      .catch(error => ({ ok: false, message: error.message || '检测失败' }));
  });

  for (let index = 0; index < jobs.length; index += 1) {
    if (!humanVerification.enabled || humanVerification.token !== token) return;
    const job = jobs[index];
    if (!job) continue;
    const { account, tab } = job;
    try {
      if (!tab?.webview) {
        setStatus(`${getAccountDisplayName(account)} 未找到项目窗口`);
        continue;
      }
      activateTab(account.id);
      await delay(HUMAN_VERIFICATION_SEND_SWITCH_DELAY_MS);
      const result = await detectionJobs[index];
      if (result.captcha) {
        humanVerification.statusByAccount.set(account.id, 'captcha');
        captchaCount += 1;
      } else if (result.ok) {
        humanVerification.statusByAccount.set(account.id, 'normal');
        normalCount += 1;
      } else {
        setStatus(`${getAccountDisplayName(account)} 检查失败: ${result.message || '未知错误'}`);
      }
      renderAccounts();
    } catch (error) {
      setStatus(`${getAccountDisplayName(account)} 检查失败: ${error.message || '未知错误'}`);
    }
  }
  if (!humanVerification.enabled || humanVerification.token !== token) return;
  humanVerification.running = false;
  updateAutoDialogueButton();
  const previousId = humanVerification.previousActiveId;
  if (previousId && state.openTabs.some(tab => tab.accountId === previousId)) activateTab(previousId);
  setStatus(`人机验证检查完成：正常 ${normalCount} 个，检测到验证 ${captchaCount} 个`);
  monitorHumanVerificationResolution(humanVerification.token);
}

async function confirmHumanVerificationResolved(account, tab) {
  if (!tab?.webview) return false;
  const detection = await detectHumanVerification(tab.webview);
  if (detection !== false) return false;
  // 确认页面仍能找到正常的对话输入框，避免检测脚本短暂失败造成误变绿。
  const inputState = await getAutoDialogueInputState(tab.webview, '');
  return Boolean(inputState?.ok);
}

async function monitorHumanVerificationResolution(token) {
  humanVerification.monitoring = true;
  humanVerification.resolutionProbes.clear();
  updateAutoDialogueButton();

  while (humanVerification.enabled && humanVerification.token === token) {
    const captchaAccounts = Array.from(humanVerification.statusByAccount.entries())
      .filter(([, status]) => status === 'captcha')
      .map(([accountId]) => state.accounts.find(account => account.id === accountId))
      .filter(Boolean);

    if (!captchaAccounts.length) break;
    let changed = false;

    await Promise.all(captchaAccounts.map(async account => {
      if (!humanVerification.enabled || humanVerification.token !== token) return;
      const tab = state.openTabs.find(item => item.accountId === account.id);
      if (!tab?.webview) return;
      try {
        const resolved = await confirmHumanVerificationResolved(account, tab);
        if (!resolved) {
          humanVerification.resolutionProbes.set(account.id, 0);
          return;
        }
        const probes = (humanVerification.resolutionProbes.get(account.id) || 0) + 1;
        humanVerification.resolutionProbes.set(account.id, probes);
        if (probes >= HUMAN_VERIFICATION_RESOLUTION_STABLE_PROBES) {
          humanVerification.statusByAccount.set(account.id, 'normal');
          humanVerification.resolutionProbes.delete(account.id);
          changed = true;
          setStatus(`${getAccountDisplayName(account)} 已通过人机验证，项目已恢复绿色`);
        }
      } catch (error) {
        humanVerification.resolutionProbes.set(account.id, 0);
      }
    }));

    if (changed) renderAccounts();
    if (humanVerification.enabled && humanVerification.token === token) {
      await delay(HUMAN_VERIFICATION_RESOLUTION_POLL_MS);
    }
  }

  if (humanVerification.token === token) {
    humanVerification.monitoring = false;
    humanVerification.resolutionProbes.clear();
    updateAutoDialogueButton();
  }
}

function startHumanVerificationCheck(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return;
  if (humanVerification.enabled) stopHumanVerificationCheck('正在重新开始人机验证检查');
  humanVerification.enabled = true;
  humanVerification.running = true;
  humanVerification.monitoring = false;
  humanVerification.token += 1;
  humanVerification.previousActiveId = state.activeTabId || state.activeAccountId;
  humanVerification.statusByAccount.clear();
  humanVerification.resolutionProbes.clear();
  renderAccounts();
  updateAutoDialogueButton();
  setStatus(`开始检查 ${accounts.length} 个项目，请勿关闭页面`);
  runHumanVerificationCheck(accounts, humanVerification.token);
}

function pickAutoDialoguePart(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function generateAutoDialogueDraft(account, draftIndex) {
  const accountName = getAccountDisplayName(account);
  let draft = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const topic = pickAutoDialoguePart(AUTO_DIALOGUE_TOPICS);
    const opener = pickAutoDialoguePart(AUTO_DIALOGUE_OPENERS)
      .replace('{topic}', topic)
      .replace('{account}', accountName);
    const action = pickAutoDialoguePart(AUTO_DIALOGUE_ACTIONS);
    const style = pickAutoDialoguePart(AUTO_DIALOGUE_STYLES);
    const output = pickAutoDialoguePart(AUTO_DIALOGUE_OUTPUTS);
    draft = `${opener}${action}${style}${output}`;
    if (!autoDialogue.generatedDrafts.has(draft)) break;
  }
  autoDialogue.generatedDrafts.add(draft);
  return draft;
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
      const isVisibleNode = node => {
        if (!node || typeof node.getBoundingClientRect !== 'function') return false;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width >= 12 && rect.height >= 12 &&
          style.visibility !== 'hidden' && style.display !== 'none' &&
          Number(style.opacity || '1') > 0.05 && style.pointerEvents !== 'none' &&
          node.getAttribute('aria-hidden') !== 'true';
      };
      const isGenerating = () => {
        const busyNodes = document.querySelectorAll('[aria-busy="true"], [data-loading="true"], [data-testid*="loading" i]');
        if (Array.from(busyNodes).some(isVisibleNode)) return true;
        return Array.from(document.querySelectorAll('button,[role="button"]')).some(node => {
          if (!isVisibleNode(node)) return false;
          const hint = [node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-testid'), node.className, node.textContent].join(' ');
          return /停止生成|停止回答|停止响应|stop generating|stop response|cancel response/i.test(hint);
        });
      };
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
          currentLength: normalize(current).length,
          isGenerating: isGenerating()
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

function buildAutoDialogueImageScript(images) {
  return `
    (() => new Promise(resolve => {
      const images = ${JSON.stringify(images || [])};
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const input = inputs.find(node => /image|png|jpe?g|webp/i.test(node.accept || '')) || inputs[0];
      if (!input) return resolve({ ok: false, count: 0, message: '未找到图片上传入口' });
      try {
        const dataTransfer = new DataTransfer();
        for (const image of images) {
          const match = String(image.dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
          if (!match) continue;
          const mime = image.type || match[1] || 'image/png';
          const binary = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
          const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          dataTransfer.items.add(new File([bytes], image.name || 'image.png', { type: mime }));
          if (!input.multiple) break;
        }
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
        if (setter) setter.call(input, dataTransfer.files);
        else input.files = dataTransfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        resolve({ ok: dataTransfer.files.length > 0, count: dataTransfer.files.length, message: '图片已加入对话' });
      } catch (error) {
        resolve({ ok: false, count: 0, message: error?.message || '图片上传失败' });
      }
    }))()
  `;
}

async function uploadAutoDialogueImages(webview, images) {
  if (!Array.isArray(images) || !images.length) return { ok: true, count: 0 };
  return webview.executeJavaScript(buildAutoDialogueImageScript(images));
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
          Number(style.opacity || '1') > 0.05 && style.pointerEvents !== 'none' &&
          node.getAttribute('aria-hidden') !== 'true';
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
        if (!normalize(readValue(input.node)) && expected) return resolve({ ok: true, clicked: false, empty: true, message: '输入框已清空，可能已经发送' });
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

async function waitForAutoDialogueInputEmpty(webview, account, waitForResponse = true) {
  const startedAt = Date.now();
  const inputTimeoutMs = 18000;
  while (autoDialogue.enabled) {
    const inputState = await getAutoDialogueInputState(webview, '');
    if (!inputState?.ok) {
      if (Date.now() - startedAt >= inputTimeoutMs) {
        setStatus(inputState?.message || `${getAccountDisplayName(account)} 未找到对话输入框`);
        return false;
      }
      setStatus(`${getAccountDisplayName(account)} 正在切换项目，等待对话输入框加载`);
      await delay(500);
      continue;
    }
    if (inputState.hasAnyText) {
      setStatus(`${getAccountDisplayName(account)} 输入框已有内容，请等待上一条发送完成`);
      await delay(AUTO_DIALOGUE_POLL_MS);
      continue;
    }
    if (waitForResponse && inputState.isGenerating) {
      setStatus(`${getAccountDisplayName(account)} 正在等待上一条回复完成`);
      await delay(1000);
      continue;
    }
    return true;
  }
  return false;
}

async function waitForAutoDialogueSent(webview, account, draftIndex, draftsPerAccount, expectedText = '') {
  let sendClicked = false;
  let sendAttemptCount = 0;
  let lastSendAttemptAt = 0;
  const expected = String(expectedText || '').trim();
  while (autoDialogue.enabled) {
    const inputState = await getAutoDialogueInputState(webview, expected);
    if (!inputState?.ok) {
      setStatus(inputState?.message || `${getAccountDisplayName(account)} 未找到对话输入框`);
      return false;
    }
    if (!inputState.hasAnyText) return true;
    if (autoDialogue.sendEnabled) {
      const now = Date.now();
      const shouldRetry = !sendClicked || now - lastSendAttemptAt >= 8000;
      if (shouldRetry) {
        if (sendClicked && inputState.isGenerating) {
          setStatus(`${getAccountDisplayName(account)} 第 ${draftIndex + 1}/${draftsPerAccount} 条已发送，等待回复完成`);
          await delay(1000);
          continue;
        }
        if (sendAttemptCount >= 3) {
          setStatus(`${getAccountDisplayName(account)} 第 ${draftIndex + 1}/${draftsPerAccount} 条发送失败，请检查页面后重试`);
          return false;
        }
        sendAttemptCount += 1;
        lastSendAttemptAt = now;
        const sendResult = await sendAutoDialogueDraft(webview, expected);
        if (sendResult?.clicked) {
          sendClicked = true;
          setStatus(`${getAccountDisplayName(account)} 第 ${draftIndex + 1}/${draftsPerAccount} 条已自动点击发送`);
        } else if (sendResult?.empty) {
          return true;
        } else {
          sendClicked = false;
          setStatus(sendResult?.message || `${getAccountDisplayName(account)} 正在等待发送按钮`);
        }
      } else {
        setStatus(`${getAccountDisplayName(account)} 第 ${draftIndex + 1}/${draftsPerAccount} 条已发送，等待输入框清空`);
      }
      await delay(650);
    } else {
      setStatus(`${getAccountDisplayName(account)} 第 ${draftIndex + 1}/${draftsPerAccount} 条已填入，请手动发送`);
      await delay(AUTO_DIALOGUE_POLL_MS);
    }
  }
  return false;
}

async function prepareAutoDialogueDraft(account, tab, draftIndex, draftsPerAccount, draftText, waitForResponse = true) {
  if (!tab?.webview) return false;
  if (!autoDialogue.enabled) return false;
  if (!(await waitForAutoDialogueInputEmpty(tab.webview, account, waitForResponse))) return false;

  if (autoDialogue.mode === 'custom' && autoDialogue.customImages.length) {
    const uploadResult = await uploadAutoDialogueImages(tab.webview, autoDialogue.customImages);
    if (!uploadResult?.ok) {
      setStatus(`${getAccountDisplayName(account)} 图片上传失败: ${uploadResult?.message || '页面未找到上传入口'}`);
      return false;
    }
    await delay(650);
  }

  const draft = String(draftText ?? '').trim() || (autoDialogue.mode === 'custom'
    ? String(autoDialogue.customText || '').trim()
    : generateAutoDialogueDraft(account, draftIndex));
  const result = await fillAutoDialogueDraft(tab.webview, draft);
  if (!result?.ok) {
    setStatus(result?.message || `${getAccountDisplayName(account)} 未找到对话输入框`);
    return false;
  }
  autoDialogue.waitingText = draft;
  autoDialogue.waitingAccountId = account.id;
  autoDialogue.draftIndex = draftIndex;
  return true;
}

async function processAutoDialogueDraft(account, tab, draftIndex, draftsPerAccount) {
  const draft = autoDialogue.mode === 'custom'
    ? String(autoDialogue.customText || '').trim()
    : generateAutoDialogueDraft(account, draftIndex);
  const prepared = await prepareAutoDialogueDraft(account, tab, draftIndex, draftsPerAccount, draft, true);
  if (!prepared) return false;
  return waitForAutoDialogueSent(tab.webview, account, draftIndex, draftsPerAccount, draft);
}

async function processAutoDialogueAccount(account, tab) {
  const draftsPerAccount = getAutoDialogueDraftCount();
  for (let draftIndex = 0; draftIndex < draftsPerAccount; draftIndex += 1) {
    const sent = await processAutoDialogueDraft(account, tab, draftIndex, draftsPerAccount);
    if (!sent || !autoDialogue.enabled) return false;
    if (draftIndex < draftsPerAccount - 1) {
      setStatus(`${getAccountDisplayName(account)} 第 ${draftIndex + 1}/${draftsPerAccount} 条已完成，准备发送下一条`);
      await delay(AUTO_DIALOGUE_PROJECT_SWITCH_DELAY_MS);
    }
  }
  return true;
}

async function runAutoDialogue() {
  if (!autoDialogue.enabled || autoDialogue.running) return;
  if (!autoDialogue.queue.length) {
    stopAutoDialogue('自动对话没有可执行的项目');
    return;
  }
  autoDialogue.running = true;
  updateAutoDialogueButton();
  try {
    if (autoDialogue.batchRun) {
      const batch = autoDialogue.queue.slice();
      const draftsPerAccount = getAutoDialogueDraftCount();
      const results = batch.map(() => true);
      setStatus(`正在确认 ${batch.length} 个已打开项目页面...`);
      const tabs = await Promise.all(batch.map(async account => {
        // 批量发布只使用启动前已经打开的项目，不额外替用户打开新项目。
        const existingTab = state.openTabs.find(item => item.accountId === account.id);
        if (!existingTab) return null;
        try {
          return await ensureAutoDialogueAccountReady(account);
        } catch (error) {
          setStatus(`${getAccountDisplayName(account)} 页面准备失败: ${error.message || '未知错误'}`);
          return null;
        }
      }));
      const draftPlan = batch.map(account => Array.from({ length: draftsPerAccount }, (_, draftIndex) => (
        autoDialogue.mode === 'custom'
          ? String(autoDialogue.customText || '').trim()
          : generateAutoDialogueDraft(account, draftIndex)
      )));

      tabs.forEach((tab, index) => {
        if (tab?.webview) return;
        results[index] = false;
        setStatus(`${getAccountDisplayName(batch[index])} 未找到已打开项目窗口，请先批量打开项目`);
      });

      for (let draftIndex = 0; draftIndex < draftsPerAccount; draftIndex += 1) {
        if (!autoDialogue.enabled) return;
        setStatus(`正在批量准备第 ${draftIndex + 1}/${draftsPerAccount} 轮文本...`);

        const prepared = await Promise.all(batch.map(async (account, accountIndex) => {
          if (!results[accountIndex]) return false;
          const tab = tabs[accountIndex];
          try {
            return await prepareAutoDialogueDraft(
              account,
              tab,
              draftIndex,
              draftsPerAccount,
              draftPlan[accountIndex][draftIndex],
              false
            );
          } catch (error) {
            results[accountIndex] = false;
            setStatus(`${getAccountDisplayName(account)} 文本准备失败: ${error.message || '未知错误'}`);
            return false;
          }
        }));

        prepared.forEach((ok, accountIndex) => {
          if (!ok) results[accountIndex] = false;
        });

        if (!autoDialogue.enabled) return;
        setStatus(`第 ${draftIndex + 1}/${draftsPerAccount} 轮文本已准备完成，开始逐项目发送...`);
        for (let accountIndex = 0; accountIndex < batch.length; accountIndex += 1) {
          if (!autoDialogue.enabled) return;
          if (!results[accountIndex]) continue;
          const account = batch[accountIndex];
          const tab = tabs[accountIndex];
          try {
            activateTab(account.id);
            await delay(AUTO_DIALOGUE_PROJECT_SWITCH_DELAY_MS);
            const sent = await waitForAutoDialogueSent(
              tab.webview,
              account,
              draftIndex,
              draftsPerAccount,
              draftPlan[accountIndex][draftIndex]
            );
            if (!sent) results[accountIndex] = false;
          } catch (error) {
            results[accountIndex] = false;
            setStatus(`${getAccountDisplayName(account)} 自动对话发送失败: ${error.message || '未知错误'}`);
          }
        }
      }
      if (autoDialogue.enabled) {
        const successCount = results.filter(Boolean).length;
        stopAutoDialogue(`批量发布完成：${successCount}/${batch.length} 个项目，每个项目 ${draftsPerAccount} 条`);
      }
      return;
    }

    for (let index = 0; index < autoDialogue.queue.length; index += 1) {
      if (!autoDialogue.enabled) return;
      autoDialogue.accountIndex = index;
      const account = autoDialogue.queue[index];
      try {
        const tab = await ensureAutoDialogueAccountReady(account);
        if (!tab?.webview) {
          setStatus(`自动对话未找到项目窗口: ${getAccountDisplayName(account)}`);
          continue;
        }
        activateTab(account.id);
        await delay(AUTO_DIALOGUE_PROJECT_SWITCH_DELAY_MS);
        const completed = await processAutoDialogueAccount(account, tab);
        if (!completed && autoDialogue.enabled) {
          setStatus(`${getAccountDisplayName(account)} 未完成，继续处理下一个项目`);
        }
      } catch (error) {
        setStatus(`${getAccountDisplayName(account)} 自动对话失败: ${error.message || '未知错误'}`);
      }
    }
    if (autoDialogue.enabled) stopAutoDialogue('逐个发布已完成全部项目');
  } catch (error) {
    if (autoDialogue.enabled) stopAutoDialogue(`自动对话失败: ${error.message || '未知错误'}`);
  } finally {
    autoDialogue.running = false;
    updateAutoDialogueButton();
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
  const loadFinished = waitForWebviewLoad(webview);
  if (typeof webview.loadURL === 'function') {
    try {
      await Promise.resolve(webview.loadURL(DOUBAO_CREATION_SCAN_URL));
    } catch (e) {}
  } else {
    webview.src = DOUBAO_CREATION_SCAN_URL;
  }
  await loadFinished;
  await waitForDoubaoCreationReady(webview);
}

let doubaoScanMenu = null;
let doubaoScanRunning = false;
const DOUBAO_SCAN_DEFAULT_SCOPE_KEY = 'aiamDoubaoScanDefaultScope';

function getDoubaoScanDefaultScope() {
  return localStorage.getItem(DOUBAO_SCAN_DEFAULT_SCOPE_KEY) === 'conversation' ? 'conversation' : 'project';
}

function setDoubaoScanDefaultScope(scope) {
  const value = scope === 'conversation' ? 'conversation' : 'project';
  localStorage.setItem(DOUBAO_SCAN_DEFAULT_SCOPE_KEY, value);
  return value;
}

function getWebviewUrl(webview) {
  try {
    return String(webview?.getURL?.() || webview?.src || '');
  } catch (e) {
    return String(webview?.src || '');
  }
}

function closeDoubaoScanMenu() {
  doubaoScanMenu?.remove();
  doubaoScanMenu = null;
}

function openDoubaoScanMenu(event) {
  closeDoubaoScanMenu();
  const menu = document.createElement('div');
  menu.className = 'doubao-scan-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" role="menuitem" data-scope="project">扫描当前项目全部图片和视频</button>
    <button type="button" role="menuitem" data-scope="conversation">扫描当前对话图片和视频</button>
    <div class="doubao-scan-default-row">
      <span>默认扫描范围</span>
      <select class="doubao-scan-default-select" aria-label="默认扫描范围">
        <option value="project">当前项目全部图片和视频</option>
        <option value="conversation">当前对话图片和视频</option>
      </select>
      <button type="button" data-action="save-default">设置默认</button>
    </div>
  `;
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, event.clientX), window.innerWidth - rect.width - 8);
  const top = Math.min(Math.max(8, event.clientY), window.innerHeight - rect.height - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  doubaoScanMenu = menu;
  menu.querySelector('.doubao-scan-default-select').value = getDoubaoScanDefaultScope();
  menu.addEventListener('click', async (clickEvent) => {
    const action = clickEvent.target.closest('[data-action]');
    if (action?.dataset.action === 'save-default') {
      const scope = setDoubaoScanDefaultScope(menu.querySelector('.doubao-scan-default-select')?.value);
      closeDoubaoScanMenu();
      setStatus(`已将${scope === 'conversation' ? '当前对话图片和视频' : '当前项目全部图片和视频'}设为默认扫描范围`);
      return;
    }
    const button = clickEvent.target.closest('[data-scope]');
    if (!button || doubaoScanRunning) return;
    closeDoubaoScanMenu();
    await scanDoubaoScope(button.dataset.scope || 'project');
  });
}

document.addEventListener('pointerdown', (event) => {
  if (doubaoScanMenu && !doubaoScanMenu.contains(event.target)) closeDoubaoScanMenu();
}, true);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDoubaoScanMenu();
});

async function injectDoubaoCreationScript(webview, scripts) {
  const code = scripts?.['doubao-creation-download'];
  if (!code || !webview) return false;
  await webview.executeJavaScript(code + ';void 0;');
  return true;
}

async function callDoubaoScan(webview, scope) {
  return webview.executeJavaScript(`
    (async () => {
      const scan = window.__AIAM_DOUBAO_SCAN_SCOPE__;
      if (typeof scan !== 'function') return false;
      return await scan(${JSON.stringify(scope)});
    })()
  `);
}

async function restoreWebviewUrl(webview, url) {
  if (!url || /^about:blank$/i.test(url)) return;
  const current = getWebviewUrl(webview);
  if (current === url) return;
  try {
    const loadFinished = waitForWebviewLoad(webview, 12000);
    if (typeof webview.loadURL === 'function') {
      await Promise.resolve(webview.loadURL(url));
      await loadFinished;
    } else {
      webview.src = url;
      await loadFinished;
    }
  } catch (e) {}
}

async function scanDoubaoTab(tab, scripts, scope, options = {}) {
  const account = state.accounts.find(item => item.id === tab.accountId);
  if (!tab?.webview || !isDoubaoDialogueAccount(account)) return { ok: false, count: 0, skipped: true };
  const originalUrl = getWebviewUrl(tab.webview);
  try {
    if (scope === 'project') {
      await ensureDoubaoCreationPage(tab.webview);
      setStatus(`正在扫描 ${getAccountDisplayName(account)} 的全部图片和视频...`);
    } else {
      setStatus(`正在扫描 ${getAccountDisplayName(account)} 当前对话图片和视频...`);
    }
    await injectDoubaoCreationScript(tab.webview, scripts);
    return await callDoubaoScan(tab.webview, scope);
  } finally {
    if (options.restoreUrl) await restoreWebviewUrl(tab.webview, originalUrl);
  }
}

async function scanDoubaoScope(scope = 'project') {
  if (doubaoScanRunning) return;
  const activeTab = state.openTabs.find(tab => tab.accountId === state.activeTabId);
  const activeAccount = state.accounts.find(account => account.id === state.activeTabId);
  if (!activeTab?.webview || !isDoubaoDialogueAccount(activeAccount)) {
    setStatus('请先打开豆包项目');
    return;
  }

  doubaoScanRunning = true;
  btnJimengOriginal.disabled = true;
  try {
    const scripts = await window.electronAPI.getExtensionScripts();
    if (!scripts?.['doubao-creation-download']) throw new Error('豆包扫描脚本未找到');

    const result = await scanDoubaoTab(activeTab, scripts, scope);
    const count = Number(result?.count || 0);
    if (Array.isArray(result?.resources) && result.resources.length > 0) {
      reportCapturedResources(activeTab.accountId, result.resources);
    }
    if (result?.ok) {
      const label = scope === 'conversation' ? '当前对话' : '当前项目';
      const imageCount = Number(result?.imageCount || 0);
      const videoCount = Number(result?.videoCount || Math.max(0, count - imageCount));
      setStatus(`已扫描${label}，加入 ${imageCount} 张图片、${videoCount} 个视频到右侧资源栏`);
      showDownloadToast(`已加入 ${imageCount} 张图片、${videoCount} 个视频`, 'success');
    } else if (result?.navigated) {
      setStatus('正在打开豆包“我的创作”页面，请稍后再扫描');
    } else {
      setStatus(scope === 'conversation' ? '当前对话没有扫描到可用图片或视频' : '当前项目没有扫描到可用图片或视频');
    }
  } catch (e) {
    setStatus(`豆包扫描失败: ${e.message || '未知错误'}`);
    showDownloadToast(`豆包扫描失败：${e.message || '未知错误'}`, 'error');
  } finally {
    doubaoScanRunning = false;
    btnJimengOriginal.disabled = false;
  }
}

btnJimengOriginal?.addEventListener('contextmenu', (event) => {
  const account = state.accounts.find(item => item.id === state.activeTabId);
  if (!isDoubaoDialogueAccount(account)) return;
  event.preventDefault();
  event.stopPropagation();
  if (!doubaoScanRunning) openDoubaoScanMenu(event);
});

btnJimengOriginal?.addEventListener('click', async () => {
  const tab = state.openTabs.find(t => t.accountId === state.activeTabId);
  const account = state.accounts.find(a => a.id === state.activeTabId);
  if (!tab?.webview || !['jimeng', 'doubao'].includes(account?.platform || '')) {
    setStatus('请先打开即梦或豆包账号');
    return;
  }
  if (account.platform === 'doubao') {
    await scanDoubaoScope(getDoubaoScanDefaultScope());
    return;
  }

  btnJimengOriginal.disabled = true;
  try {
    const scripts = await window.electronAPI.getExtensionScripts();
    const code = scripts?.['jimeng-image-download'];
    if (code) await tab.webview.executeJavaScript(code + ';void 0;');
    const ok = await tab.webview.executeJavaScript(`
      if (window.__AIAM_JIMENG_START_SELECT__) {
        window.__AIAM_JIMENG_START_SELECT__();
        true;
      } else false;
    ` + ';void 0;');
    if (ok) {
      setStatus('即梦原图选择已开启，请在页面里点一张图片');
      showDownloadToast('即梦原图选择已开启，请点击要下载的图片', 'success');
    } else {
      setStatus('即梦原图脚本未生效，请关闭软件后重新打开');
    }
  } catch (e) {
    setStatus(`选择模式启动失败: ${e.message}`);
  } finally {
    btnJimengOriginal.disabled = false;
  }
});

btnExportAccounts?.addEventListener('click', async () => {
  btnExportAccounts.disabled = true;
  setStatus('正在导出全部账号及登录状态...');
  try {
    const result = await window.electronAPI.exportAccounts();
    if (result?.canceled) {
      setStatus('已取消导出账号');
      return;
    }
    if (result?.ok) {
      setStatus(result.message || '账号文件夹导出完成');
      showDownloadToast(`已导出 ${result.accountCount || 0} 个账号及登录状态`, 'success');
      alert(`导出完成：${result.accountCount || 0} 个账号及登录状态\n\n保存位置：\n${result.folderPath || '账号备份文件夹'}`);
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
  const confirmed = window.confirm('请选择之前导出的账号备份文件夹。\n\n导入后会恢复全部账号、分组、备注和登录状态，并替换当前账号列表。程序会先自动备份当前数据，导入完成后需要重启软件。\n\n是否继续？');
  if (!confirmed) return;
  btnImportAccounts.disabled = true;
  setStatus('正在导入全部账号及登录状态...');
  try {
    const result = await window.electronAPI.importAccounts({ mode: 'overwrite' });
    if (result?.canceled) {
      setStatus('已取消导入账号');
      return;
    }
    if (result?.ok) {
      if (result.restartRequired) {
        const message = `${result.message || '账号导入已准备完成'}\n\n当前数据已自动备份到：\n${result.backupPath || 'backups 文件夹'}\n\n请关闭并重新打开软件。`;
        alert(message);
        setStatus('账号导入已准备完成，重启后生效');
      } else {
        state.accounts = await window.electronAPI.getAccounts();
        renderAccountFilter();
        renderAccountGroupFilter();
        renderAccounts();
        const message = `${result.message || '账号导入完成'}，已恢复 ${result.copiedPartitions || 0} 个登录态目录。\n\n当前数据已自动备份到：\n${result.backupPath || 'backups 文件夹'}`;
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

let accountOpenMenu = null;

function closeAccountOpenMenu() {
  accountOpenMenu?.remove();
  accountOpenMenu = null;
}

function openVisibleAccountTabs(count = null, enableHumanVerification = false, range = null) {
  const accounts = getVisibleAccounts();
  if (!accounts.length) {
    setStatus('当前筛选下没有账号可打开');
    return;
  }
  let selected = accounts;
  let rangeLabel = '';
  if (range) {
    const start = Math.max(1, Math.min(accounts.length, Number(range.start) || 1));
    const end = Math.max(1, Math.min(accounts.length, Number(range.end) || 1));
    if (start > end) {
      setStatus('打开项目范围无效，请确认起始项目不大于结束项目');
      return;
    }
    selected = accounts.slice(start - 1, end);
    rangeLabel = `（第 ${start}-${end} 个）`;
  } else if (count !== null) {
    selected = accounts.slice(0, Math.max(1, Math.min(accounts.length, Number(count) || 1)));
  }
  selected.forEach(account => openAccountTab(account.id));
  setStatus(`已打开 ${selected.length} 个筛选项目${rangeLabel}`);

  if (enableHumanVerification) {
    const checkAccounts = selected.filter(isDoubaoDialogueAccount);
    if (autoDialogue.enabled || autoDialogue.running) {
      setStatus('自动对话正在运行，暂时不能开启人机验证检查');
    } else if (checkAccounts.length) {
      startHumanVerificationCheck(checkAccounts);
    } else {
      setStatus('本次打开的项目中没有可检查的豆包项目');
    }
  }
}

function openAccountOpenMenu() {
  if (accountOpenMenu) {
    closeAccountOpenMenu();
    return;
  }
  closeAccountOpenMenu();
  const accounts = getVisibleAccounts();
  if (!accounts.length) {
    setStatus('当前筛选下没有账号可打开');
    return;
  }
  const menu = document.createElement('div');
  menu.className = 'account-open-menu';
  const savedHumanVerification = localStorage.getItem('aiamBatchOpenHumanVerification') === '1';
  const humanVerificationChecked = humanVerification.enabled || savedHumanVerification;
  menu.innerHTML = `
    <div class="account-open-menu-title">选择打开项目</div>
    <button type="button" data-open-count="all">全部打开 <span>${accounts.length} 个</span></button>
    <div class="account-open-custom-row">
      <input class="account-open-count" type="number" min="1" max="${Math.min(50, accounts.length)}" value="${Math.min(3, accounts.length)}" aria-label="自定义打开数量">
      <button type="button" data-open-count="custom">确认打开</button>
    </div>
    <div class="account-open-range-title">按范围打开项目</div>
    <div class="account-open-range-row">
      <input class="account-open-range-input account-open-range-start" type="number" min="1" max="${accounts.length}" value="1" aria-label="起始项目序号">
      <span>到</span>
      <input class="account-open-range-input account-open-range-end" type="number" min="1" max="${accounts.length}" value="${accounts.length}" aria-label="结束项目序号">
      <button type="button" data-open-count="range">确认打开</button>
    </div>
    <div class="account-open-menu-divider"></div>
    <label class="account-open-human-row">
      <span>
        <strong>人机验证检查</strong>
        <small>勾选后，请等待系统自行检测。</small>
      </span>
      <input class="account-open-human-toggle" type="checkbox" role="switch" aria-label="开启人机验证检查" ${humanVerificationChecked ? 'checked' : ''}>
    </label>
  `;
  document.body.appendChild(menu);
  const rect = btnOpenFilteredAccounts.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - menuRect.width - 8)}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menuRect.height - 8)}px`;
  accountOpenMenu = menu;
  const humanToggle = menu.querySelector('.account-open-human-toggle');
  const humanRow = menu.querySelector('.account-open-human-row');
  const syncHumanToggleState = () => {
    humanRow?.classList.toggle('is-active', Boolean(humanToggle?.checked));
    humanToggle?.setAttribute('aria-checked', humanToggle?.checked ? 'true' : 'false');
  };
  humanToggle?.addEventListener('change', () => {
    const enabled = Boolean(humanToggle.checked);
    localStorage.setItem('aiamBatchOpenHumanVerification', enabled ? '1' : '0');
    syncHumanToggleState();
    if (!enabled && humanVerification.enabled) {
      stopHumanVerificationCheck('人机验证检查已关闭，项目颜色已恢复');
    }
  });
  syncHumanToggleState();
  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-open-count]');
    if (!button) return;
    const value = button.dataset.openCount;
    const count = value === 'all' || value === 'range' ? null : menu.querySelector('.account-open-count')?.value;
    const range = value === 'range'
      ? {
        start: menu.querySelector('.account-open-range-start')?.value,
        end: menu.querySelector('.account-open-range-end')?.value
      }
      : null;
    const enableHumanVerification = Boolean(menu.querySelector('.account-open-human-toggle')?.checked);
    localStorage.setItem('aiamBatchOpenHumanVerification', enableHumanVerification ? '1' : '0');
    closeAccountOpenMenu();
    openVisibleAccountTabs(count, enableHumanVerification, range);
  });
  menu.querySelector('.account-open-count')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') menu.querySelector('[data-open-count="custom"]')?.click();
  });
  menu.querySelectorAll('.account-open-range-input').forEach(input => {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') menu.querySelector('[data-open-count="range"]')?.click();
    });
  });
}

btnOpenFilteredAccounts?.addEventListener('click', () => {
  if (humanVerification.enabled) {
    stopHumanVerificationCheck('人机验证检查已关闭，项目颜色已恢复');
    return;
  }
  openAccountOpenMenu();
});

document.addEventListener('pointerdown', event => {
  if (accountOpenMenu && !accountOpenMenu.contains(event.target) && !btnOpenFilteredAccounts?.contains(event.target)) {
    closeAccountOpenMenu();
  }
}, true);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeAccountOpenMenu();
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

// ============= 下载位置 =============
async function chooseDownloadDir(button = btnChooseDownloadDir) {
  if (button) button.disabled = true;
  try {
    const result = await window.electronAPI.chooseDownloadDir();
    if (result?.canceled || !result.downloadDir) return;

    if (button) button.title = result.downloadDir;
    state.downloadLibraryLoaded = false;
    state.downloadLibraryFiles = [];
    if (downloadLibraryPath) downloadLibraryPath.textContent = result.downloadDir;
    setStatus(`下载位置已更换: ${result.downloadDir}`);
    showDownloadToast('下载位置已更换', 'success');
  } catch (error) {
    setStatus(`更换下载位置失败: ${error.message || '未知错误'}`);
    showDownloadToast('更换下载位置失败', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

async function setupDownloadDirButton() {
  if (!btnChooseDownloadDir) return;
  btnChooseDownloadDir.title = await window.electronAPI.getDownloadDir();
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
    const playBtn = (file.type === 'video' || file.type === 'image')
      ? `<div class="download-file-play-overlay"><svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>`
      : '';
    return `
      <div class="download-file-card" draggable="true" data-path="${escapeHtml(file.path)}" data-file-url="${escapeHtml(file.fileUrl)}" title="单击打开，拖拽到其他软件或网页上传区">
        <div class="download-file-thumb ${file.type === 'video' ? 'video' : ''}">${thumb}${playBtn}</div>
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
    settleBatchResourceDownload('', data);
    markDownloadFinished(data.filename || '文件', data.path || '');
    showDownloadToast(data.filename || '文件', 'download');
    scheduleDownloadLibraryRefresh();
  });

  // 导入账号后首次启动，自动打开备份中的全部账号；普通启动只恢复上次活跃账号。
  const session = await window.electronAPI.getSession();
  if (session?.restoreAllAfterImport && Array.isArray(session.openTabs)) {
    const importedIds = session.openTabs.filter(id => state.accounts.some(account => account.id === id));
    importedIds.forEach(accountId => openAccountTab(accountId));
    const activeId = importedIds.includes(session.activeTabId) ? session.activeTabId : importedIds[0];
    if (activeId) activateTab(activeId);
  } else if (session && session.activeTabId && state.accounts.some(a => a.id === session.activeTabId)) {
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
          settleBatchResourceDownload(accountId, payload, new Error(message));
          resetResourceDownloadButton(accountId, filename);
          showDownloadToast(message, 'error');
          setStatus(message);
          return;
        }
        const taskId = addDownloadTask({ filename: filename || '页面下载', accountId, type: 'page-download' });
        window.electronAPI.downloadResource({
          url,
          backupUrl,
          accountId,
          filename,
          source: payload.source || '',
          confirmedNoWatermark: Boolean(payload.confirmedNoWatermark)
        }).then(result => {
          console.log('[webview-ipc] downloadResource result:', JSON.stringify(result));
          if (!result?.ok) {
            const message = result?.message || result?.reason || '下载失败';
            updateDownloadTask(taskId, { status: 'error', message });
            settleBatchResourceDownload(accountId, payload, new Error(message));
            resetResourceDownloadButton(accountId, filename);
          } else {
            updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : filename });
            reportSuccessfulDoubaoVideoDownload(accountId, payload, result);
            settleBatchResourceDownload(accountId, payload);
            finishResourceDownloadButton(accountId, filename);
          }
        }).catch(err => {
          updateDownloadTask(taskId, { status: 'error', message: err.message || '下载失败' });
          settleBatchResourceDownload(accountId, payload, err);
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
            const message = result?.message || '保存失败';
            updateDownloadTask(taskId, { status: 'error', message });
            settleBatchResourceDownload(accountId, data, new Error(message));
            resetResourceDownloadButton(accountId, data.filename);
          } else {
            updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : data.filename });
            settleBatchResourceDownload(accountId, data);
            finishResourceDownloadButton(accountId, data.filename);
          }
        }).catch(err => {
          updateDownloadTask(taskId, { status: 'error', message: err.message || '保存失败' });
          settleBatchResourceDownload(accountId, data, err);
          resetResourceDownloadButton(accountId, data.filename);
          console.error('[webview-ipc] saveBlob error:', err);
        });
      }
    } else if (event.channel === 'download-error') {
      const error = event.args[0] || {};
      console.error('[webview-ipc] webview download error:', JSON.stringify(error));
      settleBatchResourceDownload(accountId, error, new Error(error.error || error.message || '下载链接解析失败'));
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
    accountId,
    source: 'doubao-creation-resource-panel',
    confirmedNoWatermark: true
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
    source: 'doubao-creation-resource-panel',
    confirmedNoWatermark: true,
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
  if (inputProjectCount) inputProjectCount.value = '1';
  projectCountGroup?.classList.toggle('hidden', isEdit);
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
  if (inputProjectCount) inputProjectCount.value = '1';
  projectCountGroup?.classList.remove('hidden');
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
  const projectCount = Math.min(50, Math.max(1, Number.parseInt(inputProjectCount?.value || '1', 10) || 1));
  const customUrl = platform === 'custom' ? normalizeCustomUrl(inputCustomUrl?.value || '') : '';
  const editingAccountId = state.editingAccountId;

  if (editingAccountId) {
    modalConfirm.disabled = true;
    try {
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
    } finally {
      modalConfirm.disabled = false;
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

  modalConfirm.disabled = true;
  try {
    const result = await window.electronAPI.addAccount({
      platform,
      name,
      url: customUrl,
      group,
      remark,
      count: projectCount
    });
    if (result?.success) {
      state.accounts = await window.electronAPI.getAccounts();
      renderAccountFilter();
      renderAccountGroupFilter();
      renderAccounts();
      closeAccountModal();
      const createdCount = Number(result.count || projectCount);
      setStatus(createdCount > 1
        ? `已创建 ${createdCount} 个项目`
        : `已添加账号 ${getAccountDisplayName(result.account)}`);
    } else {
      alert(result?.error || '创建项目失败');
    }
  } finally {
    modalConfirm.disabled = false;
  }
});

function renderAccounts() {
  const visibleAccounts = getVisibleAccounts();

  accountList.innerHTML = visibleAccounts.map(acc => `
    <div class="account-card ${state.activeAccountId === acc.id ? 'active' : ''} ${state.videoNoticeByAccount[acc.id] ? 'has-video-notice' : ''} ${humanVerification.statusByAccount.get(acc.id) === 'normal' ? 'human-verification-normal' : humanVerification.statusByAccount.get(acc.id) === 'captcha' ? 'human-verification-captcha' : ''}" data-id="${acc.id}">
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

      // 豆包聊天页的视频下载按钮和“扫描豆包下载无水印版”共用无水印资源栏。
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
          window.electronAPI.downloadResource({
            url,
            backupUrl,
            accountId,
            filename,
            source: payload.source || '',
            confirmedNoWatermark: Boolean(payload.confirmedNoWatermark)
          }).then(result => {
            console.log('[download-route] downloadResource result:', JSON.stringify(result));
            if (!result?.ok) {
              updateDownloadTask(taskId, { status: 'error', message: result?.message || result?.reason || '下载失败' });
              resetResourceDownloadButton(accountId, filename);
            } else {
              updateDownloadTask(taskId, { status: 'success', message: result.filePath || '已完成', filename: result.filePath ? result.filePath.split(/[\\/]/).pop() : filename });
              reportSuccessfulDoubaoVideoDownload(accountId, payload, result);
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

tabBar?.addEventListener('wheel', (event) => {
  if (tabBar.scrollWidth <= tabBar.clientWidth) return;
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (!delta) return;
  event.preventDefault();
  const step = Math.max(-56, Math.min(56, delta * 0.32));
  tabBar.scrollLeft += step;
}, { passive: false });

tabBar?.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  if (event.key === 'Home') tabBar.scrollLeft = 0;
  if (event.key === 'End') tabBar.scrollLeft = tabBar.scrollWidth;
  if (event.key === 'ArrowLeft') tabBar.scrollLeft -= 160;
  if (event.key === 'ArrowRight') tabBar.scrollLeft += 160;
  event.preventDefault();
});

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
      btnJimengOriginal.title = '左键使用默认扫描范围，右键选择扫描范围或设置默认';
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

function reportSuccessfulDoubaoVideoDownload(accountId, payload = {}, result = {}) {
  if (!isDoubaoAccountId(accountId) || String(payload.type || '').toLowerCase() !== 'video' || !payload.url) return;
  if (!payload.confirmedNoWatermark && !isConfirmedNoWatermarkVideoUrl(payload.url)) return;

  reportCapturedResources(accountId, [{
    type: 'video',
    url: payload.url,
    backupUrl: payload.backupUrl || '',
    vid: payload.vid || '',
    nodeId: payload.nodeId || '',
    messageId: payload.messageId || '',
    title: payload.title || '豆包无水印视频',
    thumbUrl: payload.thumbUrl || '',
    width: payload.width || 0,
    height: payload.height || 0,
    definition: payload.definition || 'original',
    source: payload.source || 'doubao-chat-download',
    confirmedNoWatermark: true,
    status: 'ready',
    downloadPath: result.filePath || ''
  }]);
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

function getBatchResourceDownloadKey(accountId, details = {}) {
  if (details.messageId) return `message:${accountId || ''}:${details.messageId}`;
  if (details.url) return `url:${details.url}`;
  if (details.filename) return `file:${accountId || ''}:${details.filename}`;
  return '';
}

function waitForBatchResourceDownload(accountId, details, timeoutMs = 120000) {
  const key = getBatchResourceDownloadKey(accountId, details);
  if (!key) return Promise.resolve({ ok: true });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      batchResourceDownloadWaiters.delete(key);
      reject(new Error('下载等待超时'));
    }, timeoutMs);
    batchResourceDownloadWaiters.set(key, { resolve, reject, timer });
  });
}

function settleBatchResourceDownload(accountId, details = {}, error = null) {
  const key = getBatchResourceDownloadKey(accountId, details);
  if (!key) return;
  const waiter = batchResourceDownloadWaiters.get(key);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  batchResourceDownloadWaiters.delete(key);
  if (error) waiter.reject(error instanceof Error ? error : new Error(String(error)));
  else waiter.resolve(details);
}

function markResourceDownloadDone(resource) {
  if (!resource) return;
  const key = getResourceDownloadButtonKey(resource.accountId || '', getResourceDownloadFilename(resource));
  if (key) resourceDownloadStateByKey.set(key, 'done');
  const button = Array.from(resourceList?.querySelectorAll('.resource-download') || [])
    .find(item => item.dataset.resourceid === String(resource.id || ''));
  if (button) setResourceButtonDone(button);
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
    const btnAttrs = `class="${btnClass}"${btnDisabled} data-resourceid="${escapeHtml(r.id || '')}" data-url="${escapeHtml(r.url || '')}" data-backup-url="${escapeHtml(r.backupUrl || '')}" data-messageid="${escapeHtml(r.messageId || '')}" data-nodeid="${escapeHtml(r.nodeId || '')}" data-accountid="${escapeHtml(r.accountId || '')}" data-vid="${escapeHtml(r.vid || '')}" data-source="${escapeHtml(r.source || '')}" data-filename="${escapeHtml(downloadFilename)}"`;
    const deleteAttrs = `class="resource-delete" type="button" data-resourceid="${escapeHtml(r.id || '')}" title="删除此资源"`;

    return `
      <div class="resource-item ${isPending ? 'pending' : ''}">
        ${thumbHtml}
        <div class="resource-info">
          <span class="resource-type ${isImage ? 'image' : 'video'}">${isImage ? '图片' : '视频'}</span>
          <div class="resource-name" title="${escapeHtml(r.title || r.url || r.vid || r.messageId || '')}">${escapeHtml(displayName)}</div>
          ${meta ? `<div class="resource-meta">${meta}</div>` : ''}
        </div>
        <div class="resource-card-actions">
          <button ${btnAttrs}>${btnText}</button>
          <button ${deleteAttrs}>删除</button>
        </div>
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
      const confirmedNoWatermark = Boolean(currentResource?.confirmedNoWatermark)
        || isConfirmedNoWatermarkVideoUrl(url);
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
        } else if (account?.platform === 'doubao' && currentResource?.type === 'video' && !confirmedNoWatermark) {
          throw new Error('未获取到豆包无水印视频链接，已停止下载');
        } else {
          const result = await window.electronAPI.downloadResource({
            url,
            backupUrl,
            accountId,
            filename,
            source: currentResource?.source || '',
            confirmedNoWatermark
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

  resourceList.querySelectorAll('.resource-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const resourceId = btn.dataset.resourceid || '';
      if (!resourceId) {
        setStatus('该资源暂时无法删除');
        return;
      }
      btn.disabled = true;
      try {
        const result = await window.electronAPI.removeResource({ resourceId });
        if (!result?.ok) throw new Error(result?.message || '删除失败');
        setStatus('资源已删除');
      } catch (error) {
        btn.disabled = false;
        setStatus(`删除失败：${error.message || '未知错误'}`);
      }
    });
  });
}


let activeResourceBatchDownload = '';

function getBatchDownloadResources(type) {
  return state.resources.filter(resource => resource?.type === type);
}

function requiresWebviewBatchDownload(resource) {
  const type = resource?.type || '';
  const url = resource?.url || '';
  const source = String(resource?.source || '').toLowerCase();
  const messageId = resource?.messageId || '';
  const account = state.accounts.find(item => item.id === resource?.accountId);
  if (type !== 'video') return false;
  if (messageId && (account?.platform === 'doubao' || !url)) return true;
  if (url.startsWith('blob:')) return true;
  return isDolaVideoUrl(url) && !source.includes('nowatermark');
}

function getBatchDownloadConcurrency(type, resources) {
  if (type === 'image') return 8;
  if (resources.some(requiresWebviewBatchDownload)) return 5;
  return 6;
}

async function downloadResourceForBatch(resource) {
  const type = resource?.type || '';
  const accountId = resource?.accountId || '';
  const account = state.accounts.find(item => item.id === accountId);
  const source = String(resource?.source || '').toLowerCase();
  const messageId = resource?.messageId || '';
  const nodeId = resource?.nodeId || '';
  const filename = getResourceDownloadFilename(resource);
  const url = resource?.url || '';

  // 豆包和待获取的视频都通过页面内解析流程获取真实下载地址。
  const shouldResolveByMessage = type === 'video' && messageId && (
    account?.platform === 'doubao' || !url
  );
  if (shouldResolveByMessage) {
    const canFetch = !!url || !source || source.includes('doubao') || source === 'dom';
    if (!canFetch) throw new Error('该视频还没有可用的下载地址');
    const webview = document.querySelector(`webview[partition="persist:account_${accountId}"]`);
    if (!webview) throw new Error('未找到对应的 WebView，请先打开该账号');
    const completion = waitForBatchResourceDownload(accountId, { messageId });
    try {
      await webview.executeJavaScript(`window.postMessage({ type: "startVideoDownloadByMessageId", messageId: ${JSON.stringify(messageId)}, nodeId: ${JSON.stringify(nodeId)}, filename: ${JSON.stringify(filename)}, title: ${JSON.stringify(resource?.title || '')}, suppressAutoDownload: true, downloadAfterResolve: true }, "*");` + ';void 0;');
      return await completion;
    } catch (error) {
      settleBatchResourceDownload(accountId, { messageId }, error);
      try { await completion; } catch (ignored) {}
      throw error;
    }
  }

  if (!url) throw new Error('资源地址不可用');

  if (url.startsWith('blob:')) {
    const webview = document.querySelector(`webview[partition="persist:account_${accountId}"]`);
    if (!webview) throw new Error('未找到对应的 WebView，请先打开该账号');
    const completion = waitForBatchResourceDownload(accountId, { filename });
    try {
      await webview.executeJavaScript(`window.postMessage({ type: "electronDownload", data: { url: ${JSON.stringify(url)}, filename: ${JSON.stringify(filename)} } }, "*");` + ';void 0;');
      return await completion;
    } catch (error) {
      settleBatchResourceDownload(accountId, { filename }, error);
      try { await completion; } catch (ignored) {}
      throw error;
    }
  }

  if (type === 'video' && isDolaVideoUrl(url) && !source.includes('nowatermark')) {
    downloadInWebview(accountId, url);
    return await waitForBatchResourceDownload(accountId, { url });
  }

  const confirmedNoWatermark = Boolean(resource?.confirmedNoWatermark)
    || isConfirmedNoWatermarkVideoUrl(url);
  if (account?.platform === 'doubao' && type === 'video' && !confirmedNoWatermark) {
    throw new Error('未获取到豆包无水印视频链接，已停止下载');
  }

  const result = await window.electronAPI.downloadResource({
    url,
    backupUrl: resource?.backupUrl || '',
    accountId,
    filename,
    source: resource?.source || '',
    confirmedNoWatermark
  });
  if (!result?.ok) throw new Error(result?.message || result?.reason || '下载失败');
  return result;
}

async function downloadResourceBatch(type, button) {
  if (activeResourceBatchDownload) return;
  const allResources = getBatchDownloadResources(type);
  const downloadableResources = allResources.filter(resource => resource.url || (type === 'video' && resource.messageId));
  const unavailableCount = allResources.length - downloadableResources.length;
  const label = type === 'image' ? '图片' : '视频';

  if (!allResources.length) {
    setStatus(`当前没有扫描到${label}`);
    return;
  }
  if (!downloadableResources.length) {
    setStatus(`扫描到 ${allResources.length} 个${label}，但暂时没有可用下载地址`);
    return;
  }

  activeResourceBatchDownload = type;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '下载中...';
  let startedCount = 0;
  let failedCount = 0;
  let nextIndex = 0;
  const workerCount = Math.min(
    downloadableResources.length,
    getBatchDownloadConcurrency(type, downloadableResources)
  );

  try {
    const worker = async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= downloadableResources.length) return;

        const resource = downloadableResources[index];
        const filename = getResourceDownloadFilename(resource);
        const taskId = addDownloadTask({ filename, accountId: resource.accountId, type });
        setStatus(`正在并行下载${label} ${Math.min(index + 1, downloadableResources.length)}/${downloadableResources.length}`);
        try {
          const result = await downloadResourceForBatch(resource);
          startedCount += 1;
          markResourceDownloadDone(resource);
          updateDownloadTask(taskId, {
            status: 'success',
            message: result?.filePath || '已完成',
            filename: result?.filePath ? result.filePath.split(/[\\/]/).pop() : filename
          });
        } catch (error) {
          failedCount += 1;
          updateDownloadTask(taskId, { status: 'error', message: error.message || '下载失败' });
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    activeResourceBatchDownload = '';
    button.disabled = false;
    button.textContent = originalText;
  }

  const details = [
    `已发起 ${startedCount} 个${label}`,
    failedCount ? `失败 ${failedCount} 个` : '',
    unavailableCount ? `${unavailableCount} 个暂无下载地址` : ''
  ].filter(Boolean).join('，');
  setStatus(details);
}

$('btnDownloadImages').addEventListener('click', () => {
  downloadResourceBatch('image', $('btnDownloadImages'));
});

$('btnDownloadVideos').addEventListener('click', () => {
  downloadResourceBatch('video', $('btnDownloadVideos'));
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
