/**
 * YouTube Material 3 Expressive - MV3 Background Service Worker.
 * Manages persistent settings sync, action badge status, and CORS-safe
 * thumbnail pixel extraction for Dynamic Video Color (Material You).
 */
importScripts('md3-color.js');

const STORAGE_KEY = 'ytmd3Settings';
const VIDEO_SEED_CACHE = new Map();
const MAX_VIDEO_CACHE = 60;

function mergeSettings(raw) {
  return Object.assign({}, YTMD3Color.DEFAULT_SETTINGS, raw && typeof raw === 'object' ? raw : {});
}

async function getSettings() {
  try {
    const data = await chrome.storage.sync.get(STORAGE_KEY);
    return mergeSettings(data[STORAGE_KEY]);
  } catch (_) {
    const local = await chrome.storage.local.get(STORAGE_KEY);
    return mergeSettings(local[STORAGE_KEY]);
  }
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = mergeSettings(Object.assign({}, current, partial));
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  } catch (_) {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  }
  await syncBadge(next);
  return next;
}

async function syncBadge(settings) {
  try {
    const isEnabled = settings ? settings.enabled !== false : true;
    await chrome.action.setBadgeText({ text: isEnabled ? '' : 'OFF' });
    if (!isEnabled) {
      await chrome.action.setBadgeBackgroundColor({ color: '#49454F' });
    }
  } catch (_) {
    // Ignore badge errors in restricted contexts
  }
}

async function fetchThumbnailBitmap(videoId) {
  const safeId = encodeURIComponent(String(videoId).trim());
  const candidates = [
    `https://i.ytimg.com/vi/${safeId}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${safeId}/default.jpg`
  ];

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { credentials: 'omit' });
      if (!resp.ok) continue;
      const blob = await resp.blob();
      if (!blob || blob.size < 256) continue;
      const bitmap = await createImageBitmap(blob);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return bitmap;
      }
      bitmap.close();
    } catch (_) {
      // Try next fallback resolution
    }
  }
  return null;
}

async function extractVideoSeed(videoId) {
  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    return null;
  }
  if (VIDEO_SEED_CACHE.has(videoId)) {
    return VIDEO_SEED_CACHE.get(videoId);
  }

  let bitmap = null;
  try {
    bitmap = await fetchThumbnailBitmap(videoId);
    if (!bitmap) return null;

    const size = 24;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(bitmap, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    const seedColor = YTMD3Color.extractVibrantSeedFromPixels(imageData.data);

    if (seedColor) {
      VIDEO_SEED_CACHE.set(videoId, seedColor);
      if (VIDEO_SEED_CACHE.size > MAX_VIDEO_CACHE) {
        const oldest = VIDEO_SEED_CACHE.keys().next().value;
        VIDEO_SEED_CACHE.delete(oldest);
      }
    }
    return seedColor;
  } catch (_) {
    return null;
  } finally {
    if (bitmap && typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await getSettings();
  await saveSettings(existing);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await syncBadge(settings);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === 'sync' || areaName === 'local') && changes[STORAGE_KEY]) {
    const next = mergeSettings(changes[STORAGE_KEY].newValue);
    syncBadge(next);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'GET_SETTINGS') {
    getSettings().then(settings => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    saveSettings(message.payload || {}).then(settings => sendResponse({ ok: true, settings }));
    return true;
  }

  if (message.type === 'RESET_SETTINGS') {
    const fresh = Object.assign({}, YTMD3Color.DEFAULT_SETTINGS);
    chrome.storage.sync.set({ [STORAGE_KEY]: fresh }).catch(() =>
      chrome.storage.local.set({ [STORAGE_KEY]: fresh })
    ).then(async () => {
      await syncBadge(fresh);
      sendResponse({ ok: true, settings: fresh });
    });
    return true;
  }

  if (message.type === 'EXTRACT_VIDEO_SEED') {
    extractVideoSeed(message.videoId).then(seedColor => {
      sendResponse({ ok: Boolean(seedColor), videoId: message.videoId, seedColor });
    });
    return true;
  }

  return false;
});
