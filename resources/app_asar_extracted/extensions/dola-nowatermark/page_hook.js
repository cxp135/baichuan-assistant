(() => {
  "use strict";

  if (window.__DOLA_API_PLUGIN_HOOKED__) return;
  window.__DOLA_API_PLUGIN_HOOKED__ = true;

  const MESSAGE_TYPE = "DOLA_API_PLUGIN_CAPTURE";
  const MAX_SCAN_NODES = 6000;
  const endpointTemplates = {
    playInfo: "",
    shareSave: "",
    videoShareInfo: "",
    threadShareInfo: ""
  };
  const records = [];
  const elementMediaMap = new Map();
  let videoElementSeq = 1;
  let lastPath = location.pathname;

  function postPayload(payload) {
    window.postMessage({ type: MESSAGE_TYPE, ...payload }, location.origin);
  }

  function notifyRouteChanged() {
    if (lastPath === location.pathname) return;
    lastPath = location.pathname;
    postPayload({ routeChanged: true });
  }

  function compactText(raw) {
    return String(raw || "")
      .replace(/&amp;/g, "&")
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/");
  }

  function normalizeUrl(raw) {
    let text = compactText(raw).trim();
    if (!text) return "";
    const decoded = decodeMaybeBase64Url(text);
    if (decoded) text = decoded;
    try {
      return new URL(text, location.href).href;
    } catch (_error) {
      return text;
    }
  }

  function decodeMaybeBase64Url(raw) {
    const text = String(raw || "").trim();
    if (!text || /^https?:\/\//i.test(text) || /^blob:/i.test(text)) return "";
    if (text.length < 20 || /[^\w+/=_-]/.test(text)) return "";
    try {
      const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const decoded = atob(padded)
        .replace(/&amp;/g, "&")
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/")
        .trim();
      return /^https?:\/\//i.test(decoded) ? decoded : "";
    } catch (_error) {
      return "";
    }
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

  function looksLikeVid(value) {
    return /^v[0-9a-z]{10,}$/i.test(String(value || "").trim());
  }

  function looksLikeVideoUrl(value) {
    const text = normalizeUrl(value);
    return !!text && (
      /\/video\//i.test(text) ||
      /mime_type=video/i.test(text) ||
      /\.mp4(\?|$)/i.test(text)
    );
  }

  function looksLikeShareUrl(value) {
    return /https?:\/\/(?:www\.)?dola\.com\/share\//i.test(String(value || ""));
  }

  function looksLikeThreadUrl(value) {
    return /https?:\/\/(?:www\.)?dola\.com\/thread\//i.test(String(value || ""));
  }

  function extractConversationIdFromLocation() {
    const match = location.pathname.match(/\/chat\/([A-Za-z0-9_-]+)/i);
    return match ? match[1] : "";
  }

  function replaceNoWatermarkLr(url) {
    const text = normalizeUrl(url);
    if (!text) return "";
    return text
      .replace(/lr=video_gen_watermark_dyn/ig, "lr=video_gen_no_watermark")
      .replace(/lr=video_gen_watermark/ig, "lr=video_gen_no_watermark")
      .replace(/([?&])logo_type=[^&]*/ig, "$1logo_type=no_watermark");
  }

  function isNoWatermarkUrl(url) {
    const text = normalizeUrl(url);
    if (!text) return false;
    return /video_gen_no_watermark|logo_type=no_watermark|unwatermarked/i.test(text);
  }

  function selectBestVideoUrl(urls) {
    const list = Array.from(new Set((urls || []).map(normalizeUrl).filter(looksLikeVideoUrl)));
    if (!list.length) return "";
    const preferred = list.find((item) => isNoWatermarkUrl(item));
    if (preferred) return preferred;
    return replaceNoWatermarkLr(list[0]);
  }

  function upgradeNoWatermarkUrl(url) {
    const text = normalizeUrl(url);
    if (!text) return "";
    if (isNoWatermarkUrl(text)) return text;
    const upgraded = replaceNoWatermarkLr(text);
    return upgraded !== text && looksLikeVideoUrl(upgraded) ? upgraded : "";
  }

  function bodyToText(body) {
    try {
      if (!body) return "";
      if (typeof body === "string") return body;
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof FormData) {
        const parts = [];
        for (const [key, value] of body.entries()) {
          if (typeof value === "string") parts.push(`${key}=${value}`);
        }
        return parts.join("&");
      }
      if (body instanceof ArrayBuffer && body.byteLength <= 65536) {
        return new TextDecoder("utf-8").decode(body);
      }
      if (ArrayBuffer.isView(body) && body.byteLength <= 65536) {
        return new TextDecoder("utf-8").decode(body);
      }
    } catch (_error) {
      // ignored
    }
    return "";
  }

  function extractKeySeed(text) {
    const normalized = compactText(text);
    const matches = [
      normalized.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i),
      normalized.match(/["']key_seed["']\s*:\s*["']([^"']+)/i),
      normalized.match(/["']keySeed["']\s*:\s*["']([^"']+)/i)
    ];
    const match = matches.find(Boolean);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_error) {
      return match[1];
    }
  }

  function remember(raw, meta = {}) {
    let url = normalizeUrl(raw);
    if (!/\/video\/fplay\//i.test(url)) return;
    if (meta.keySeed) url = appendQueryParam(url, "key_seed", meta.keySeed);
    postPayload({
      url,
      startTime: meta.startTime,
      keySeed: meta.keySeed || ""
    });
  }

  function postFplayStatus(raw, status) {
    if (!status) return;
    const url = normalizeUrl(raw);
    if (!/\/video\/fplay\//i.test(url)) return;
    postPayload({ url, linkStatus: status });
  }

  function safeClone(value, depth = 0, seen = new WeakSet()) {
    if (depth > 8) return undefined;
    if (value == null) return value;
    if (typeof value === "string") return value.length > 12000 ? value.slice(0, 12000) : value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object") return undefined;
    if (seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      return value.slice(0, 40).map((item) => safeClone(item, depth + 1, seen));
    }
    const out = {};
    for (const key of Object.keys(value).slice(0, 100)) {
      const cloned = safeClone(value[key], depth + 1, seen);
      if (cloned !== undefined) out[key] = cloned;
    }
    return out;
  }

  function postVideoInfo(value, meta = {}) {
    try {
      const cloned = safeClone(value);
      const text = JSON.stringify(cloned);
      if (text.length > 20 && text.length < 250000) {
        postPayload({
          videoInfo: cloned,
          requestUrl: meta.requestUrl || "",
          responseUrl: meta.responseUrl || "",
          keySeed: meta.keySeed || "",
          requestKeySeed: meta.requestKeySeed || ""
        });
      }
    } catch (_error) {
      // ignored
    }
  }

  function postRecord(record, source = "") {
    if (!record) return;
    postPayload({
      videoRecord: {
        messageId: record.messageId || "",
        conversationId: record.conversationId || "",
        shareId: record.shareId || "",
        vid: record.vid || "",
        shareUrl: record.shareUrl || "",
        threadUrl: record.threadUrl || "",
        videoUrl: record.videoUrl || "",
        fplayUrl: record.fplayUrl || "",
        keySeed: record.keySeed || "",
        hasDomVideo: record.hasDomVideo ? "1" : "",
        source: source || record.source || ""
      }
    });
  }

  function recordHasConflict(partial, record) {
    const partialVid = pickString(partial && partial.vid);
    const recordVid = pickString(record && record.vid);
    if (partialVid && recordVid && partialVid !== recordVid) return true;

    const partialKeySeed = pickString(partial && partial.keySeed);
    const recordKeySeed = pickString(record && record.keySeed);
    if (partialKeySeed && recordKeySeed && partialKeySeed !== recordKeySeed) return true;

    const partialFplay = normalizeUrl(partial && partial.fplayUrl);
    const recordFplay = normalizeUrl(record && record.fplayUrl);
    if (partialFplay && recordFplay && partialFplay !== recordFplay) return true;

    const partialVideoUrl = normalizeUrl(partial && partial.videoUrl);
    const recordVideoUrl = normalizeUrl(record && record.videoUrl);
    if (partialVideoUrl && recordVideoUrl && partialVideoUrl !== recordVideoUrl) return true;

    return false;
  }

  function ensureVideoElementId(video) {
    if (!video || typeof video !== "object") return "";
    const existing = video.getAttribute && video.getAttribute("data-dola-api-video-id");
    if (existing) return existing;
    const id = `dola_video_${videoElementSeq++}`;
    try {
      video.setAttribute("data-dola-api-video-id", id);
    } catch (_error) {
      return "";
    }
    return id;
  }

  function getElementMediaEntry(video) {
    const id = ensureVideoElementId(video);
    if (!id) return null;
    if (!elementMediaMap.has(id)) {
      elementMediaMap.set(id, {
        videoUrls: [],
        fplayUrls: [],
        keySeeds: [],
        updatedAt: 0
      });
    }
    return elementMediaMap.get(id);
  }

  function rememberElementMedia(video, raw, source = "") {
    if (!video) return;
    const url = normalizeUrl(raw);
    if (!url) return;
    const entry = getElementMediaEntry(video);
    if (!entry) return;
    entry.updatedAt = Date.now();
    entry.source = source || entry.source || "";
    const keySeed = extractKeySeed(url);
    if (keySeed && !entry.keySeeds.includes(keySeed)) entry.keySeeds.push(keySeed);
    if (/\/video\/fplay\//i.test(url)) {
      const finalUrl = appendQueryParam(url, "key_seed", keySeed);
      if (!entry.fplayUrls.includes(finalUrl)) entry.fplayUrls.push(finalUrl);
      return;
    }
    if (looksLikeVideoUrl(url) && !entry.videoUrls.includes(url)) {
      entry.videoUrls.push(url);
    }
  }

  function readElementMedia(video) {
    const id = ensureVideoElementId(video);
    if (!id) return null;
    return elementMediaMap.get(id) || null;
  }

  function findRecordIndex(partial) {
    return records.findIndex((record) => (
      (partial.messageId && record.messageId && partial.messageId === record.messageId && !recordHasConflict(partial, record)) ||
      (partial.shareId && record.shareId && partial.shareId === record.shareId) ||
      (partial.vid && record.vid && partial.vid === record.vid) ||
      (partial.keySeed && record.keySeed && partial.keySeed === record.keySeed) ||
      (partial.fplayUrl && record.fplayUrl && normalizeUrl(partial.fplayUrl) === normalizeUrl(record.fplayUrl)) ||
      (partial.videoUrl && record.videoUrl && normalizeUrl(partial.videoUrl) === normalizeUrl(record.videoUrl)) ||
      (partial.shareUrl && record.shareUrl && partial.shareUrl === record.shareUrl) ||
      (partial.threadUrl && record.threadUrl && partial.threadUrl === record.threadUrl)
    ));
  }

  function mergeRecord(partial, source = "") {
    const rawUrl = normalizeUrl(pickString(partial.url));
    const candidate = {
      messageId: pickString(partial.messageId, partial.message_id, partial.msg_id),
      conversationId: pickString(partial.conversationId, partial.conversation_id, partial.conv_id) || extractConversationIdFromLocation(),
      shareId: pickString(partial.shareId, partial.share_id),
      shareUrl: normalizeUrl(pickString(
        partial.shareUrl,
        partial.share_url,
        looksLikeShareUrl(rawUrl) ? rawUrl : ""
      )),
      threadUrl: normalizeUrl(pickString(
        partial.threadUrl,
        partial.thread_url,
        looksLikeThreadUrl(rawUrl) ? rawUrl : ""
      )),
      vid: looksLikeVid(pickString(partial.vid, partial.videoId, partial.video_id, partial.key))
        ? pickString(partial.vid, partial.videoId, partial.video_id, partial.key)
        : "",
      videoUrl: selectBestVideoUrl([
        partial.videoUrl,
        partial.video_url,
        partial.main_url,
        partial.mainUrl,
        partial.download_url,
        partial.downloadUrl,
        partial.url
      ]),
      fplayUrl: /\/video\/fplay\//i.test(String(partial.fplayUrl || partial.url || ""))
        ? normalizeUrl(appendQueryParam(pickString(partial.fplayUrl, partial.url), "key_seed", pickString(partial.keySeed, partial.key_seed)))
        : "",
      keySeed: pickString(partial.keySeed, partial.key_seed) || extractKeySeed(pickString(partial.fplayUrl, partial.videoUrl, partial.url)),
      hasDomVideo: !!(partial && partial.hasDomVideo),
      source: source || pickString(partial.source),
      updatedAt: Date.now()
    };

    if (!candidate.messageId && !candidate.vid && !candidate.videoUrl && !candidate.shareUrl && !candidate.threadUrl && !candidate.fplayUrl && !candidate.keySeed) {
      return null;
    }

    const existingIndex = findRecordIndex(candidate);
    const existing = existingIndex >= 0 ? records[existingIndex] : null;
    const canCreateStandalone = !!(candidate.hasDomVideo || candidate.videoUrl || candidate.fplayUrl);
    const canUpdateExisting = !!existing;
    if (!canCreateStandalone && !canUpdateExisting) {
      return null;
    }
    const merged = {
      messageId: candidate.messageId || (existing && existing.messageId) || "",
      conversationId: candidate.conversationId || (existing && existing.conversationId) || extractConversationIdFromLocation(),
      shareId: candidate.shareId || (existing && existing.shareId) || "",
      shareUrl: candidate.shareUrl || (existing && existing.shareUrl) || "",
      threadUrl: candidate.threadUrl || (existing && existing.threadUrl) || "",
      vid: candidate.vid || (existing && existing.vid) || "",
      videoUrl: candidate.videoUrl || (existing && existing.videoUrl) || "",
      fplayUrl: candidate.fplayUrl || (existing && existing.fplayUrl) || "",
      keySeed: candidate.keySeed || (existing && existing.keySeed) || "",
      hasDomVideo: candidate.hasDomVideo || (existing && existing.hasDomVideo) || false,
      source: candidate.source || (existing && existing.source) || "",
      updatedAt: candidate.updatedAt
    };

    if (existingIndex >= 0) records.splice(existingIndex, 1);
    records.unshift(merged);
    if (records.length > 80) records.length = 80;
    postRecord(merged, source);
    return merged;
  }

  function collectPlayInfoUrls(value, results, depth = 0, seen = new WeakSet()) {
    if (!value || depth > 6) return;
    if (typeof value === "string") {
      if (looksLikeVideoUrl(value)) results.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectPlayInfoUrls(item, results, depth + 1, seen);
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    const directValues = [
      value.main_url,
      value.mainUrl,
      value.main,
      value.play_url,
      value.playUrl,
      value.video_url,
      value.videoUrl,
      value.download_url,
      value.downloadUrl,
      value.url
    ];
    for (const item of directValues) {
      if (looksLikeVideoUrl(item)) results.push(item);
    }

    let keys = [];
    try {
      keys = Object.keys(value);
    } catch (_error) {
      return;
    }
    for (const key of keys.slice(0, 40)) {
      collectPlayInfoUrls(value[key], results, depth + 1, seen);
    }
  }

  function extractBestVideoUrl(values) {
    const urls = [];
    for (const value of values || []) {
      collectPlayInfoUrls(value, urls);
      if (looksLikeVideoUrl(value)) urls.push(value);
    }
    return selectBestVideoUrl(urls);
  }

  function extractRecordCandidate(root) {
    if (!root || typeof root !== "object") return null;
    const playUrls = [];
    collectPlayInfoUrls(root.play_info, playUrls);
    collectPlayInfoUrls(root.play_infos, playUrls);
    collectPlayInfoUrls(root.video, playUrls);
    collectPlayInfoUrls(root.media, playUrls);
    const rawUrl = normalizeUrl(pickString(root.url));
    return {
      messageId: pickString(root.message_id, root.messageId, root.msg_id),
      conversationId: pickString(root.conversation_id, root.conversationId, root.conv_id),
      shareId: pickString(root.share_id, root.shareId),
      shareUrl: looksLikeShareUrl(rawUrl) ? rawUrl : pickString(root.share_url, root.shareUrl),
      threadUrl: looksLikeThreadUrl(rawUrl) ? rawUrl : pickString(root.thread_url, root.threadUrl),
      vid: pickString(root.vid, root.video_id, root.videoId, root.key),
      videoUrl: extractBestVideoUrl([
        root.video_url,
        root.videoUrl,
        root.main_url,
        root.mainUrl,
        root.download_url,
        root.downloadUrl,
        root.url,
        ...playUrls
      ]),
      fplayUrl: /\/video\/fplay\//i.test(rawUrl) ? rawUrl : "",
      keySeed: extractKeySeed(rawUrl)
    };
  }

  function scanString(text) {
    const normalized = compactText(text);
    const keySeed = extractKeySeed(normalized);
    const fplayUrls = normalized.match(/https?:\/\/[^"'<>\\\s]+\/video\/fplay\/[^"'<>\\\s]*/gi) || [];
    for (const url of fplayUrls) {
      const finalUrl = appendQueryParam(url, "key_seed", keySeed);
      remember(finalUrl, { keySeed });
      mergeRecord({ fplayUrl: finalUrl, keySeed }, "text-fplay");
    }

    const shareUrls = normalized.match(/https?:\/\/(?:www\.)?dola\.com\/(?:thread|share|video-sharing)\/[^\s"'<>\\]+/gi) || [];
    for (const url of shareUrls) {
      const finalUrl = normalizeUrl(url);
      mergeRecord({
        shareUrl: looksLikeShareUrl(finalUrl) ? finalUrl : "",
        threadUrl: looksLikeThreadUrl(finalUrl) ? finalUrl : ""
      }, "text-share");
    }

    const videoUrls = normalized.match(/https?:\/\/[^\s"'<>\\]+\/video\/(?:tos|play)\/[^\s"'<>\\]+/gi) || [];
    for (const url of videoUrls) {
      mergeRecord({ videoUrl: url }, "text-video");
    }
  }

  function classifyFplayResponse(text) {
    const raw = String(text || "");
    if (/error\s+check\s+params|check\s+params/i.test(raw)) return "bad";
    try {
      const obj = JSON.parse(raw);
      const videoInfo = obj && obj.video_info;
      const topCode = typeof obj.code === "number" ? obj.code : null;
      const infoCode = videoInfo && typeof videoInfo.code === "number" ? videoInfo.code : null;
      const topMessage = String((obj && obj.message) || "");
      const infoMessage = String((videoInfo && videoInfo.message) || "");
      if (topCode === 0 || infoCode === 0 || /success/i.test(`${topMessage} ${infoMessage}`)) return "ok";
      if ((topCode != null && topCode !== 0) || (infoCode != null && infoCode !== 0)) return "bad";
    } catch (_error) {
      // ignored
    }
    if (/video_info/i.test(raw) && /key_seed|video_list|main_url|qAAB/i.test(raw)) return "ok";
    return "";
  }

  function scanObject(root, meta = {}) {
    const queue = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let visited = 0;

    while (queue.length && visited < MAX_SCAN_NODES) {
      const item = queue.shift();
      const value = item && item.value;
      const depth = item ? item.depth : 0;
      visited += 1;

      if (typeof value === "string") {
        scanString(value);
        continue;
      }
      if (!value || typeof value !== "object" || seen.has(value) || depth > 8) continue;
      seen.add(value);

      const candidate = extractRecordCandidate(value);
      if (candidate) mergeRecord(candidate, meta.source || "scan-object");

      try {
        const keys = Object.keys(value);
        const keyText = keys.join(",");
        if (
          /key_seed/i.test(keyText)
          && (/main_url|backup_url|video_list|video_1/i.test(keyText) || /qAAB/.test(JSON.stringify(safeClone(value, 0))))
        ) {
          postVideoInfo(value, meta);
        }
        for (const key of keys.slice(0, 120)) {
          queue.push({ value: value[key], depth: depth + 1 });
        }
      } catch (_error) {
        // ignored
      }
    }
  }

  function parseText(text, source = "", meta = {}) {
    const compact = compactText(text);
    scanString(compact);
    if (!/message_id|conversation_id|share_url|thread_url|share_id|video_url|main_url|video_list|qAAB|key_seed|get_play_info|video\/fplay/i.test(compact)) {
      return;
    }
    try {
      scanObject(JSON.parse(compact), { ...meta, source });
    } catch (_error) {
      // ignored
    }
  }

  function scanResponseText(text, responseUrl = "", meta = {}) {
    postFplayStatus(responseUrl, classifyFplayResponse(text));
    parseText(text, meta.source || "response", { ...meta, responseUrl });
  }

  function detectEndpoint(url) {
    const value = String(url || "");
    if (/\/samantha\/(?:video|media)\/get_play_info/i.test(value)) return "playInfo";
    if (/\/alice\/media\/bigmusic\/share_save/i.test(value)) return "shareSave";
    if (/\/creativity\/share\/get_video_share_info/i.test(value)) return "videoShareInfo";
    if (/\/samantha\/thread\/share\/info/i.test(value)) return "threadShareInfo";
    return "";
  }

  function rememberEndpointTemplate(kind, url) {
    if (!kind || !url) return;
    endpointTemplates[kind] = url;
  }

  function buildRequestContext(kind, url, requestText) {
    rememberEndpointTemplate(kind, url);
    const base = { kind, url };
    if (!requestText) return base;
    try {
      const parsed = JSON.parse(requestText);
      return {
        ...base,
        messageId: pickString(parsed.message_id, parsed.messageId),
        vid: pickString(parsed.vid, parsed.key),
        shareId: pickString(parsed.share_id, parsed.shareId)
      };
    } catch (_error) {
      try {
        const params = new URLSearchParams(requestText);
        return {
          ...base,
          messageId: pickString(params.get("message_id"), params.get("messageId")),
          vid: pickString(params.get("vid"), params.get("key")),
          shareId: pickString(params.get("share_id"), params.get("shareId"))
        };
      } catch (_innerError) {
        return base;
      }
    }
  }

  function handleEndpointResponse(context, responseText, responseUrl) {
    const kind = context && context.kind;
    if (!kind) return;
    try {
      const parsed = JSON.parse(responseText);
      if (kind === "playInfo") {
        mergeRecord({
          vid: context.vid,
          videoUrl: extractBestVideoUrl([
            parsed && parsed.data && parsed.data.video_url,
            parsed && parsed.data && parsed.data.main_url,
            parsed && parsed.data && parsed.data.mainUrl,
            parsed && parsed.data && parsed.data.play_info,
            parsed && parsed.data && parsed.data.play_infos,
            parsed && parsed.data && parsed.data.original_media_info && parsed.data.original_media_info.main_url
          ])
        }, "play-info");
      }
      if (kind === "shareSave") {
        mergeRecord({
          messageId: context.messageId,
          shareId: pickString(parsed && parsed.data && parsed.data.share_id, parsed && parsed.data && parsed.data.shareId)
        }, "share-save");
      }
      if (kind === "videoShareInfo") {
        mergeRecord({
          messageId: context.messageId,
          vid: context.vid,
          shareId: context.shareId,
          videoUrl: extractBestVideoUrl([
            parsed && parsed.data && parsed.data.video_url,
            parsed && parsed.data && parsed.data.main_url,
            parsed && parsed.data && parsed.data.mainUrl,
            parsed && parsed.data && parsed.data.play_info,
            parsed && parsed.data && parsed.data.play_infos
          ])
        }, "video-share-info");
      }
      if (kind === "threadShareInfo") {
        mergeRecord({
          messageId: context.messageId,
          shareUrl: normalizeUrl(pickString(
            parsed && parsed.data && parsed.data.share_url,
            parsed && parsed.data && parsed.data.shareUrl
          )),
          threadUrl: normalizeUrl(pickString(
            parsed && parsed.data && parsed.data.thread_url,
            parsed && parsed.data && parsed.data.threadUrl,
            parsed && parsed.data && parsed.data.url,
            parsed && parsed.data && parsed.data.thread_link
          ))
        }, "thread-share-info");
      }
    } catch (_error) {
      // ignored
    }
    rememberEndpointTemplate(kind, responseUrl || context.url);
  }

  function scanReactState() {
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
            scanObject(node[key], { source: "react" });
          } catch (_error) {
            // ignored
          }
        }
      }
    }
  }

  function scanPageState() {
    scanObject(window._ROUTER_DATA, { source: "router" });
    scanObject(window._SSR_DATA, { source: "ssr" });
    const nextData = document.getElementById("__NEXT_DATA__");
    if (nextData && nextData.textContent) parseText(nextData.textContent, "next-data");
    scanReactState();
    try {
      for (const storage of [localStorage, sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          const value = storage.getItem(key);
          if (!value) continue;
          parseText(value, `storage:${key}`);
        }
      }
    } catch (_error) {
      // ignored
    }
  }

  function scanPerformance() {
    try {
      const entries = performance.getEntriesByType("resource") || [];
      for (const entry of entries) remember(entry.name, { startTime: entry.startTime });
    } catch (_error) {
      // ignored
    }
  }

  function bindExistingVideoElements() {
    const videos = Array.from(document.querySelectorAll("video"));
    for (const video of videos) {
      ensureVideoElementId(video);
      const currentSrc = normalizeUrl(video.currentSrc || video.src || "");
      if (currentSrc) rememberElementMedia(video, currentSrc, "dom-current-src");
      const sourceNodes = Array.from(video.querySelectorAll("source"));
      for (const source of sourceNodes) {
        const sourceUrl = normalizeUrl(source.src || source.getAttribute("src") || "");
        if (sourceUrl) rememberElementMedia(video, sourceUrl, "dom-source");
      }
      mergeRecord(collectElementContext(video), "dom-video");
    }
  }

  function findAncestorValue(node, attributeNames) {
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

  function getElementVideoUrl(video) {
    const source = video && (video.currentSrc || video.src || "");
    if (looksLikeVideoUrl(source)) return normalizeUrl(source);
    const childSource = video && video.querySelector("source");
    return childSource && looksLikeVideoUrl(childSource.src) ? normalizeUrl(childSource.src) : "";
  }

  function collectElementContext(video) {
    const threadAnchor = video && video.closest("a[href*='/thread/'], a[href*='/share/']");
    const threadUrl = threadAnchor ? normalizeUrl(threadAnchor.href) : "";
    const videoUrl = getElementVideoUrl(video);
    const mediaEntry = readElementMedia(video);
    return {
      messageId: findAncestorValue(video, ["data-message-id", "message-id", "data-message_id", "message_id"]),
      conversationId: extractConversationIdFromLocation(),
      vid: findAncestorValue(video, ["data-vid", "vid", "data-video-id", "video-id"]),
      threadUrl: looksLikeThreadUrl(threadUrl) ? threadUrl : "",
      shareUrl: looksLikeShareUrl(threadUrl) ? threadUrl : "",
      videoUrl: (mediaEntry && mediaEntry.videoUrls && mediaEntry.videoUrls[0]) || videoUrl,
      keySeed: (mediaEntry && mediaEntry.keySeeds && mediaEntry.keySeeds[0]) || extractKeySeed(videoUrl),
      fplayUrl: mediaEntry && mediaEntry.fplayUrls && mediaEntry.fplayUrls[0] || "",
      hasDomVideo: true
    };
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

  function collectScopedRecordsForVideo(video) {
    const localRecords = [];

    function pushLocalRecord(record) {
      if (!record) return;
      const existingIndex = localRecords.findIndex((item) => (
        (record.messageId && item.messageId && record.messageId === item.messageId) ||
        (record.vid && item.vid && record.vid === item.vid) ||
        (record.keySeed && item.keySeed && record.keySeed === item.keySeed) ||
        (record.fplayUrl && item.fplayUrl && normalizeUrl(record.fplayUrl) === normalizeUrl(item.fplayUrl)) ||
        (record.videoUrl && item.videoUrl && normalizeUrl(record.videoUrl) === normalizeUrl(item.videoUrl))
      ));
      if (existingIndex >= 0) {
        localRecords[existingIndex] = {
          ...localRecords[existingIndex],
          ...record
        };
      } else {
        localRecords.push({ ...record });
      }
    }

    function scanScopedValue(value, depth = 0, seen = new WeakSet()) {
      if (!value || depth > 8) return;
      if (typeof value === "string") {
        const keySeed = extractKeySeed(value);
        const fplayUrls = compactText(value).match(/https?:\/\/[^"'<>\\\s]+\/video\/fplay\/[^"'<>\\\s]*/gi) || [];
        for (const url of fplayUrls) {
          pushLocalRecord({
            fplayUrl: appendQueryParam(url, "key_seed", keySeed),
            keySeed
          });
        }
        const videoUrls = compactText(value).match(/https?:\/\/[^\s"'<>\\]+\/video\/(?:tos|play)\/[^\s"'<>\\]+/gi) || [];
        for (const url of videoUrls) {
          pushLocalRecord({
            videoUrl: normalizeUrl(url),
            keySeed: extractKeySeed(url)
          });
        }
        return;
      }
      if (typeof value !== "object" || seen.has(value)) return;
      seen.add(value);

      const candidate = extractRecordCandidate(value);
      if (candidate) pushLocalRecord(candidate);

      let keys = [];
      try {
        keys = Object.keys(value);
      } catch (_error) {
        return;
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

    const elementHint = collectElementContext(video);
    pushLocalRecord(elementHint);
    return localRecords;
  }

  function findBestMatchingVideoElement(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return null;
    const videos = Array.from(document.querySelectorAll("video"));
    for (const video of videos) {
      const currentSrc = normalizeUrl(video.currentSrc || video.src || "");
      if (currentSrc && currentSrc === normalized) return video;
      const mediaEntry = readElementMedia(video);
      if (mediaEntry && (mediaEntry.videoUrls || []).some((item) => normalizeUrl(item) === normalized)) {
        return video;
      }
    }
    return null;
  }

  function scoreRecord(record, hint) {
    let score = 0;
    if (!record) return score;
    if (hint.messageId && record.messageId === hint.messageId) score += 80;
    if (hint.vid && record.vid === hint.vid) score += 70;
    if (hint.videoUrl && record.videoUrl && normalizeUrl(record.videoUrl) === normalizeUrl(hint.videoUrl)) score += 60;
    if (hint.keySeed && record.keySeed === hint.keySeed) score += 50;
    if (hint.threadUrl && record.threadUrl === hint.threadUrl) score += 35;
    if (hint.shareUrl && record.shareUrl === hint.shareUrl) score += 35;
    if (hint.conversationId && record.conversationId === hint.conversationId) score += 20;
    if (record.videoUrl) score += 8;
    if (record.vid) score += 5;
    return score;
  }

  function hasStrongRecordMatch(hint, record) {
    if (!hint || !record) return false;
    if (hint.messageId && record.messageId && hint.messageId === record.messageId) return true;
    if (hint.vid && record.vid && hint.vid === record.vid) return true;
    if (hint.keySeed && record.keySeed && hint.keySeed === record.keySeed) return true;
    if (hint.threadUrl && record.threadUrl && hint.threadUrl === record.threadUrl) return true;
    if (hint.shareUrl && record.shareUrl && hint.shareUrl === record.shareUrl) return true;
    if (hint.videoUrl && record.videoUrl && normalizeUrl(hint.videoUrl) === normalizeUrl(record.videoUrl)) return true;
    if (hint.fplayUrl && record.fplayUrl && normalizeUrl(hint.fplayUrl) === normalizeUrl(record.fplayUrl)) return true;
    return false;
  }

  function findBestRecord(hint, sourceRecords = records, options = {}) {
    let best = null;
    let bestScore = -1;
    for (const record of sourceRecords || []) {
      if (options.requireStrongMatch && !hasStrongRecordMatch(hint, record)) continue;
      const score = scoreRecord(record, hint);
      if (score > bestScore) {
        best = record;
        bestScore = score;
      }
    }
    if (bestScore <= 0) return null;
    return best;
  }

  function queryStringFor(url, fallback) {
    try {
      const base = new URL(url || fallback, location.origin);
      return `${base.origin}${base.pathname}${base.search}`;
    } catch (_error) {
      return `${location.origin}${fallback}`;
    }
  }

  async function requestJson(url, body, headers = {}) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...headers
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`);
    }
    parseText(text, `manual:${url}`);
    return JSON.parse(text);
  }

  async function requestPlayInfo(vid) {
    const url = queryStringFor(endpointTemplates.playInfo, "/samantha/video/get_play_info");
    const attempts = [
      { key: vid, type: "video" },
      { vid },
      { key: vid },
      { vid, type: "video" }
    ];
    let lastError = null;
    for (const body of attempts) {
      try {
        const result = await requestJson(url, body, {
          "agw-js-conv": "str",
          origin: location.origin,
          referer: `${location.origin}/chat/`
        });
        const videoUrl = extractBestVideoUrl([
          result && result.data && result.data.video_url,
          result && result.data && result.data.main_url,
          result && result.data && result.data.mainUrl,
          result && result.data && result.data.play_info,
          result && result.data && result.data.play_infos,
          result && result.data && result.data.original_media_info && result.data.original_media_info.main_url
        ]);
        if (videoUrl) return videoUrl;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    throw new Error("play_info 没拿到视频地址");
  }

  async function requestLegacyShare(messageId, vid) {
    const shareSaveUrl = queryStringFor(endpointTemplates.shareSave, "/alice/media/bigmusic/share_save");
    const shareSaveResult = await requestJson(shareSaveUrl, { message_id: messageId });
    const shareId = pickString(
      shareSaveResult && shareSaveResult.data && shareSaveResult.data.share_id,
      shareSaveResult && shareSaveResult.data && shareSaveResult.data.shareId
    );
    if (!shareId) throw new Error("share_save 没拿到 share_id");

    const videoShareUrl = queryStringFor(endpointTemplates.videoShareInfo, "/creativity/share/get_video_share_info");
    const videoShareResult = await requestJson(videoShareUrl, {
      share_id: shareId,
      vid,
      creation_id: ""
    }, { "agw-js-conv": "str" });

    const videoUrl = extractBestVideoUrl([
      videoShareResult && videoShareResult.data && videoShareResult.data.video_url,
      videoShareResult && videoShareResult.data && videoShareResult.data.main_url,
      videoShareResult && videoShareResult.data && videoShareResult.data.mainUrl,
      videoShareResult && videoShareResult.data && videoShareResult.data.play_info,
      videoShareResult && videoShareResult.data && videoShareResult.data.play_infos
    ]);
    if (!videoUrl) throw new Error("get_video_share_info 没拿到视频地址");
    return { shareId, videoUrl };
  }

  async function requestThreadShareInfo(messageId) {
    const url = queryStringFor(endpointTemplates.threadShareInfo, "/samantha/thread/share/info");
    const result = await requestJson(url, { message_id: messageId }, { "agw-js-conv": "str" });
    const shareUrl = normalizeUrl(pickString(
      result && result.data && result.data.share_url,
      result && result.data && result.data.shareUrl
    ));
    const threadUrl = normalizeUrl(pickString(
      result && result.data && result.data.thread_url,
      result && result.data && result.data.threadUrl,
      result && result.data && result.data.url,
      result && result.data && result.data.thread_link
    ));
    if (!shareUrl && !threadUrl) throw new Error("thread/share/info 没拿到 thread 链接");
    return { shareUrl, threadUrl };
  }

  function extractThreadVideoUrlsFromHtml(html) {
    const compact = compactText(html);
    const urls = compact.match(/https?:\/\/[^\s"'<>\\]+\/video\/(?:tos|play)\/[^\s"'<>\\]+/gi) || [];
    return urls.map((item) => normalizeUrl(item));
  }

  async function parseThreadPage(threadUrl) {
    const response = await fetch(threadUrl, { credentials: "include" });
    const html = await response.text();
    if (!response.ok) throw new Error("thread 页面读取失败");
    parseText(html, "thread-html");
    const videoUrl = selectBestVideoUrl(extractThreadVideoUrlsFromHtml(html));
    if (!videoUrl) throw new Error("thread 页面没有解析出视频地址");
    return videoUrl;
  }

  async function resolveRecordFromHint(hint, source = "manual-hint", videoElement = null) {
    mergeRecord(hint, source);
    const localRecords = videoElement ? collectScopedRecordsForVideo(videoElement) : [];
    const strictMultiVideo = document.querySelectorAll("video").length > 1;
    let record = findBestRecord(hint, localRecords, { requireStrongMatch: strictMultiVideo })
      || findBestRecord(hint, records, { requireStrongMatch: strictMultiVideo })
      || hint;

    if (record.videoUrl && isNoWatermarkUrl(record.videoUrl)) return record;

    if (record.vid) {
      try {
        const videoUrl = await requestPlayInfo(record.vid);
        if (isNoWatermarkUrl(videoUrl)) {
          record = mergeRecord({ ...record, videoUrl }, "manual-play-info") || { ...record, videoUrl };
          return record;
        }
      } catch (_error) {
        // continue
      }
    }

    if (record.messageId && record.vid) {
      try {
        const legacy = await requestLegacyShare(record.messageId, record.vid);
        if (isNoWatermarkUrl(legacy.videoUrl)) {
          record = mergeRecord({ ...record, shareId: legacy.shareId, videoUrl: legacy.videoUrl }, "manual-legacy-share") || {
            ...record,
            shareId: legacy.shareId,
            videoUrl: legacy.videoUrl
          };
          return record;
        }
      } catch (_error) {
        // continue
      }
    }

    if (record.messageId) {
      try {
        const threadInfo = await requestThreadShareInfo(record.messageId);
        const threadUrl = threadInfo.threadUrl || threadInfo.shareUrl;
        const videoUrl = threadUrl ? await parseThreadPage(threadUrl) : "";
        if (isNoWatermarkUrl(videoUrl)) {
          record = mergeRecord({ ...record, ...threadInfo, videoUrl }, "manual-thread-parse") || {
            ...record,
            ...threadInfo,
            videoUrl
          };
          if (record.videoUrl) return record;
        }
      } catch (_error) {
        // continue
      }
    }

    if (record.threadUrl || record.shareUrl) {
      try {
        const videoUrl = await parseThreadPage(record.threadUrl || record.shareUrl);
        if (isNoWatermarkUrl(videoUrl)) {
          record = mergeRecord({ ...record, videoUrl }, "manual-thread-direct") || { ...record, videoUrl };
          return record;
        }
      } catch (_error) {
        // continue
      }
    }

    const upgradedKnown = upgradeNoWatermarkUrl(record.videoUrl);
    if (upgradedKnown) {
      record = mergeRecord({ ...record, videoUrl: upgradedKnown }, "upgrade-known-url") || { ...record, videoUrl: upgradedKnown };
      return record;
    }

    const domVideoUrl = videoElement ? getElementVideoUrl(videoElement) : "";
    const upgradedDom = upgradeNoWatermarkUrl(domVideoUrl);
    if (upgradedDom) {
      record = mergeRecord({ ...record, videoUrl: upgradedDom }, "dom-current-src-upgraded") || { ...record, videoUrl: upgradedDom };
      return record;
    }

    throw new Error("当前视频还没有解析出无水印原视频");
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function patchedFetch(input, init) {
      const requestUrl = typeof input === "string" ? input : input && input.url;
      const requestText = bodyToText(init && init.body);
      const requestKeySeed = extractKeySeed(requestText);
      const kind = detectEndpoint(requestUrl);
      const context = buildRequestContext(kind, requestUrl, requestText);

      remember(requestUrl, { keySeed: requestKeySeed });
      if (context.messageId || context.vid || context.shareId) {
        mergeRecord({
          messageId: context.messageId,
          vid: context.vid,
          shareId: context.shareId
        }, `request:${kind || "fetch"}`);
      }
      if (requestText) {
        parseText(requestText, `request:${kind || "fetch"}`, {
          requestUrl: requestUrl || "",
          requestKeySeed,
          source: `request:${kind || "fetch"}`
        });
      }

      return originalFetch.apply(this, arguments).then((response) => {
        remember(response && response.url);
        const matchedVideo = findBestMatchingVideoElement(response && response.url);
        if (matchedVideo) {
          rememberElementMedia(matchedVideo, response.url || "", "fetch-response");
        }
        try {
          const contentType = response.headers && response.headers.get("content-type");
          if ((contentType && /json|text/i.test(contentType)) || /\/video\/fplay\//i.test(response.url || "")) {
            response.clone().text().then((text) => {
              scanResponseText(text, response.url || "", {
                requestUrl: requestUrl || "",
                keySeed: requestKeySeed,
                requestKeySeed,
                source: `response:${kind || "fetch"}`
              });
              handleEndpointResponse(context, text, response.url || "");
            }).catch(() => {});
          }
        } catch (_error) {
          // ignored
        }
        return response;
      });
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__dolaApiPluginUrl = url;
    this.__dolaApiPluginKind = detectEndpoint(url);
    remember(url);
    try {
      this.addEventListener("loadend", function onXhrLoadEnd() {
        try {
          remember(this.responseURL || url);
          const matchedVideo = findBestMatchingVideoElement(this.responseURL || url || "");
          if (matchedVideo) {
            rememberElementMedia(matchedVideo, this.responseURL || url || "", "xhr-response");
          }
          const responseType = this.responseType || "";
          if (responseType && responseType !== "text") return;
          const contentType = this.getResponseHeader("content-type") || "";
          const text = this.responseText || "";
          if (text && ((contentType && /json|text/i.test(contentType)) || /key_seed|video_list|main_url|qAAB|video\/fplay/i.test(text))) {
            scanResponseText(text, this.responseURL || url, {
              requestUrl: this.__dolaApiPluginUrl || url || "",
              keySeed: this.__dolaApiPluginRequestKeySeed || "",
              requestKeySeed: this.__dolaApiPluginRequestKeySeed || "",
              source: `response:${this.__dolaApiPluginKind || "xhr"}`
            });
            handleEndpointResponse(this.__dolaApiPluginRequestContext, text, this.responseURL || url || "");
          }
        } catch (_error) {
          // ignored
        }
      });
    } catch (_error) {
      // ignored
    }
    return originalOpen.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function patchedSend(body) {
    try {
      const requestText = bodyToText(body);
      const requestKeySeed = extractKeySeed(requestText);
      this.__dolaApiPluginRequestKeySeed = requestKeySeed;
      this.__dolaApiPluginRequestContext = buildRequestContext(this.__dolaApiPluginKind, this.__dolaApiPluginUrl, requestText);
      if (this.__dolaApiPluginRequestContext.messageId || this.__dolaApiPluginRequestContext.vid || this.__dolaApiPluginRequestContext.shareId) {
        mergeRecord({
          messageId: this.__dolaApiPluginRequestContext.messageId,
          vid: this.__dolaApiPluginRequestContext.vid,
          shareId: this.__dolaApiPluginRequestContext.shareId
        }, `request:${this.__dolaApiPluginKind || "xhr"}`);
      }
      if (requestText) {
        parseText(requestText, `request:${this.__dolaApiPluginKind || "xhr"}`, {
          requestUrl: this.__dolaApiPluginUrl || "",
          requestKeySeed,
          source: `request:${this.__dolaApiPluginKind || "xhr"}`
        });
      }
      if (requestKeySeed) remember(this.__dolaApiPluginUrl, { keySeed: requestKeySeed });
    } catch (_error) {
      // ignored
    }
    return originalSend.apply(this, arguments);
  };

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    if (typeof original === "function") {
      history[method] = function patchedHistoryMethod() {
        const result = original.apply(this, arguments);
        notifyRouteChanged();
        return result;
      };
    }
  }
  window.addEventListener("popstate", notifyRouteChanged);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.type !== MESSAGE_TYPE || !data.videoRequest) return;

    const request = data.videoRequest || {};
    const requestId = request.requestId;
    const videoIndex = Number(request.videoIndex);
    const videos = Array.from(document.querySelectorAll("video"));
    const videoElementId = pickString(request.videoElementId);
    const videoElement = (videoElementId && document.querySelector(`video[data-dola-api-video-id="${videoElementId}"]`))
      || (Number.isInteger(videoIndex) && videoIndex >= 0 ? videos[videoIndex] || null : null);
    const elementHint = videoElement ? collectElementContext(videoElement) : {};
    const hint = {
      messageId: pickString(request.messageId, elementHint.messageId),
      conversationId: pickString(request.conversationId, elementHint.conversationId, extractConversationIdFromLocation()),
      vid: pickString(request.vid, elementHint.vid),
      shareId: pickString(request.shareId),
      shareUrl: normalizeUrl(pickString(request.shareUrl, elementHint.shareUrl)),
      threadUrl: normalizeUrl(pickString(request.threadUrl, elementHint.threadUrl)),
      videoUrl: normalizeUrl(pickString(request.videoUrl, elementHint.videoUrl)),
      fplayUrl: normalizeUrl(pickString(request.fplayUrl, elementHint.fplayUrl)),
      keySeed: pickString(request.keySeed, elementHint.keySeed)
    };

    resolveRecordFromHint(hint, "content-video-request", videoElement)
      .then((record) => {
        postPayload({
          requestId,
          videoResult: {
            ok: true,
            result: {
              messageId: record.messageId || "",
              conversationId: record.conversationId || "",
              shareId: record.shareId || "",
              vid: record.vid || "",
              shareUrl: record.shareUrl || "",
              threadUrl: record.threadUrl || "",
              videoUrl: record.videoUrl || "",
              fplayUrl: record.fplayUrl || "",
              keySeed: record.keySeed || ""
            }
          }
        });
      })
      .catch((error) => {
        postPayload({
          requestId,
          videoResult: {
            ok: false,
            error: error.message || "站内视频解析失败"
          }
        });
      });
  });

  bindExistingVideoElements();
  scanPerformance();
  scanPageState();
})();
