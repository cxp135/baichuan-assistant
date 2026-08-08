const { contextBridge, ipcRenderer, clipboard } = require('electron');

const DEBUG_LOG_ENABLED = process.env.AIAM_DEBUG_LOG === '1';
if (!DEBUG_LOG_ENABLED) {
  console.log = () => {};
}

contextBridge.exposeInMainWorld('electronAPI', {
  getExtensionScripts: () => ipcRenderer.invoke('get-extension-scripts'),

  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (data) => ipcRenderer.invoke('add-account', data),
  updateAccount: (id, patch) => ipcRenderer.invoke('update-account', { id, patch }),
  deleteAccount: (id) => ipcRenderer.invoke('delete-account', id),
  exportAccounts: () => ipcRenderer.invoke('export-accounts'),
  importAccounts: (options) => ipcRenderer.invoke('import-accounts', options),
  getPlatforms: () => ipcRenderer.invoke('get-platforms'),
  getPlatformUrl: (id) => ipcRenderer.invoke('get-platform-url', id),
  getCompatUserAgent: () => ipcRenderer.invoke('get-compat-user-agent'),
  externalLoginStatus: (accountId) => ipcRenderer.invoke('external-login-status', accountId),
  externalLoginStart: (accountId) => ipcRenderer.invoke('external-login-start', accountId),
  externalLoginSync: (accountId) => ipcRenderer.invoke('external-login-sync', accountId),
  externalLoginClose: (accountId) => ipcRenderer.invoke('external-login-close', accountId),
  licenseStatus: () => ipcRenderer.invoke('license-status'),
  activateLicense: (payload) => ipcRenderer.invoke('license-activate', payload),
  copyLicenseDevice: (deviceId) => ipcRenderer.invoke('license-copy-device', deviceId),
  licenseNetworkInfo: () => ipcRenderer.invoke('license-network-info'),
  copyText: (text) => {
    clipboard.writeText(String(text || ''));
    return true;
  },

  getResources: () => ipcRenderer.invoke('get-resources'),
  removeResource: (payload) => ipcRenderer.invoke('remove-resource', payload),
  clearResources: () => ipcRenderer.invoke('clear-resources'),
  getDownloadDir: () => ipcRenderer.invoke('get-download-dir'),
  openDownloadDir: () => ipcRenderer.invoke('open-download-dir'),
  chooseDownloadDir: () => ipcRenderer.invoke('choose-download-dir'),
  createDesktopShortcut: () => ipcRenderer.invoke('create-desktop-shortcut'),
  listDownloadFiles: () => ipcRenderer.invoke('list-download-files'),
  openDownloadFile: (filePath) => ipcRenderer.invoke('open-download-file', filePath),
  revealDownloadFile: (filePath) => ipcRenderer.invoke('reveal-download-file', filePath),
  deleteDownloadFile: (filePath) => ipcRenderer.invoke('delete-download-file', filePath),
  copyDownloadFilePath: (filePath) => ipcRenderer.invoke('copy-download-file-path', filePath),
  startDownloadFileDrag: (filePath) => ipcRenderer.send('start-download-file-drag', filePath),
  resolveDolaNowatermark: (payload) => ipcRenderer.invoke('resolve-dola-nowatermark', payload),
  downloadResource: (payload) => ipcRenderer.invoke('download-resource', payload),
  saveBlob: (data) => ipcRenderer.invoke('save-blob', data),

  deepseekGenerate: (payload) => ipcRenderer.invoke('deepseek-generate', payload),

  onResourcesUpdated: (callback) => {
    ipcRenderer.on('resources-updated', (_event, data) => callback(data));
  },
  onFileDownloaded: (callback) => {
    ipcRenderer.on('file-downloaded', (_event, data) => callback(data));
  },
  onDebuggerVideoDetected: (callback) => {
    ipcRenderer.on('debugger-video-detected', (_event, videos) => callback(videos));
  },

  reportCapturedResources: (accountId, resources) => {
    ipcRenderer.send('resource-captured', { accountId, resources });
  },
  registerWebview: (accountId, webContentsId) => {
    ipcRenderer.send('register-webview', { accountId, webContentsId });
  },
  getWebviewMap: () => ipcRenderer.invoke('get-webview-map'),
  setupDownloadHandler: (accountId) => {
    ipcRenderer.send('setup-download-handler', accountId);
  },

  getSession: () => ipcRenderer.invoke('get-session'),
  saveSession: (data) => ipcRenderer.invoke('save-session', data),

  publishGetPlatforms: () => ipcRenderer.invoke('publish-get-platforms'),
  publishAIContent: (payload) => ipcRenderer.invoke('publish-ai-content', payload),
  publishToPlatform: (payload) => ipcRenderer.invoke('publish-to-platform', payload),
  publishStatus: (taskId) => ipcRenderer.invoke('publish-status', taskId),
  onPublishProgress: (callback) => {
    ipcRenderer.on('publish-progress', (_event, data) => callback(data));
  },

  projectCreate: (payload) => ipcRenderer.invoke('project-create', payload),
  projectList: () => ipcRenderer.invoke('project-list'),
  projectGet: (projectId) => ipcRenderer.invoke('project-get', projectId),
  projectUpdate: (projectId, patch) => ipcRenderer.invoke('project-update', { projectId, patch }),
  projectDelete: (projectId) => ipcRenderer.invoke('project-delete', projectId),
  projectGenerateScripts: (payload) => ipcRenderer.invoke('project-generate-scripts', payload),
  projectUpdateScript: (projectId, scriptId, content) => ipcRenderer.invoke('project-update-script', { projectId, scriptId, content }),
  projectAIModifyScript: (payload) => ipcRenderer.invoke('project-ai-modify-script', payload),
  projectDeleteScript: (projectId, scriptId) => ipcRenderer.invoke('project-delete-script', { projectId, scriptId }),
  projectSendToDialogue: (payload) => ipcRenderer.invoke('project-send-to-dialogue', payload),
  onProjectGenProgress: (callback) => {
    ipcRenderer.on('project-gen-progress', (_event, data) => callback(data));
  },

  dashboardSummary: () => ipcRenderer.invoke('dashboard-summary'),

  publishRecordsList: () => ipcRenderer.invoke('publish-records-list'),
  publishRecordsUpdate: (payload) => ipcRenderer.invoke('publish-records-update', payload),
  publishRecordsDelete: (recordId) => ipcRenderer.invoke('publish-records-delete', { recordId })
});
