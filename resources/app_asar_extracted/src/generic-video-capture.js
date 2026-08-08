(function () {
  if (window.__genericVideoCaptureInstalled) return;
  window.__genericVideoCaptureInstalled = true;

  if (/(\.|^)doubao\.com$/i.test(location.hostname)) return;
  if (/(\.|^)moonshot\.cn$/i.test(location.hostname)) return;

  const seen = new Set();
  const videoExtPattern = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
  const imageExtPattern = /\.(png|jpe?g|webp|gif)(\?|#|$)/i;
  const videoHostPattern = /(video|media|vod|tos|byte|dola|doubao|aliyun|alicdn)/i;
  const imageHostPattern = /(image|img|media|oss|tos|byte|dola|doubao|aliyun|alicdn)/i;
  const blockedAssetPattern = /(?:logo|icon|favicon|sprite|avatar|placeholder|loading|empty|default|intro|banner|bg|background|\.css|\.js|\.map)(?:[._-]|\?|#|$)/i;
  const isDolaPage = /(^|\.)dola\.com$/i.test(location.hostname);
  const isDolaCreateImagePage = isDolaPage && /^\/chat\/create-image(?:\/|$)/i.test(location.pathname);
  const isQianwenPage = /(^|\.)qianwen\.com$/i.test(location.hostname) || /(^|\.)tongyi\.aliyun\.com$/i.test(location.hostname);

  function cleanUrl(value) {
    if (!value || typeof value !== 'string') return '';
    const url = value.trim();
    if (!url || url.startsWith('data:')) return '';
    if (/^[{\[]/.test(url) || /"block_type"|"creation_block"|"content_block"/.test(url)) return '';
    if (!/^https?:\/\//i.test(url) && !/^blob:/i.test(url) && !/^\//.test(url)) return '';
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return '';
    }
  }

  function looksLikeVideoUrl(url) {
    if (!url) return false;
    if (blockedAssetPattern.test(url) || /css-var|index\./i.test(url)) return false;
    if (url.startsWith('blob:')) return true;
    return videoExtPattern.test(url) || (/^https?:/i.test(url) && videoHostPattern.test(url) && /video|mp4|play|media|stream|source|mime_type=video|vod/i.test(url));
  }

  function looksLikeImageUrl(url) {
    if (!url) return false;
    if (blockedAssetPattern.test(url) || /css-var|index\./i.test(url)) return false;
    if (isQianwenPage && /(?:svg|favicon|logo|icon|sprite|avatar|placeholder|toolbar|menu|button|appcenter|app_center|static|assets|_next|chunk|bundle|\.js|\.css)/i.test(url)) return false;
    return imageExtPattern.test(url) || (/^https?:/i.test(url) && imageHostPattern.test(url) && /image|img|png|jpe?g|webp|cover|thumb|origin|watermark/i.test(url));
  }

  function isLikelyUserContentNode(node) {
    if (!node || node === document.documentElement || node === document.body) return false;
    if (node.closest('header,nav,aside,footer,[role="navigation"],[class*="logo"],[class*="icon"],[class*="avatar"]')) return false;
    if (isDolaPage && node.closest('main,[class*="creation"],[class*="generated"],[class*="asset"],[class*="work"],[class*="media"],[class*="video"],[class*="image"],[class*="card"]')) return true;
    return !!node.closest('[data-testid], article, main, [class*="message"], [class*="chat"], [class*="conversation"], [class*="answer"], [class*="result"], [class*="media"], [class*="video"], [class*="image"], [class*="creation"], [class*="generated"]');
  }

  function getTitleFromNode(node) {
    const root = node.closest('[data-testid], article, [class*="message"], [class*="card"], [class*="video"], [class*="media"]') || node.parentElement;
    const text = root ? (root.innerText || '').replace(/\s+/g, ' ').trim() : '';
    return text ? text.slice(0, 80) : document.title || '创作平台视频';
  }

  function isDolaVideoImageNode(img) {
    if (!isDolaPage || !img) return false;
    const root = img.closest('[class*="video"],[class*="player"],[class*="media"],[class*="card"]') || img.parentElement;
    const text = (root?.innerText || '').replace(/\s+/g, ' ').trim();
    const className = `${img.className || ''} ${root?.className || ''}`;
    return /下载视频|生成视频|原视频|播放|预览|video/i.test(`${text} ${className}`);
  }

  function publish(resource) {
    const type = resource.type || 'video';
    const key = `${type}:${resource.url}`;
    if (!resource.url || seen.has(key)) return;
    if (type === 'image' && isDolaCreateImagePage) return;
    seen.add(key);
    if (type === 'image') {
      window.postMessage({
        type: 'imageDataExtracted',
        data: [{
          no_watermark_url: resource.url,
          watermark_url: resource.thumbUrl || resource.url,
          width: resource.width,
          height: resource.height,
          title: resource.title,
          source: 'generic-dom-image'
        }]
      }, '*');
      return;
    }
    window.postMessage({
      type: 'videoDownloadResult',
      data: {
        success: true,
        videoUrl: resource.url,
        title: resource.title,
        thumbUrl: resource.thumbUrl,
        width: resource.width,
        height: resource.height,
        source: 'generic-dom-video'
      }
    }, '*');
  }

  function collectVideoElement(video) {
    if (!isLikelyUserContentNode(video)) return;
    const posterUrl = cleanUrl(video.poster);
    const elementWidth = video.videoWidth || video.clientWidth || 0;
    const elementHeight = video.videoHeight || video.clientHeight || 0;
    if (isDolaPage) {
      if ((elementWidth && elementWidth < 240) || (elementHeight && elementHeight < 180)) return;
      if (!posterUrl && !video.currentSrc && !video.src && !video.querySelector('source[src]')) return;
    }
    const urls = [
      cleanUrl(video.currentSrc),
      cleanUrl(video.src),
      ...Array.from(video.querySelectorAll('source')).map(source => cleanUrl(source.src))
    ].filter(Boolean);

    for (const url of urls) {
      if (!looksLikeVideoUrl(url)) continue;
      publish({
        type: 'video',
        url,
        title: getTitleFromNode(video),
        thumbUrl: posterUrl,
        width: elementWidth,
        height: elementHeight
      });
    }
  }

  function collectImageElement(img) {
    if (!isLikelyUserContentNode(img)) return;
    if (isDolaVideoImageNode(img)) return;
    const width = img.naturalWidth || img.clientWidth || 0;
    const height = img.naturalHeight || img.clientHeight || 0;
    if (isQianwenPage && (!width || !height || width < 512 || height < 512)) return;
    if (isDolaPage && (!width || !height || width < 512 || height < 512 || width * height < 700 * 700)) return;
    if ((width && width < 240) || (height && height < 180)) return;
    const candidates = [
      cleanUrl(img.currentSrc),
      cleanUrl(img.src),
      cleanUrl(img.getAttribute('data-src')),
      cleanUrl(img.getAttribute('data-original')),
      cleanUrl(img.getAttribute('data-origin')),
      cleanUrl(img.getAttribute('data-url'))
    ].filter(Boolean);

    for (const url of candidates) {
      if (!looksLikeImageUrl(url)) continue;
      const title = getTitleFromNode(img);
      publish({
        type: 'image',
        url,
        thumbUrl: cleanUrl(img.src) || url,
        width,
        height,
        title
      });
    }
  }

  function scanLinks() {
    const selectors = [
      '[data-src]',
      '[data-original]',
      '[data-origin]',
      '[data-url]',
      '[data-video-url]',
      '[data-play-url]',
      '[data-image-url]'
    ].join(',');

    for (const node of document.querySelectorAll(selectors)) {
      if (!isLikelyUserContentNode(node)) continue;
      const candidates = [
        node.getAttribute('data-src'),
        node.getAttribute('data-original'),
        node.getAttribute('data-origin'),
        node.getAttribute('data-url'),
        node.getAttribute('data-video-url'),
        node.getAttribute('data-play-url'),
        node.getAttribute('data-image-url')
      ].map(cleanUrl).filter(Boolean);

      for (const url of candidates) {
        if (looksLikeVideoUrl(url)) {
          publish({
            type: 'video',
            url,
            title: getTitleFromNode(node),
            thumbUrl: '',
            width: 0,
            height: 0
          });
        } else if (looksLikeImageUrl(url)) {
          publish({
            type: 'image',
            url,
            title: getTitleFromNode(node),
            thumbUrl: '',
            width: 0,
            height: 0
          });
        }
      }
    }
  }

  function collectUrlCandidates(node) {
    const values = [];
    if (!node || node.nodeType !== 1) return values;
    for (const attr of Array.from(node.attributes || [])) {
      const name = attr.name.toLowerCase();
      const value = attr.value || '';
      if (/src|href|url|video|play|media|poster|cover|origin|download|data/.test(name)) values.push(value);
    }
    const styleBg = getComputedStyle(node).backgroundImage || '';
    const bgMatch = styleBg.match(/url\(["']?([^"')]+)["']?\)/);
    if (bgMatch) values.push(bgMatch[1]);
    return values.map(cleanUrl).filter(Boolean);
  }

  function scanDolaVideoCards() {
    if (!isDolaPage) return;
    const selectors = [
      'video',
      'a[href]',
      '[class*="video"]',
      '[class*="media"]',
      '[class*="creation"]',
      '[class*="asset"]',
      '[class*="work"]',
      '[data-video-url]',
      '[data-play-url]',
      '[data-url]',
      '[data-src]'
    ].join(',');

    for (const node of document.querySelectorAll(selectors)) {
      if (!isLikelyUserContentNode(node)) continue;
      const scope = node.closest('[class*="card"],[class*="creation"],[class*="media"],[class*="video"],[class*="asset"],[class*="work"],article,main') || node;
      const candidates = [
        ...collectUrlCandidates(node),
        ...collectUrlCandidates(scope),
        ...Array.from(scope.querySelectorAll('[src],[href],[data-src],[data-url],[data-video-url],[data-play-url],[data-download-url]')).flatMap(collectUrlCandidates)
      ];
      const cover = scope.querySelector('img[src],img[data-src]');
      const thumbUrl = cleanUrl(cover?.currentSrc) || cleanUrl(cover?.src) || cleanUrl(cover?.getAttribute?.('data-src')) || '';
      for (const url of candidates) {
        if (!looksLikeVideoUrl(url)) continue;
        const width = node.videoWidth || node.clientWidth || cover?.naturalWidth || 0;
        const height = node.videoHeight || node.clientHeight || cover?.naturalHeight || 0;
        if (!thumbUrl && ((width && width < 240) || (height && height < 180))) continue;
        if (!thumbUrl && /^blob:/i.test(url)) continue;
        publish({
          type: 'video',
          url,
          title: getTitleFromNode(scope),
          thumbUrl,
          width,
          height
        });
      }
    }
  }

  function scan() {
    document.querySelectorAll('video').forEach(collectVideoElement);
    document.querySelectorAll('img').forEach(collectImageElement);
    scanLinks();
    scanDolaVideoCards();
  }

  const observer = new MutationObserver(() => {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(scan, 300);
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'href', 'data-src', 'data-original', 'data-origin', 'data-url', 'data-video-url', 'data-play-url', 'data-image-url']
  });

  window.addEventListener('loadedmetadata', (event) => {
    if (event.target && event.target.tagName === 'VIDEO') collectVideoElement(event.target);
  }, true);
  window.addEventListener('play', (event) => {
    if (event.target && event.target.tagName === 'VIDEO') collectVideoElement(event.target);
  }, true);
  window.addEventListener('load', (event) => {
    if (event.target && event.target.tagName === 'IMG') collectImageElement(event.target);
  }, true);

  scan();
  setInterval(scan, 3000);
})();
