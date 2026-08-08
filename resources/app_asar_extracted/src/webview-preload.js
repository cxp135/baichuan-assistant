const { ipcRenderer } = require('electron');

const DEBUG_LOG_ENABLED = process.env.AIAM_DEBUG_LOG === '1';
if (!DEBUG_LOG_ENABLED) {
  console.log = () => {};
}

console.log('[webview-preload] loaded:', location.href);

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  console.log('[webview-preload] postMessage:', data.type);

  if (data.type === 'electronDownload' && data.data && data.data.url) {
    const {
      url,
      backupUrl,
      filename,
      type,
      source,
      confirmedNoWatermark,
      vid,
      nodeId,
      messageId,
      title,
      thumbUrl,
      width,
      height,
      definition
    } = data.data;
    if (String(url).startsWith('blob:')) {
      fetchBlobAndSend(url, filename || 'download');
      return;
    }
    ipcRenderer.sendToHost('download-request', {
      url,
      backupUrl,
      filename,
      type,
      source,
      confirmedNoWatermark: Boolean(confirmedNoWatermark),
      vid,
      nodeId,
      messageId,
      title,
      thumbUrl,
      width,
      height,
      definition
    });
    return;
  }

  if (data.type === 'AIAM_DOLA_BG_REQUEST' && data.requestId && data.message) {
    ipcRenderer.sendToHost('dola-bg-request', {
      requestId: data.requestId,
      message: data.message
    });
    return;
  }

  if (data.type === 'AIAM_VIDEO_GENERATED_NOTICE') {
    ipcRenderer.sendToHost('video-generated-notice', data.data || {});
    return;
  }

  if (data.type === 'resourcesDataExtracted' && Array.isArray(data.data) && data.data.length > 0) {
    const resources = data.data.map(item => ({
      type: item.type === 'image' ? 'image' : 'video',
      url: item.url || item.imageUrl || item.videoUrl || '',
      backupUrl: item.backupUrl || '',
      vid: item.vid,
      nodeId: item.nodeId,
      messageId: item.messageId,
      title: item.title,
      thumbUrl: item.thumbUrl || item.coverUrl || '',
      createdAt: item.createdAt || item.created_at || item.createdTime || item.created_time || item.generatedAt || item.generated_at || item.generatedTime || item.generated_time || item.generationTime || item.generation_time || item.creationTime || item.creation_time || item.ctime || item.create_timestamp || item.created_timestamp || item.generation_timestamp || item.createDate || item.createdDate,
      source: item.source || 'resources-data-extracted',
      pageUrl: location.href,
      referer: location.href,
      width: item.width,
      height: item.height,
      definition: item.definition,
      confirmedNoWatermark: item.type === 'image' ? true : !!item.confirmedNoWatermark,
      status: item.url || item.imageUrl || item.videoUrl ? 'ready' : 'pending'
    })).filter(item => item.url);
    if (resources.length > 0) ipcRenderer.sendToHost('captured-resources', resources);
    return;
  }

  if (data.type === 'imageDataExtracted') {
    const images = (Array.isArray(data.data) ? data.data : []).map(img => ({
      type: 'image',
      url: img.no_watermark_url || img.watermark_url || img.url,
      thumbUrl: img.watermark_url || img.thumbUrl || img.no_watermark_url || img.url,
      width: img.width,
      height: img.height,
      title: img.title || img.prompt || img.description,
      source: img.source || 'image-data-extracted',
      pageUrl: location.href,
      referer: location.href
    })).filter(img => img.url);

    if (images.length > 0) {
      ipcRenderer.sendToHost('captured-resources', images);
    }
    return;
  }

  if (data.type === 'videoDataExtracted' && Array.isArray(data.data) && data.data.length > 0) {
    const videos = data.data.map(v => ({
      type: 'video',
      url: v.videoUrl || v.url || '',
      backupUrl: v.backupUrl || '',
      vid: v.vid,
      nodeId: v.nodeId,
      messageId: v.messageId,
      title: v.title,
      thumbUrl: v.thumbUrl,
      createdAt: v.createdAt || v.created_at || v.createdTime || v.created_time || v.generatedAt || v.generated_at || v.generatedTime || v.generated_time || v.generationTime || v.generation_time || v.creationTime || v.creation_time || v.ctime || v.create_timestamp || v.created_timestamp || v.generation_timestamp || v.createDate || v.createdDate,
      source: v.source,
      pageUrl: location.href,
      referer: location.href,
      width: v.width,
      height: v.height,
      definition: v.definition,
      confirmedNoWatermark: !!v.confirmedNoWatermark,
      status: v.videoUrl || v.url ? 'ready' : 'pending'
    }));
    ipcRenderer.sendToHost('video-metadata', videos);
    return;
  }

  if (data.type === 'videoDownloadResult' && data.data) {
    const result = data.data;
    if (result.success && result.videoUrl) {
      ipcRenderer.sendToHost('captured-resources', [{
        type: 'video',
        url: result.videoUrl,
        backupUrl: result.backupUrl,
        width: result.width,
        height: result.height,
        vid: result.vid,
        nodeId: result.nodeId,
        messageId: result.messageId,
        title: result.title,
        thumbUrl: result.thumbUrl,
        createdAt: result.createdAt || result.created_at || result.createdTime || result.created_time || result.generatedAt || result.generated_at || result.generatedTime || result.generated_time || result.generationTime || result.generation_time || result.creationTime || result.creation_time || result.ctime || result.create_timestamp || result.created_timestamp || result.generation_timestamp || result.createDate || result.createdDate,
        source: result.source,
        pageUrl: location.href,
        referer: location.href,
        definition: result.definition,
        confirmedNoWatermark: !!result.confirmedNoWatermark
      }]);
      if (result.downloadAfterResolve) {
        ipcRenderer.sendToHost('download-request', {
          url: result.videoUrl,
          backupUrl: result.backupUrl,
          filename: result.filename || '',
          messageId: result.messageId || '',
          type: 'video',
          source: result.source || '',
          confirmedNoWatermark: !!result.confirmedNoWatermark
        });
      }
    } else {
      ipcRenderer.sendToHost('download-error', {
        filename: result.filename || '',
        messageId: result.messageId || '',
        error: result.error || '解析下载链接失败'
      });
    }
  }
});

async function fetchBlobAndSend(blobUrl, filename) {
  try {
    const res = await fetch(blobUrl);
    if (!res.ok) {
      ipcRenderer.sendToHost('download-error', { error: `HTTP ${res.status}`, url: blobUrl });
      return;
    }

    const buffer = await res.arrayBuffer();
    const mime = res.headers.get('content-type') || 'application/octet-stream';
    let ext = '';
    if (mime.includes('png')) ext = '.png';
    else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
    else if (mime.includes('webp')) ext = '.webp';
    else if (mime.includes('mp4')) ext = '.mp4';
    else if (mime.includes('gif')) ext = '.gif';

    const baseName = String(filename || 'download');
    const finalFilename = /\.[a-z0-9]{2,5}$/i.test(baseName) ? baseName : baseName + ext;

    ipcRenderer.sendToHost('download-blob', {
      filename: finalFilename,
      mime,
      buffer: Array.from(new Uint8Array(buffer))
    });
  } catch (e) {
    ipcRenderer.sendToHost('download-error', { error: e.message || String(e), url: blobUrl });
  }
}
