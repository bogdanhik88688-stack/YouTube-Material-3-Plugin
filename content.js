/**
 * YouTube Material 3 Expressive — Main Content Script Orchestrator.
 * Coordinates:
 * - Zero-FOUC MD3 HCT color token injection & live RGB recoloring (Accent / Text / Buttons)
 * - Dynamic Video Color seed extraction on watch/shorts pages
 * - 16 MD3 Expressive avatar shapes with clockwise morph animation
 * - Material Symbols Rounded icon rewriting (Return YouTube Dislike compatible)
 * - Clean ad removal, MD3 ripples & scroll-aware floating "Параметры" panel
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ytmd3Settings';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VARS_STYLE_ID = 'ytmd3-vars-sheet';

  let currentSettings = Object.assign({}, YTMD3Color.DEFAULT_SETTINGS);
  let activeDynamicSeed = null;
  let lastVideoId = null;
  let appliedVarKeys = [];
  let domObserver = null;
  let themeObserver = null;
  let scanTimer = null;
  let quickPanelOpen = false;
  let boundVideoEl = null;
  let lastAvatarModeKey = null;
  let pendingMorphSwapTimer = null;
  let pendingMorphEndTimer = null;
  let quickColorTarget = 'accent'; // 'accent' | 'text' | 'button'
  let isDraggingSlider = false;
  let lastScrollY = 0;
  let wasAdMutedByUs = false;
  let preAdMutedState = false;

  const AVATAR_HOST_SELECTOR = [
    'yt-avatar-shape',
    'ytd-comment-view-model #author-thumbnail',
    'ytd-comment-renderer #author-thumbnail',
    'ytd-commentbox #author-thumbnail',
    'ytd-comment-simplebox-renderer #author-thumbnail',
    'ytd-video-owner-renderer #avatar',
    'ytd-rich-grid-media #avatar-link',
    'ytd-channel-renderer #avatar',
    'ytd-grid-channel-renderer #avatar',
    'ytd-c4-tabbed-header-renderer #avatar',
    'ytd-active-account-header-renderer #avatar',
    'yt-live-chat-text-message-renderer #author-photo',
    'yt-live-chat-paid-message-renderer #author-photo',
    'ytd-guide-entry-renderer yt-img-shadow',
    'ytd-notification-renderer yt-img-shadow',
    'ytd-masthead #avatar-btn yt-img-shadow'
  ].join(', ');

  function mergeSettings(raw) {
    return Object.assign({}, YTMD3Color.DEFAULT_SETTINGS, raw && typeof raw === 'object' ? raw : {});
  }

  function resolveIsDark() {
    if (currentSettings.themeMode === 'dark') return true;
    if (currentSettings.themeMode === 'light') return false;
    const html = document.documentElement;
    if (html.hasAttribute('dark') || html.hasAttribute('darker-dark-theme')) return true;
    if (document.querySelector('ytd-app[dark], [darker-dark-theme]')) return true;
    try {
      if (document.cookie && /PREF=[^;]*f6=400/.test(document.cookie)) return true;
    } catch (_) {
      // Ignore cookie access errors
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return true;
    return false;
  }

  function clearCssVariables() {
    const style = document.documentElement.style;
    for (let i = 0; i < appliedVarKeys.length; i++) {
      style.removeProperty(appliedVarKeys[i]);
    }
    appliedVarKeys = [];
    const sheet = document.getElementById(VARS_STYLE_ID);
    if (sheet) sheet.remove();
  }

  function injectVarsStylesheet(vars, shapeScale) {
    const parent = document.head || document.documentElement;
    if (!parent) return;
    let sheet = document.getElementById(VARS_STYLE_ID);
    if (!sheet) {
      sheet = document.createElement('style');
      sheet.id = VARS_STYLE_ID;
      parent.appendChild(sheet);
    }

    const lines = Object.keys(vars).map(k => `  ${k}: ${vars[k]} !important;`);
    lines.push(`  --ytmd3-shape-scale: ${shapeScale} !important;`);
    const body = lines.join('\n');

    sheet.textContent = [
      'html[data-ytmd3="on"],',
      'html[data-ytmd3="on"][dark],',
      'html[data-ytmd3="on"][darker-dark-theme],',
      'html[data-ytmd3="on"]:not([dark]),',
      'html[data-ytmd3="on"] body,',
      'html[data-ytmd3="on"] ytd-app,',
      'html[data-ytmd3="on"] [dark],',
      'html[data-ytmd3="on"] [darker-dark-theme],',
      'html[data-ytmd3="on"] ytd-masthead,',
      'html[data-ytmd3="on"] ytd-watch-flexy,',
      'html[data-ytmd3="on"] ytd-browse,',
      'html[data-ytmd3="on"] ytd-search,',
      'html[data-ytmd3="on"] ytd-guide-renderer,',
      'html[data-ytmd3="on"] ytd-mini-guide-renderer,',
      'html[data-ytmd3="on"] ytd-popup-container,',
      'html[data-ytmd3="on"] tp-yt-paper-dialog,',
      'html[data-ytmd3="on"] yt-live-chat-renderer {',
      body,
      '}'
    ].join('\n');
  }

  function applyThemeAndFlags() {
    const html = document.documentElement;
    if (!currentSettings.enabled) {
      html.removeAttribute('data-ytmd3');
      html.removeAttribute('data-ytmd3-theme');
      html.removeAttribute('data-ytmd3-font');
      html.removeAttribute('data-ytmd3-cards');
      html.removeAttribute('data-ytmd3-logo');
      html.removeAttribute('data-ytmd3-player');
      html.removeAttribute('data-ytmd3-ripple');
      html.removeAttribute('data-ytmd3-avatar-spring');
      html.removeAttribute('data-ytmd3-fab');
      html.removeAttribute('data-ytmd3-ads');
      html.removeAttribute('data-ytmd3-custom-btn');
      clearCssVariables();
      cleanupAvatars();
      if (window.YTMD3Icons) YTMD3Icons.restoreOriginalIcons(document);
      removeQuickStudio();
      return;
    }

    const isDark = resolveIsDark();
    const effectiveSeed = (currentSettings.dynamicVideoColor && activeDynamicSeed)
      ? activeDynamicSeed
      : currentSettings.seedColor;

    const scheme = YTMD3Color.generateScheme({
      seedColor: effectiveSeed,
      isDark,
      schemeStyle: currentSettings.schemeStyle,
      contrastLevel: currentSettings.contrastLevel,
      amoled: currentSettings.amoled
    });
    const vars = YTMD3Color.schemeToCssVariables(scheme, {
      customTextColor: currentSettings.customTextColor,
      customButtonColor: currentSettings.customButtonColor,
      iconSize: currentSettings.iconSize,
      iconRounding: currentSettings.iconRounding
    });

    const scale = Number(currentSettings.shapeScale);
    const safeScale = Number.isFinite(scale) ? String(scale) : '1';

    const style = html.style;
    const keys = Object.keys(vars);
    for (let i = 0; i < keys.length; i++) {
      style.setProperty(keys[i], vars[keys[i]], 'important');
    }
    style.setProperty('--ytmd3-shape-scale', safeScale);
    appliedVarKeys = keys.concat(['--ytmd3-shape-scale']);

    injectVarsStylesheet(vars, safeScale);

    html.setAttribute('data-ytmd3', 'on');
    html.setAttribute('data-ytmd3-theme', isDark ? 'dark' : 'light');
    html.setAttribute('data-ytmd3-font', currentSettings.md3Font ? 'on' : 'off');
    html.setAttribute('data-ytmd3-cards', currentSettings.tonalCards ? 'on' : 'off');
    html.setAttribute('data-ytmd3-logo', currentSettings.accentLogo ? 'on' : 'off');
    html.setAttribute('data-ytmd3-player', currentSettings.md3Player ? 'on' : 'off');
    html.setAttribute('data-ytmd3-ripple', currentSettings.rippleEffect ? 'on' : 'off');
    html.setAttribute('data-ytmd3-avatar-spring', currentSettings.avatarHoverSpring ? 'on' : 'off');
    html.setAttribute('data-ytmd3-fab', currentSettings.floatingStudio ? 'on' : 'off');
    html.setAttribute('data-ytmd3-ads', currentSettings.blockAds !== false ? 'on' : 'off');
    html.setAttribute('data-ytmd3-custom-btn', YTMD3Color.isValidHex(currentSettings.customButtonColor) ? 'on' : 'off');
  }

  /* ============================================================================
     16 Expressive Avatar Shapes + Clockwise Morph Spin Animation
     ============================================================================ */
  function classifyAvatarHost(host) {
    if (!host || !host.closest) return null;
    if (host.closest('.ytmd3-studio, #ytmd3-fab, #ytmd3-quick-panel')) return null;

    if (host.matches('ytd-guide-entry-renderer yt-img-shadow')) {
      const img = host.querySelector('img');
      if (!img || (!img.src && !img.getAttribute('src'))) return null;
    }

    const isSelf = Boolean(
      host.closest('ytd-masthead #avatar-btn, ytd-comment-simplebox-renderer, ytd-commentbox #author-thumbnail, ytd-active-account-header-renderer')
    );
    if (isSelf && !currentSettings.avatarIncludeSelf) return null;

    const isComment = Boolean(
      host.closest('ytd-comment-view-model, ytd-comment-renderer, ytd-commentbox, ytd-comment-simplebox-renderer, yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer')
    );

    if (isComment) {
      return currentSettings.avatarApplyComments !== false ? 'comment' : null;
    }

    return currentSettings.avatarApplyChannels !== false ? 'channel' : null;
  }

  function extractAvatarMixKey(host) {
    const comment = host.closest('ytd-comment-view-model, ytd-comment-renderer');
    if (comment) {
      const author = comment.querySelector('#author-text, a[href*="/@"], a[href*="/channel/"]');
      if (author) {
        return (author.getAttribute('href') || author.textContent || '').trim();
      }
    }
    const link = host.closest('a[href]') || host.querySelector('a[href]');
    if (link) {
      const href = link.getAttribute('href');
      if (href && href !== '#') return href;
    }
    const img = host.querySelector('img');
    if (img && (img.alt || img.src)) return img.alt || img.src.slice(0, 64);
    const parentLockup = host.closest('yt-lockup-view-model, ytd-rich-grid-media, ytd-video-owner-renderer, ytd-channel-renderer');
    if (parentLockup) {
      const ch = parentLockup.querySelector('ytd-channel-name a, a[href*="/@"], a[href*="/channel/"]');
      if (ch) return (ch.getAttribute('href') || ch.textContent || '').trim();
    }
    return 'default-user';
  }

  function updateAvatarRing(host, shape) {
    let ringSvg = host.querySelector(':scope > svg.ytmd3-avatar-ring-svg');
    const wantRing = Boolean(currentSettings.avatarRing) && shape.id !== 'none';

    if (!wantRing) {
      if (ringSvg) ringSvg.remove();
      return;
    }

    const rect = host.getBoundingClientRect();
    if (rect.width > 0 && rect.width < 18) {
      if (ringSvg) ringSvg.remove();
      return;
    }

    if (!ringSvg) {
      ringSvg = document.createElementNS(SVG_NS, 'svg');
      ringSvg.setAttribute('viewBox', '0 0 100 100');
      ringSvg.setAttribute('aria-hidden', 'true');
      ringSvg.classList.add('ytmd3-avatar-ring-svg');
      const p = document.createElementNS(SVG_NS, 'path');
      ringSvg.appendChild(p);
      host.appendChild(ringSvg);
    }

    if (ringSvg.dataset.ytmd3Shape !== shape.id) {
      ringSvg.dataset.ytmd3Shape = shape.id;
      const p = ringSvg.firstElementChild;
      if (p) p.setAttribute('d', shape.svgPath);
    }
  }

  function applyShapeToHosts(rootEl) {
    const scope = rootEl && rootEl.querySelectorAll ? rootEl : document;
    const hosts = scope.querySelectorAll(AVATAR_HOST_SELECTOR);

    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i];
      if (!host.matches('yt-avatar-shape') && host.closest('yt-avatar-shape')) continue;

      const kind = classifyAvatarHost(host);
      if (!kind) {
        if (host.classList.contains('ytmd3-avatar-host')) {
          host.classList.remove('ytmd3-avatar-host');
          host.style.removeProperty('--ytmd3-avatar-clip');
          delete host.dataset.ytmd3Shape;
          const r = host.querySelector(':scope > svg.ytmd3-avatar-ring-svg');
          if (r) r.remove();
        }
        continue;
      }

      const shape = currentSettings.avatarMode === 'mix'
        ? YTMD3Shapes.getMixShapeForKey(extractAvatarMixKey(host))
        : YTMD3Shapes.getShapeById(currentSettings.avatarShape);

      const clipCss = YTMD3Shapes.getClipPathCss(shape.id);

      if (!host.classList.contains('ytmd3-avatar-host')) {
        host.classList.add('ytmd3-avatar-host');
      }
      if (host.dataset.ytmd3Shape !== shape.id) {
        host.dataset.ytmd3Shape = shape.id;
        host.style.setProperty('--ytmd3-avatar-clip', clipCss);
      }
      updateAvatarRing(host, shape);
    }
  }

  function applyAvatars(rootEl) {
    if (!currentSettings.enabled) return;
    const modeKey = `${currentSettings.avatarShape}|${currentSettings.avatarMode}`;
    const changed = lastAvatarModeKey !== null && lastAvatarModeKey !== modeKey;
    lastAvatarModeKey = modeKey;

    if (changed) {
      const existing = document.querySelectorAll('.ytmd3-avatar-host');
      existing.forEach(host => {
        host.classList.remove('ytmd3-avatar-morphing');
        void host.offsetWidth;
        host.classList.add('ytmd3-avatar-morphing');
      });

      clearTimeout(pendingMorphSwapTimer);
      clearTimeout(pendingMorphEndTimer);
      pendingMorphSwapTimer = setTimeout(() => {
        applyShapeToHosts(document);
        pendingMorphEndTimer = setTimeout(() => {
          document.querySelectorAll('.ytmd3-avatar-host.ytmd3-avatar-morphing').forEach(host => {
            host.classList.remove('ytmd3-avatar-morphing');
          });
        }, 360);
      }, 210);
      return;
    }

    applyShapeToHosts(rootEl);
  }

  function cleanupAvatars() {
    clearTimeout(pendingMorphSwapTimer);
    clearTimeout(pendingMorphEndTimer);
    document.querySelectorAll('.ytmd3-avatar-host').forEach(host => {
      host.classList.remove('ytmd3-avatar-host', 'ytmd3-avatar-morphing');
      host.style.removeProperty('--ytmd3-avatar-clip');
      delete host.dataset.ytmd3Shape;
    });
    document.querySelectorAll('svg.ytmd3-avatar-ring-svg').forEach(svg => svg.remove());
  }

  /* ============================================================================
     Ad Cleanup & Skip Helper
     ============================================================================ */
  function handleAds() {
    if (!currentSettings.enabled || currentSettings.blockAds === false) return;

    const player = document.querySelector('.html5-video-player');
    if (!player) return;

    const adShowing = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
    const video = player.querySelector('video');

    if (adShowing) {
      const skipBtn = player.querySelector(
        '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-overlay-close-button'
      );
      if (skipBtn) {
        skipBtn.click();
      }
      if (video && Number.isFinite(video.duration) && video.duration > 0 && video.duration < 120) {
        if (!wasAdMutedByUs) {
          preAdMutedState = video.muted;
          wasAdMutedByUs = true;
        }
        video.muted = true;
        if (video.currentTime < video.duration - 0.15) {
          video.currentTime = video.duration;
        }
      }
    } else if (wasAdMutedByUs && video) {
      video.muted = preAdMutedState;
      wasAdMutedByUs = false;
    }
  }

  /* ============================================================================
     Icon Rewrite + Player Event Synchronization
     ============================================================================ */
  function bindPlayerEvents() {
    const video = document.querySelector('.html5-video-player video');
    if (!video || video === boundVideoEl) return;
    boundVideoEl = video;

    const refreshPlayerIcons = () => {
      if (!currentSettings.enabled) return;
      handleAds();
      if (!currentSettings.rewriteIcons || !window.YTMD3Icons) return;
      const btns = document.querySelectorAll(
        '.ytp-play-button, .ytp-mute-button, .ytp-subtitles-button, .ytp-settings-button, .ytp-size-button, .ytp-fullscreen-button'
      );
      btns.forEach(btn => YTMD3Icons.processPlayerButton(btn));
    };

    ['play', 'pause', 'ended', 'volumechange', 'durationchange', 'timeupdate'].forEach(evt => {
      video.addEventListener(evt, refreshPlayerIcons, { passive: true });
    });
  }

  function scanDom(rootEl) {
    if (!currentSettings.enabled) return;
    applyAvatars(rootEl);
    handleAds();

    if (window.YTMD3Icons) {
      if (currentSettings.rewriteIcons) {
        YTMD3Icons.scanAndRewriteIcons(rootEl);
      } else {
        YTMD3Icons.restoreOriginalIcons(rootEl);
      }
    }

    bindPlayerEvents();
    if (currentSettings.floatingStudio) {
      ensureFloatingFab();
    } else {
      removeQuickStudio();
    }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanDom(document);
    }, 85);
  }

  /* ============================================================================
     Dynamic Video Color (Material You from Video Thumbnail)
     ============================================================================ */
  function extractCurrentVideoId() {
    const url = new URL(location.href);
    if (url.pathname === '/watch') return url.searchParams.get('v');
    if (url.pathname.startsWith('/shorts/')) return url.pathname.split('/')[2] || null;
    return null;
  }

  function refreshDynamicVideoSeed() {
    if (!currentSettings.enabled || !currentSettings.dynamicVideoColor) {
      if (activeDynamicSeed !== null) {
        activeDynamicSeed = null;
        applyThemeAndFlags();
      }
      return;
    }

    const vid = extractCurrentVideoId();
    if (!vid) {
      if (activeDynamicSeed !== null) {
        activeDynamicSeed = null;
        lastVideoId = null;
        applyThemeAndFlags();
      }
      return;
    }

    if (vid === lastVideoId && activeDynamicSeed) return;
    lastVideoId = vid;

    chrome.runtime.sendMessage({ type: 'EXTRACT_VIDEO_SEED', videoId: vid }, response => {
      if (chrome.runtime.lastError) return;
      if (response && response.ok && response.seedColor && extractCurrentVideoId() === vid) {
        activeDynamicSeed = response.seedColor;
        applyThemeAndFlags();
        syncQuickPanelControls();
      }
    });
  }

  /* ============================================================================
     MD3 Touch / Click Ripple (RYD-Safe)
     ============================================================================ */
  function setupRippleListener() {
    document.addEventListener('pointerdown', e => {
      if (!currentSettings.enabled || !currentSettings.rippleEffect) return;
      if (e.button !== 0) return;

      const rawTarget = e.target;
      if (!rawTarget || !rawTarget.closest) return;
      // Never disturb Return YouTube Dislike segmented button container or bar
      if (rawTarget.closest('segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer, like-button-view-model, dislike-button-view-model, #segmented-like-button, #segmented-dislike-button, #ryd-bar-container, .ryd-tooltip')) {
        return;
      }

      const target = rawTarget.closest(
        'button.yt-spec-button-shape-next, a.yt-spec-button-shape-next, ' +
        'tp-yt-paper-item.ytd-guide-entry-renderer, yt-chip-cloud-chip-renderer #chip-container, ' +
        'ytd-menu-service-item-renderer, .ytmd3-qp-shape-btn, #ytmd3-fab'
      );
      if (!target) return;

      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      target.classList.add('ytmd3-ripple-host');
      const size = Math.max(rect.width, rect.height) * 2.1;
      const wave = document.createElement('span');
      wave.className = 'ytmd3-ripple-wave';
      wave.style.width = `${size}px`;
      wave.style.height = `${size}px`;
      wave.style.left = `${e.clientX - rect.left - size / 2}px`;
      wave.style.top = `${e.clientY - rect.top - size / 2}px`;
      target.appendChild(wave);

      const cleanup = () => wave.remove();
      wave.addEventListener('animationend', cleanup, { once: true });
      setTimeout(cleanup, 600);
    }, { passive: true, capture: true });
  }

  /* ============================================================================
     Floating On-Page "Параметры" Pill + Scroll Auto-Hide/Show
     ============================================================================ */
  function persistPartialSettings(partial) {
    currentSettings = mergeSettings(Object.assign({}, currentSettings, partial));
    applyThemeAndFlags();
    scheduleScan();
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: partial }, () => {
      void chrome.runtime.lastError;
    });
  }

  function getActiveTargetHex() {
    if (quickColorTarget === 'text') {
      return YTMD3Color.isValidHex(currentSettings.customTextColor)
        ? currentSettings.customTextColor
        : (resolveIsDark() ? '#E6E0E9' : '#1D1B20');
    }
    if (quickColorTarget === 'button') {
      return YTMD3Color.isValidHex(currentSettings.customButtonColor)
        ? currentSettings.customButtonColor
        : currentSettings.seedColor;
    }
    return currentSettings.seedColor;
  }

  function getTargetSettingPatch(hex) {
    if (quickColorTarget === 'text') return { customTextColor: hex };
    if (quickColorTarget === 'button') return { customButtonColor: hex };
    return { seedColor: hex, dynamicVideoColor: false };
  }

  function setFloatingVisibility(hidden) {
    const fab = document.getElementById('ytmd3-fab');
    const panel = document.getElementById('ytmd3-quick-panel');
    if (fab) fab.classList.toggle('ytmd3-scroll-hidden', hidden);
    if (panel) panel.classList.toggle('ytmd3-scroll-hidden', hidden);
  }

  function setupScrollAutoHide() {
    lastScrollY = window.scrollY || 0;
    window.addEventListener('scroll', () => {
      if (!currentSettings.enabled || !currentSettings.floatingStudio) return;
      if (isDraggingSlider) return;

      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const delta = y - lastScrollY;
      if (delta > 8 && y > 60) {
        setFloatingVisibility(true);
      } else if (delta < -4 || y <= 40) {
        setFloatingVisibility(false);
      }
      lastScrollY = y;
    }, { passive: true });
  }

  function ensureFloatingFab() {
    if (window.top !== window.self) return;
    const hostRoot = document.documentElement;
    if (!hostRoot) return;

    let fab = document.getElementById('ytmd3-fab');
    if (!fab) {
      fab = document.createElement('button');
      fab.id = 'ytmd3-fab';
      fab.type = 'button';
      fab.title = 'Параметры YouTube MD3';
      if (window.YTMD3Icons) {
        fab.appendChild(YTMD3Icons.createIconSvgElement('tune', 20));
      }
      const label = document.createElement('span');
      label.textContent = 'Параметры';
      fab.appendChild(label);

      fab.addEventListener('click', () => {
        quickPanelOpen = !quickPanelOpen;
        if (quickPanelOpen) renderQuickPanel();
        else {
          const panel = document.getElementById('ytmd3-quick-panel');
          if (panel) panel.remove();
        }
      });
      hostRoot.appendChild(fab);
    }
  }

  function renderQuickPanel() {
    const hostRoot = document.documentElement;
    if (!hostRoot) return;
    let panel = document.getElementById('ytmd3-quick-panel');
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'ytmd3-quick-panel';
    panel.className = 'ytmd3-studio';

    const header = document.createElement('div');
    header.className = 'ytmd3-qp-header';
    const title = document.createElement('div');
    title.className = 'ytmd3-qp-title';
    if (window.YTMD3Icons) title.appendChild(YTMD3Icons.createIconSvgElement('tune', 18));
    const titleText = document.createElement('span');
    titleText.textContent = 'Параметры MD3';
    title.appendChild(titleText);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ytmd3-qp-close';
    closeBtn.type = 'button';
    if (window.YTMD3Icons) closeBtn.appendChild(YTMD3Icons.createIconSvgElement('close', 18));
    closeBtn.addEventListener('click', () => {
      quickPanelOpen = false;
      panel.remove();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // RGB Sliders Section with Target Selector (Accent / Text / Buttons)
    const rgbSection = document.createElement('div');
    rgbSection.className = 'ytmd3-qp-section';

    const targetRow = document.createElement('div');
    targetRow.className = 'ytmd3-qp-targets';
    const targets = [
      { id: 'accent', label: 'Акцент' },
      { id: 'text', label: 'Текст' },
      { id: 'button', label: 'Кнопки' }
    ];
    targets.forEach(t => {
      const tb = document.createElement('button');
      tb.type = 'button';
      tb.className = 'ytmd3-qp-target-btn';
      tb.dataset.target = t.id;
      tb.textContent = t.label;
      if (t.id === quickColorTarget) tb.classList.add('is-active');
      tb.addEventListener('click', () => {
        quickColorTarget = t.id;
        syncQuickPanelControls();
      });
      targetRow.appendChild(tb);
    });
    rgbSection.appendChild(targetRow);

    const rgbLabel = document.createElement('div');
    rgbLabel.className = 'ytmd3-qp-label';
    const rgbTitle = document.createElement('span');
    rgbTitle.id = 'ytmd3-qp-rgb-title';
    rgbTitle.textContent = 'RGB ползунок';

    const rightBox = document.createElement('div');
    rightBox.style.display = 'flex';
    rightBox.style.alignItems = 'center';
    rightBox.style.gap = '6px';

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.id = 'ytmd3-qp-auto';
    autoBtn.className = 'ytmd3-qp-auto-btn';
    autoBtn.textContent = 'Авто';
    autoBtn.addEventListener('click', () => {
      if (quickColorTarget === 'text') persistPartialSettings({ customTextColor: null });
      else if (quickColorTarget === 'button') persistPartialSettings({ customButtonColor: null });
      syncQuickPanelControls();
    });

    const hexBadge = document.createElement('span');
    hexBadge.id = 'ytmd3-qp-hex';
    hexBadge.textContent = getActiveTargetHex().toUpperCase();

    rightBox.appendChild(autoBtn);
    rightBox.appendChild(hexBadge);
    rgbLabel.appendChild(rgbTitle);
    rgbLabel.appendChild(rightBox);
    rgbSection.appendChild(rgbLabel);

    const [r0, g0, b0] = YTMD3Color.hexToRgb(getActiveTargetHex());
    const channels = [
      { id: 'r', label: 'R', color: '#FF5252', val: r0 },
      { id: 'g', label: 'G', color: '#4CAF50', val: g0 },
      { id: 'b', label: 'B', color: '#448AFF', val: b0 }
    ];
    const chState = { r: r0, g: g0, b: b0 };

    channels.forEach(ch => {
      const row = document.createElement('div');
      row.className = 'ytmd3-slider-row';

      const chTag = document.createElement('span');
      chTag.className = 'ytmd3-slider-ch';
      chTag.textContent = ch.label;

      const slider = document.createElement('div');
      slider.className = 'ytmd3-m3-slider';
      slider.style.setProperty('--ytmd3-ch-color', ch.color);

      const wrap = document.createElement('div');
      wrap.className = 'ytmd3-m3-slider-track-wrap';
      const activeTrack = document.createElement('div');
      activeTrack.className = 'ytmd3-m3-slider-active';
      const handle = document.createElement('div');
      handle.className = 'ytmd3-m3-slider-handle';
      const inactiveTrack = document.createElement('div');
      inactiveTrack.className = 'ytmd3-m3-slider-inactive';
      wrap.appendChild(activeTrack);
      wrap.appendChild(handle);
      wrap.appendChild(inactiveTrack);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '255';
      input.value = String(ch.val);
      input.dataset.channel = ch.id;

      const valOut = document.createElement('span');
      valOut.className = 'ytmd3-slider-val';
      valOut.textContent = String(ch.val);

      const updateSliderVisual = v => {
        const pct = Math.max(0, Math.min(1, v / 255));
        slider.style.setProperty('--ytmd3-pct', String(pct));
        slider.classList.toggle('is-at-max', v >= 246);
        valOut.textContent = String(v);
      };
      updateSliderVisual(ch.val);

      input.addEventListener('pointerdown', () => {
        isDraggingSlider = true;
        slider.classList.add('is-dragging');
      });
      const endDrag = () => {
        isDraggingSlider = false;
        slider.classList.remove('is-dragging');
      };
      input.addEventListener('pointerup', endDrag);
      input.addEventListener('pointercancel', endDrag);
      input.addEventListener('blur', endDrag);

      input.addEventListener('input', () => {
        // Re-read current state of all 3 channels in panel to stay synced across target switches
        const pInputs = panel.querySelectorAll('input[data-channel]');
        pInputs.forEach(el => { chState[el.dataset.channel] = Number(el.value); });
        updateSliderVisual(Number(input.value));
        const nextHex = YTMD3Color.rgbToHex(chState.r, chState.g, chState.b);
        hexBadge.textContent = nextHex.toUpperCase();
        autoBtn.classList.remove('is-active');
        currentSettings = mergeSettings(Object.assign({}, currentSettings, getTargetSettingPatch(nextHex)));
        applyThemeAndFlags();
      });

      input.addEventListener('change', () => {
        const pInputs = panel.querySelectorAll('input[data-channel]');
        pInputs.forEach(el => { chState[el.dataset.channel] = Number(el.value); });
        const nextHex = YTMD3Color.rgbToHex(chState.r, chState.g, chState.b);
        persistPartialSettings(getTargetSettingPatch(nextHex));
      });

      slider.appendChild(wrap);
      slider.appendChild(input);
      row.appendChild(chTag);
      row.appendChild(slider);
      row.appendChild(valOut);
      rgbSection.appendChild(row);
    });

    panel.appendChild(rgbSection);

    // 48 Shapes Quick Selector
    const shapeSection = document.createElement('div');
    shapeSection.className = 'ytmd3-qp-section';
    const shapeLabel = document.createElement('div');
    shapeLabel.className = 'ytmd3-qp-label';
    const shapeTitle = document.createElement('span');
    shapeTitle.textContent = `Формы аватарок (${YTMD3Shapes.SHAPES.length} MD3)`;
    const curShape = YTMD3Shapes.getShapeById(currentSettings.avatarShape);
    const shapeNameSpan = document.createElement('span');
    shapeNameSpan.id = 'ytmd3-qp-shape-name';
    shapeNameSpan.textContent = curShape.nameRu;
    shapeLabel.appendChild(shapeTitle);
    shapeLabel.appendChild(shapeNameSpan);
    shapeSection.appendChild(shapeLabel);

    const grid = document.createElement('div');
    grid.className = 'ytmd3-qp-shapes';
    YTMD3Shapes.SHAPES.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ytmd3-qp-shape-btn';
      btn.dataset.shapeId = s.id;
      btn.title = s.nameRu;
      if (s.id === currentSettings.avatarShape) btn.classList.add('is-active');

      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', s.svgPath);
      svg.appendChild(p);
      btn.appendChild(svg);

      btn.addEventListener('click', () => {
        grid.querySelectorAll('.ytmd3-qp-shape-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        shapeNameSpan.textContent = s.nameRu;
        persistPartialSettings({ avatarShape: s.id, avatarMode: 'single' });
      });
      grid.appendChild(btn);
    });
    shapeSection.appendChild(grid);
    panel.appendChild(shapeSection);

    // Quick Icon Size & Rounding Sliders
    const iconSection = document.createElement('div');
    iconSection.className = 'ytmd3-qp-section';
    const iconLbl = document.createElement('div');
    iconLbl.className = 'ytmd3-qp-label';
    const iconLblTitle = document.createElement('span');
    iconLblTitle.textContent = 'Иконки (Размер и Скругление)';
    iconLbl.appendChild(iconLblTitle);
    iconSection.appendChild(iconLbl);

    const iconConfigs = [
      { key: 'iconSize', label: 'Px', min: 14, max: 28, step: 1, unit: 'px', def: 20 },
      { key: 'iconRounding', label: '◎', min: 0, max: 100, step: 5, unit: '%', def: 50 }
    ];
    iconConfigs.forEach(cfg => {
      const row = document.createElement('div');
      row.className = 'ytmd3-slider-row';
      const tag = document.createElement('span');
      tag.className = 'ytmd3-slider-ch';
      tag.textContent = cfg.label;

      const slider = document.createElement('div');
      slider.className = 'ytmd3-m3-slider';
      const wrap = document.createElement('div');
      wrap.className = 'ytmd3-m3-slider-track-wrap';
      const activeTrack = document.createElement('div');
      activeTrack.className = 'ytmd3-m3-slider-active';
      const handle = document.createElement('div');
      handle.className = 'ytmd3-m3-slider-handle';
      const inactiveTrack = document.createElement('div');
      inactiveTrack.className = 'ytmd3-m3-slider-inactive';
      wrap.appendChild(activeTrack);
      wrap.appendChild(handle);
      wrap.appendChild(inactiveTrack);

      const val0 = currentSettings[cfg.key] !== undefined ? Number(currentSettings[cfg.key]) : cfg.def;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(cfg.min);
      input.max = String(cfg.max);
      input.step = String(cfg.step);
      input.value = String(val0);
      input.dataset.iconKey = cfg.key;

      const valOut = document.createElement('span');
      valOut.className = 'ytmd3-slider-val';
      const setVis = v => {
        const pct = Math.max(0, Math.min(1, (v - cfg.min) / (cfg.max - cfg.min)));
        slider.style.setProperty('--ytmd3-pct', String(pct));
        slider.classList.toggle('is-at-max', pct >= 0.96);
        valOut.textContent = `${v}${cfg.unit}`;
      };
      setVis(val0);

      input.addEventListener('pointerdown', () => {
        isDraggingSlider = true;
        slider.classList.add('is-dragging');
      });
      const endIconDrag = () => {
        isDraggingSlider = false;
        slider.classList.remove('is-dragging');
      };
      input.addEventListener('pointerup', endIconDrag);
      input.addEventListener('pointercancel', endIconDrag);
      input.addEventListener('blur', endIconDrag);

      input.addEventListener('input', () => {
        const v = Number(input.value);
        setVis(v);
        currentSettings = mergeSettings(Object.assign({}, currentSettings, { [cfg.key]: v }));
        applyThemeAndFlags();
      });
      input.addEventListener('change', () => {
        persistPartialSettings({ [cfg.key]: Number(input.value) });
      });

      slider.appendChild(wrap);
      slider.appendChild(input);
      row.appendChild(tag);
      row.appendChild(slider);
      row.appendChild(valOut);
      iconSection.appendChild(row);
    });
    panel.appendChild(iconSection);

    hostRoot.appendChild(panel);
    syncQuickPanelControls();
  }

  function syncQuickPanelControls() {
    const panel = document.getElementById('ytmd3-quick-panel');
    if (!panel) return;

    panel.querySelectorAll('.ytmd3-qp-target-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.target === quickColorTarget);
    });

    const autoBtn = panel.querySelector('#ytmd3-qp-auto');
    if (autoBtn) {
      if (quickColorTarget === 'accent') {
        autoBtn.style.display = 'none';
      } else {
        autoBtn.style.display = 'inline-block';
        const isAuto = quickColorTarget === 'text'
          ? !YTMD3Color.isValidHex(currentSettings.customTextColor)
          : !YTMD3Color.isValidHex(currentSettings.customButtonColor);
        autoBtn.classList.toggle('is-active', isAuto);
      }
    }

    const activeHex = getActiveTargetHex();
    const hexBadge = panel.querySelector('#ytmd3-qp-hex');
    const [r, g, b] = YTMD3Color.hexToRgb(activeHex);
    const map = { r, g, b };
    if (hexBadge) hexBadge.textContent = activeHex.toUpperCase();
    panel.querySelectorAll('input[data-channel]').forEach(inp => {
      const v = map[inp.dataset.channel];
      inp.value = String(v);
      const row = inp.closest('.ytmd3-slider-row');
      if (row) {
        const slider = row.querySelector('.ytmd3-m3-slider');
        const valOut = row.querySelector('.ytmd3-slider-val');
        if (slider) {
          slider.style.setProperty('--ytmd3-pct', String(Math.max(0, Math.min(1, v / 255))));
          slider.classList.toggle('is-at-max', v >= 246);
        }
        if (valOut) valOut.textContent = String(v);
      }
    });

    const shapeName = panel.querySelector('#ytmd3-qp-shape-name');
    if (shapeName) shapeName.textContent = YTMD3Shapes.getShapeById(currentSettings.avatarShape).nameRu;
    panel.querySelectorAll('.ytmd3-qp-shape-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.shapeId === currentSettings.avatarShape);
    });

    panel.querySelectorAll('input[data-icon-key]').forEach(inp => {
      const k = inp.dataset.iconKey;
      const isSize = k === 'iconSize';
      const min = isSize ? 14 : 0;
      const max = isSize ? 28 : 100;
      const v = currentSettings[k] !== undefined ? Number(currentSettings[k]) : (isSize ? 20 : 50);
      inp.value = String(v);
      const row = inp.closest('.ytmd3-slider-row');
      if (row) {
        const slider = row.querySelector('.ytmd3-m3-slider');
        const valOut = row.querySelector('.ytmd3-slider-val');
        const pct = Math.max(0, Math.min(1, (v - min) / (max - min)));
        if (slider) {
          slider.style.setProperty('--ytmd3-pct', String(pct));
          slider.classList.toggle('is-at-max', pct >= 0.96);
        }
        if (valOut) valOut.textContent = `${v}${isSize ? 'px' : '%'}`;
      }
    });
  }

  function removeQuickStudio() {
    const fab = document.getElementById('ytmd3-fab');
    if (fab) fab.remove();
    const panel = document.getElementById('ytmd3-quick-panel');
    if (panel) panel.remove();
    quickPanelOpen = false;
  }

  /* ============================================================================
     Observers, Navigation & Lifecycle
     ============================================================================ */
  function isIgnoredMutationNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const id = node.id || '';
    if (id.startsWith('ytmd3-') || id.startsWith('ryd-')) return true;
    if (node.classList && (
      node.classList.contains('ytmd3-icon-svg') ||
      node.classList.contains('ytmd3-avatar-ring-svg') ||
      node.classList.contains('ytmd3-ripple-wave') ||
      node.classList.contains('ryd-tooltip')
    )) return true;
    return false;
  }

  function startObservers() {
    if (!domObserver && document.documentElement) {
      domObserver = new MutationObserver(mutations => {
        if (!currentSettings.enabled) return;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.target && m.target.closest && m.target.closest('#ytmd3-quick-panel, #ytmd3-fab, #ryd-bar-container, .ryd-tooltip')) {
            continue;
          }
          if (m.addedNodes && m.addedNodes.length > 0) {
            let hasRealNode = false;
            for (let j = 0; j < m.addedNodes.length; j++) {
              if (!isIgnoredMutationNode(m.addedNodes[j])) {
                hasRealNode = true;
                break;
              }
            }
            if (hasRealNode) {
              scheduleScan();
              return;
            }
          }
          if (m.type === 'attributes') {
            scheduleScan();
            return;
          }
        }
      });

      domObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-pressed', 'aria-selected', 'aria-expanded', 'active', 'aria-current']
      });
    }

    if (!themeObserver && document.documentElement) {
      themeObserver = new MutationObserver(() => {
        if (currentSettings.themeMode === 'auto') {
          applyThemeAndFlags();
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['dark', 'darker-dark-theme']
      });
    }

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq && typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', () => {
          if (currentSettings.themeMode === 'auto') applyThemeAndFlags();
        });
      }
    }

    document.addEventListener('fullscreenchange', () => {
      if (currentSettings.enabled && currentSettings.rewriteIcons && window.YTMD3Icons) {
        const fsBtn = document.querySelector('.ytp-fullscreen-button');
        if (fsBtn) YTMD3Icons.processPlayerButton(fsBtn);
      }
    });

    window.addEventListener('yt-navigate-finish', () => {
      applyThemeAndFlags();
      refreshDynamicVideoSeed();
      scheduleScan();
    });

    window.addEventListener('popstate', () => {
      applyThemeAndFlags();
      refreshDynamicVideoSeed();
      scheduleScan();
    });
  }

  function loadInitialSettings() {
    const finishLoad = raw => {
      currentSettings = mergeSettings(raw);
      applyThemeAndFlags();
      refreshDynamicVideoSeed();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          applyThemeAndFlags();
          scanDom(document);
        }, { once: true });
      } else {
        scanDom(document);
      }
    };

    try {
      chrome.storage.sync.get(STORAGE_KEY, data => {
        if (chrome.runtime.lastError || !data || !data[STORAGE_KEY]) {
          chrome.storage.local.get(STORAGE_KEY, local => {
            finishLoad(local && local[STORAGE_KEY]);
          });
        } else {
          finishLoad(data[STORAGE_KEY]);
        }
      });
    } catch (_) {
      finishLoad(null);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' || area === 'local') && changes[STORAGE_KEY]) {
      currentSettings = mergeSettings(changes[STORAGE_KEY].newValue);
      applyThemeAndFlags();
      refreshDynamicVideoSeed();
      syncQuickPanelControls();
      scheduleScan();
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'PREVIEW_SETTINGS' || msg.type === 'APPLY_SETTINGS') {
      currentSettings = mergeSettings(Object.assign({}, currentSettings, msg.payload || {}));
      applyThemeAndFlags();
      refreshDynamicVideoSeed();
      syncQuickPanelControls();
      scheduleScan();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  setupRippleListener();
  setupScrollAutoHide();
  startObservers();
  loadInitialSettings();
})();
