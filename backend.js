/* 记忆相册 · 可选后端同步模块
 *
 * 当配置了后端地址（SnapBackend.setBase）时：
 *   - 生成海报后异步上传到后端，永久保存
 *   - 家人扫码时优先从后端加载海报和留言
 *   - 后端不可达时自动降级到本地 + ntfy 临时通道
 *
 * 不配置后端时，所有方法返回空值，不影响原有流程。
 */
(function (global) {
  "use strict";

  const STORAGE_BASE = "snapstory.backend";
  // 默认云端地址：首次打开即生效，用户无需填写
  const DEFAULT_BASE = "https://ruiminlee.pythonanywhere.com";
  let baseUrl = "";
  let online = null;       // null=未探测, true/false
  let onlineExpire = 0;    // 探测结果缓存 30 秒
  let lastError = "";      // 最近一次失败原因：timeout / network / http-404 ...

  function setLastError(msg) { lastError = msg || ""; }

  function readBase() {
    try {
      const saved = localStorage.getItem(STORAGE_BASE + ".base");
      // 从未设置过 → 用默认云端；用户点过「清除」→ 保存为空串，表示关闭云端
      if (saved === null) return DEFAULT_BASE;
      return saved;
    } catch (e) { return DEFAULT_BASE; }
  }
  function writeBase(url) {
    try { localStorage.setItem(STORAGE_BASE + ".base", url); } catch (e) { /* 忽略 */ }
  }

  function setBase(url) {
    baseUrl = String(url || "").replace(/\/+$/, "");
    writeBase(baseUrl);
    online = null; // 地址变了，重新探测
  }

  function getBase() {
    if (!baseUrl) baseUrl = readBase();
    return baseUrl;
  }

  function isConfigured() {
    return !!getBase();
  }

  // 健康检查，超时 6 秒，结果缓存（成功 60 秒 / 失败 20 秒）
  async function health(force) {
    if (!isConfigured()) return false;
    const now = Date.now();
    if (!force && online !== null && now < onlineExpire) return online;

    const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
    try {
      const res = await fetch(`${baseUrl}/health`, {
        method: "GET",
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
      const ok = res.ok;
      online = ok;
      onlineExpire = now + (ok ? 60000 : 20000);
      setLastError(ok ? "" : "http-" + res.status);
      return ok;
    } catch (e) {
      online = false;
      onlineExpire = now + 20000;
      setLastError(e && e.name === "AbortError" ? "timeout" : "network");
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 上传海报（dataURL），成功返回后端 URL，失败返回 ""
  async function uploadPoster(syncKey, userId, dataUrl, meta) {
    if (!isConfigured()) return "";
    if (!syncKey || !dataUrl) return "";
    // 直接尝试上传，省掉一次 health 请求（免费隧道请求数有限）
    const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
    try {
      const res = await fetch(`${baseUrl}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          syncKey: String(syncKey || ""),
          userId: String(userId || ""),
          image: String(dataUrl || ""),
          meta: (meta && typeof meta === "object") ? meta : {}
        }),
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) {
        online = false;
        onlineExpire = Date.now() + 20000;
        setLastError("http-" + res.status);
        return "";
      }
      const data = await res.json().catch(() => ({}));
      online = true;
      onlineExpire = Date.now() + 60000;
      setLastError("");
      if (data && data.ok && data.url) {
        return baseUrl + data.url;
      }
      setLastError("bad-response");
      return "";
    } catch (e) {
      online = false;
      onlineExpire = Date.now() + 20000;
      setLastError(e && e.name === "AbortError" ? "timeout" : "network");
      return "";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 列出某个身份码在云端的所有海报（换设备后恢复列表用）
  // 8 秒超时；后端不可用时返回空数组，绝不影响本地列表
  async function listPosters(userId) {
    if (!isConfigured() || !userId) return [];
    const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
      const res = await fetch(`${baseUrl}/users/${encodeURIComponent(userId)}/posters`, {
        method: "GET",
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      if (!data || !Array.isArray(data.posters)) return [];
      return data.posters
        .filter((p) => p && p.syncKey)
        .map((p) => ({
          syncKey: String(p.syncKey),
          url: baseUrl + String(p.url || `/posters/${p.syncKey}.jpg`),
          at: Number(p.at) || 0,
          meta: (p.meta && typeof p.meta === "object") ? p.meta : {}
        }));
    } catch (e) {
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 取后端海报的永久 URL，取不到返回 ""
  function posterUrl(syncKey) {
    if (!isConfigured() || !syncKey) return "";
    return `${baseUrl}/posters/${encodeURIComponent(syncKey)}.jpg`;
  }

  // 从后端取留言列表（6 秒超时，失败返回空数组）
  async function fetchComments(syncKey) {
    if (!isConfigured() || !syncKey) return [];
    const controller = (typeof AbortController !== "undefined") ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 6000) : null;
    try {
      const res = await fetch(`${baseUrl}/comments/${encodeURIComponent(syncKey)}`, {
        method: "GET",
        cache: "no-store",
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // 往后端发一条留言
  async function publishComment(syncKey, comment) {
    if (!isConfigured() || !syncKey) return false;
    try {
      const res = await fetch(`${baseUrl}/comments/${encodeURIComponent(syncKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(comment && comment.name || "家人").slice(0, 12),
          content: String(comment && comment.content || "").slice(0, 200),
          at: Number(comment && comment.at) || Date.now()
        })
      });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  // 订阅后端留言（轮询，每 20 秒拉一次，减少免费隧道请求数）
  function subscribeComments(syncKey, onComment) {
    if (!isConfigured() || !syncKey || typeof onComment !== "function") {
      return function () {};
    }
    let stopped = false;
    let lastAt = 0;
    const tick = async () => {
      if (stopped) return;
      const list = await fetchComments(syncKey);
      list.forEach((c) => {
        const at = Number(c.at) || 0;
        if (at > lastAt) {
          lastAt = at;
          onComment(c);
        }
      });
      if (!stopped) setTimeout(tick, 20000);
    };
    // 首次立即拉一次建立 lastAt 基线
    fetchComments(syncKey).then((list) => {
      list.forEach((c) => { lastAt = Math.max(lastAt, Number(c.at) || 0); });
      if (!stopped) setTimeout(tick, 20000);
    });
    return function () { stopped = true; };
  }

  global.SnapBackend = {
    setBase, getBase, isConfigured,
    health, uploadPoster, posterUrl, listPosters,
    fetchComments, publishComment, subscribeComments,
    getLastError: function () { return lastError; }
  };
})(window);
