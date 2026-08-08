// Chrome API compatibility layer for scripts injected into Electron webviews.
(function () {
  'use strict';

  if (window.__chromePolyfilled) return;
  window.__chromePolyfilled = true;

  const messageListeners = [];
  const storageStore = {};

  function asyncCallback(callback, value) {
    if (typeof callback === 'function') {
      setTimeout(() => callback(value), 0);
    }
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function sendElectronDownload(item) {
    const payload = item || {};
    if (!isHttpUrl(payload.url)) {
      return { success: false, error: 'download url invalid' };
    }
    window.postMessage({
      type: 'electronDownload',
      data: {
        url: payload.url,
        backupUrl: payload.backupUrl || '',
        filename: payload.filename || ''
      }
    }, '*');
    return { success: true };
  }

  async function resolveDoubaoVideo(videoKey) {
    if (!videoKey || !window.MaowangPlatformRules) {
      return { success: false, error: 'missing video key' };
    }
    try {
      const request = window.MaowangPlatformRules.buildDoubaoPlayInfoRequest(
        videoKey,
        crypto.randomUUID()
      );
      const response = await fetch(request.url, request.init);
      return window.MaowangPlatformRules.extractDoubaoPlayInfo(await response.json());
    } catch (error) {
      return { success: false, error: error.message || String(error) };
    }
  }

  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {};
  window.chrome.downloads = window.chrome.downloads || {};
  window.chrome.storage = window.chrome.storage || {};
  window.chrome.storage.local = window.chrome.storage.local || {};

  window.chrome.storage.local.get = function (defaults, callback) {
    const result = {};
    if (Array.isArray(defaults)) {
      for (const key of defaults) result[key] = storageStore[key];
    } else if (defaults && typeof defaults === 'object') {
      for (const [key, value] of Object.entries(defaults)) {
        result[key] = Object.prototype.hasOwnProperty.call(storageStore, key)
          ? storageStore[key]
          : value;
      }
    } else if (typeof defaults === 'string') {
      result[defaults] = storageStore[defaults];
    } else {
      Object.assign(result, storageStore);
    }
    asyncCallback(callback, result);
  };

  window.chrome.storage.local.set = function (values, callback) {
    Object.assign(storageStore, values || {});
    asyncCallback(callback);
  };

  window.chrome.storage.local.remove = function (keys, callback) {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete storageStore[key];
    asyncCallback(callback);
  };

  window.chrome.storage.local.clear = function (callback) {
    for (const key of Object.keys(storageStore)) delete storageStore[key];
    asyncCallback(callback);
  };

  window.chrome.runtime.sendMessage = function (message, callback) {
    if (message && message.type === 'MW_PING') {
      asyncCallback(callback, { success: true });
      return;
    }

    if (message && message.type === 'MW_STATUS_UPDATE') {
      asyncCallback(callback, { success: true });
      return;
    }

    if (message && message.type === 'MW_GET_STATUS') {
      asyncCallback(callback, {
        success: true,
        version: '1.1.1',
        totals: {
          doubao: { imageCount: 0, videoCount: 0 },
          qianwen: { imageCount: 0, videoCount: 0 }
        },
        health: {
          activePages: 1,
          readyPages: 1,
          warningPages: 0,
          platforms: { doubao: 'ready', qianwen: 'inactive' }
        },
        imageCount: 0,
        videoCount: 0
      });
      return;
    }

    if (message && message.type === 'MW_DOWNLOAD') {
      asyncCallback(callback, sendElectronDownload(message.item));
      return;
    }

    if (message && message.type === 'MW_DOWNLOAD_MANY') {
      const items = Array.isArray(message.items) ? message.items : [];
      let successCount = 0;
      for (const item of items) {
        if (sendElectronDownload(item).success) successCount += 1;
      }
      asyncCallback(callback, {
        success: successCount > 0,
        successCount,
        failCount: Math.max(0, items.length - successCount),
        total: items.length
      });
      return;
    }

    if (message && message.type === 'MW_RESOLVE_DOUBAO_VIDEO') {
      resolveDoubaoVideo(message.videoKey).then((result) => asyncCallback(callback, result));
      return true;
    }

    if (message && message.type === 'GET_IMAGE_LIST') {
      asyncCallback(callback, { success: true, data: [] });
      return;
    }

    if (message && message.type === 'downloadImage') {
      asyncCallback(callback, sendElectronDownload({ url: message.url, filename: message.filename }));
      return;
    }

    if (message && message.type === 'bigmusicShareSave') {
      fetch('https://api-normal.doubao.com/alice/media/bigmusic/share_save?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&region=CN&sys_region=CN&samantha_web=1&use-olympus-account=1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ message_id: message.messageId })
      })
        .then((resp) => resp.json())
        .then((json) => {
          if (json && json.code === 0 && json.data && json.data.share_id) {
            asyncCallback(callback, {
              success: true,
              share_id: json.data.share_id,
              share_url: json.data.share_url || `https://www.doubao.com/video-sharing?share_id=${json.data.share_id}`
            });
          } else {
            asyncCallback(callback, { success: false, error: `API_ERROR:${json?.code || 'unknown'}:${json?.msg || ''}` });
          }
        })
        .catch((error) => {
          asyncCallback(callback, { success: false, error: error.message || String(error) });
        });
      return true;
    }

    if (message && message.type === 'CHECK_VERSION') {
      asyncCallback(callback, {
        valid: true,
        version: '1.0',
        warning: '',
        updateUrl: '',
        newVersion: '',
        imageCount: 0,
        videoCount: 0
      });
      return;
    }

    window.postMessage({ type: 'chromeSendMessage', data: message }, '*');
    asyncCallback(callback);
  };

  window.chrome.runtime.onMessage = window.chrome.runtime.onMessage || {};
  window.chrome.runtime.onMessage.addListener = function (callback) {
    messageListeners.push(callback);
  };

  window.chrome.runtime.getURL = function (path) {
    return path;
  };

  window.chrome.runtime.getManifest = function () {
    return { manifest_version: 3, name: 'Maowang Doubao', version: '1.1.1' };
  };

  window.chrome.runtime.id = 'polyfill-extension-id';

  window.chrome.downloads.download = function (options, callback) {
    const result = sendElectronDownload({
      url: options?.url,
      filename: options?.filename || String(options?.url || '').split('/').pop()
    });
    asyncCallback(callback, result.success ? Date.now() : undefined);
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'chromeOnMessage' && data.type !== 'newImageData' && data.type !== 'startVideoDownload') return;
    for (const callback of messageListeners) {
      try {
        callback(data.type === 'chromeOnMessage' ? data.data : data, {}, () => {});
      } catch (e) {}
    }
  });
})();
