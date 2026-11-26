/**
 * YouTube Material 3 Expressive — Popup Controller.
 * Drives live HCT palette preview on both the popup itself and open YouTube tabs,
 * MD3 Expressive RGB sliders (for Accent / Text / Buttons), 16-shape avatar picker,
 * ad removal toggle, and icon/UI toggles.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  let settings = Object.assign({}, YTMD3Color.DEFAULT_SETTINGS);
  let saveDebounce = null;
  let activeRgbTarget = 'accent'; // 'accent' | 'text' | 'button'
  let lastPreviewShape = null;

  const $ = id => document.getElementById(id);

  function mergeSettings(raw) {
    return Object.assign({}, YTMD3Color.DEFAULT_SETTINGS, raw && typeof raw === 'object' ? raw : {});
  }

  function resolvePopupDark() {
    if (settings.themeMode === 'light') return false;
    if (settings.themeMode === 'dark') return true;
    return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
  }

  function applyPopupTheme() {
    const isDark = resolvePopupDark();
    const scheme = YTMD3Color.generateScheme({
      seedColor: settings.seedColor,
      isDark,
      schemeStyle: settings.schemeStyle,
      contrastLevel: settings.contrastLevel,
      amoled: settings.amoled
    });
    const vars = YTMD3Color.schemeToCssVariables(scheme, {
      customTextColor: settings.customTextColor,
      customButtonColor: settings.customButtonColor
    });
    const rootStyle = document.documentElement.style;
    Object.keys(vars).forEach(k => rootStyle.setProperty(k, vars[k]));
  }

  function broadcastPreview(partial) {
    try {
      chrome.tabs.query({ url: 'https://www.youtube.com/*' }, tabs => {
        if (chrome.runtime.lastError || !Array.isArray(tabs)) return;
        tabs.forEach(tab => {
          if (tab.id != null) {
            chrome.tabs.sendMessage(tab.id, { type: 'PREVIEW_SETTINGS', payload: partial }, () => {
              void chrome.runtime.lastError;
            });
          }
        });
      });
    } catch (_) {
      // Ignore if tabs permission or context unavailable
    }
  }

  function getActiveTargetHex() {
    if (activeRgbTarget === 'text') {
      return YTMD3Color.isValidHex(settings.customTextColor)
        ? settings.customTextColor
        : (resolvePopupDark() ? '#E6E0E9' : '#1D1B20');
    }
    if (activeRgbTarget === 'button') {
      return YTMD3Color.isValidHex(settings.customButtonColor)
        ? settings.customButtonColor
        : settings.seedColor;
    }
    return settings.seedColor;
  }

  function getTargetPatch(hex) {
    if (activeRgbTarget === 'text') return { customTextColor: hex };
    if (activeRgbTarget === 'button') return { customButtonColor: hex };
    return { seedColor: hex, dynamicVideoColor: false };
  }

  function updateSetting(partial, immediateSave = true) {
    settings = mergeSettings(Object.assign({}, settings, partial));
    applyPopupTheme();
    syncUi();
    broadcastPreview(partial);

    if (immediateSave) {
      clearTimeout(saveDebounce);
      chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: partial }, () => {
        void chrome.runtime.lastError;
      });
    } else {
      clearTimeout(saveDebounce);
      saveDebounce = setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: partial }, () => {
          void chrome.runtime.lastError;
        });
      }, 120);
    }
  }

  function updateSliderVisual(sliderEl, value, min, max, labelText) {
    if (!sliderEl) return;
    const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
    sliderEl.style.setProperty('--pct', String(pct));
    sliderEl.classList.toggle('is-at-max', pct >= 0.96);
    const tip = sliderEl.querySelector('.m3-slider-tooltip');
    if (tip) tip.textContent = labelText !== undefined ? labelText : String(value);
  }

  function applyPreviewAvatarShape(shape) {
    const clip = YTMD3Shapes.getClipPathCss(shape.id);
    const avatarFill = $('preview-avatar-fill');
    const avatarRing = $('preview-avatar-ring');
    const ringPath = $('preview-avatar-ring-path');
    avatarFill.style.clipPath = clip;
    avatarFill.style.webkitClipPath = clip;
    avatarRing.style.display = settings.avatarRing ? 'block' : 'none';
    ringPath.setAttribute('d', shape.svgPath);
  }

  function syncUi() {
    $('toggle-enabled').checked = settings.enabled !== false;

    const shape = YTMD3Shapes.getShapeById(settings.avatarShape);
    const avatarChanged = lastPreviewShape !== null && lastPreviewShape !== shape.id;
    lastPreviewShape = shape.id;

    if (avatarChanged) {
      const wrap = $('preview-avatar-wrap');
      wrap.classList.remove('is-morphing');
      void wrap.offsetWidth;
      wrap.classList.add('is-morphing');
      setTimeout(() => applyPreviewAvatarShape(shape), 200);
      setTimeout(() => wrap.classList.remove('is-morphing'), 560);
    } else {
      applyPreviewAvatarShape(shape);
    }

    const modeLabel = settings.avatarMode === 'mix' ? `Микс (${YTMD3Shapes.SHAPES.length} форм)` : shape.nameRu;
    $('preview-sub-label').textContent = `${modeLabel} • ${settings.seedColor.toUpperCase()}`;
    $('selected-shape-badge').textContent = modeLabel;

    // Preview card custom button / text colors
    const previewPill = document.querySelector('.preview-pill-btn');
    if (previewPill) {
      if (YTMD3Color.isValidHex(settings.customButtonColor)) {
        previewPill.style.backgroundColor = settings.customButtonColor;
        previewPill.style.color = YTMD3Color.getContrastForeground(settings.customButtonColor);
      } else {
        previewPill.style.backgroundColor = '';
        previewPill.style.color = '';
      }
    }

    // Theme mode + AMOLED + dynamic video
    document.querySelectorAll('#theme-mode-group .seg-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.theme === settings.themeMode);
    });
    $('btn-amoled').classList.toggle('is-active', Boolean(settings.amoled));
    $('btn-dynamic-video').classList.toggle('is-active', Boolean(settings.dynamicVideoColor));

    // RGB Target switcher & Auto chip
    document.querySelectorAll('#rgb-target-group .seg-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.rgbTarget === activeRgbTarget);
    });
    const autoBtn = $('btn-target-auto');
    if (activeRgbTarget === 'accent') {
      autoBtn.style.display = 'none';
    } else {
      autoBtn.style.display = 'inline-block';
      const isAuto = activeRgbTarget === 'text'
        ? !YTMD3Color.isValidHex(settings.customTextColor)
        : !YTMD3Color.isValidHex(settings.customButtonColor);
      autoBtn.classList.toggle('is-active', isAuto);
    }

    // RGB Sliders + HEX input for selected target
    const targetHex = getActiveTargetHex();
    const [r, g, b] = YTMD3Color.hexToRgb(targetHex);
    $('slider-r').value = String(r);
    $('slider-g').value = String(g);
    $('slider-b').value = String(b);
    $('val-r').textContent = String(r);
    $('val-g').textContent = String(g);
    $('val-b').textContent = String(b);
    updateSliderVisual(document.querySelector('[data-channel="r"]'), r, 0, 255);
    updateSliderVisual(document.querySelector('[data-channel="g"]'), g, 0, 255);
    updateSliderVisual(document.querySelector('[data-channel="b"]'), b, 0, 255);

    if (document.activeElement !== $('hex-input')) {
      $('hex-input').value = targetHex.toUpperCase();
    }
    $('rgb-preview-dot').style.background = targetHex;

    // Presets
    document.querySelectorAll('.preset-dot').forEach(dot => {
      dot.classList.toggle('is-active', dot.dataset.seed.toLowerCase() === targetHex.toLowerCase());
    });

    // Scheme & Contrast
    document.querySelectorAll('#scheme-style-group .filter-chip').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.scheme === settings.schemeStyle);
    });
    document.querySelectorAll('#contrast-group .seg-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.contrast === settings.contrastLevel);
    });

    // Avatar mode & 16 shapes grid
    document.querySelectorAll('#avatar-mode-group .seg-btn').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.amode === settings.avatarMode);
    });
    document.querySelectorAll('.shape-tile').forEach(tile => {
      tile.classList.toggle('is-active', tile.dataset.shapeId === settings.avatarShape);
    });

    $('toggle-avatar-comments').checked = settings.avatarApplyComments !== false;
    $('toggle-avatar-channels').checked = settings.avatarApplyChannels !== false;
    $('toggle-avatar-self').checked = Boolean(settings.avatarIncludeSelf);
    $('toggle-avatar-ring').checked = Boolean(settings.avatarRing);
    $('toggle-avatar-spring').checked = Boolean(settings.avatarHoverSpring);

    // Icons & Interface
    $('toggle-rewrite-icons').checked = settings.rewriteIcons !== false;
    $('toggle-accent-logo').checked = Boolean(settings.accentLogo);
    $('toggle-tonal-cards').checked = Boolean(settings.tonalCards);
    $('toggle-md3-player').checked = Boolean(settings.md3Player);
    $('toggle-md3-font').checked = Boolean(settings.md3Font);
    $('toggle-ripple').checked = Boolean(settings.rippleEffect);
    $('toggle-block-ads').checked = settings.blockAds !== false;
    $('toggle-floating-studio').checked = Boolean(settings.floatingStudio);

    const iconSize = Math.max(14, Math.min(28, Number(settings.iconSize) || 20));
    $('slider-icon-size').value = String(iconSize);
    $('val-icon-size').textContent = `${iconSize}px`;
    updateSliderVisual($('icon-size-slider'), iconSize, 14, 28, `${iconSize}px`);

    const iconRound = Math.max(0, Math.min(100, settings.iconRounding !== undefined ? Number(settings.iconRounding) : 50));
    $('slider-icon-round').value = String(iconRound);
    $('val-icon-round').textContent = `${iconRound}%`;
    updateSliderVisual($('icon-round-slider'), iconRound, 0, 100, `${iconRound}%`);

    // Reflect icon size & rounding in popup showcase strip
    const strokeW = iconRound > 20 ? Math.round((iconRound - 20) * 0.42) : 0;
    document.querySelectorAll('#icons-showcase svg').forEach(svg => {
      svg.style.width = `${iconSize}px`;
      svg.style.height = `${iconSize}px`;
      const p = svg.querySelector('path');
      if (p) {
        p.style.stroke = 'currentColor';
        p.style.strokeWidth = String(strokeW);
        p.style.strokeLinejoin = 'round';
        p.style.strokeLinecap = 'round';
        p.style.paintOrder = 'stroke fill';
      }
    });

    const scaleVal = Math.round((Number(settings.shapeScale) || 1) * 100);
    const scaleLabel = `${(scaleVal / 100).toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1')}×`;
    $('slider-shape-scale').value = String(scaleVal);
    $('val-scale').textContent = scaleLabel;
    $('shape-scale-val').textContent = scaleLabel;
    updateSliderVisual($('shape-scale-slider'), scaleVal, 50, 150, scaleLabel);
  }

  function hydrateIcons() {
    $('brand-badge').appendChild(YTMD3Icons.createIconSvgElement('palette', 20));
    $('master-thumb-icon').appendChild(YTMD3Icons.createIconSvgElement('check', 14));
    $('preview-icon-like').appendChild(YTMD3Icons.createIconSvgElement('thumb_up', 15));
    $('preview-icon-chat').appendChild(YTMD3Icons.createIconSvgElement('chat_bubble', 15));
    $('preview-icon-share').appendChild(YTMD3Icons.createIconSvgElement('share', 15));

    const tabDefs = [
      { id: 'tab-btn-palette', icon: 'palette', text: 'Палитра' },
      { id: 'tab-btn-avatars', icon: 'interests', text: '48 Форм' },
      { id: 'tab-btn-interface', icon: 'sliders', text: 'Дизайн' }
    ];
    tabDefs.forEach(t => {
      const btn = $(t.id);
      btn.appendChild(YTMD3Icons.createIconSvgElement(t.icon, 16));
      const sp = document.createElement('span');
      sp.textContent = t.text;
      btn.appendChild(sp);
    });

    const showcase = $('icons-showcase');
    ['home-fill', 'bolt-fill', 'subscriptions-fill', 'thumb_up-fill', 'notifications_active-fill', 'play_arrow-fill', 'settings']
      .forEach(key => showcase.appendChild(YTMD3Icons.createIconSvgElement(key, 20)));

    const resetBtn = $('btn-reset');
    resetBtn.appendChild(YTMD3Icons.createIconSvgElement('restart_alt', 18));
    const resetLabel = document.createElement('span');
    resetLabel.textContent = 'Сбросить настройки MD3';
    resetBtn.appendChild(resetLabel);
  }

  function buildPresets() {
    const wrap = $('preset-dots');
    YTMD3Color.COLOR_PRESETS.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-dot';
      btn.dataset.seed = p.seed;
      btn.style.backgroundColor = p.seed;
      btn.title = p.name;
      btn.addEventListener('click', () => {
        updateSetting(getTargetPatch(p.seed));
      });
      wrap.appendChild(btn);
    });
  }

  function build16ShapesGrid() {
    const grid = $('shapes-grid');
    YTMD3Shapes.SHAPES.forEach(s => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'shape-tile';
      tile.dataset.shapeId = s.id;
      tile.title = `${s.nameRu} (${s.materialName})`;

      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', s.svgPath);
      svg.appendChild(path);

      const label = document.createElement('span');
      label.textContent = s.nameRu;

      tile.appendChild(svg);
      tile.appendChild(label);
      tile.addEventListener('click', () => {
        updateSetting({ avatarShape: s.id, avatarMode: 'single' });
      });
      grid.appendChild(tile);
    });
  }

  function bindEvents() {
    document.querySelectorAll('.m3-tab').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const target = tabBtn.dataset.tab;
        document.querySelectorAll('.m3-tab').forEach(b => {
          const active = b === tabBtn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
          panel.classList.toggle('is-active', panel.dataset.panel === target);
        });
      });
    });

    $('toggle-enabled').addEventListener('change', e => updateSetting({ enabled: e.target.checked }));

    document.querySelectorAll('#theme-mode-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => updateSetting({ themeMode: btn.dataset.theme }));
    });
    $('btn-amoled').addEventListener('click', () => updateSetting({ amoled: !settings.amoled }));
    $('btn-dynamic-video').addEventListener('click', () => updateSetting({ dynamicVideoColor: !settings.dynamicVideoColor }));

    // RGB Target switcher & Auto button
    document.querySelectorAll('#rgb-target-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeRgbTarget = btn.dataset.rgbTarget;
        syncUi();
      });
    });
    $('btn-target-auto').addEventListener('click', () => {
      if (activeRgbTarget === 'text') updateSetting({ customTextColor: null });
      else if (activeRgbTarget === 'button') updateSetting({ customButtonColor: null });
    });

    const onRgbInput = isFinal => {
      const r = Number($('slider-r').value);
      const g = Number($('slider-g').value);
      const b = Number($('slider-b').value);
      const hex = YTMD3Color.rgbToHex(r, g, b);
      updateSetting(getTargetPatch(hex), isFinal);
    };

    document.querySelectorAll('.m3-expressive-slider').forEach(slider => {
      const inp = slider.querySelector('input[type="range"]');
      if (!inp) return;
      inp.addEventListener('pointerdown', () => slider.classList.add('is-dragging'));
      inp.addEventListener('pointerup', () => slider.classList.remove('is-dragging'));
      inp.addEventListener('pointercancel', () => slider.classList.remove('is-dragging'));
      inp.addEventListener('blur', () => slider.classList.remove('is-dragging'));
    });

    ['slider-r', 'slider-g', 'slider-b'].forEach(id => {
      $(id).addEventListener('input', () => onRgbInput(false));
      $(id).addEventListener('change', () => onRgbInput(true));
    });

    $('hex-input').addEventListener('input', e => {
      const raw = e.target.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
        updateSetting(getTargetPatch(raw.toLowerCase()));
      }
    });

    document.querySelectorAll('#scheme-style-group .filter-chip').forEach(btn => {
      btn.addEventListener('click', () => updateSetting({ schemeStyle: btn.dataset.scheme }));
    });
    document.querySelectorAll('#contrast-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => updateSetting({ contrastLevel: btn.dataset.contrast }));
    });

    document.querySelectorAll('#avatar-mode-group .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => updateSetting({ avatarMode: btn.dataset.amode }));
    });
    $('toggle-avatar-comments').addEventListener('change', e => updateSetting({ avatarApplyComments: e.target.checked }));
    $('toggle-avatar-channels').addEventListener('change', e => updateSetting({ avatarApplyChannels: e.target.checked }));
    $('toggle-avatar-self').addEventListener('change', e => updateSetting({ avatarIncludeSelf: e.target.checked }));
    $('toggle-avatar-ring').addEventListener('change', e => updateSetting({ avatarRing: e.target.checked }));
    $('toggle-avatar-spring').addEventListener('change', e => updateSetting({ avatarHoverSpring: e.target.checked }));

    $('toggle-rewrite-icons').addEventListener('change', e => updateSetting({ rewriteIcons: e.target.checked }));
    $('toggle-accent-logo').addEventListener('change', e => updateSetting({ accentLogo: e.target.checked }));
    $('toggle-tonal-cards').addEventListener('change', e => updateSetting({ tonalCards: e.target.checked }));
    $('toggle-md3-player').addEventListener('change', e => updateSetting({ md3Player: e.target.checked }));
    $('toggle-md3-font').addEventListener('change', e => updateSetting({ md3Font: e.target.checked }));
    $('toggle-ripple').addEventListener('change', e => updateSetting({ rippleEffect: e.target.checked }));
    $('toggle-block-ads').addEventListener('change', e => updateSetting({ blockAds: e.target.checked }));
    $('toggle-floating-studio').addEventListener('change', e => updateSetting({ floatingStudio: e.target.checked }));

    $('slider-icon-size').addEventListener('input', e => {
      updateSetting({ iconSize: Number(e.target.value) }, false);
    });
    $('slider-icon-size').addEventListener('change', e => {
      updateSetting({ iconSize: Number(e.target.value) }, true);
    });

    $('slider-icon-round').addEventListener('input', e => {
      updateSetting({ iconRounding: Number(e.target.value) }, false);
    });
    $('slider-icon-round').addEventListener('change', e => {
      updateSetting({ iconRounding: Number(e.target.value) }, true);
    });

    $('slider-shape-scale').addEventListener('input', e => {
      updateSetting({ shapeScale: Number(e.target.value) / 100 }, false);
    });
    $('slider-shape-scale').addEventListener('change', e => {
      updateSetting({ shapeScale: Number(e.target.value) / 100 }, true);
    });

    $('btn-reset').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'RESET_SETTINGS' }, resp => {
        if (resp && resp.settings) {
          settings = mergeSettings(resp.settings);
          activeRgbTarget = 'accent';
          applyPopupTheme();
          syncUi();
          broadcastPreview(settings);
        }
      });
    });
  }

  function init() {
    hydrateIcons();
    buildPresets();
    build16ShapesGrid();
    bindEvents();

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, resp => {
      if (resp && resp.settings) {
        settings = mergeSettings(resp.settings);
      }
      applyPopupTheme();
      syncUi();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
