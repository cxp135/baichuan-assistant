(function() {
  'use strict';

  if (window.__AIAM_DOLA_ELECTRON_BRIDGE__) return;
  window.__AIAM_DOLA_ELECTRON_BRIDGE__ = true;

  const pending = new Map();
  const capture = {
    pageKey: '',
    fplayUrls: [],
    mediaUrls: []
  };

  function pushUnique(list, value) {
    if (!value || list.includes(value)) return;
    list.unshift(value);
    if (list.length > 40) list.length = 40;
  }

  function sendHostRequest(message, callback) {
    const requestId = `dola_bg_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    if (typeof callback === 'function') {
      pending.set(requestId, callback);
      setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        callback({ ok: false, error: '解析超时，请刷新页面后重试' });
      }, 45000);
    }
    window.postMessage({
      type: 'AIAM_DOLA_BG_REQUEST',
      requestId,
      message
    }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.type === 'AIAM_DOLA_BG_RESPONSE' && data.requestId) {
      const callback = pending.get(data.requestId);
      if (!callback) return;
      pending.delete(data.requestId);
      callback(data.response || { ok: false, error: '解析失败' });
    }
  });

  window.chrome = window.chrome || {};
  window.chrome.storage = window.chrome.storage || {};
  const storageData = {};
  window.chrome.storage.local = window.chrome.storage.local || {
    get(defaults, callback) {
      const result = { ...(defaults || {}) };
      for (const [key, value] of Object.entries(storageData)) result[key] = value;
      if (typeof callback === 'function') setTimeout(() => callback(result), 0);
    },
    set(values, callback) {
      Object.assign(storageData, values || {});
      if (typeof callback === 'function') setTimeout(callback, 0);
    }
  };

  const originalSendMessage = window.chrome.runtime && window.chrome.runtime.sendMessage;
  window.chrome.runtime = window.chrome.runtime || {};
  window.chrome.runtime.sendMessage = function(message, callback) {
    if (message && typeof message.type === 'string' && message.type.startsWith('DOLA_BG_')) {
      if (message.type === 'DOLA_BG_SET_PAGE') {
        capture.pageKey = message.pageKey || capture.pageKey;
        if (typeof callback === 'function') setTimeout(() => callback({ ok: true }), 0);
        return;
      }
      if (message.type === 'DOLA_BG_REMEMBER') {
        pushUnique(capture.fplayUrls, message.url);
        if (typeof callback === 'function') setTimeout(() => callback({ ok: true }), 0);
        return;
      }
      if (message.type === 'DOLA_BG_GET_CAPTURE') {
        if (typeof callback === 'function') {
          setTimeout(() => callback({
            ok: true,
            fplayUrls: capture.fplayUrls.slice(),
            mediaUrls: capture.mediaUrls.slice()
          }), 0);
        }
        return;
      }
      sendHostRequest(message, callback);
      return;
    }

    if (typeof originalSendMessage === 'function') {
      return originalSendMessage.call(window.chrome.runtime, message, callback);
    }
    if (typeof callback === 'function') setTimeout(() => callback({ ok: true }), 0);
  };

  window.chrome.downloads = window.chrome.downloads || {};
  window.chrome.downloads.download = function(options, callback) {
    sendHostRequest({
      type: 'DOLA_BG_DOWNLOAD_DIRECT',
      videoUrl: options && options.url,
      filename: options && options.filename,
      referer: location.href
    }, callback);
  };
})();
