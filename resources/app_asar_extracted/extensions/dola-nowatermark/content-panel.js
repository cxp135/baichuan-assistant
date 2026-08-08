(function () {
  const PANEL_ID = "watermark-free-media-panel";
  const DOUBAO_PLAY_INFO_URL = "https://www.doubao.com/samantha/media/get_play_info?version_code=20800&language=zh-CN&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=&pc_version=2.51.7&region=&sys_region=&samantha_web=1&use-olympus-account=1&web_tab_id=";
  const items = new Map();

  if (document.getElementById(PANEL_ID)) {
    return;
  }

  const host = document.createElement("div");
  host.id = PANEL_ID;
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        font-family: "Microsoft YaHei UI", "PingFang SC", "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
        letter-spacing: 0;
      }

      .panel {
        width: 340px;
        max-height: 420px;
        display: flex;
        flex-direction: column;
        color: #172033;
        background: rgba(255, 255, 255, .98);
        border: 1px solid #dfe7f3;
        border-radius: 8px;
        box-shadow: 0 24px 70px rgba(37, 61, 105, .18);
        overflow: hidden;
        backdrop-filter: blur(14px) saturate(115%);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 13px 14px;
        background: #fbfdff;
        border-bottom: 1px solid #edf2f8;
      }

      .title {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        min-width: 0;
        font-size: 14px;
        line-height: 20px;
        font-weight: 900;
      }

      .title::before {
        content: "豆";
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 1px solid #cfe0ff;
        border-radius: 8px;
        background: #edf6ff;
        color: #1767d2;
        font-size: 15px;
        font-weight: 900;
      }

      .count {
        min-width: 28px;
        height: 24px;
        padding: 0 8px;
        border-radius: 999px;
        background: #1677ff;
        color: #fff;
        font-size: 12px;
        font-weight: 900;
        line-height: 24px;
        text-align: center;
      }

      .list {
        min-height: 76px;
        max-height: 350px;
        overflow: auto;
        padding: 10px;
        background: #f7faff;
      }

      .empty {
        padding: 20px 12px;
        color: #68778f;
        font-size: 12px;
        font-weight: 800;
        line-height: 20px;
        text-align: center;
      }

      .item {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
        min-height: 48px;
        padding: 9px 10px;
        border: 1px solid #edf2f8;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 8px 20px rgba(37, 61, 105, .05);
      }

      .item + .item {
        margin-top: 8px;
      }

      .label {
        min-width: 0;
        color: #172033;
        font-size: 12px;
        line-height: 18px;
        font-weight: 900;
      }

      .tag {
        display: inline-block;
        min-width: 34px;
        margin-right: 8px;
        padding: 2px 6px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 900;
        line-height: 16px;
        text-align: center;
      }

      .tag.video {
        background: #f3f1ff;
        color: #575be8;
      }

      .tag.image {
        background: #eefaf6;
        color: #168b6b;
      }

      button {
        height: 32px;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: #1677ff;
        color: #fff;
        font-size: 12px;
        font-weight: 900;
        line-height: 30px;
        cursor: pointer;
        box-shadow: 0 8px 18px rgba(22, 119, 255, .18);
      }

      button:hover {
        background: #0f66d9;
      }
    </style>
    <section class="panel" aria-label="无水印资源面板">
      <div class="header">
        <div class="title">无水印资源</div>
        <div class="count">0</div>
      </div>
      <div class="list">
        <div class="empty">等待捕获资源</div>
      </div>
    </section>
  `;

  const list = shadow.querySelector(".list");
  const count = shadow.querySelector(".count");
  let currentSourceKey = "";
  let statusText = "等待捕获资源";

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) {
      return;
    }

    if (message.type === "MEDIA_STATUS" && typeof message.text === "string") {
      resetForSource(message.sourceKey);
      items.clear();
      statusText = message.text;
      render();
      return;
    }

    if (message.type === "MEDIA_FOUND" && Array.isArray(message.items)) {
      resetForSource(message.sourceKey);
      items.clear();
      addItems(message.items);
      statusText = items.size ? "" : "未提取到资源";
      render();
      return;
    }

    if (message.type === "DOUBAO_VIDS_FOUND" && Array.isArray(message.vids)) {
      resetForSource(message.sourceKey);
      fetchDoubaoVideos(message.sourceKey, message.vids);
    }
  });

  async function fetchDoubaoVideos(sourceKey, vids) {
    const uniqueVids = Array.from(new Set(vids.filter((vid) => typeof vid === "string" && vid)));
    if (!uniqueVids.length) {
      return;
    }

    statusText = items.size ? "" : "正在获取豆包无水印视频";
    render();

    const foundItems = [];
    for (const vid of uniqueVids) {
      const url = await getDoubaoOriginalVideoUrl(vid);
      if (isHttpUrl(url)) {
        foundItems.push({ type: "video", url });
      }
    }

    if (sourceKey !== currentSourceKey) {
      return;
    }

    addItems(foundItems);
    statusText = items.size ? "" : "未提取到资源";
    render();
  }

  async function getDoubaoOriginalVideoUrl(vid) {
    try {
      const response = await fetch(DOUBAO_PLAY_INFO_URL, {
        method: "POST",
        credentials: "omit",
        headers: {
          "accept": "application/json, text/plain, */*",
          "content-type": "application/json"
        },
        body: JSON.stringify({ key: vid })
      });
      const json = await response.json();
      const url = json?.data?.original_media_info?.main_url;
      return isHttpUrl(url) ? url : "";
    } catch (error) {
      console.warn("doubao play info failed:", error);
      return "";
    }
  }

  function resetForSource(sourceKey) {
    if (typeof sourceKey !== "string" || !sourceKey) {
      return;
    }

    if (sourceKey !== currentSourceKey) {
      currentSourceKey = sourceKey;
      items.clear();
      statusText = "";
    }
  }

  function render() {
    count.textContent = String(items.size);
    list.textContent = "";

    if (!items.size) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = statusText || "等待捕获资源";
      list.appendChild(empty);
      return;
    }

    Array.from(items.values()).forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "item";

      const label = document.createElement("div");
      label.className = "label";
      label.title = item.url;

      const tag = document.createElement("span");
      tag.className = `tag ${item.type}`;
      tag.textContent = item.type === "image" ? "图片" : "视频";

      const indexText = document.createElement("span");
      indexText.textContent = String(index + 1);

      label.append(tag, indexText);

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "下载";
      button.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "DOWNLOAD_MEDIA", url: item.url });
      });

      row.append(label, button);
      list.appendChild(row);
    });
  }

  function addItems(nextItems) {
    for (const item of nextItems) {
      if (!item || typeof item.url !== "string" || !isHttpUrl(item.url)) {
        continue;
      }
      items.set(item.url, {
        type: item.type === "image" ? "image" : "video",
        url: item.url
      });
    }
  }

  function isHttpUrl(url) {
    return /^https?:\/\//i.test(url);
  }
})();
