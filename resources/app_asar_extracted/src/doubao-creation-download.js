(function () {
  const SCRIPT_VERSION = '2026-08-05-creation-download-scope-media-v21';
  const DOUBAO_CREATION_SCAN_URL = 'https://www.doubao.com/chat/create-image?tab=myCreation';
  if (window.__AIAM_DOUBAO_CREATION_DOWNLOAD__ === SCRIPT_VERSION) return;
  window.__AIAM_DOUBAO_CREATION_DOWNLOAD__ = SCRIPT_VERSION;

  if (!/(^|\.)doubao\.com$/i.test(location.hostname)) return;

  function isCreationPageLocation() {
    return /\/chat\/create-image/i.test(location.pathname) && /(?:^|[?&])tab=myCreation(?:&|$)/i.test(location.search || '');
  }

  const STYLE_ID = 'aiam-doubao-creation-download-style';
  const PANEL_CLASS = 'aiam-doubao-creation-panel';
  const STATUS_CLASS = 'aiam-doubao-creation-status';
  const HIT_CLASS = 'aiam-doubao-creation-hit';
  let selectionMode = false;
  let hoverNode = null;
  let pendingRevealToken = 0;
  let creationNodeCache = { time: 0, nodes: [] };
  let creationNodePageDebug = [];

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${PANEL_CLASS} {
        position: fixed !important;
        right: 24px !important;
        top: 82px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 8px !important;
        border-radius: 12px !important;
        background: rgba(255,255,255,.96) !important;
        color: #111827 !important;
        box-shadow: 0 12px 32px rgba(15,23,42,.18) !important;
        border: 1px solid rgba(15,23,42,.08) !important;
        font-size: 13px !important;
      }
      .${PANEL_CLASS} button {
        height: 32px !important;
        padding: 0 12px !important;
        border: none !important;
        border-radius: 999px !important;
        background: #111827 !important;
        color: #fff !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
      }
      .${PANEL_CLASS} span { color: #64748b !important; white-space: nowrap !important; }
      .${STATUS_CLASS} {
        position: fixed !important;
        right: 24px !important;
        top: 132px !important;
        z-index: 2147483647 !important;
        max-width: 420px !important;
        padding: 9px 13px !important;
        border-radius: 999px !important;
        background: rgba(17,24,39,.92) !important;
        color: #fff !important;
        font-size: 13px !important;
        line-height: 1.35 !important;
        pointer-events: none !important;
        box-shadow: 0 10px 26px rgba(0,0,0,.24) !important;
      }
      .${HIT_CLASS} {
        outline: 3px solid #2563eb !important;
        outline-offset: -3px !important;
        box-shadow: inset 0 0 0 9999px rgba(37,99,235,.10) !important;
      }
      html.aiam-doubao-creation-select * { cursor: crosshair !important; }
    `;
    document.documentElement.appendChild(style);
  }

  function showStatus(text) {
    installStyle();
    let node = document.querySelector(`.${STATUS_CLASS}`);
    if (!node) {
      node = document.createElement('div');
      node.className = STATUS_CLASS;
      document.documentElement.appendChild(node);
    }
    node.textContent = text;
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.remove(), 3200);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setSelectionMode(active) {
    selectionMode = Boolean(active);
    document.documentElement.classList.toggle('aiam-doubao-creation-select', selectionMode);
    if (!selectionMode && hoverNode) {
      hoverNode.classList.remove(HIT_CLASS);
      hoverNode = null;
    }
    updatePanel();
    if (selectionMode) showStatus('请选择一个豆包 AI 创作视频卡片');
  }

  function updatePanel() {
    const panel = document.querySelector(`.${PANEL_CLASS}`);
    if (!panel) return;
    const button = panel.querySelector('button');
    const label = panel.querySelector('span');
    if (button) button.textContent = selectionMode ? '选择中...' : '选择视频下载原视频';
    if (label) label.textContent = selectionMode ? '现在点一个视频作品' : '只下载明确无水印的视频字段';
  }

  function ensurePanel() {
    installStyle();
    let panel = document.querySelector(`.${PANEL_CLASS}`);
    if (panel) {
      updatePanel();
      return panel;
    }
    panel = document.createElement('div');
    panel.className = PANEL_CLASS;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '选择视频下载原视频';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectionMode(!selectionMode);
    }, true);
    const label = document.createElement('span');
    label.textContent = '只下载明确无水印的视频字段';
    panel.append(button, label);
    document.documentElement.appendChild(panel);
    return panel;
  }

  function visible(node) {
    if (!node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width >= 48 && rect.height >= 48 &&
      rect.bottom > 0 && rect.right > 0 &&
      rect.top < window.innerHeight && rect.left < window.innerWidth &&
      style.display !== 'none' && style.visibility !== 'hidden';
  }

  function getCard(node) {
    let current = node;
    let best = node;
    let bestArea = Number.POSITIVE_INFINITY;
    for (let level = 0; current && current !== document.body && level < 10; level += 1) {
      if (visible(current)) {
        const rect = current.getBoundingClientRect();
        if (rect.width >= 120 && rect.height >= 120 && rect.width <= 680 && rect.height <= 680) {
          const area = rect.width * rect.height;
          if (area < bestArea) {
            best = current;
            bestArea = area;
          }
        }
      }
      current = current.parentElement;
    }
    return best;
  }

  function getNodeAtPoint(event) {
    const elements = document.elementsFromPoint?.(event.clientX, event.clientY) || [];
    const candidates = elements.filter(node => {
      if (!(node instanceof Element)) return false;
      if (node.closest(`.${PANEL_CLASS},.${STATUS_CLASS}`)) return false;
      if (node.tagName === 'VIDEO' || node.tagName === 'IMG') return visible(node);
      if (node.querySelector?.('video,img') && visible(node)) return true;
      return false;
    });
    const target = candidates.find(node => {
      const src = String(node.currentSrc || node.src || '');
      return (node.tagName === 'VIDEO' || node.tagName === 'IMG') && src && !src.startsWith('data:');
    }) || candidates[0];
    return target ? getCard(target) : null;
  }

  function findFiberRecords(node) {
    const records = [];
    const seen = new WeakSet();
    let current = node;
    while (current && current !== document.documentElement) {
      const fiberKey = Object.keys(current).find(key => key.startsWith('__reactFiber') || key.startsWith('__reactProps'));
      let fiber = fiberKey ? current[fiberKey] : null;
      let guard = 0;
      while (fiber && guard < 80) {
        guard += 1;
        const props = fiber.memoizedProps || fiber.pendingProps || fiber;
        collectRecordLike(props, records, seen, 0);
        fiber = fiber.return;
      }
      current = current.parentElement;
    }
    return records;
  }

  function collectRecordLike(value, out, seen, depth) {
    if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return;
    seen.add(value);
    const keys = Object.keys(value);
    const keyText = keys.join(' ').toLowerCase();
    if (/video|media|creation|item|work|asset|download|origin|original|play|url/.test(keyText)) {
      out.push(value);
    }
    for (const key of keys.slice(0, 80)) {
      const child = value[key];
      if (child && typeof child === 'object') collectRecordLike(child, out, seen, depth + 1);
    }
  }

  function normalizeUrl(value) {
    if (typeof value !== 'string') return '';
    const text = value.trim().replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    if (/^https?:\/\//i.test(text)) return text;
    return '';
  }

  function getCoverKey(url) {
    const text = normalizeUrl(url);
    if (!text) return '';
    try {
      const parsed = new URL(text, location.href);
      return decodeURIComponent(parsed.pathname).replace(/~[^/]*$/, '').toLowerCase();
    } catch (e) {
      return text.split('?')[0].replace(/~[^/]*$/, '').toLowerCase();
    }
  }

  function isVideoUrl(url, path) {
    const text = `${path} ${url}`.toLowerCase();
    if (/(image|img|photo|picture|image_ori|image_url)/i.test(text) &&
        !/(video|mp4|webm|mov|m4v|play_url|video_url|mime_type=video)/i.test(text)) {
      return false;
    }
    return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) ||
      /\/video\//i.test(url) ||
      /video|play_url|main_url|backup_url|download_url|source_url|origin_url|original_url|raw_url|master_url/i.test(path);
  }

  function isImageUrl(url, path = '') {
    const normalized = normalizeUrl(url);
    if (!normalized || isVideoUrl(normalized, path)) return false;
    const text = `${path} ${normalized}`.toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i.test(normalized) ||
      /image|img|photo|picture|cover|thumbnail|poster/i.test(text);
  }

  function scoreImageUrl(url, path = '') {
    const text = `${path} ${url}`.toLowerCase();
    let score = 0;
    if (/original|origin|raw|large|full|download|image_ori/.test(text)) score += 100;
    if (/\.(png|jpe?g|webp|avif)(\?|#|$)/i.test(url)) score += 35;
    if (/thumb|thumbnail|cover|poster|avatar|icon|logo/.test(text)) score -= 35;
    return score;
  }

  function collectImageUrls(value, path, out, seen, depth = 0) {
    if (depth > 12 || value == null) return;
    if (typeof value === 'string') {
      const url = normalizeUrl(value);
      if (!url || !isImageUrl(url, path)) return;
      out.push({ url, path, score: scoreImageUrl(url, path) });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectImageUrls(item, `${path}[${index}]`, out, seen, depth + 1));
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      collectImageUrls(child, path ? `${path}.${key}` : key, out, seen, depth + 1);
    }
  }

  function pickBestImageUrl(value) {
    const candidates = [];
    collectImageUrls(value, '', candidates, new WeakSet());
    return uniqueBy(candidates, item => item.url).sort((a, b) => b.score - a.score)[0]?.url || '';
  }

  function getVideoRejectReason(url, path) {
    const text = `${path} ${url}`.toLowerCase();
    if (/with_watermark=1|with_watermark=true|wm=1|watermark=true|no_watermark=false|aigc_busi_mark|aigc_resize_mark/.test(text)) {
      return 'watermark-signal';
    }
    if (/thumb|cover|poster|preview/.test(text) && !/download|origin|original|source|raw|master/i.test(text)) {
      return 'preview-only';
    }
    return '';
  }

  function isRejectedVideoUrl(url, path) {
    return Boolean(getVideoRejectReason(url, path));
  }

  function scoreVideoUrl(url, path) {
    const text = `${path} ${url}`.toLowerCase();
    let score = 0;
    if (/no[_-]?watermark|without[_-]?watermark|logo_type=no_watermark|watermark=false/.test(text)) score += 200;
    if (/origin|original|source|raw|master|download/.test(text)) score += 80;
    if (/main_url|play_url|video_url/.test(text)) score += 30;
    if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) score += 20;
    if (/backup|thumb|cover|poster|preview/.test(text)) score -= 40;
    return score;
  }

  function getDoubaoApiUrl(apiPath) {
    const path = String(apiPath || '');
    if (/^https?:\/\//i.test(path)) return path;
    try {
      const entries = performance.getEntriesByType?.('resource') || [];
      for (const entry of entries.slice().reverse()) {
        const url = String(entry.name || '');
        if (url.includes(path)) return url;
      }
      const samanthaEntry = entries.slice().reverse().find(entry => /\/samantha\//.test(String(entry.name || '')));
      if (samanthaEntry?.name) {
        const parsed = new URL(samanthaEntry.name);
        parsed.pathname = path;
        return parsed.href;
      }
    } catch (e) {}
    return path;
  }

  function analyzeVideoUrl(url, path) {
    const rejectReason = getVideoRejectReason(url, path);
    return {
      url,
      path,
      score: scoreVideoUrl(url, path),
      rejectReason,
      accepted: !rejectReason
    };
  }

  function collectVideoUrls(value, path, out, seen, depth = 0, includeRejected = false) {
    if (depth > 12 || value == null) return;
    if (typeof value === 'string') {
      const url = normalizeUrl(value);
      if (!url || !isVideoUrl(url, path)) return;
      const item = analyzeVideoUrl(url, path);
      if (!includeRejected && !item.accepted) return;
      out.push(item);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectVideoUrls(item, `${path}[${index}]`, out, seen, depth + 1, includeRejected));
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      collectVideoUrls(child, path ? `${path}.${key}` : key, out, seen, depth + 1, includeRejected);
    }
  }

  function pickBestVideo(records) {
    const candidates = [];
    for (const record of records) collectVideoUrls(record, '', candidates, new WeakSet());
    const deduped = [];
    const seen = new Set();
    for (const item of candidates) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      deduped.push(item);
    }
    return deduped.filter(item => item.accepted).sort((a, b) => b.score - a.score)[0] || null;
  }

  function collectNodeIds(value, out, seen, depth = 0) {
    if (depth > 8 || value == null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const direct = value.node_id || value.nodeId || value.node_id_str || value.nodeIdStr;
    const mediaNodeId = value.id && typeof value.key === 'string' && /^v\d/i.test(value.key)
      ? value.id
      : '';
    if (/^\d{8,}$/.test(String(direct || ''))) out.push(String(direct));
    if (/^\d{8,}$/.test(String(mediaNodeId || ''))) out.push(String(mediaNodeId));
    if (Array.isArray(value)) {
      value.forEach(item => collectNodeIds(item, out, seen, depth + 1));
      return;
    }
    for (const child of Object.values(value)) {
      collectNodeIds(child, out, seen, depth + 1);
    }
  }

  function collectMessageIds(value, out, seen, depth = 0) {
    if (depth > 8 || value == null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const direct = value.message_id || value.messageId || value.message_id_str || value.messageIdStr;
    if (/^\d{8,}$/.test(String(direct || ''))) out.push(String(direct));
    for (const [key, child] of Object.entries(value)) {
      const text = typeof child === 'string' || typeof child === 'number' ? String(child) : '';
      if (text && text.length <= 180 && /(^|_|\b)(message_id|messageid|msg_id|msgid|creation_task_id|creationtaskid|task_id|taskid)(_|$|\b)/i.test(key)) {
        out.push(text.trim());
      }
      if (child && typeof child === 'object') collectMessageIds(child, out, seen, depth + 1);
    }
  }

  function collectResolvedNodeIds(value, out, seen, depth = 0) {
    if (depth > 8 || value == null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const direct = value.node_id || value.nodeId || value.node_id_str || value.nodeIdStr;
    if (/^\d{8,}$/.test(String(direct || ''))) out.push(String(direct));
    for (const [key, child] of Object.entries(value)) {
      const text = typeof child === 'string' || typeof child === 'number' ? String(child) : '';
      if (text && text.length <= 180 && /(^|_|\b)(node_id|nodeid)(_|$|\b)/i.test(key)) {
        out.push(text.trim());
      }
      if (child && typeof child === 'object') collectResolvedNodeIds(child, out, seen, depth + 1);
    }
  }

  async function resolveNodeIdsFromMessageIds(messageIds) {
    const ids = uniqueBy((messageIds || []).map(item => String(item || '').trim()).filter(item => /^\d{8,}$/.test(item)), item => item);
    if (!ids.length) return [];
    const resolved = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const response = await fetch(getDoubaoApiUrl('/samantha/aispace/message_node_info'), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'agw-js-conv': 'str',
          origin: location.origin,
          referer: location.href
        },
        credentials: 'include',
        body: JSON.stringify({ message_ids: batch.map(item => Number(item)), message_ids_str: batch })
      });
      const json = await response.json();
      if (json.code !== 0) continue;
      collectResolvedNodeIds(json?.data || json, resolved, new WeakSet());
    }
    return uniqueBy(resolved, item => item);
  }

  async function postJson(url, body) {
    const response = await fetch(getDoubaoApiUrl(url), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'agw-js-conv': 'str',
        origin: location.origin,
        referer: location.href
      },
      credentials: 'include',
      body: JSON.stringify(body || {})
    });
    const json = await response.json();
    if (json.code !== 0) throw new Error(json.msg || json.message || `接口返回 ${json.code}`);
    return json;
  }

  function normalizeCreationTimestamp(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'object') {
      value = value.value ?? value.timestamp ?? value.time ?? value.seconds ?? value.milliseconds ?? '';
    }
    const text = String(value).trim();
    if (!text) return '';
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      let timestamp = Number(text);
      if (timestamp < 100000000000) timestamp *= 1000;
      if (timestamp > 100000000000000) timestamp /= 1000;
      return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : '';
    }
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : '';
  }

  function pickCreationTimestamp(value) {
    const roots = [value, value?.content, value?.metadata, value?.meta, value?.extra, value?.node_info, value?.nodeInfo];
    const keys = [
      'created_at', 'createdAt', 'created_time', 'createdTime', 'create_time', 'createTime',
      'generated_at', 'generatedAt', 'generated_time', 'generatedTime', 'generation_time',
      'generationTime', 'creation_time', 'creationTime', 'create_ts', 'created_ts',
      'ctime', 'create_timestamp', 'created_timestamp', 'generation_timestamp',
      'createDate', 'createdDate'
    ];
    for (const root of roots) {
      if (!root || typeof root !== 'object') continue;
      for (const key of keys) {
        const timestamp = normalizeCreationTimestamp(root[key]);
        if (timestamp) return timestamp;
      }
    }
    return '';
  }

  function collectCreationNodes(value, out, seen, depth = 0) {
    if (depth > 10 || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const id = value.id != null ? String(value.id) : '';
    const key = value.key != null ? String(value.key) : '';
    const name = value.name != null ? String(value.name) : '';
    if (/^\d{8,}$/.test(id) && (key || name || value.node_type)) {
      const coverUrls = [];
      const cover = value.node_cover || value.nodeCover || {};
      const listCover = cover?.list_view?.cover_url || cover?.listView?.coverUrl || '';
      const thumbCover = cover?.thumbnail_view?.cover_url || cover?.thumbnailView?.coverUrl || '';
      if (listCover) coverUrls.push(String(listCover));
      if (thumbCover) coverUrls.push(String(thumbCover));
      const imageUrl = pickBestImageUrl(value) || listCover || thumbCover || '';
      out.push({
        id,
        key,
        name,
        nodeType: Number(value.node_type || value.nodeType || 0),
        messageId: String(value?.content?.message_id_str || value?.content?.message_id || ''),
        creationTaskId: String(value?.content?.creation_task_id_str || ''),
        coverUrl: coverUrls[0] || '',
        width: Number(value?.content?.width || value.width || 0),
        height: Number(value?.content?.height || value.height || 0),
        duration: Number(value?.content?.duration || value.duration || 0),
        size: Number(value.size || value?.content?.size || 0),
        createdAt: pickCreationTimestamp(value),
        imageUrl,
        coverKeys: uniqueBy(coverUrls.map(getCoverKey), item => item, 8)
      });
    }
    if (Array.isArray(value)) {
      value.forEach(item => collectCreationNodes(item, out, seen, depth + 1));
      return;
    }
    for (const child of Object.values(value).slice(0, 160)) {
      if (child && typeof child === 'object') collectCreationNodes(child, out, seen, depth + 1);
    }
  }

  async function fetchLatestUsedVideoNodes() {
    const nodes = [];
    const payloads = [
      { nodeType: 6, size: 200 },
      { node_type: 6, size: 200 }
    ];
    for (const payload of payloads) {
      try {
        const info = await postJson('/samantha/aispace/node_lastest_used', payload);
        collectCreationNodes(info?.data || info, nodes, new WeakSet());
        const videos = uniqueBy(nodes.filter(isCreationVideoNode), item => item.id);
        creationNodePageDebug.push({
          page: `latest_used_${payload.nodeType != null ? 'nodeType' : 'node_type'}`,
          sentCursor: '',
          added: videos.length,
          hasMore: Boolean(info?.data?.has_more || info?.data?.hasMore),
          nextCursor: String(info?.data?.next_cursor || info?.data?.nextCursor || '')
        });
        if (videos.length) return videos;
      } catch (e) {
        creationNodePageDebug.push({
          page: `latest_used_error_${payload.nodeType != null ? 'nodeType' : 'node_type'}`,
          sentCursor: '',
          added: 0,
          hasMore: false,
          nextCursor: '',
          error: e.message || String(e)
        });
      }
    }
    return [];
  }

  async function fetchCreationNodes(options = {}) {
    const force = Boolean(options.force);
    if (!force && Date.now() - creationNodeCache.time < 45000 && creationNodeCache.nodes.length) {
      return creationNodeCache.nodes;
    }
    const home = await postJson('/samantha/aispace/homepage', {});
    const homeNodes = [];
    collectCreationNodes(home?.data || home, homeNodes, new WeakSet());
    const root = homeNodes.find(item => /我的创作|鎴戠殑鍒涗綔/.test(String(item.name || ''))) ||
      homeNodes.find(item => item.nodeType === 1 && item.key === item.id) ||
      homeNodes[0];
    if (!root?.id) return [];
    creationNodePageDebug = [];
    const loadNodeInfoPages = async (attempt = 1) => {
      const nodes = [];
      let cursor = '';
      const seenCursors = new Set();
      for (let page = 0; page < 1000; page += 1) {
        const payload = {
          node_id: root.id,
          need_full_path: true,
          sort_param: {
            need_sort_config: true,
            sort_order: 1,
            sort_type: 0
          },
          size: 50
        };
        if (cursor) {
          payload.cursor = cursor;
          payload.next_cursor_with_sort = cursor;
        }
        const info = await postJson('/samantha/aispace/node_info', payload);
        const beforeCount = nodes.length;
        collectCreationNodes(info?.data || info, nodes, new WeakSet());
        const data = info?.data || {};
        creationNodePageDebug.push({
          page: attempt === 1 ? page + 1 : `retry_${attempt}_${page + 1}`,
          sentCursor: cursor,
          added: nodes.length - beforeCount,
          hasMore: Boolean(data.has_more),
          nextCursor: String(data.next_cursor || data.nextCursor || '')
        });
        const nextCursor = String(data.next_cursor || data.nextCursor || '');
        if (!data.has_more || !nextCursor) break;
        if (seenCursors.has(nextCursor)) break;
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
      return uniqueBy(nodes, item => item.id);
    };

    let uniqueNodes = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      uniqueNodes = await loadNodeInfoPages(attempt);
      if (uniqueNodes.some(isCreationMediaNode)) break;
      if (!collectVisibleCreationVideoCoverKeys().length) break;
      creationNodePageDebug.push({
        page: `wait_video_nodes_${attempt}`,
        sentCursor: '',
        added: 0,
        hasMore: false,
        nextCursor: ''
      });
      await delay(1800);
    }
    const finalNodes = uniqueNodes.some(isCreationMediaNode)
      ? uniqueNodes
      : await fetchLatestUsedVideoNodes();
    creationNodeCache = {
      time: Date.now(),
      nodes: finalNodes
    };
    return creationNodeCache.nodes;
  }

  function collectVisibleCreationVideoCoverKeys(limit = Number.POSITIVE_INFINITY) {
    const mediaNodes = Array.from(document.querySelectorAll('img,video,source')).filter(visible);
    const keys = [];
    for (const node of mediaNodes) {
      const candidates = [
        node.currentSrc,
        node.src,
        node.poster,
        String(node.srcset || node.srcSet || '').split(',')[0]?.trim()?.split(/\s+/)[0]
      ];
      for (const url of candidates) {
        const key = getCoverKey(url || '');
        if (key && /tos-cn-p-9ecd54|tplv-noop|videoweb/i.test(String(url || ''))) keys.push(key);
      }
      if (keys.length >= limit) break;
    }
    return uniqueBy(keys, item => item, limit);
  }

  function collectVisibleCreationCoverKeys(limit = Number.POSITIVE_INFINITY) {
    const videoKeys = collectVisibleCreationVideoCoverKeys(limit);
    if (videoKeys.length) return videoKeys;
    const mediaNodes = Array.from(document.querySelectorAll('img,video,source')).filter(visible);
    const keys = [];
    for (const node of mediaNodes) {
      const candidates = [
        node.currentSrc,
        node.src,
        node.poster,
        String(node.srcset || node.srcSet || '').split(',')[0]?.trim()?.split(/\s+/)[0]
      ];
      for (const url of candidates) {
        const key = getCoverKey(url || '');
        if (key) keys.push(key);
      }
      if (keys.length >= limit) break;
    }
    return uniqueBy(keys, item => item, limit);
  }

  function parseCreationDateText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/(?:^|\s)(20\d{2})\s*[./年-]\s*(\d{1,2})\s*[./月-]\s*(\d{1,2})\s*日?(?:\s|$)/);
    if (!match) return '';
    return `${match[1]}/${String(match[2]).padStart(2, '0')}/${String(match[3]).padStart(2, '0')}`;
  }

  function getCreationDateCard(node) {
    let current = node;
    let best = node;
    let bestArea = Number.POSITIVE_INFINITY;
    for (let level = 0; current && current !== document.body && level < 10; level += 1) {
      const rect = current.getBoundingClientRect?.();
      if (rect && rect.width >= 120 && rect.height >= 100 && rect.width <= 720 && rect.height <= 720) {
        const area = rect.width * rect.height;
        if (area < bestArea) {
          best = current;
          bestArea = area;
        }
      }
      current = current.parentElement;
    }
    return best;
  }

  function collectDirectCardCoverKeys(card) {
    const keys = [];
    const media = [card, ...(card?.querySelectorAll?.('img,video,source') || [])];
    for (const node of media) {
      const candidates = [
        node.currentSrc,
        node.src,
        node.poster,
        String(node.srcset || node.srcSet || '').split(',')[0]?.trim()?.split(/\s+/)[0]
      ];
      for (const url of candidates) {
        const key = getCoverKey(url || '');
        if (key) keys.push(key);
      }
    }
    return uniqueBy(keys, item => item, 30);
  }

  function collectCreationDateByCoverKey() {
    const dates = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const rect = element.getBoundingClientRect?.();
      if (!rect || rect.width < 30 || rect.height < 10) continue;
      const elementText = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      if (elementText.length > 80) continue;
      const date = parseCreationDateText(elementText);
      if (!date) continue;
      const key = `${date}:${Math.round(rect.top)}:${Math.round(rect.left)}`;
      if (dates.some(item => item.key === key)) continue;
      dates.push({ key, date, top: rect.top });
    }
    if (!dates.length) return new Map();

    dates.sort((a, b) => a.top - b.top);
    const dateByCoverKey = new Map();
    const dateSequence = [];
    const mediaNodes = Array.from(document.querySelectorAll('img,video,source'));
    for (const media of mediaNodes) {
      const rect = media.getBoundingClientRect?.();
      if (!rect || rect.width < 48 || rect.height < 48) continue;
      const card = getCreationDateCard(media);
      const cardRect = card?.getBoundingClientRect?.();
      if (!cardRect) continue;
      const date = dates
        .filter(item => item.top <= cardRect.top + 8)
        .slice(-1)[0]?.date;
      if (!date) continue;
      dateSequence.push(date);
      for (const coverKey of collectDirectCardCoverKeys(card)) {
        if (!dateByCoverKey.has(coverKey)) dateByCoverKey.set(coverKey, date);
      }
    }
    dateByCoverKey.sequence = dateSequence;
    return dateByCoverKey;
  }

  function applyCreationDatesFromPage(nodes) {
    const dateByCoverKey = collectCreationDateByCoverKey();
    const dateSequence = Array.isArray(dateByCoverKey.sequence) ? dateByCoverKey.sequence : [];
    if (!dateByCoverKey.size && !dateSequence.length) return nodes;
    return nodes.map((node, index) => {
      if (node.createdAt) return node;
      const createdAt = (node.coverKeys || []).map(key => dateByCoverKey.get(key)).find(Boolean) || '';
      const fallbackDate = dateSequence[index] || '';
      return createdAt || fallbackDate ? { ...node, createdAt: createdAt || fallbackDate } : node;
    });
  }

  function prioritizeNodesByVisibleOrder(nodes) {
    const coverKeys = collectVisibleCreationCoverKeys();
    if (!coverKeys.length) return nodes;
    return nodes.slice().sort((a, b) => {
      const ai = Math.min(...(a.coverKeys || []).map(key => coverKeys.indexOf(key)).filter(index => index >= 0), Number.POSITIVE_INFINITY);
      const bi = Math.min(...(b.coverKeys || []).map(key => coverKeys.indexOf(key)).filter(index => index >= 0), Number.POSITIVE_INFINITY);
      if (ai !== bi) return ai - bi;
      return 0;
    });
  }

  function collectCardCoverKeys(card) {
    const keys = [];
    const nodes = [];
    let current = card;
    for (let level = 0; current && current !== document.body && level < 7; level += 1) {
      nodes.push(current);
      if (current.querySelectorAll) nodes.push(...current.querySelectorAll('img,video,source'));
      current = current.parentElement;
    }
    for (const node of nodes) {
      const src = node.currentSrc || node.src || node.poster || '';
      const key = getCoverKey(src);
      if (key) keys.push(key);
      const srcset = String(node.srcset || node.srcSet || '');
      for (const part of srcset.split(',')) {
        const itemKey = getCoverKey(part.trim().split(/\s+/)[0]);
        if (itemKey) keys.push(itemKey);
      }
    }
    return uniqueBy(keys, item => item, 20);
  }

  async function resolveNodeIdsFromCreationList(card, messageIds = []) {
    const nodes = await fetchCreationNodes();
    const coverKeys = collectCardCoverKeys(card);
    const idSet = new Set((messageIds || []).map(item => String(item || '')));
    const matched = nodes.filter(item => {
      const coverMatched = coverKeys.some(key => item.coverKeys?.includes(key));
      const messageMatched = item.messageId && idSet.has(item.messageId);
      const taskMatched = item.creationTaskId && idSet.has(item.creationTaskId);
      return coverMatched || messageMatched || taskMatched;
    });
    return uniqueBy(matched
      .filter(item => item.nodeType === 6 || /^v\d/i.test(item.key) || /\.mp4$/i.test(item.name))
      .map(item => item.id), item => item, 20);
  }

  function isConfirmedNoWatermarkVideoUrl(url) {
    const text = String(url || '').toLowerCase();
    if (!text) return false;
    try {
      const parsed = new URL(url, location.href);
      if (/(^|[.-])videoweb-download\.doubao\.com$/i.test(parsed.hostname) && parsed.searchParams.get('download') === 'true') return true;
      if (/(^|[.-])videoweb\.doubao\.com$/i.test(parsed.hostname) && parsed.searchParams.get('download') === 'true') return true;
      if (parsed.hostname.includes('doubao.com') && parsed.pathname.includes('/download') && parsed.searchParams.get('download') === 'true') return true;
    } catch (e) {}
    return /download=true/.test(text) && /video_mp4|mime_type=video_mp4/.test(text);
  }

  async function getDownloadInfo(nodeId, mediaType = 'video') {
    const id = String(nodeId || '').trim();
    if (!/^\d{8,}$/.test(id)) throw new Error('缺少作品节点ID');
    const response = await fetch(getDoubaoApiUrl('/samantha/aispace/get_download_info'), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'agw-js-conv': 'str',
        origin: location.origin,
        referer: location.href
      },
      credentials: 'include',
      body: JSON.stringify({ requests: [{ node_id: id }] })
    });
    const json = await response.json();
    if (json.code !== 0) throw new Error(json.msg || `接口返回 ${json.code}`);
    const info = json?.data?.download_infos?.[0];
    const mainUrl = info?.main_url || info?.mainUrl || info?.url || info?.image_url || info?.imageUrl || '';
    const backupUrl = info?.backup_url || info?.backupUrl || '';
    if (mediaType === 'image') {
      if (isVideoUrl(mainUrl, 'download_info')) throw new Error('接口返回的是视频地址');
      return { mainUrl, backupUrl, nodeId: id };
    }
    if (!mainUrl) throw new Error('接口没有返回视频下载地址');
    if (!isConfirmedNoWatermarkVideoUrl(mainUrl)) throw new Error('接口返回的不是确认无水印下载流');
    return { mainUrl, backupUrl, nodeId: id };
  }

  async function getDownloadInfos(nodeEntries) {
    const entries = uniqueBy((nodeEntries || []).map(item => {
      if (item && typeof item === 'object') {
        return { nodeId: String(item.nodeId || item.id || '').trim(), mediaType: item.mediaType || item.type || 'video' };
      }
      return { nodeId: String(item || '').trim(), mediaType: 'video' };
    }).filter(item => /^\d{8,}$/.test(item.nodeId)), item => item.nodeId);
    const ids = entries.map(item => item.nodeId);
    if (!ids.length) return [];
    const out = new Array(ids.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < ids.length) {
        const index = nextIndex++;
        const entry = entries[index];
        const nodeId = entry.nodeId;
        try {
          const info = await getDownloadInfo(nodeId, entry.mediaType);
          out[index] = { nodeId, mediaType: entry.mediaType, mainUrl: info.mainUrl, backupUrl: info.backupUrl || '', ok: true };
        } catch (error) {
          out[index] = { nodeId, mediaType: entry.mediaType, mainUrl: '', backupUrl: '', ok: false, error: error?.message || String(error) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, ids.length) }, () => worker()));
    return out;
  }

  function isCreationVideoNode(node) {
    if (!node) return false;
    return node.nodeType === 6 || /^v\d/i.test(String(node.key || '')) || /\.mp4$/i.test(String(node.name || ''));
  }

  function isCreationImageNode(node) {
    if (!node || isCreationVideoNode(node) || node.nodeType === 1) return false;
    return Boolean(node.imageUrl || node.coverUrl) && (
      node.nodeType > 0 || /^(?:i|img|image|p)\d/i.test(String(node.key || ''))
    );
  }

  function isCreationMediaNode(node) {
    return isCreationVideoNode(node) || isCreationImageNode(node);
  }

  function getCreationMediaType(node) {
    return isCreationVideoNode(node) ? 'video' : 'image';
  }

  function isOnCreationPage() {
    return /\/chat\/create-image/i.test(location.pathname) && /(?:^|[?&])tab=myCreation(?:&|$)/i.test(location.search || '');
  }

  function buildCreationVideoTitle(node, index) {
    const name = sanitizeFilename(node?.name || '');
    if (name && !/^video(?:\.mp4)?$/i.test(name)) return `豆包无水印_${name}`;
    return `豆包无水印视频_${String(index + 1).padStart(3, '0')}`;
  }

  function buildCreationImageTitle(node, index) {
    const name = sanitizeFilename(node?.name || '');
    if (name && !/^image(?:\.png)?$/i.test(name)) return `豆包图片_${name}`;
    return `豆包图片_${String(index + 1).padStart(3, '0')}`;
  }

  function postResourcesToPanel(resources) {
    const list = Array.isArray(resources) ? resources : [];
    const images = list.filter(item => item.type === 'image').map(item => ({
      url: item.url,
      no_watermark_url: item.url,
      thumbUrl: item.thumbUrl || item.url,
      title: item.title,
      source: item.source,
      nodeId: item.nodeId,
      messageId: item.messageId,
      width: item.width,
      height: item.height,
      createdAt: item.createdAt
    }));
    const videos = list.filter(item => item.type === 'video').map(item => ({
      videoUrl: item.url,
      url: item.url,
      backupUrl: item.backupUrl,
      vid: item.vid,
      nodeId: item.nodeId,
      messageId: item.messageId,
      title: item.title,
      thumbUrl: item.thumbUrl,
      createdAt: item.createdAt,
      width: item.width,
      height: item.height,
      source: item.source,
      definition: item.definition,
      confirmedNoWatermark: item.confirmedNoWatermark
    }));
    if (images.length) window.postMessage({ type: 'imageDataExtracted', data: images }, '*');
    if (videos.length) window.postMessage({ type: 'videoDataExtracted', data: videos }, '*');
  }

  async function scanCreationResourcesToResourcePanel() {
    if (!isOnCreationPage()) {
      showStatus('正在打开豆包“我的创作”页面，请稍后再扫描');
      location.href = DOUBAO_CREATION_SCAN_URL;
      return { ok: false, count: 0, navigated: true };
    }
    showStatus('正在扫描豆包作品中的图片和视频...');
    const fetchedNodes = await fetchCreationNodes({ force: true });
    const allMediaNodes = prioritizeNodesByVisibleOrder(
      applyCreationDatesFromPage(fetchedNodes).filter(isCreationMediaNode)
    );
    if (!allMediaNodes.length) {
      showStatus('当前“我的创作”没有找到可扫描的图片或视频');
      return { ok: false, count: 0 };
    }

    const entries = allMediaNodes.map(node => ({
      nodeId: node.id,
      mediaType: getCreationMediaType(node)
    }));
    const downloadInfos = await getDownloadInfos(entries);
    const infoByNodeId = new Map(downloadInfos.filter(info => info.ok).map(info => [info.nodeId, info]));
    const resources = [];
    allMediaNodes.forEach((node, index) => {
      const type = getCreationMediaType(node);
      const info = infoByNodeId.get(node.id);
      const url = info?.mainUrl || (type === 'image' ? node.imageUrl || node.coverUrl : '');
      if (!url) return;
      resources.push({
        type,
        url,
        backupUrl: info?.backupUrl || '',
        vid: node.key || node.id,
        nodeId: node.id,
        title: type === 'image' ? buildCreationImageTitle(node, index) : buildCreationVideoTitle(node, index),
        thumbUrl: node.coverUrl || node.imageUrl || '',
        createdAt: node.createdAt || '',
        width: node.width || 0,
        height: node.height || 0,
        source: 'doubao-creation-resource-panel',
        replaceDoubaoCreationScan: true,
        definition: type === 'image' ? '原图' : '原视频',
        confirmedNoWatermark: type === 'video'
      });
    });

    if (!resources.length) {
      showStatus(`扫描到 ${allMediaNodes.length} 个作品，但没有找到可用下载地址`);
      return { ok: false, count: 0, totalMediaNodes: allMediaNodes.length };
    }
    postResourcesToPanel(resources);
    const imageCount = resources.filter(item => item.type === 'image').length;
    const videoCount = resources.length - imageCount;
    showStatus(`已加入右侧资源栏 ${imageCount} 张图片、${videoCount} 个视频`);
    return { ok: true, count: resources.length, imageCount, videoCount, totalMediaNodes: allMediaNodes.length, resources };
  }

  async function scanCreationVideosToResourcePanel() {
    if (!isOnCreationPage()) {
      showStatus('正在打开豆包“我的创作”页面，请稍后再点一次扫描');
      location.href = DOUBAO_CREATION_SCAN_URL;
      return { ok: false, count: 0, navigated: true };
    }
    showStatus('正在扫描豆包无水印视频...');
    const fetchedNodes = await fetchCreationNodes({ force: true });
    const allVideoNodes = prioritizeNodesByVisibleOrder(
      applyCreationDatesFromPage(fetchedNodes).filter(isCreationVideoNode)
    );
    const nodes = allVideoNodes;
    if (!nodes.length) {
      showStatus('没有扫描到豆包无水印视频，请确认当前在“我的创作”页面');
      return { ok: false, count: 0 };
    }

    const downloadInfos = await getDownloadInfos(nodes.map(node => node.id));
    const infoByNodeId = new Map(downloadInfos.filter(info => info.ok).map(info => [info.nodeId, info]));
    const videos = [];
    nodes.forEach((node, index) => {
      const info = infoByNodeId.get(node.id);
      if (!info?.mainUrl) return;
      videos.push({
        vid: node.key || node.id,
        nodeId: node.id,
        title: buildCreationVideoTitle(node, index),
        thumbUrl: node.coverUrl || '',
        createdAt: node.createdAt || '',
        videoUrl: info.mainUrl,
        backupUrl: info.backupUrl || '',
        width: node.width || 0,
        height: node.height || 0,
        source: 'doubao-creation-resource-panel',
        replaceDoubaoCreationScan: true,
        definition: '原视频',
        confirmedNoWatermark: true
      });
    });

    if (!videos.length) {
      showStatus(`扫描到 ${allVideoNodes.length} 个视频，但没有明确无水印下载流`);
      return { ok: false, count: 0 };
    }

    window.postMessage({ type: 'videoDataExtracted', data: videos }, '*');
    showStatus(`已加入右侧资源栏 ${videos.length} 个豆包无水印视频`);
    return { ok: true, count: videos.length, totalVideoNodes: allVideoNodes.length };
  }

  function isLikelyConversationVideoMedia(node) {
    if (!node) return false;
    const source = String(node.currentSrc || node.src || node.poster || '');
    let current = node;
    let classText = '';
    for (let level = 0; current && level < 10; level += 1) {
      classText += ` ${String(current.className || '')}`;
      current = current.parentElement;
    }
    return node.tagName === 'VIDEO' || node.tagName === 'SOURCE' ||
      /block-video|video-player|play-icon|cover-/i.test(classText) ||
      /tos-cn-p-9ecd54|tplv-noop|videoweb|\.mp4(?:\?|#|$)/i.test(source);
  }

  function isLikelyConversationImageMedia(node) {
    if (!node || node.tagName !== 'IMG') return false;
    const source = String(node.currentSrc || node.src || '');
    if (!/^https?:\/\//i.test(source)) return false;
    let current = node;
    let classText = '';
    for (let level = 0; current && level < 10; level += 1) {
      classText += ` ${String(current.className || '')}`;
      current = current.parentElement;
    }
    const text = `${source} ${classText}`;
    if (/avatar|head[-_]?img|profile|emoji|icon|logo|toolbar|favicon/i.test(text)) return false;
    const rect = node.getBoundingClientRect?.();
    const largeEnough = Boolean(rect && rect.width >= 64 && rect.height >= 64);
    return largeEnough || /tos-cn-i|image|photo|picture|generated|creation/i.test(text);
  }

  function collectConversationImageResources(mediaNodes) {
    const resources = [];
    let index = 0;
    for (const media of mediaNodes || []) {
      if (!isLikelyConversationImageMedia(media)) continue;
      const directUrl = normalizeUrl(media.currentSrc || media.src || '');
      const candidates = [];
      if (directUrl) candidates.push({ url: directUrl, score: 30 });
      for (const record of findFiberRecords(media)) {
        collectImageUrls(record, '', candidates, new WeakSet());
      }
      const best = uniqueBy(candidates, item => item.url).sort((a, b) => b.score - a.score)[0];
      if (!best?.url) continue;
      const card = getCard(media);
      const title = String(card?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      resources.push({
        type: 'image',
        url: best.url,
        thumbUrl: directUrl || best.url,
        title: title || `当前对话图片_${String(index + 1).padStart(3, '0')}`,
        width: media.naturalWidth || media.width || 0,
        height: media.naturalHeight || media.height || 0,
        source: 'doubao-current-conversation',
        confirmedNoWatermark: true
      });
      index += 1;
    }
    return uniqueBy(resources, item => item.url);
  }

  function collectMessageIdsFromMediaTree(node, out) {
    let current = node;
    for (let level = 0; current && level < 16; level += 1) {
      const values = [
        current.dataset?.messageId,
        current.dataset?.messageid,
        current.dataset?.message_id,
        current.getAttribute?.('data-message-id'),
        current.getAttribute?.('data-messageid'),
        current.getAttribute?.('data-message_id')
      ];
      values.forEach(value => {
        const text = String(value || '').trim();
        if (/^\d{8,}$/.test(text)) out.push(text);
      });
      current = current.parentElement;
    }
  }

  function collectCurrentConversationEvidence() {
    const messageIds = [];
    const directNodeIds = [];
    const nodeTypes = new Map();
    const mediaNodes = Array.from(document.querySelectorAll('video,img,source'))
      .filter(node => isLikelyConversationVideoMedia(node) || isLikelyConversationImageMedia(node));
    const imageResources = collectConversationImageResources(mediaNodes);
    for (const media of mediaNodes) {
      collectMessageIdsFromMediaTree(media, messageIds);
      const records = findFiberRecords(media);
      collectMessageIds(records, messageIds, new WeakSet());
      const ids = collectDownloadNodeIdsFromRecords(records);
      const mediaType = media.tagName === 'IMG' ? 'image' : 'video';
      ids.forEach(id => nodeTypes.set(id, mediaType));
      directNodeIds.push(...ids);
    }

    const routeIds = new Set((location.pathname.match(/\d{8,}/g) || []).map(String));
    const routerData = window._ROUTER_DATA;
    const cells = routerData?.loaderData?.chat_layout?.trimmedChainRecentConvCells || [];
    for (const cell of cells) {
      const conversation = cell?.conversation || {};
      const conversationIds = [
        cell?.conversation_id,
        cell?.conversationId,
        conversation?.conversation_id,
        conversation?.conversationId,
        conversation?.id
      ].map(value => String(value || '')).filter(Boolean);
      if (!routeIds.size || !conversationIds.some(id => routeIds.has(id))) continue;
      collectMessageIds(conversation?.messages || [], messageIds, new WeakSet());
      collectNodeIds(conversation?.messages || [], directNodeIds, new WeakSet());
    }

    return {
      messageIds: uniqueBy(messageIds, item => item),
      directNodeIds: uniqueBy(directNodeIds, item => item),
      nodeTypes: Object.fromEntries(nodeTypes),
      imageResources
    };
  }

  async function scanConversationResourcesToResourcePanel() {
    if (isCreationPageLocation()) {
      showStatus('当前正在“我的创作”页面，请切换到要扫描的对话后再试');
      return { ok: false, count: 0 };
    }
    showStatus('正在读取当前对话中的图片和视频...');
    const evidence = collectCurrentConversationEvidence();
    const messageIdSet = new Set(evidence.messageIds);
    const directNodeIdSet = new Set(evidence.directNodeIds);
    const allNodes = await fetchCreationNodes({ force: true });
    const matchedNodes = allNodes.filter(node => {
      if (!isCreationMediaNode(node)) return false;
      return directNodeIdSet.has(node.id) ||
        (node.messageId && messageIdSet.has(node.messageId)) ||
        (node.creationTaskId && messageIdSet.has(node.creationTaskId));
    });

    const resolvedNodeIds = evidence.messageIds.length
      ? await resolveNodeIdsFromMessageIds(evidence.messageIds)
      : [];
    const resolvedSet = new Set(resolvedNodeIds);
    const nodesById = new Map(allNodes.map(node => [node.id, node]));
    const candidateNodes = matchedNodes.slice();
    const imageResources = evidence.imageResources || [];
    for (const nodeId of [...evidence.directNodeIds, ...resolvedNodeIds]) {
      if (nodesById.has(nodeId) || candidateNodes.some(node => node.id === nodeId)) continue;
      const mediaType = evidence.nodeTypes?.[nodeId] || (imageResources.length ? 'image' : 'video');
      candidateNodes.push({
        id: nodeId,
        key: `${mediaType === 'image' ? 'i' : 'v'}${nodeId}`,
        nodeType: mediaType === 'image' ? 2 : 6,
        imageUrl: mediaType === 'image' ? imageResources[0]?.url || '' : ''
      });
    }

    const downloadInfos = await getDownloadInfos(candidateNodes.map(node => ({
      nodeId: node.id,
      mediaType: getCreationMediaType(node)
    })));
    const infoByNodeId = new Map(downloadInfos.filter(info => info.ok).map(info => [info.nodeId, info]));
    const nodeResources = [];
    candidateNodes.forEach((node, index) => {
      const type = getCreationMediaType(node);
      const info = infoByNodeId.get(node.id);
      const url = info?.mainUrl || (type === 'image' ? node.imageUrl || node.coverUrl : '');
      if (!url) return;
      nodeResources.push({
        type,
        url,
        backupUrl: info?.backupUrl || '',
        vid: node.key || node.id,
        nodeId: node.id,
        messageId: node.messageId || '',
        title: type === 'image' ? buildCreationImageTitle(node, index) : buildCreationVideoTitle(node, index),
        thumbUrl: node.coverUrl || node.imageUrl || '',
        createdAt: node.createdAt || '',
        width: node.width || 0,
        height: node.height || 0,
        source: 'doubao-current-conversation',
        replaceDoubaoCreationScan: true,
        definition: type === 'image' ? '原图' : '原视频',
        confirmedNoWatermark: type === 'video'
      });
    });
    const resources = uniqueBy([...imageResources, ...nodeResources], item => item.url);
    if (!resources.length) {
      showStatus(`当前对话没有找到可扫描的图片或视频（已读取 ${evidence.messageIds.length} 条消息）`);
      return { ok: false, count: 0, messageIds: evidence.messageIds.length };
    }
    postResourcesToPanel(resources);
    const imageCount = resources.filter(item => item.type === 'image').length;
    const videoCount = resources.length - imageCount;
    showStatus(`已加入右侧资源栏 ${imageCount} 张图片、${videoCount} 个视频`);
    return {
      ok: true,
      count: resources.length,
      imageCount,
      videoCount,
      totalMediaNodes: candidateNodes.length,
      messageIds: evidence.messageIds.length,
      resolvedNodeIds: resolvedSet.size,
      resources
    };
  }

  async function scanConversationVideosToResourcePanel() {
    if (isCreationPageLocation()) {
      showStatus('当前正在“我的创作”页面，请切换到要扫描的对话后再试');
      return { ok: false, count: 0 };
    }
    showStatus('正在读取当前对话中的视频...');
    const evidence = collectCurrentConversationEvidence();
    const messageIdSet = new Set(evidence.messageIds);
    const directNodeIdSet = new Set(evidence.directNodeIds);
    const allNodes = await fetchCreationNodes({ force: true });
    const matchedNodes = allNodes.filter(node => {
      if (!isCreationVideoNode(node)) return false;
      return directNodeIdSet.has(node.id) ||
        (node.messageId && messageIdSet.has(node.messageId)) ||
        (node.creationTaskId && messageIdSet.has(node.creationTaskId));
    });

    const resolvedNodeIds = evidence.messageIds.length
      ? await resolveNodeIdsFromMessageIds(evidence.messageIds)
      : [];
    const resolvedSet = new Set(resolvedNodeIds);
    const nodesById = new Map(allNodes.map(node => [node.id, node]));
    const candidateNodes = matchedNodes.slice();
    for (const nodeId of [...evidence.directNodeIds, ...resolvedNodeIds]) {
      if (nodesById.has(nodeId) || candidateNodes.some(node => node.id === nodeId)) continue;
      candidateNodes.push({ id: nodeId, key: `v${nodeId}`, nodeType: 6 });
    }
    if (!candidateNodes.length) {
      showStatus(`当前对话没有找到视频（已读取 ${evidence.messageIds.length} 条消息）`);
      return { ok: false, count: 0, messageIds: evidence.messageIds.length };
    }

    const downloadInfos = await getDownloadInfos(candidateNodes.map(node => node.id));
    const infoByNodeId = new Map(downloadInfos.filter(info => info.ok).map(info => [info.nodeId, info]));
    const videos = [];
    candidateNodes.forEach((node, index) => {
      const info = infoByNodeId.get(node.id);
      if (!info?.mainUrl) return;
      videos.push({
        vid: node.key || node.id,
        nodeId: node.id,
        messageId: node.messageId || '',
        title: buildCreationVideoTitle(node, index),
        thumbUrl: node.coverUrl || '',
        createdAt: node.createdAt || '',
        videoUrl: info.mainUrl,
        backupUrl: info.backupUrl || '',
        width: node.width || 0,
        height: node.height || 0,
        source: 'doubao-current-conversation',
        replaceDoubaoCreationScan: true,
        definition: '原视频',
        confirmedNoWatermark: true
      });
    });
    if (!videos.length) {
      showStatus(`当前对话找到 ${candidateNodes.length} 个视频节点，但没有明确无水印下载流`);
      return { ok: false, count: 0, totalVideoNodes: candidateNodes.length };
    }
    window.postMessage({ type: 'videoDataExtracted', data: videos }, '*');
    showStatus(`已加入右侧资源栏 ${videos.length} 个当前对话视频`);
    return {
      ok: true,
      count: videos.length,
      totalVideoNodes: candidateNodes.length,
      messageIds: evidence.messageIds.length,
      resolvedNodeIds: resolvedSet.size
    };
  }

  async function debugCreationResourceScan() {
    const nodes = await fetchCreationNodes({ force: true });
    const videoNodes = prioritizeNodesByVisibleOrder(nodes.filter(isCreationVideoNode));
    const latestVideoNodes = videoNodes;
    const downloadInfos = await getDownloadInfos(latestVideoNodes.map(node => node.id));
    return {
      url: location.href,
      totalNodes: nodes.length,
      videoNodes: videoNodes.length,
      selectedVideoNodes: latestVideoNodes.length,
      pages: creationNodePageDebug,
      sampleAllNodes: nodes.slice(0, 10).map(node => ({
        id: node.id,
        key: node.key,
        name: node.name,
        nodeType: node.nodeType,
        typeOfNodeType: typeof node.nodeType
      })),
      sampleNodes: latestVideoNodes.slice(0, 5).map(node => ({
        id: node.id,
        key: node.key,
        name: node.name,
        nodeType: node.nodeType,
        coverUrl: node.coverUrl,
        coverKeys: node.coverKeys
      })),
      downloadInfos: downloadInfos.map(info => ({
        nodeId: info.nodeId,
        ok: info.ok,
        error: info.error || '',
        mainUrl: String(info.mainUrl || '').slice(0, 220)
      }))
    };
  }

  function collectIds(value, path, out, seen, depth = 0) {
    if (depth > 8 || value == null) return;
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (child != null && /(^|_|\b)(id|item|item_id|itemid|creation|creation_id|media|media_id|vid|video|video_id|task|task_id|key)(_|$|\b)/i.test(key)) {
        const text = typeof child === 'string' || typeof child === 'number' ? String(child) : '';
        if (text && text.length <= 180) out.push({ path: nextPath, value: text });
      }
      if (child && typeof child === 'object') collectIds(child, nextPath, out, seen, depth + 1);
    }
  }

  function collectMediaRecords(value, out, seen, depth = 0) {
    if (depth > 8 || value == null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const record = {
      type: typeof value.type === 'string' ? value.type : '',
      id: value.id != null ? String(value.id) : '',
      nodeId: value.nodeId != null ? String(value.nodeId) : (value.node_id != null ? String(value.node_id) : ''),
      key: value.key != null ? String(value.key) : '',
      uri: value.uri != null ? String(value.uri) : '',
      name: value.name != null ? String(value.name).slice(0, 120) : '',
      title: value.title != null ? String(value.title).slice(0, 120) : ''
    };
    if ((/^(image|video|audio|file)$/i.test(record.type) || record.nodeId || record.uri || record.key) &&
        (record.id || record.nodeId || record.uri || record.key)) {
      out.push(record);
    }
    if (Array.isArray(value)) {
      value.forEach(item => collectMediaRecords(item, out, seen, depth + 1));
      return;
    }
    for (const child of Object.values(value).slice(0, 120)) {
      if (child && typeof child === 'object') collectMediaRecords(child, out, seen, depth + 1);
    }
  }

  function collectDownloadNodeIdsFromRecords(records, limit = 40) {
    const ids = [];
    const mediaRecords = [];
    for (const record of records || []) {
      collectNodeIds(record, ids, new WeakSet());
      collectMediaRecords(record, mediaRecords, new WeakSet());
    }
    for (const item of mediaRecords) {
      if (/^\d{8,}$/.test(String(item.nodeId || ''))) ids.push(String(item.nodeId));
      if (/^\d{8,}$/.test(String(item.id || '')) &&
          (/^(?:v|i|img|image|p)\d/i.test(String(item.key || '')) || /^(?:image|video)$/i.test(String(item.type || '')))) {
        ids.push(String(item.id));
      }
    }
    return uniqueBy(ids, item => item, limit);
  }

  function collectVisibleDownloadNodeIds() {
    const nodes = Array.from(document.querySelectorAll('video,img')).filter(visible);
    const sorted = nodes.sort((a, b) => {
      const aVideo = a.tagName === 'VIDEO' ? 1 : 0;
      const bVideo = b.tagName === 'VIDEO' ? 1 : 0;
      if (aVideo !== bVideo) return bVideo - aVideo;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.width * br.height) - (ar.width * ar.height);
    });
    const ids = [];
    const seenCards = new WeakSet();
    for (const node of sorted.slice(0, 24)) {
      const card = getCard(node);
      if (!card || seenCards.has(card)) continue;
      seenCards.add(card);
      ids.push(...collectDownloadNodeIdsFromRecords(findFiberRecords(card), 20));
      ids.push(...collectDownloadNodeIdsFromRecords(findFiberRecords(node), 20));
    }
    return uniqueBy(ids, item => item, 40);
  }

  async function revealCardMedia(card) {
    if (!card || !card.isConnected) return false;
    setSelectionMode(false);
    const target = card.querySelector?.('video,img') || card;
    target.scrollIntoView?.({ block: 'center', inline: 'center' });
    await delay(350);
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const options = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    for (const type of ['pointerover', 'mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, options));
    }
    await delay(2200);
    return true;
  }

  async function downloadFirstNodeIds(nodeIds) {
    let lastError = null;
    for (const nodeId of uniqueBy(nodeIds || [], item => item, 50)) {
      try {
        const result = await getDownloadInfo(nodeId);
        postDownload(result.mainUrl, result.backupUrl);
        showStatus('已发送豆包无水印视频下载');
        return { ok: true, lastError: null };
      } catch (error) {
        lastError = error;
      }
    }
    return { ok: false, lastError };
  }

  async function waitForRevealedVideoAndDownload() {
    const token = ++pendingRevealToken;
    for (let index = 0; index < 16; index += 1) {
      await delay(500);
      if (token !== pendingRevealToken) return false;
      const result = await downloadFirstNodeIds(collectVisibleDownloadNodeIds());
      if (result.ok) return true;
    }
    showStatus('作品已打开，但未发现可下载原视频，请再点一次下载按钮');
    return false;
  }

  function uniqueBy(list, getKey, limit = Number.POSITIVE_INFINITY) {
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const key = getKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (Number.isFinite(limit) && out.length >= limit) break;
    }
    return out;
  }

  function dumpVisibleCards() {
    const nodes = Array.from(document.querySelectorAll('video,img'));
    const mediaNodes = uniqueBy(nodes.filter(visible), node => {
      const rect = node.getBoundingClientRect();
      const src = node.currentSrc || node.src || '';
      return `${node.tagName}:${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${src.slice(0, 120)}`;
    }, 80);
    return mediaNodes.map((node, index) => {
      const card = getCard(node);
      const rect = node.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const records = findFiberRecords(node);
      const candidates = [];
      const ids = [];
      const mediaRecords = [];
      for (const record of records) {
        collectVideoUrls(record, '', candidates, new WeakSet(), 0, true);
        collectIds(record, '', ids, new WeakSet());
        collectMediaRecords(record, mediaRecords, new WeakSet());
      }
      return {
        index,
        text: String(card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        cardRect: {
          left: Math.round(cardRect.left),
          top: Math.round(cardRect.top),
          width: Math.round(cardRect.width),
          height: Math.round(cardRect.height)
        },
        tagName: node.tagName,
        src: String(node.currentSrc || node.src || '').slice(0, 800),
        hasVideoElement: node.tagName === 'VIDEO' || Boolean(card.querySelector('video')),
        hasImageElement: node.tagName === 'IMG' || Boolean(card.querySelector('img')),
        recordCount: records.length,
        ids: uniqueBy(ids, item => `${item.path}:${item.value}`, 80),
        mediaRecords: uniqueBy(mediaRecords, item => `${item.type}:${item.id}:${item.nodeId}:${item.key}:${item.uri}`, 80),
        candidates: uniqueBy(candidates, item => item.url, 80)
          .sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.score - a.score)
          .map(item => ({
            path: item.path,
            score: item.score,
            accepted: item.accepted,
            rejectReason: item.rejectReason,
            url: item.url
          }))
      };
    });
  }

  function sanitizeFilename(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .trim()
      .slice(0, 48);
  }

  function postDownload(url, backupUrl = '') {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    window.postMessage({
      type: 'electronDownload',
      data: {
        url,
        backupUrl,
        filename: `豆包_无水印视频_${stamp}.mp4`,
        type: 'video',
        source: 'doubao-creation-resource-panel',
        confirmedNoWatermark: true
      }
    }, '*');
  }

  async function resolveFromCard(card) {
    const records = findFiberRecords(card);
    const directNodeIds = collectDownloadNodeIdsFromRecords(records, 30);
    const messageIds = uniqueBy(records.flatMap(record => {
      const ids = [];
      collectMessageIds(record, ids, new WeakSet());
      return ids;
    }), item => item, 40);
    let lastError = null;
    let listNodeIds = [];
    try {
      listNodeIds = await resolveNodeIdsFromCreationList(card, messageIds);
    } catch (error) {
      lastError = error;
    }
    const candidateNodeIds = uniqueBy([...listNodeIds, ...directNodeIds, ...collectVisibleDownloadNodeIds()], item => item, 50);
    const directResult = await downloadFirstNodeIds(candidateNodeIds);
    if (directResult.ok) return true;
    lastError = directResult.lastError;

    await revealCardMedia(card);
    const revealedNodeIds = collectVisibleDownloadNodeIds()
      .filter(nodeId => !candidateNodeIds.includes(nodeId));
    const revealedResult = await downloadFirstNodeIds(revealedNodeIds);
    if (revealedResult.ok) return true;
    lastError = revealedResult.lastError || lastError;

    if (messageIds.length) {
      try {
        const resolvedNodeIds = await resolveNodeIdsFromMessageIds(messageIds);
        for (const nodeId of resolvedNodeIds) {
          if (candidateNodeIds.includes(nodeId)) continue;
          try {
            const result = await getDownloadInfo(nodeId);
            postDownload(result.mainUrl, result.backupUrl);
            showStatus('已发送豆包无水印视频下载');
            return true;
          } catch (error) {
            lastError = error;
          }
        }
      } catch (error) {
        lastError = error;
      }
    }

    const best = pickBestVideo(records);
    if (!best?.url || !isConfirmedNoWatermarkVideoUrl(best.url)) {
      showStatus(`未发现确认无水印下载流，已停止下载（扫描 ${records.length} 组卡片数据）${lastError ? `：${lastError.message || lastError}` : ''}`);
      return false;
    }
    postDownload(best.url);
    showStatus('已发送豆包无水印视频下载');
    return true;
  }

  function setupSelectionResolver() {
    if (window.__AIAM_DOUBAO_CREATION_SELECTION__ === SCRIPT_VERSION) return;
    window.__AIAM_DOUBAO_CREATION_SELECTION__ = SCRIPT_VERSION;

    document.addEventListener('mousemove', event => {
      if (!selectionMode) return;
      const node = getNodeAtPoint(event);
      if (node === hoverNode) return;
      if (hoverNode) hoverNode.classList.remove(HIT_CLASS);
      hoverNode = node || null;
      if (hoverNode) hoverNode.classList.add(HIT_CLASS);
    }, true);

    document.addEventListener('click', async event => {
      if (!selectionMode) return;
      if (event.target?.closest?.(`.${PANEL_CLASS},.${STATUS_CLASS}`)) return;
      const node = getNodeAtPoint(event);
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      await resolveFromCard(node);
      setSelectionMode(false);
    }, true);
  }

  window.__AIAM_DOUBAO_CREATION_START_SELECT__ = () => {
    ensurePanel();
    setupSelectionResolver();
    setSelectionMode(true);
    return true;
  };

  window.__AIAM_DOUBAO_CREATION_SCAN_TO_RESOURCE_PANEL__ = scanCreationResourcesToResourcePanel;
  window.__AIAM_DOUBAO_SCAN_SCOPE__ = (scope = 'project') => {
    return scope === 'conversation'
      ? scanConversationResourcesToResourcePanel()
      : scanCreationResourcesToResourcePanel();
  };
  window.__AIAM_DOUBAO_CREATION_SCAN_DEBUG__ = debugCreationResourceScan;
  window.__AIAM_DOUBAO_CREATION_DUMP_VISIBLE__ = dumpVisibleCards;
  window.__AIAM_DOUBAO_CREATION_DUMP_VERSION__ = SCRIPT_VERSION;

  function start() {
    if (!document.body) return setTimeout(start, 100);
    installStyle();
    setupSelectionResolver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
