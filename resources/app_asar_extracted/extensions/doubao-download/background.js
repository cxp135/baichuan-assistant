let imageList = [];
let videoList = [];
const CURRENT_VERSION = "1.0";

async function callBigmusicShareSave(messageId) {
  const body = { message_id: messageId };
  try {
    const resp = await fetch("https://api-normal.doubao.com/alice/media/bigmusic/share_save?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7550681679050343936&pc_version=3.14.6&region=CN&sys_region=CN&samantha_web=1&use-olympus-account=1", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "include",
      body: JSON.stringify(body)
    });
    const json = await resp.json();
    if (json.code === 0 && json.data) {
      const shareId = json.data.share_id;
      return { success: true, share_id: shareId, share_url: json.data.share_url || `https://www.doubao.com/video-sharing?share_id=${shareId}` };
    }
    return { success: false, error: `API错误: code=${json.code}, msg=${json.msg}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function downloadImage(url, filename) {
  try {
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
    return { success: true, downloadId, filename };
  } catch (err) {
    throw err;
  }
}

async function downloadVideo(url, filename, backupUrl) {
  try {
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
    return { success: true, downloadId, filename };
  } catch (err) {
    if (backupUrl) {
      try {
        const downloadId = await chrome.downloads.download({ url: backupUrl, filename, saveAs: false, conflictAction: "uniquify" });
        return { success: true, downloadId, filename, usedBackup: true };
      } catch (e) {
        throw e;
      }
    }
    throw err;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "downloadImage") {
    downloadImage(message.url, message.filename)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "imageDataExtracted") {
    const newImages = message.data || [];
    const existingUrls = new Set(imageList.map(img => img.no_watermark_url));
    const filtered = newImages.filter(img => !existingUrls.has(img.no_watermark_url));
    if (filtered.length) imageList.push(...filtered);
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "GET_IMAGE_LIST") {
    sendResponse({ success: true, data: imageList });
    return true;
  }
  if (message.type === "CHECK_VERSION") {
    sendResponse({
      valid: true,
      message: "",
      warning: "",
      expireDate: "",
      updateUrl: "",
      newVersion: "",
      imageCount: imageList.length,
      videoCount: videoList.length,
      version: CURRENT_VERSION
    });
    return true;
  }
  if (message.type === "CLEAR_IMAGES") {
    imageList = [];
    videoList = [];
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "videoDataExtracted") {
    const newVideos = message.data || [];
    const existingVids = new Set(videoList.map(v => v.vid));
    const filtered = newVideos.filter(v => !existingVids.has(v.vid));
    if (filtered.length) videoList.push(...filtered);
    sendResponse({ success: true });
    return true;
  }
  if (message.type === "startVideoDownload") {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs || tabs.length === 0) {
        sendResponse({ success: false, error: "未找到活动标签页" });
        return;
      }
      const tab = tabs[0];
      if (tab.url && tab.url.includes("doubao.com")) {
        chrome.tabs.sendMessage(tab.id, { type: "startVideoDownload" }, response => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: "无法连接到页面，请刷新页面后重试" });
          } else {
            sendResponse({ success: true });
          }
        });
      } else {
        sendResponse({ success: false, error: "请在豆包页面使用此功能" });
      }
    });
    return true;
  }
  if (message.type === "bigmusicShareSave") {
    callBigmusicShareSave(message.messageId)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "videoDownloadResult") {
    const data = message.data;
    if (data?.success && data?.videoUrl) {
      const timestamp = Date.now();
      const filename = data.filename || `doubao_video${data.width && data.height ? `_${data.width}x${data.height}` : ""}_${timestamp}.mp4`;
      downloadVideo(data.videoUrl, filename, data.backupUrl)
        .then(result => {
          data.downloadResult = result;
          chrome.runtime.sendMessage({ type: "videoDownloadResult", data }).catch(() => {});
        })
        .catch(err => {
          data.downloadResult = { success: false, error: err.message };
          chrome.runtime.sendMessage({ type: "videoDownloadResult", data }).catch(() => {});
        });
    } else {
      chrome.runtime.sendMessage({ type: "videoDownloadResult", data }).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }
});
