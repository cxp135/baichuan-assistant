(() => {
  "use strict";

  const CAPTURE_MESSAGE = "DOLA_API_PLUGIN_CAPTURE";
  const MAX_ITEMS = 30;
  const fplayUrls = [];
  const fplayStatuses = new Map();
  const videoInfos = [];
  const videoRecords = [];
  let blobVideoCount = 0;
  let activePageKey = "";
  let activeStartedAt = 0;
  let scanBudget = 0;
  const copyButtons = new Map();
  const STYLE_VERSION = "2";
  const FPLAY_URL_RE = /https?:\/\/[^"'<>\\\s]+\/video\/fplay\/[^"'<>\\\s]*/gi;
  let savedApiKey = "";

  function currentPageKey() {
    return `${location.origin}${location.pathname}`;
  }

  function currentConversationId() {
    const match = location.pathname.match(/\/chat\/([A-Za-z0-9_-]+)/i);
    return match ? match[1] : "";
  }

  function storageGet(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }

  function storageSet(values) {
    return new Promise((resolve) => chrome.storage.local.set(values, resolve));
  }

  function runtimeSendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || "处理失败" });
          return;
        }
        resolve(response || { ok: false, error: "处理失败" });
      });
    });
  }

  async function loadSavedApiKey() {
    savedApiKey = "";
    updateDownloadButtonLabels();
    return savedApiKey;
  }

  function persistCapture() {
    chrome.storage.local.set({
      dolaLastCapture: {
        pageKey: activePageKey || currentPageKey(),
        fplayUrls: fplayUrls.slice(0, MAX_ITEMS),
        fplayStatuses: Array.from(fplayStatuses.entries()).slice(0, MAX_ITEMS),
        videoInfos: videoInfos.slice(0, 10),
        videoRecords: videoRecords.slice(0, 20)
      }
    });
  }

  function announcePage() {
    try {
      chrome.runtime.sendMessage({ type: "DOLA_BG_SET_PAGE", pageKey: activePageKey || currentPageKey() });
    } catch (_error) {
      // ignored
    }
  }

  function resetForPage(pageKey) {
    activePageKey = pageKey;
    activeStartedAt = performance.now();
    fplayUrls.length = 0;
    fplayStatuses.clear();
    videoInfos.length = 0;
    videoRecords.length = 0;
    blobVideoCount = 0;
    persistCapture();
    announcePage();
  }

  function ensureCurrentPage() {
    const pageKey = currentPageKey();
    if (!activePageKey) {
      activePageKey = pageKey;
      activeStartedAt = performance.now();
      announcePage();
      return;
    }
    if (activePageKey !== pageKey) {
      resetForPage(pageKey);
    }
  }

  function normalizeUrl(raw) {
    let text = String(raw || "")
      .replace(/&amp;/g, "&")
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");
    try {
      text = new URL(text, location.href).href;
    } catch (_error) {
      // ignored
    }
    return text;
  }

  function pushUnique(list, value) {
    const raw = normalizeUrl(value);
    if (!raw) return;
    const oldIndex = list.indexOf(raw);
    if (oldIndex >= 0) list.splice(oldIndex, 1);
    list.unshift(raw);
    if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
  }

  function fplayResourceKey(raw) {
    try {
      const url = new URL(normalizeUrl(raw), location.href);
      const aid = url.searchParams.get("aid") || "";
      return `${url.hostname}${url.pathname}?aid=${aid}`.toLowerCase();
    } catch (_error) {
      return normalizeUrl(raw).split("?")[0].toLowerCase();
    }
  }

  function setFplayStatus(raw, status) {
    const normalizedStatus = status === "ok" || status === "bad" ? status : "";
    const key = fplayResourceKey(raw);
    if (!key || !normalizedStatus) return;
    fplayStatuses.set(key, normalizedStatus);
    while (fplayStatuses.size > MAX_ITEMS) {
      fplayStatuses.delete(fplayStatuses.keys().next().value);
    }
    persistCapture();
  }

  function getFplayStatus(raw) {
    return fplayStatuses.get(fplayResourceKey(raw)) || "";
  }

  function knownBadFplayKeys() {
    return Array.from(fplayStatuses.entries())
      .filter((entry) => entry[1] === "bad")
      .map((entry) => entry[0]);
  }

  function appendQueryParam(raw, key, value) {
    if (!value) return raw;
    try {
      const url = new URL(raw, location.href);
      if (!url.searchParams.get(key)) url.searchParams.set(key, value);
      return url.href;
    } catch (_error) {
      return raw;
    }
  }

  function pickString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function extractKeySeed(raw) {
    const text = String(raw || "").replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    const match = text.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i)
      || text.match(/["']key_seed["']\s*:\s*["']([^"']+)/i)
      || text.match(/["']keySeed["']\s*:\s*["']([^"']+)/i);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_error) {
      return match[1];
    }
  }

  function looksLikeVideoUrl(raw) {
    const url = normalizeUrl(raw);
    return !!url && (
      /\/video\//i.test(url) ||
      /mime_type=video/i.test(url) ||
      /\.mp4(\?|$)/i.test(url)
    );
  }

  function isDefinitelyNoWatermarkUrl(raw) {
    const url = normalizeUrl(raw);
    return /unwatermarked|no_watermark|logo_type=no_watermark/i.test(url);
  }

  function replaceNoWatermarkMarkers(raw) {
    const url = normalizeUrl(raw);
    if (!url) return "";
    return url
      .replace(/lr=video_gen_watermark_dyn/ig, "lr=video_gen_no_watermark")
      .replace(/lr=video_gen_watermark/ig, "lr=video_gen_no_watermark")
      .replace(/([?&])logo_type=[^&]*/ig, "$1logo_type=no_watermark");
  }

  function upgradeNoWatermarkUrl(raw) {
    const url = normalizeUrl(raw);
    if (!url || !looksLikeVideoUrl(url)) return "";
    if (isDefinitelyNoWatermarkUrl(url)) return url;
    const upgraded = replaceNoWatermarkMarkers(url);
    return upgraded !== url && isDefinitelyNoWatermarkUrl(upgraded) ? upgraded : "";
  }

  function extractFplayUrlsFromText(text) {
    return String(text || "").match(FPLAY_URL_RE) || [];
  }

  function sameMediaResource(left, right) {
    const leftUrl = normalizeUrl(left);
    const rightUrl = normalizeUrl(right);
    if (!leftUrl || !rightUrl) return false;
    if (leftUrl === rightUrl) return true;
    try {
      const a = new URL(leftUrl);
      const b = new URL(rightUrl);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch (_error) {
      return false;
    }
  }

  function safeClone(value, depth = 0, seen = new WeakSet()) {
    if (depth > 8) return undefined;
    if (value == null) return value;
    if (typeof value === "string") return value.length > 12000 ? value.slice(0, 12000) : value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object" || seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((item) => safeClone(item, depth + 1, seen));
    }
    const out = {};
    let keys = [];
    try {
      keys = Object.keys(value);
    } catch (_error) {
      return undefined;
    }
    for (const key of keys.slice(0, 120)) {
      const cloned = safeClone(value[key], depth + 1, seen);
      if (cloned !== undefined) out[key] = cloned;
    }
    return out;
  }

  function extractVideoInfoSignature(root) {
    const result = {
      messageIds: new Set(),
      vids: new Set(),
      urls: new Set(),
      fplayUrls: new Set(),
      keySeeds: new Set()
    };

    const queue = [root];
    const seen = new WeakSet();
    let visited = 0;

    while (queue.length && visited < 1800) {
      const current = queue.shift();
      visited += 1;

      if (typeof current === "string") {
        const keySeed = extractKeySeed(current);
        if (keySeed) result.keySeeds.add(keySeed);
        for (const url of extractFplayUrlsFromText(current)) {
          result.fplayUrls.add(normalizeUrl(appendQueryParam(url, "key_seed", keySeed)));
        }
        const maybeUrl = normalizeUrl(current);
        if (looksLikeVideoUrl(maybeUrl)) result.urls.add(maybeUrl);
        continue;
      }

      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);

      let keys = [];
      try {
        keys = Object.keys(current);
      } catch (_error) {
        continue;
      }

      for (const key of keys.slice(0, 120)) {
        let value;
        try {
          value = current[key];
        } catch (_error) {
          continue;
        }

        const keyName = String(key).toLowerCase();
        if (typeof value === "string") {
          const normalizedValue = value.trim();
          if ((keyName === "message_id" || keyName === "messageid" || keyName === "msg_id") && normalizedValue) {
            result.messageIds.add(normalizedValue);
          }
          if ((keyName === "vid" || keyName === "video_id" || keyName === "videoid" || keyName === "key") && normalizedValue) {
            result.vids.add(normalizedValue);
          }
          if (["main_url", "mainurl", "backup_url_1", "backup_url_2", "backup_url_3", "play_url", "playurl", "video_url", "videourl", "download_url", "downloadurl", "url"].includes(keyName)) {
            const mediaUrl = normalizeUrl(normalizedValue);
            if (/\/video\/fplay\//i.test(mediaUrl)) {
              result.fplayUrls.add(mediaUrl);
            } else if (looksLikeVideoUrl(mediaUrl)) {
              result.urls.add(mediaUrl);
            }
          }
          const keySeed = extractKeySeed(normalizedValue);
          if (keySeed) result.keySeeds.add(keySeed);
        }

        queue.push(value);
      }
    }

    return {
      messageIds: Array.from(result.messageIds),
      vids: Array.from(result.vids),
      urls: Array.from(result.urls),
      fplayUrls: Array.from(result.fplayUrls),
      keySeeds: Array.from(result.keySeeds)
    };
  }

  function pushUniqueValue(list, value, normalize = (item) => item) {
    const normalized = normalize(value);
    if (!normalized) return;
    if (!list.includes(normalized)) list.push(normalized);
  }

  function intersectValues(left, right) {
    const rightSet = new Set(right || []);
    return (left || []).filter((item) => rightSet.has(item));
  }

  function contextHasMediaConflict(candidate, record) {
    const candidateVids = candidate && candidate.vids || [];
    const recordVids = record && record.vids || [];
    if (candidateVids.length && recordVids.length && !intersectValues(candidateVids, recordVids).length) {
      return true;
    }

    const candidateKeys = candidate && candidate.keySeeds || [];
    const recordKeys = record && record.keySeeds || [];
    if (candidateKeys.length && recordKeys.length && !intersectValues(candidateKeys, recordKeys).length) {
      return true;
    }

    const candidateFplays = candidate && candidate.fplayUrls || [];
    const recordFplays = record && record.fplayUrls || [];
    if (candidateFplays.length && recordFplays.length && !candidateFplays.some((url) => recordFplays.some((item) => sameFplayResource(item, url)))) {
      return true;
    }

    const candidateUrls = candidate && candidate.urls || [];
    const recordUrls = record && record.urls || [];
    if (candidateUrls.length && recordUrls.length && !candidateUrls.some((url) => recordUrls.some((item) => sameMediaResource(item, url)))) {
      return true;
    }

    return false;
  }

  function makeVideoRecordKey(record) {
    if (!record) return "";
    return [
      (record.messageIds || []).join(","),
      (record.vids || []).join(","),
      (record.keySeeds || []).join(","),
      (record.fplayUrls || []).map((url) => fplayResourceKey(url)).join(","),
      (record.urls || []).map((url) => normalizeUrl(url)).join(","),
      record.videoInfo ? videoInfoContextSignature(record.videoInfo) : ""
    ].join("|");
  }

  function buildVideoRecord(partial) {
    if (!partial || typeof partial !== "object") return null;
    const videoInfo = partial.videoInfo && typeof partial.videoInfo === "object" ? safeClone(partial.videoInfo) : null;
    const signature = videoInfo ? extractVideoInfoSignature(videoInfo) : {
      messageIds: [],
      vids: [],
      urls: [],
      fplayUrls: [],
      keySeeds: []
    };
    const hasDomVideo = partial && (partial.hasDomVideo === true || partial.hasDomVideo === "1");

    const messageIds = [];
    const vids = [];
    const urls = [];
    const fplayList = [];
    const keySeeds = [];

    pushUniqueValue(messageIds, partial.messageId, (value) => String(value || "").trim());
    for (const value of signature.messageIds) pushUniqueValue(messageIds, value, (item) => String(item || "").trim());

    pushUniqueValue(vids, partial.vid, (value) => String(value || "").trim());
    for (const value of signature.vids) pushUniqueValue(vids, value, (item) => String(item || "").trim());

    for (const value of [partial.requestUrl, partial.responseUrl, partial.directVideoUrl, partial.videoUrl]) {
      if (looksLikeVideoUrl(value) && !/\/video\/fplay\//i.test(String(value || ""))) {
        pushUniqueValue(urls, value, normalizeUrl);
      }
    }
    for (const value of signature.urls) pushUniqueValue(urls, value, normalizeUrl);

    for (const value of [partial.fplayUrl, partial.requestUrl, partial.responseUrl]) {
      if (/\/video\/fplay\//i.test(String(value || ""))) {
        pushUniqueValue(fplayList, bestSeededVariant(value), normalizeUrl);
      }
    }
    for (const value of signature.fplayUrls) pushUniqueValue(fplayList, bestSeededVariant(value), normalizeUrl);

    for (const value of [partial.keySeed, partial.requestKeySeed]) {
      pushUniqueValue(keySeeds, value, (item) => String(item || "").trim());
    }
    for (const value of [
      partial.fplayUrl,
      partial.requestUrl,
      partial.responseUrl,
      partial.directVideoUrl,
      partial.videoUrl
    ]) {
      pushUniqueValue(keySeeds, extractKeySeed(value), (item) => String(item || "").trim());
    }
    for (const value of signature.keySeeds) pushUniqueValue(keySeeds, value, (item) => String(item || "").trim());

    if (!messageIds.length && !vids.length && !urls.length && !fplayList.length && !keySeeds.length && !videoInfo) {
      return null;
    }

    return {
      messageIds,
      vids,
      urls,
      fplayUrls: fplayList,
      keySeeds,
      hasDomVideo,
      videoInfo,
      requestUrl: normalizeUrl(partial.requestUrl || ""),
      responseUrl: normalizeUrl(partial.responseUrl || ""),
      updatedAt: Date.now()
    };
  }

  function findVideoRecordIndex(candidate) {
    if (!candidate) return -1;
    const candidateKey = makeVideoRecordKey(candidate);
    return videoRecords.findIndex((record) => {
      if (candidateKey && makeVideoRecordKey(record) === candidateKey) return true;
      if (intersectValues(candidate.vids, record.vids).length) return true;
      if (intersectValues(candidate.keySeeds, record.keySeeds).length) return true;
      if ((candidate.fplayUrls || []).some((url) => (record.fplayUrls || []).some((item) => sameFplayResource(item, url)))) return true;
      if ((candidate.urls || []).some((url) => (record.urls || []).some((item) => sameMediaResource(item, url)))) return true;
      if (intersectValues(candidate.messageIds, record.messageIds).length && !contextHasMediaConflict(candidate, record)) return true;
      return false;
    });
  }

  function rememberVideoRecord(partial) {
    ensureCurrentPage();
    const candidate = buildVideoRecord(partial);
    if (!candidate) return;

    const existingIndex = findVideoRecordIndex(candidate);
    const existing = existingIndex >= 0 ? videoRecords[existingIndex] : null;
    const canCreateStandalone = !!(candidate.hasDomVideo || (candidate.urls || []).length || (candidate.fplayUrls || []).length || candidate.videoInfo);
    const canUpdateExisting = !!existing;
    if (!canCreateStandalone && !canUpdateExisting) return;
    const merged = {
      messageIds: [],
      vids: [],
      urls: [],
      fplayUrls: [],
      keySeeds: [],
      hasDomVideo: candidate.hasDomVideo || (existing && existing.hasDomVideo) || false,
      videoInfo: candidate.videoInfo || (existing && existing.videoInfo) || null,
      requestUrl: candidate.requestUrl || (existing && existing.requestUrl) || "",
      responseUrl: candidate.responseUrl || (existing && existing.responseUrl) || "",
      updatedAt: Date.now()
    };

    for (const value of [...(candidate.messageIds || []), ...(existing && existing.messageIds || [])]) {
      pushUniqueValue(merged.messageIds, value, (item) => String(item || "").trim());
    }
    for (const value of [...(candidate.vids || []), ...(existing && existing.vids || [])]) {
      pushUniqueValue(merged.vids, value, (item) => String(item || "").trim());
    }
    for (const value of [...(candidate.urls || []), ...(existing && existing.urls || [])]) {
      pushUniqueValue(merged.urls, value, normalizeUrl);
    }
    for (const value of [...(candidate.fplayUrls || []), ...(existing && existing.fplayUrls || [])]) {
      pushUniqueValue(merged.fplayUrls, bestSeededVariant(value), normalizeUrl);
    }
    for (const value of [...(candidate.keySeeds || []), ...(existing && existing.keySeeds || [])]) {
      pushUniqueValue(merged.keySeeds, value, (item) => String(item || "").trim());
    }

    if (existingIndex >= 0) videoRecords.splice(existingIndex, 1);
    videoRecords.unshift(merged);
    if (videoRecords.length > 20) videoRecords.length = 20;
    persistCapture();
  }

  function remember(raw, meta = {}) {
    ensureCurrentPage();
    if (typeof meta.startTime === "number" && meta.startTime + 250 < activeStartedAt) return;
    let url = normalizeUrl(raw);
    if (meta.keySeed) url = appendQueryParam(url, "key_seed", meta.keySeed);
    const isFplay = /\/video\/fplay\//i.test(url);
    if (!isFplay) return;
    pushUnique(fplayUrls, url);
    try {
      chrome.runtime.sendMessage({ type: "DOLA_BG_REMEMBER", url, pageKey: activePageKey });
    } catch (_error) {
      // ignored
    }
    persistCapture();
  }

  function rememberVideoInfo(videoInfo) {
    ensureCurrentPage();
    if (!videoInfo || typeof videoInfo !== "object") return;
    try {
      const cloned = safeClone(videoInfo);
      const text = JSON.stringify(cloned);
      if (!/key_seed/i.test(text) || !/main_url|backup_url|video_list|qAAB/i.test(text)) return;
      if (videoInfos.some((item) => JSON.stringify(item) === text)) return;
      videoInfos.unshift(cloned);
      if (videoInfos.length > 10) videoInfos.length = 10;
      rememberVideoRecord({ videoInfo: cloned });
      persistCapture();
    } catch (_error) {
      // ignored
    }
  }

  function scanValue(value, depth = 0, seen = new WeakSet()) {
    if (scanBudget <= 0 || depth > 7) return;
    scanBudget -= 1;
    if (typeof value === "string") {
      scanTextForFplay(value);
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    let keys = [];
    try {
      keys = Object.keys(value);
    } catch (_error) {
      return;
    }
    const keyText = keys.join(",");
    let shallowText = keyText;
    for (const key of keys.slice(0, 35)) {
      try {
        const child = value[key];
        if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
          shallowText += ` ${key}:${String(child).slice(0, 300)}`;
        }
      } catch (_error) {
        // ignored
      }
    }
    if (/key_seed|main_url|backup_url|video_list|qAAB|video_1/i.test(shallowText)) {
      try {
        const cloned = safeClone(value);
        const text = JSON.stringify(cloned);
        if (/key_seed/i.test(text) && /main_url|backup_url|video_list|qAAB/i.test(text)) {
          rememberVideoInfo(cloned);
        }
      } catch (_error) {
        // ignored
      }
    }

    for (const key of keys.slice(0, 80)) {
      try {
        scanValue(value[key], depth + 1, seen);
      } catch (_error) {
        // ignored
      }
    }
  }

  function injectHook() {
    const root = document.documentElement || document.head;
    if (!root) {
      setTimeout(injectHook, 50);
      return;
    }
    if (root.dataset.dolaApiHookInjected === "1") return;
    root.dataset.dolaApiHookInjected = "1";
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("page_hook.js");
    script.async = false;
    root.appendChild(script);
    script.remove();
  }

  function scanTextForFplay(text) {
    const matches = extractFplayUrlsFromText(text);
    matches.forEach(remember);
  }

  function scanReactState() {
    scanBudget = 3000;
    const roots = Array.from(document.querySelectorAll("video, [data-testid], [class], [id]")).slice(0, 1400);
    for (const node of roots) {
      let keys = [];
      try {
        keys = Object.keys(node);
      } catch (_error) {
        continue;
      }
      for (const key of keys) {
        if (/^__react(Fiber|Props|Container)\$/.test(key)) {
          try {
            scanValue(node[key]);
          } catch (_error) {
            // ignored
          }
        }
      }
      if (scanBudget <= 0) break;
    }
  }

  function scanDom() {
    ensureCurrentPage();
    blobVideoCount = 0;
    const attrs = Array.from(document.querySelectorAll("[src], [href]"));
    for (const node of attrs) {
      remember(node.getAttribute("src") || node.getAttribute("href") || "");
    }
    const videos = Array.from(document.querySelectorAll("video"));
    for (const video of videos) {
      const current = video.currentSrc || video.src || "";
      if (current.startsWith("blob:")) blobVideoCount += 1;
      remember(current);
      for (const source of Array.from(video.querySelectorAll("source"))) {
        remember(source.src || source.getAttribute("src") || "");
      }
    }
    scanReactState();
  }

  function scanPerformance() {
    ensureCurrentPage();
    try {
      const entries = performance.getEntriesByType("resource") || [];
      for (const entry of entries) remember(entry.name, { startTime: entry.startTime });
    } catch (_error) {
      // ignored
    }
  }

  function sameFplayResource(left, right) {
    return fplayResourceKey(left) === fplayResourceKey(right);
  }

  function hasKeySeed(url) {
    return /(?:^|[?&])key_seed=/i.test(url);
  }

  function bestSeededVariant(url) {
    if (!url || hasKeySeed(url)) return url;
    return fplayUrls.find((candidate) => getFplayStatus(candidate) !== "bad" && hasKeySeed(candidate) && sameFplayResource(candidate, url)) || url;
  }

  function rankedFplayUrls() {
    const ranked = [];
    const seen = new Set();
    for (const raw of fplayUrls) {
      const url = bestSeededVariant(raw);
      const key = fplayResourceKey(url);
      if (!key || seen.has(key) || getFplayStatus(url) === "bad") continue;
      seen.add(key);
      ranked.push({ url, status: getFplayStatus(url), seeded: hasKeySeed(url) });
    }
    ranked.sort((left, right) => {
      if (left.status !== right.status) return left.status === "ok" ? -1 : 1;
      if (left.seeded !== right.seeded) return left.seeded ? -1 : 1;
      return 0;
    });
    return ranked.map((item) => item.url);
  }

  function bestFplayUrl() {
    scanPerformance();
    return rankedFplayUrls()[0] || "";
  }

  function bestVideoInfo() {
    scanDom();
    return videoInfos[0] || null;
  }

  function bestDirectVideoUrl() {
    const videos = Array.from(document.querySelectorAll("video"));
    const primaryVideo = pickPrimaryPreviewVideo(videos);
    const ordered = primaryVideo ? [primaryVideo, ...videos.filter((video) => video !== primaryVideo)] : videos;
    for (const video of ordered) {
      const url = normalizeUrl(video.currentSrc || video.src || "");
      if (/^https?:\/\/.+mime_type=video_mp4/i.test(url) || /^https?:\/\/.+\/video\//i.test(url)) {
        return url;
      }
    }
    return "";
  }

  function getAncestorValue(node, attributeNames) {
    let current = node;
    for (let index = 0; index < 12 && current && current !== document.body; index += 1) {
      if (current.dataset) {
        for (const name of attributeNames) {
          const datasetName = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
          const value = current.dataset[datasetName];
          if (value) return String(value).trim();
        }
      }
      if (typeof current.getAttribute === "function") {
        for (const name of attributeNames) {
          const value = current.getAttribute(name);
          if (value) return String(value).trim();
        }
      }
      current = current.parentElement;
    }
    return "";
  }

  function ensureVideoElementId(video) {
    if (!video || typeof video.getAttribute !== "function") return "";
    const existing = String(video.getAttribute("data-dola-api-video-id") || "").trim();
    if (existing) return existing;
    const id = `dola_video_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    try {
      video.setAttribute("data-dola-api-video-id", id);
      return id;
    } catch (_error) {
      return "";
    }
  }

  function findScopedVideoRoot(video) {
    let best = video;
    let current = video && video.parentElement;
    for (let depth = 0; depth < 12 && current && current !== document.body; depth += 1) {
      let videoCount = 0;
      try {
        videoCount = current.querySelectorAll("video").length;
      } catch (_error) {
        break;
      }
      if (videoCount !== 1) break;
      best = current;
      current = current.parentElement;
    }
    return best;
  }

  function getReactRootsForVideo(video) {
    const roots = [];
    const scopeRoot = findScopedVideoRoot(video);
    let current = video;
    for (let depth = 0; depth < 10 && current; depth += 1) {
      let keys = [];
      try {
        keys = Object.keys(current);
      } catch (_error) {
        if (current === scopeRoot) break;
        current = current.parentElement;
        continue;
      }
      for (const key of keys) {
        if (/^__react(Fiber|Props|Container)\$/.test(key)) {
          try {
            roots.push(current[key]);
          } catch (_error) {
            // ignored
          }
        }
      }
      if (current === scopeRoot) break;
      current = current.parentElement;
    }
    return roots;
  }

  function collectScopedCandidatesForVideo(video) {
    const scopedVideoInfos = [];
    const scopedFplayUrls = [];
    const seenJson = new Set();

    function pushScopedFplay(raw, keySeed = "") {
      const url = normalizeUrl(appendQueryParam(raw, "key_seed", keySeed));
      if (!/\/video\/fplay\//i.test(url)) return;
      if (!scopedFplayUrls.includes(url)) scopedFplayUrls.push(url);
    }

    function pushScopedVideoInfo(value) {
      try {
        const cloned = safeClone(value);
        const text = JSON.stringify(cloned);
        if (!/key_seed/i.test(text) || !/main_url|backup_url|video_list|qAAB/i.test(text)) return;
        if (seenJson.has(text)) return;
        seenJson.add(text);
        scopedVideoInfos.push(cloned);
      } catch (_error) {
        // ignored
      }
    }

    function scanScopedValue(value, depth = 0, seen = new WeakSet()) {
      if (!value || depth > 8) return;
      if (typeof value === "string") {
        const keySeed = extractKeySeed(value);
        for (const url of extractFplayUrlsFromText(value)) {
          pushScopedFplay(url, keySeed);
        }
        return;
      }
      if (typeof value !== "object" || seen.has(value)) return;
      seen.add(value);

      let keys = [];
      try {
        keys = Object.keys(value);
      } catch (_error) {
        return;
      }

      const keyText = keys.join(",");
      if (/key_seed|main_url|backup_url|video_list|qAAB|video_1/i.test(keyText)) {
        pushScopedVideoInfo(value);
      }

      for (const key of keys.slice(0, 120)) {
        try {
          scanScopedValue(value[key], depth + 1, seen);
        } catch (_error) {
          // ignored
        }
      }
    }

    for (const root of getReactRootsForVideo(video)) {
      scanScopedValue(root);
    }

    return { videoInfos: scopedVideoInfos, fplayUrls: scopedFplayUrls };
  }

  function collectVideoHint(video) {
    const scopeRoot = findScopedVideoRoot(video);
    const urls = [];
    const currentSrc = normalizeUrl(video.currentSrc || video.src || "");
    if (currentSrc) urls.push(currentSrc);
    for (const source of Array.from(video.querySelectorAll("source"))) {
      const sourceUrl = normalizeUrl(source.src || source.getAttribute("src") || "");
      if (sourceUrl && !urls.includes(sourceUrl)) urls.push(sourceUrl);
    }
    return {
      messageId: getAncestorValue(scopeRoot, ["data-message-id", "message-id", "data-message_id", "message_id"])
        || getAncestorValue(video, ["data-message-id", "message-id", "data-message_id", "message_id"]),
      vid: getAncestorValue(scopeRoot, ["data-vid", "vid", "data-video-id", "video-id"])
        || getAncestorValue(video, ["data-vid", "vid", "data-video-id", "video-id"]),
      urls
    };
  }

  function collectPreferredDirectVideoUrls(video) {
    const directUrls = [];
    const seen = new Set();

    function pushDirect(raw) {
      const url = normalizeUrl(raw);
      if (!url || seen.has(url)) return;
      seen.add(url);
      const upgraded = upgradeNoWatermarkUrl(url);
      if (upgraded && !directUrls.includes(upgraded)) {
        directUrls.push(upgraded);
      }
      if (isDefinitelyNoWatermarkUrl(url) && !directUrls.includes(url)) {
        directUrls.push(url);
      }
    }

    pushDirect(video.currentSrc || video.src || "");
    for (const source of Array.from(video.querySelectorAll("source"))) {
      pushDirect(source.src || source.getAttribute("src") || "");
    }

    for (const url of collectVideoHint(video).urls) {
      pushDirect(url);
    }

    return directUrls;
  }

  function scoreVideoRecordForVideo(video, record, hint = null) {
    if (!record) return -1;
    const localHint = hint || collectVideoHint(video);
    let score = 0;
    if (localHint.messageId && (record.messageIds || []).includes(localHint.messageId)) score += 180;
    if (localHint.vid && (record.vids || []).includes(localHint.vid)) score += 170;
    if ((record.urls || []).some((url) => localHint.urls.some((item) => sameMediaResource(url, item)))) score += 140;
    if ((record.urls || []).some((url) => localHint.urls.some((item) => normalizeUrl(url) === normalizeUrl(item)))) score += 30;
    const localKeys = localHint.keySeeds || [];
    if (localKeys.some((keySeed) => (record.keySeeds || []).includes(keySeed))) score += 120;
    if (record.hasDomVideo && (record.urls || []).some((url) => localHint.urls.some((item) => normalizeUrl(url) === normalizeUrl(item)))) score += 120;
    if (localHint.vid && (record.vids || []).length && !(record.vids || []).includes(localHint.vid)) score -= 220;
    if (localKeys.length && (record.keySeeds || []).length && !localKeys.some((keySeed) => (record.keySeeds || []).includes(keySeed))) score -= 180;
    if (localHint.urls.length && (record.urls || []).length && !(record.urls || []).some((url) => localHint.urls.some((item) => sameMediaResource(url, item)))) score -= 200;
    if ((record.fplayUrls || []).length) score += 12;
    if (record.videoInfo) score += 10;
    return score;
  }

  function rankVideoRecordsForVideo(video, hint = null) {
    const localHint = hint || buildVideoInfoHint(video);
    return videoRecords
      .map((record) => ({ record, score: scoreVideoRecordForVideo(video, record, localHint) }))
      .sort((left, right) => right.score - left.score)
      .map((item) => item.record);
  }

  async function mediaUrlsForPage() {
    const response = await runtimeSendMessage({
      type: "DOLA_BG_GET_CAPTURE",
      pageKey: activePageKey || currentPageKey()
    });
    return response && response.ok && Array.isArray(response.mediaUrls) ? response.mediaUrls : [];
  }

  function pickMatchedBackgroundMediaUrl(video, mediaUrls) {
    const currentSrc = normalizeUrl(video && (video.currentSrc || video.src || ""));
    if (!currentSrc) return "";
    const candidates = Array.isArray(mediaUrls) ? mediaUrls : [];
    return candidates.find((url) => sameMediaResource(url, currentSrc))
      || candidates.find((url) => normalizeUrl(url) === currentSrc)
      || "";
  }

  async function logDebugEntry(entry) {
    try {
      await runtimeSendMessage({
        type: "DOLA_BG_DEBUG_LOG",
        entry: {
          pageUrl: location.href,
          ...entry
        }
      });
    } catch (_error) {
      // ignored
    }
  }

  function pushVideoRecordContexts(list, seen, record) {
    if (!record) return;
    for (const url of record.urls || []) {
      const upgraded = upgradeNoWatermarkUrl(url);
      if (upgraded) pushUniqueContext(list, seen, { directVideoUrl: upgraded });
      if (isDefinitelyNoWatermarkUrl(url)) pushUniqueContext(list, seen, { directVideoUrl: url });
    }
    for (const url of record.fplayUrls || []) {
      pushUniqueContext(list, seen, { fplayUrl: url });
    }
    if (record.videoInfo) {
      pushUniqueContext(list, seen, { videoInfo: record.videoInfo });
    }
  }

  function scoreVideoInfoForHint(videoInfo, hint) {
    const signature = extractVideoInfoSignature(videoInfo);
    let score = 0;

    if (hint.messageId && signature.messageIds.includes(hint.messageId)) score += 120;
    if (hint.vid && signature.vids.includes(hint.vid)) score += 110;
    if (hint.keySeeds && hint.keySeeds.some((keySeed) => signature.keySeeds.includes(keySeed))) score += 90;
    if (hint.urls && hint.urls.some((url) => signature.urls.some((candidate) => sameMediaResource(candidate, url)))) score += 80;
    if (hint.urls && hint.urls.some((url) => signature.urls.some((candidate) => normalizeUrl(candidate) === normalizeUrl(url)))) score += 20;

    return { score, signature };
  }

  function buildVideoInfoHint(video, scoped = null) {
    const localScoped = scoped || collectScopedCandidatesForVideo(video);
    return {
      ...collectVideoHint(video),
      keySeeds: localScoped.fplayUrls.map((url) => extractKeySeed(url)).filter(Boolean)
    };
  }

  function scoreVideoInfosForVideo(video, candidates, scoped = null) {
    if (!Array.isArray(candidates) || !candidates.length) return [];
    const hint = buildVideoInfoHint(video, scoped);
    return candidates.map((candidate) => ({
      candidate,
      score: scoreVideoInfoForHint(candidate, hint).score
    }));
  }

  function rankVideoInfosForVideo(video, candidates, scoped = null) {
    return scoreVideoInfosForVideo(video, candidates, scoped)
      .sort((left, right) => right.score - left.score)
      .map((item) => item.candidate);
  }

  function pickBestVideoInfoForVideo(video, candidates, scoped = null) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const scored = scoreVideoInfosForVideo(video, candidates, scoped)
      .sort((left, right) => right.score - left.score);
    if (!scored.length) return null;
    if (scored[0].score > 0) return scored[0].candidate;
    return candidates.length === 1 ? candidates[0] : null;
  }

  function rankScopedFplayUrls(urls) {
    const ranked = [];
    const seen = new Set();
    for (const raw of urls || []) {
      const url = bestSeededVariant(raw);
      const key = fplayResourceKey(url);
      if (!key || seen.has(key) || getFplayStatus(url) === "bad") continue;
      seen.add(key);
      ranked.push({ url, status: getFplayStatus(url), seeded: hasKeySeed(url) });
    }
    ranked.sort((left, right) => {
      if (left.status !== right.status) return left.status === "ok" ? -1 : 1;
      if (left.seeded !== right.seeded) return left.seeded ? -1 : 1;
      return 0;
    });
    return ranked.map((item) => item.url);
  }

  function resolveVideoActionContext(video, scoped = null, globalFplays = null, options = {}) {
    if (!options.skipScan) {
      scanDom();
      scanPerformance();
    }

    const localScoped = scoped || collectScopedCandidatesForVideo(video);
    const allRankedFplays = globalFplays || rankedFplayUrls();
    const scopedVideoInfo = pickBestVideoInfoForVideo(video, localScoped.videoInfos, localScoped);
    const globalVideoInfo = scopedVideoInfo ? null : pickBestVideoInfoForVideo(video, videoInfos, localScoped);
    const chosenVideoInfo = scopedVideoInfo || globalVideoInfo;

    const scopedFplay = rankScopedFplayUrls(localScoped.fplayUrls)[0] || "";
    let matchedFplay = scopedFplay;

    if (!matchedFplay && chosenVideoInfo) {
      const signature = extractVideoInfoSignature(chosenVideoInfo);
      const keySeeds = signature.keySeeds;
      matchedFplay = allRankedFplays.find((url) => {
        const keySeed = extractKeySeed(url);
        return keySeed && keySeeds.includes(keySeed);
      }) || "";
    }

    if (!matchedFplay && document.querySelectorAll("video").length <= 1 && allRankedFplays.length === 1) {
      matchedFplay = allRankedFplays[0];
    }

    const directVideoUrl = collectPreferredDirectVideoUrls(video)[0] || "";

    return {
      fplayUrl: matchedFplay,
      videoInfo: chosenVideoInfo,
      directVideoUrl
    };
  }

  function listReadyVideos() {
    return Array.from(document.querySelectorAll("video")).filter((video) => {
      const rect = video.getBoundingClientRect();
      return video.isConnected && isVideoReadyForActions(video, rect);
    });
  }

  function videoIndexInDom(video) {
    return Array.from(document.querySelectorAll("video")).indexOf(video);
  }

  function indexCandidatesForVideo(video) {
    const indices = [];
    const domIndex = videoIndexInDom(video);
    if (domIndex >= 0) indices.push(domIndex);
    const readyIndex = listReadyVideos().indexOf(video);
    if (readyIndex >= 0 && !indices.includes(readyIndex)) indices.push(readyIndex);
    return indices;
  }

  function videoInfoContextSignature(videoInfo) {
    const signature = extractVideoInfoSignature(videoInfo);
    return [
      signature.messageIds.join(","),
      signature.vids.join(","),
      signature.keySeeds.join(","),
      signature.fplayUrls.map((url) => fplayResourceKey(url)).join(","),
      signature.urls.map((url) => normalizeUrl(url)).join(",")
    ].join("|");
  }

  function makeContextKey(context) {
    if (!context) return "";
    const parts = [];
    if (context.directVideoUrl) parts.push(`direct:${normalizeUrl(context.directVideoUrl)}`);
    if (context.fplayUrl) parts.push(`fplay:${fplayResourceKey(context.fplayUrl)}:${extractKeySeed(context.fplayUrl)}`);
    if (context.videoInfo) parts.push(`info:${videoInfoContextSignature(context.videoInfo)}`);
    return parts.join("||");
  }

  function pushUniqueContext(list, seen, context) {
    if (!context || typeof context !== "object") return;
    const candidate = {};
    if (context.directVideoUrl && isDefinitelyNoWatermarkUrl(context.directVideoUrl)) {
      candidate.directVideoUrl = normalizeUrl(context.directVideoUrl);
    }
    if (context.fplayUrl && /\/video\/fplay\//i.test(context.fplayUrl)) {
      candidate.fplayUrl = bestSeededVariant(context.fplayUrl);
    }
    if (context.videoInfo && typeof context.videoInfo === "object") {
      candidate.videoInfo = context.videoInfo;
    }
    if (!candidate.directVideoUrl && !candidate.fplayUrl && !candidate.videoInfo) return;
    const key = makeContextKey(candidate);
    if (!key || seen.has(key)) return;
    seen.add(key);
    list.push(candidate);
  }

  function pushVideoInfoContexts(list, seen, videoInfo, globalFplays) {
    if (!videoInfo) return;
    pushUniqueContext(list, seen, { videoInfo });
    const signature = extractVideoInfoSignature(videoInfo);
    for (const raw of signature.urls) {
      if (isDefinitelyNoWatermarkUrl(raw)) {
        pushUniqueContext(list, seen, { directVideoUrl: raw });
      }
    }
    for (const raw of signature.fplayUrls) {
      pushUniqueContext(list, seen, { fplayUrl: raw });
    }
    if (!signature.keySeeds.length) return;
    let matchedCount = 0;
    for (const url of globalFplays) {
      const keySeed = extractKeySeed(url);
      if (!keySeed || !signature.keySeeds.includes(keySeed)) continue;
      pushUniqueContext(list, seen, { fplayUrl: url });
      matchedCount += 1;
      if (matchedCount >= 3) break;
    }
  }

  function buildCandidateContexts(video) {
    scanDom();
    scanPerformance();

    const contexts = [];
    const seen = new Set();
    const strictMultiVideo = document.querySelectorAll("video").length > 1;
    const scoped = collectScopedCandidatesForVideo(video);
    const globalFplays = rankedFplayUrls();
    const resolved = resolveVideoActionContext(video, scoped, globalFplays, { skipScan: true });
    const scoredGlobalVideoInfos = scoreVideoInfosForVideo(video, videoInfos, scoped)
      .sort((left, right) => right.score - left.score);
    const scoredRankedRecords = videoRecords
      .map((record) => ({ record, score: scoreVideoRecordForVideo(video, record, buildVideoInfoHint(video, scoped)) }))
      .sort((left, right) => right.score - left.score);
    const rankedRecords = scoredRankedRecords.map((item) => item.record);

    for (const url of collectPreferredDirectVideoUrls(video)) {
      pushUniqueContext(contexts, seen, { directVideoUrl: url });
    }

    const recordCandidates = strictMultiVideo
      ? scoredRankedRecords.filter((item) => item.score > 0).slice(0, 1).map((item) => item.record)
      : rankedRecords.slice(0, 4);
    for (const record of recordCandidates) {
      pushVideoRecordContexts(contexts, seen, record);
    }

    const rankedScopedInfos = scoreVideoInfosForVideo(video, scoped.videoInfos, scoped)
      .sort((left, right) => right.score - left.score);
    const scopedInfoCandidates = strictMultiVideo
      ? rankedScopedInfos.filter((item) => item.score > 0).slice(0, 1).map((item) => item.candidate)
      : rankedScopedInfos.slice(0, 4).map((item) => item.candidate);
    for (const videoInfo of scopedInfoCandidates) {
      pushVideoInfoContexts(contexts, seen, videoInfo, globalFplays);
    }

    for (const url of rankScopedFplayUrls(scoped.fplayUrls).slice(0, 4)) {
      pushUniqueContext(contexts, seen, { fplayUrl: url });
    }

    if (!strictMultiVideo) {
      for (const index of indexCandidatesForVideo(video)) {
        pushVideoInfoContexts(contexts, seen, videoInfos[index], globalFplays);
        pushUniqueContext(contexts, seen, { fplayUrl: globalFplays[index] });
      }
      pushVideoInfoContexts(contexts, seen, resolved.videoInfo, globalFplays);
      pushUniqueContext(contexts, seen, { fplayUrl: resolved.fplayUrl });
    }
    pushUniqueContext(contexts, seen, { directVideoUrl: resolved.directVideoUrl });

    for (const item of scoredGlobalVideoInfos.slice(0, 4)) {
      if (item.score <= 0) continue;
      pushVideoInfoContexts(contexts, seen, item.candidate, globalFplays);
    }

    if (!strictMultiVideo && videoInfos.length === 1) {
      pushVideoInfoContexts(contexts, seen, videoInfos[0], globalFplays);
    }
    if (!strictMultiVideo && globalFplays.length === 1) {
      pushUniqueContext(contexts, seen, { fplayUrl: globalFplays[0] });
    }

    if (!contexts.length && !strictMultiVideo) {
      for (const item of scoredGlobalVideoInfos.slice(0, 4)) {
        pushVideoInfoContexts(contexts, seen, item.candidate, globalFplays);
      }
      for (const url of globalFplays.slice(0, 4)) {
        pushUniqueContext(contexts, seen, { fplayUrl: url });
      }
    }

    return contexts;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
    return Promise.resolve();
  }

  function setCopyButtonText(button, text) {
    const oldText = button.dataset.defaultText || button.textContent || "复制链接";
    button.textContent = text;
    clearTimeout(button.__dolaCopyTimer);
    button.__dolaCopyTimer = setTimeout(() => {
      button.textContent = oldText;
    }, 1400);
  }

  function setTempButtonText(button, text, fallback) {
    button.textContent = text;
    clearTimeout(button.__dolaTextTimer);
    button.__dolaTextTimer = setTimeout(() => {
      button.textContent = fallback;
    }, 1400);
  }

  function setActionButtonBusy(button, text) {
    button.dataset.defaultText = button.dataset.defaultText || button.textContent || "";
    button.classList.remove("is-error", "is-success");
    button.textContent = text;
    button.disabled = true;
    applyActionButtonVisual(button);
  }

  function resetActionButton(button, fallback) {
    button.disabled = false;
    button.classList.remove("is-error", "is-success");
    button.textContent = button.dataset.defaultText || fallback;
    applyActionButtonVisual(button);
  }

  function flashActionButton(button, text, tone, fallback) {
    button.classList.remove("is-error", "is-success");
    if (tone === "error") button.classList.add("is-error");
    if (tone === "success") button.classList.add("is-success");
    button.textContent = text;
    applyActionButtonVisual(button);
    clearTimeout(button.__dolaActionTimer);
    button.__dolaActionTimer = setTimeout(() => {
      button.classList.remove("is-error", "is-success");
      button.textContent = button.dataset.defaultText || fallback;
      applyActionButtonVisual(button);
    }, 1400);
  }

  async function copyCurrentVideoLink(button) {
    scanDom();
    const url = bestFplayUrl();
    if (!url) {
      setCopyButtonText(button, "刷新页面重试");
      return;
    }
    try {
      await copyText(url);
      setCopyButtonText(button, "已复制");
    } catch (_error) {
      setCopyButtonText(button, "刷新页面重试");
    }
  }

  function stylePanel(panel) {
    panel.style.position = "absolute";
    panel.style.right = "12px";
    panel.style.bottom = "12px";
    panel.style.zIndex = "2147483647";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.alignItems = "flex-end";
    panel.style.gap = "8px";
    panel.style.pointerEvents = "none";
    panel.style.transform = "scale(.9)";
    panel.style.transformOrigin = "right bottom";
  }

  function clearLegacyInjectedPanels() {
    const selectors = [
      ".dola-video-actions",
      ".dola-copy-video-link",
      ".dola-nowatermark-download",
      ".dola-video-actions-v2",
      "[data-dola-api-ui-version]"
    ];
    for (const node of document.querySelectorAll(selectors.join(","))) {
      if (node && typeof node.remove === "function") {
        node.remove();
      }
    }
    copyButtons.clear();
  }

  function applyActionButtonVisual(button) {
    const kind = button.dataset.actionKind || "download";
    const isSuccess = button.classList.contains("is-success");
    const isError = button.classList.contains("is-error");
    button.style.border = isSuccess || isError || kind === "download" ? "none" : "1px solid #cfe0ff";
    button.style.background = isSuccess
      ? "rgba(24,168,123,.94)"
      : isError
        ? "rgba(228,87,87,.94)"
        : kind === "download"
          ? "rgba(22,119,255,.94)"
          : "rgba(255,255,255,.94)";
    button.style.color = isSuccess || isError || kind === "download" ? "#fff" : "#1677ff";
  }

  function styleActionButton(button, kind) {
    button.type = "button";
    button.textContent = kind === "download" ? "下载原视频" : "打开链接";
    button.dataset.defaultText = button.textContent;
    button.dataset.actionKind = kind;
    button.style.height = "36px";
    button.style.minWidth = kind === "download" ? "116px" : "96px";
    button.style.padding = "0 14px";
    button.style.borderRadius = "999px";
    button.style.font = "900 12px Microsoft YaHei UI, Microsoft YaHei, Segoe UI, Arial, sans-serif";
    button.style.letterSpacing = "0";
    button.style.lineHeight = "1";
    button.style.boxShadow = "0 12px 28px rgba(37,61,105,.18)";
    button.style.backdropFilter = "blur(14px)";
    button.style.cursor = "pointer";
    button.style.userSelect = "none";
    button.style.pointerEvents = "auto";
    button.style.display = "inline-flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    button.style.whiteSpace = "nowrap";
    button.style.transition = "transform .18s ease, background .18s ease, opacity .18s ease, box-shadow .18s ease";
    applyActionButtonVisual(button);
    button.addEventListener("mouseenter", () => {
      if (button.disabled) return;
      if (button.classList.contains("is-success") || button.classList.contains("is-error")) return;
      button.style.background = kind === "download" ? "rgba(15,102,217,.98)" : "rgba(237,246,255,.98)";
      button.style.transform = "translateY(-1px)";
      button.style.boxShadow = "0 14px 32px rgba(37,61,105,.22)";
    });
    button.addEventListener("mouseleave", () => {
      applyActionButtonVisual(button);
      button.style.transform = "none";
      button.style.boxShadow = "0 12px 28px rgba(37,61,105,.18)";
    });
  }

  function markControlsActive(controls, duration = 1500) {
    controls.activeUntil = Date.now() + duration;
  }

  function videoArea(rect) {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function pickPrimaryPreviewVideo(videos) {
    let primaryVideo = null;
    let bestArea = 0;
    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      if (!video.isConnected || !isVideoReadyForActions(video, rect)) continue;
      const area = videoArea(rect);
      if (area > bestArea) {
        bestArea = area;
        primaryVideo = video;
      }
    }
    return primaryVideo;
  }

  function bindControlsVisibility(video, controls) {
    const activate = () => {
      markControlsActive(controls);
    };
    for (const eventName of ["mouseenter", "mousemove", "focus", "touchstart"]) {
      video.addEventListener(eventName, activate, true);
      controls.panel.addEventListener(eventName, activate, true);
    }
  }

  function sendBackground(message) {
    return runtimeSendMessage(message);
  }

  function requestResolvedVideoFromPage(video) {
    const videoIndex = videoIndexInDom(video);
    const videoElementId = ensureVideoElementId(video);
    const hint = collectVideoHint(video);
    const directUrls = collectPreferredDirectVideoUrls(video);
    const payload = {
      messageId: hint.messageId || "",
      conversationId: currentConversationId(),
      vid: hint.vid || "",
      videoUrl: directUrls[0] || normalizeUrl(video.currentSrc || video.src || ""),
      keySeed: directUrls.map((url) => extractKeySeed(url)).find(Boolean) || "",
      videoIndex,
      videoElementId
    };

    return new Promise((resolve) => {
      const requestId = `dola_video_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.type !== CAPTURE_MESSAGE || data.requestId !== requestId || !data.videoResult) return;
        window.removeEventListener("message", onMessage);
        resolve(data.videoResult);
      };
      window.addEventListener("message", onMessage);
      window.postMessage({
        type: CAPTURE_MESSAGE,
        videoRequest: {
          requestId,
          ...payload
        }
      }, location.origin);
      setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve({ ok: false, error: "站内视频解析超时" });
      }, 15000);
    });
  }

  async function tryOpenCandidateContexts(contexts, referer) {
    let lastError = "处理失败";
    for (const context of contexts) {
      const result = context.fplayUrl || context.videoInfo
        ? await sendBackground({
          type: "DOLA_BG_OPEN_NOWATERMARK",
          fplayUrl: context.fplayUrl || "",
          videoInfo: context.videoInfo || null,
          referer
        })
        : await sendBackground({
          type: "DOLA_BG_OPEN_DIRECT",
          videoUrl: context.directVideoUrl || "",
          referer
        });
      if (result && result.ok) {
        return result;
      }
      if (result && result.error) lastError = result.error;
    }
    return { ok: false, error: lastError };
  }

  async function tryDownloadCandidateContexts(contexts, referer) {
    let lastError = "处理失败";
    for (const context of contexts) {
      const result = context.fplayUrl || context.videoInfo
        ? await sendBackground({
          type: "DOLA_BG_DOWNLOAD_NOWATERMARK",
          fplayUrl: context.fplayUrl || "",
          videoInfo: context.videoInfo || null,
          referer
        })
        : await sendBackground({
          type: "DOLA_BG_DOWNLOAD_DIRECT",
          videoUrl: context.directVideoUrl || "",
          referer
        });
      if (result && result.ok) {
        return result;
      }
      if (result && result.error) lastError = result.error;
    }
    return { ok: false, error: lastError };
  }

  async function openNowatermark(video, button) {
    setActionButtonBusy(button, "解析中");
    const pageResult = await requestResolvedVideoFromPage(video);
    let result = null;
    const videoIndex = videoIndexInDom(video);
    const currentSrc = normalizeUrl(video.currentSrc || video.src || "");

    if (pageResult && pageResult.ok && pageResult.result && pageResult.result.videoUrl) {
      await logDebugEntry({
        action: "open",
        route: "page-result",
        videoIndex,
        currentSrc,
        result: pageResult.result
      });
      result = await sendBackground({
        type: "DOLA_BG_OPEN_DIRECT",
        videoUrl: pageResult.result.videoUrl,
        referer: location.href
      });
    } else {
      const backgroundMediaUrls = await mediaUrlsForPage();
      const matchedMediaUrl = pickMatchedBackgroundMediaUrl(video, backgroundMediaUrls);
      const strictLocalContexts = [];
      const strictSeen = new Set();
      if (matchedMediaUrl) {
        pushUniqueContext(strictLocalContexts, strictSeen, {
          directVideoUrl: upgradeNoWatermarkUrl(matchedMediaUrl) || matchedMediaUrl
        });
      }
      await logDebugEntry({
        action: "open",
        route: "background-media",
        videoIndex,
        currentSrc,
        mediaUrl: matchedMediaUrl,
        pageError: pageResult && pageResult.error ? pageResult.error : ""
      });
      if (strictLocalContexts.length) {
        result = await tryOpenCandidateContexts(strictLocalContexts, location.href);
      }
      if (!result || !result.ok) {
        const fallbackContexts = buildCandidateContexts(video);
        await logDebugEntry({
          action: "open",
          route: "fallback-contexts",
          videoIndex,
          currentSrc,
          fallbackCount: fallbackContexts.length,
          pageError: pageResult && pageResult.error ? pageResult.error : ""
        });
        if (!fallbackContexts.length) {
          button.disabled = false;
          flashActionButton(button, "请重试", "error", "打开链接");
          return;
        }
        result = await tryOpenCandidateContexts(fallbackContexts, location.href);
      }
    }

    button.disabled = false;
    if (result && result.ok) {
      flashActionButton(button, "已打开", "success", "打开链接");
    } else {
      await logDebugEntry({
        action: "open",
        route: "final-error",
        videoIndex,
        currentSrc,
        error: result && result.error ? result.error : "处理失败"
      });
      flashActionButton(button, "请重试", "error", "打开链接");
    }
    setTimeout(() => resetActionButton(button, "打开链接"), 180);
  }

  async function downloadNowatermark(video, button) {
    setActionButtonBusy(button, "解析中");
    const pageResult = await requestResolvedVideoFromPage(video);
    let result = null;
    const videoIndex = videoIndexInDom(video);
    const currentSrc = normalizeUrl(video.currentSrc || video.src || "");

    if (pageResult && pageResult.ok && pageResult.result && pageResult.result.videoUrl) {
      await logDebugEntry({
        action: "download",
        route: "page-result",
        videoIndex,
        currentSrc,
        result: pageResult.result
      });
      result = await sendBackground({
        type: "DOLA_BG_DOWNLOAD_DIRECT",
        videoUrl: pageResult.result.videoUrl,
        referer: location.href
      });
    } else {
      const backgroundMediaUrls = await mediaUrlsForPage();
      const matchedMediaUrl = pickMatchedBackgroundMediaUrl(video, backgroundMediaUrls);
      const strictLocalContexts = [];
      const strictSeen = new Set();
      if (matchedMediaUrl) {
        pushUniqueContext(strictLocalContexts, strictSeen, {
          directVideoUrl: upgradeNoWatermarkUrl(matchedMediaUrl) || matchedMediaUrl
        });
      }
      await logDebugEntry({
        action: "download",
        route: "background-media",
        videoIndex,
        currentSrc,
        mediaUrl: matchedMediaUrl,
        pageError: pageResult && pageResult.error ? pageResult.error : ""
      });
      if (strictLocalContexts.length) {
        result = await tryDownloadCandidateContexts(strictLocalContexts, location.href);
      }
      if (!result || !result.ok) {
        const fallbackContexts = buildCandidateContexts(video);
        await logDebugEntry({
          action: "download",
          route: "fallback-contexts",
          videoIndex,
          currentSrc,
          fallbackCount: fallbackContexts.length,
          pageError: pageResult && pageResult.error ? pageResult.error : ""
        });
        if (!fallbackContexts.length) {
          button.disabled = false;
          flashActionButton(button, "请重试", "error", "下载原视频");
          return;
        }
        result = await tryDownloadCandidateContexts(fallbackContexts, location.href);
      }
    }

    button.disabled = false;
    if (result && result.ok) {
      flashActionButton(button, "开始下载", "success", "下载原视频");
    } else {
      await logDebugEntry({
        action: "download",
        route: "final-error",
        videoIndex,
        currentSrc,
        error: result && result.error ? result.error : "处理失败"
      });
      flashActionButton(button, "请重试", "error", "下载原视频");
    }
    setTimeout(() => resetActionButton(button, "下载原视频"), 220);
  }

  function bindOpenButton(video, button) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openNowatermark(video, button);
    }, true);
  }

  function bindDownloadButton(video, button) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadNowatermark(video, button);
    }, true);
  }

  function updateDownloadButtonLabels() {
    for (const controls of copyButtons.values()) {
      if (controls.downloadButton && !controls.downloadButton.disabled) {
        controls.downloadButton.textContent = controls.downloadButton.dataset.defaultText || "下载原视频";
      }
      if (controls.openButton && !controls.openButton.disabled) {
        controls.openButton.textContent = controls.openButton.dataset.defaultText || "打开链接";
      }
    }
  }

  function isVideoReadyForActions(video, rect) {
    const style = window.getComputedStyle(video);
    if (!style || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
    if (video.closest("textarea, input, [contenteditable='true'], [role='textbox']")) return false;
    if (!(video.readyState >= 1 || video.videoWidth > 0 || video.videoHeight > 0 || video.poster)) return false;
    return rect.width >= 160
      && rect.height >= 100
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth;
  }

  function ensureVideoHost(video) {
    const parent = video.parentElement;
    if (!parent) return null;
    const style = window.getComputedStyle(parent);
    if (style.position === "static") {
      parent.style.position = "relative";
    }
    return parent;
  }

  function updatePanelVisibility(video, controls) {
    const rect = video.getBoundingClientRect();
    const visible = video.isConnected && isVideoReadyForActions(video, rect);
    if (!visible) {
      controls.panel.style.display = "none";
      return;
    }
    controls.panel.style.display = "flex";
  }

  function renderVideoCopyButtons() {
    if (!document.body) return;
    for (const legacy of document.querySelectorAll(".dola-video-actions, .dola-copy-video-link, .dola-nowatermark-download")) {
      legacy.remove();
    }
    const videos = Array.from(document.querySelectorAll("video"));
    for (const [video, controls] of Array.from(copyButtons.entries())) {
      if (!videos.includes(video) || !video.isConnected) {
        controls.panel.remove();
        copyButtons.delete(video);
      }
    }
    for (const video of videos) {
      ensureVideoElementId(video);
      const host = ensureVideoHost(video);
      if (!host) continue;
      let controls = copyButtons.get(video);
      if (!controls) {
        const panel = document.createElement("div");
        panel.className = "dola-video-actions-v2";
        panel.dataset.dolaApiUiVersion = STYLE_VERSION;
        stylePanel(panel);
        const openButton = document.createElement("button");
        openButton.className = "dola-open-video-link-v2";
        styleActionButton(openButton, "open");
        bindOpenButton(video, openButton);
        const downloadButton = document.createElement("button");
        downloadButton.className = "dola-download-origin-video-v2";
        styleActionButton(downloadButton, "download");
        bindDownloadButton(video, downloadButton);
        panel.appendChild(openButton);
        panel.appendChild(downloadButton);
        host.appendChild(panel);
        controls = { panel, openButton, downloadButton };
        bindControlsVisibility(video, controls);
        copyButtons.set(video, controls);
      } else if (controls.panel.parentElement !== host) {
        host.appendChild(controls.panel);
      }
      updatePanelVisibility(video, controls);
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.type === CAPTURE_MESSAGE && data.routeChanged) ensureCurrentPage();
    if (data.type === CAPTURE_MESSAGE && data.url && data.linkStatus) setFplayStatus(data.url, data.linkStatus);
    if (data.type === CAPTURE_MESSAGE && data.url) remember(data.url, { startTime: data.startTime, keySeed: data.keySeed });
    if (data.type === CAPTURE_MESSAGE && data.videoRecord) {
      rememberVideoRecord(data.videoRecord);
    }
    if (data.type === CAPTURE_MESSAGE && data.videoInfo) {
      rememberVideoInfo(data.videoInfo);
      rememberVideoRecord({
        videoInfo: data.videoInfo,
        requestUrl: data.requestUrl || "",
        responseUrl: data.responseUrl || "",
        keySeed: data.keySeed || "",
        requestKeySeed: data.requestKeySeed || ""
      });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "DOLA_COLLECT_CONTEXT") return false;
    ensureCurrentPage();
    chrome.storage.local.get({ dolaLastCapture: null }, (stored) => {
      scanDom();
      scanPerformance();
      const capture = stored.dolaLastCapture || {};
      if (capture.pageKey === activePageKey) {
        for (const entry of capture.fplayStatuses || []) {
          if (Array.isArray(entry) && entry.length >= 2) fplayStatuses.set(entry[0], entry[1]);
        }
        for (const url of capture.fplayUrls || []) remember(url);
        for (const videoInfo of capture.videoInfos || []) rememberVideoInfo(videoInfo);
        for (const record of capture.videoRecords || []) rememberVideoRecord(record);
      }
      sendResponse({
        pageUrl: location.href,
        fplayUrls: rankedFplayUrls().slice(0, MAX_ITEMS),
        badFplayKeys: knownBadFplayKeys(),
        mediaUrls: [],
        videoInfos: videoInfos.slice(0, 10),
        blobVideoCount
      });
    });
    return true;
  });

  injectHook();
  ensureCurrentPage();
  loadSavedApiKey();
  scanPerformance();
  clearLegacyInjectedPanels();
  renderVideoCopyButtons();
  setInterval(scanPerformance, 1500);
  setInterval(renderVideoCopyButtons, 800);
  setInterval(ensureCurrentPage, 400);
})();
