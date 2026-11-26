/**
 * Material Design 3 (Material You) Perceptual Tonal Palette & Color Role Engine.
 * Uses OKLab hue/chroma constancy paired with exact CIE relative-luminance Tone [0..100]
 * mapping and sRGB gamut binary clamping to compute all M3 color roles.
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    themeMode: 'auto',         // 'auto' | 'dark' | 'light'
    seedColor: '#6750A4',
    customTextColor: null,     // null (auto MD3) | '#RRGGBB'
    customButtonColor: null,   // null (auto MD3) | '#RRGGBB'
    schemeStyle: 'tonalSpot',  // 'tonalSpot' | 'vibrant' | 'expressive' | 'fidelity' | 'monochrome'
    contrastLevel: 'standard', // 'standard' | 'medium' | 'high'
    amoled: false,
    dynamicVideoColor: false,
    blockAds: true,
    avatarShape: 'square',
    avatarMode: 'single',      // 'single' | 'mix'
    avatarApplyComments: true,
    avatarApplyChannels: true,
    avatarRing: true,
    avatarHoverSpring: true,
    avatarIncludeSelf: true,
    rewriteIcons: true,
    iconSize: 20,
    iconRounding: 50,
    tonalCards: true,
    shapeScale: 1.0,
    md3Font: true,
    rippleEffect: true,
    accentLogo: true,
    md3Player: true,
    floatingStudio: true
  });

  const COLOR_PRESETS = Object.freeze([
    { id: 'm3-purple',  name: 'Material Purple',  seed: '#6750A4' },
    { id: 'yt-crimson', name: 'YouTube Crimson',  seed: '#D93829' },
    { id: 'pixel-blue', name: 'Pixel Ocean',      seed: '#1B6EF3' },
    { id: 'sage-green', name: 'Forest Sage',      seed: '#146C2E' },
    { id: 'amber-sun',  name: 'Amber Sunset',     seed: '#C4511B' },
    { id: 'rose-pink',  name: 'Expressive Rose',  seed: '#B81D5B' },
    { id: 'teal-cyan',  name: 'Teal Cyan',        seed: '#006A6A' },
    { id: 'slate-mono', name: 'Neutral Slate',    seed: '#5F5E62' }
  ]);

  const schemeCache = new Map();

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    c = clamp01(c);
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(clamp01(v) * 255);
  }

  function hexToRgb(hex) {
    const clean = String(hex || '#6750A4').trim().replace(/^#/, '');
    const full = clean.length === 3
      ? clean.split('').map(ch => ch + ch).join('')
      : clean.padEnd(6, '0').slice(0, 6);
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return [103, 80, 164];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  function hexToRgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Linear sRGB -> OKLab
  function linearRgbToOklab(r, g, b) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }

  // OKLab -> Linear sRGB
  function oklabToLinearRgb(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ];
  }

  function inSrgbGamut(r, g, b) {
    return r >= -1e-4 && r <= 1.0001 && g >= -1e-4 && g <= 1.0001 && b >= -1e-4 && b <= 1.0001;
  }

  function relativeLuminance(r, g, b) {
    return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
  }

  // MD3 Tone [0..100] -> exact CIE Y relative luminance
  function toneToLuminance(tone) {
    const t = Math.max(0, Math.min(100, tone));
    return t <= 8 ? t / 903.296296 : Math.pow((t + 16) / 116, 3);
  }

  function hexToOklch(hex) {
    const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
    const [L, oa, ob] = linearRgbToOklab(r, g, b);
    const C = Math.hypot(oa, ob);
    let H = (Math.atan2(ob, oa) * 180) / Math.PI;
    if (H < 0) H += 360;
    return { L, C, H };
  }

  /**
   * Computes a gamut-clamped sRGB hex color for a given OKLCH Hue (deg),
   * target Chroma, and MD3 Tone [0..100].
   */
  function hctToneToHex(hueDeg, targetChroma, tone) {
    if (tone <= 0.1) return '#000000';
    if (tone >= 99.9) return '#ffffff';

    const rad = (hueDeg * Math.PI) / 180;
    const cosH = Math.cos(rad);
    const sinH = Math.sin(rad);
    const targetY = toneToLuminance(tone);

    // Clamp chroma at candidate L_ok so the color fits inside the sRGB cube
    function fitChroma(L_ok) {
      let rgb = oklabToLinearRgb(L_ok, targetChroma * cosH, targetChroma * sinH);
      if (inSrgbGamut(rgb[0], rgb[1], rgb[2])) return rgb;
      let lo = 0;
      let hi = targetChroma;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) * 0.5;
        const test = oklabToLinearRgb(L_ok, mid * cosH, mid * sinH);
        if (inSrgbGamut(test[0], test[1], test[2])) lo = mid;
        else hi = mid;
      }
      return oklabToLinearRgb(L_ok, lo * cosH, lo * sinH);
    }

    // Binary search L_ok in [0, 1] to match exact CIE targetY
    let loL = 0;
    let hiL = 1;
    let bestRgb = [0, 0, 0];
    for (let i = 0; i < 16; i++) {
      const midL = (loL + hiL) * 0.5;
      const rgb = fitChroma(midL);
      const y = relativeLuminance(rgb[0], rgb[1], rgb[2]);
      bestRgb = rgb;
      if (y < targetY) loL = midL;
      else hiL = midL;
    }

    return rgbToHex(
      linearToSrgb(bestRgb[0]),
      linearToSrgb(bestRgb[1]),
      linearToSrgb(bestRgb[2])
    );
  }

  function wrapHue(h) {
    return ((h % 360) + 360) % 360;
  }

  function buildPalettes(seedHex, schemeStyle) {
    const seed = hexToOklch(seedHex);
    const H = seed.H;
    const baseC = seed.C;

    if (schemeStyle === 'monochrome' || baseC < 0.015) {
      return {
        primary:        t => hctToneToHex(H, 0.008, t),
        secondary:      t => hctToneToHex(H, 0.006, t),
        tertiary:       t => hctToneToHex(H, 0.012, t),
        neutral:        t => hctToneToHex(H, 0.004, t),
        neutralVariant: t => hctToneToHex(H, 0.006, t),
        error:          t => hctToneToHex(27, 0.175, t)
      };
    }

    if (schemeStyle === 'vibrant') {
      return {
        primary:        t => hctToneToHex(H, Math.max(baseC, 0.17), t),
        secondary:      t => hctToneToHex(wrapHue(H + 10), 0.085, t),
        tertiary:       t => hctToneToHex(wrapHue(H + 45), 0.125, t),
        neutral:        t => hctToneToHex(H, 0.018, t),
        neutralVariant: t => hctToneToHex(H, 0.032, t),
        error:          t => hctToneToHex(27, 0.19, t)
      };
    }

    if (schemeStyle === 'expressive') {
      return {
        primary:        t => hctToneToHex(wrapHue(H + 15), Math.max(baseC, 0.155), t),
        secondary:      t => hctToneToHex(wrapHue(H - 120), 0.075, t),
        tertiary:       t => hctToneToHex(wrapHue(H + 120), 0.12, t),
        neutral:        t => hctToneToHex(wrapHue(H + 15), 0.016, t),
        neutralVariant: t => hctToneToHex(wrapHue(H + 15), 0.030, t),
        error:          t => hctToneToHex(27, 0.185, t)
      };
    }

    if (schemeStyle === 'fidelity') {
      return {
        primary:        t => hctToneToHex(H, Math.max(baseC, 0.18), t),
        secondary:      t => hctToneToHex(H, Math.max(baseC * 0.48, 0.06), t),
        tertiary:       t => hctToneToHex(wrapHue(H + 35), Math.max(baseC * 0.72, 0.10), t),
        neutral:        t => hctToneToHex(H, 0.015, t),
        neutralVariant: t => hctToneToHex(H, 0.028, t),
        error:          t => hctToneToHex(27, 0.185, t)
      };
    }

    // Default: Official MD3 Tonal Spot
    return {
      primary:        t => hctToneToHex(H, Math.max(Math.min(baseC, 0.19), 0.125), t),
      secondary:      t => hctToneToHex(H, 0.052, t),
      tertiary:       t => hctToneToHex(wrapHue(H + 60), 0.085, t),
      neutral:        t => hctToneToHex(H, 0.013, t),
      neutralVariant: t => hctToneToHex(H, 0.025, t),
      error:          t => hctToneToHex(27, 0.18, t)
    };
  }

  /**
   * Computes complete Material Design 3 Color Roles for Light or Dark mode.
   */
  function generateScheme(options = {}) {
    const seedColor = options.seedColor || DEFAULT_SETTINGS.seedColor;
    const isDark = options.isDark !== undefined ? Boolean(options.isDark) : true;
    const schemeStyle = options.schemeStyle || 'tonalSpot';
    const contrastLevel = options.contrastLevel || 'standard';
    const amoled = Boolean(options.amoled);

    const cacheKey = `${seedColor}|${isDark}|${schemeStyle}|${contrastLevel}|${amoled}`;
    if (schemeCache.has(cacheKey)) {
      return schemeCache.get(cacheKey);
    }

    const p = buildPalettes(seedColor, schemeStyle);
    const cBoost = contrastLevel === 'high' ? 1 : contrastLevel === 'medium' ? 0.5 : 0;

    let roles;
    if (isDark) {
      const surfT = amoled ? 0 : 6;
      const lowestT = amoled ? 0 : 4;
      const lowT = amoled ? 5 : 10;
      const baseT = amoled ? 8 : 12;
      const highT = amoled ? 12 : 17;
      const highestT = amoled ? 16 : 22;
      const primaryT = schemeStyle === 'fidelity' ? 74 + 6 * cBoost : 80 + 6 * cBoost;

      roles = {
        primary: p.primary(primaryT),
        onPrimary: p.primary(20 - 12 * cBoost),
        primaryContainer: p.primary(32 + 6 * cBoost),
        onPrimaryContainer: p.primary(90 + 6 * cBoost),

        secondary: p.secondary(80 + 6 * cBoost),
        onSecondary: p.secondary(20 - 12 * cBoost),
        secondaryContainer: p.secondary(30 + 6 * cBoost),
        onSecondaryContainer: p.secondary(90 + 6 * cBoost),

        tertiary: p.tertiary(80 + 6 * cBoost),
        onTertiary: p.tertiary(20 - 12 * cBoost),
        tertiaryContainer: p.tertiary(30 + 6 * cBoost),
        onTertiaryContainer: p.tertiary(90 + 6 * cBoost),

        error: p.error(80 + 6 * cBoost),
        onError: p.error(20 - 12 * cBoost),
        errorContainer: p.error(30 + 6 * cBoost),
        onErrorContainer: p.error(90 + 6 * cBoost),

        background: p.neutral(surfT),
        onBackground: p.neutral(90 + 8 * cBoost),
        surface: p.neutral(surfT),
        onSurface: p.neutral(90 + 8 * cBoost),
        surfaceDim: p.neutral(surfT),
        surfaceBright: p.neutral(24 + 4 * cBoost),

        surfaceContainerLowest: p.neutral(lowestT),
        surfaceContainerLow: p.neutral(lowT),
        surfaceContainer: p.neutral(baseT),
        surfaceContainerHigh: p.neutral(highT),
        surfaceContainerHighest: p.neutral(highestT),

        surfaceVariant: p.neutralVariant(30),
        onSurfaceVariant: p.neutralVariant(80 + 10 * cBoost),
        outline: p.neutralVariant(60 + 14 * cBoost),
        outlineVariant: p.neutralVariant(30 + 14 * cBoost),

        inverseSurface: p.neutral(90),
        inverseOnSurface: p.neutral(20),
        inversePrimary: p.primary(40),
        scrim: '#000000',
        shadow: '#000000'
      };
    } else {
      roles = {
        primary: p.primary(40 - 14 * cBoost),
        onPrimary: p.primary(100),
        primaryContainer: p.primary(90 - 8 * cBoost),
        onPrimaryContainer: p.primary(10 - 6 * cBoost),

        secondary: p.secondary(40 - 14 * cBoost),
        onSecondary: p.secondary(100),
        secondaryContainer: p.secondary(90 - 8 * cBoost),
        onSecondaryContainer: p.secondary(10 - 6 * cBoost),

        tertiary: p.tertiary(40 - 14 * cBoost),
        onTertiary: p.tertiary(100),
        tertiaryContainer: p.tertiary(90 - 8 * cBoost),
        onTertiaryContainer: p.tertiary(10 - 6 * cBoost),

        error: p.error(40 - 14 * cBoost),
        onError: p.error(100),
        errorContainer: p.error(90 - 8 * cBoost),
        onErrorContainer: p.error(10 - 6 * cBoost),

        background: p.neutral(98),
        onBackground: p.neutral(10 - 6 * cBoost),
        surface: p.neutral(98),
        onSurface: p.neutral(10 - 6 * cBoost),
        surfaceDim: p.neutral(87 - 6 * cBoost),
        surfaceBright: p.neutral(98),

        surfaceContainerLowest: p.neutral(100),
        surfaceContainerLow: p.neutral(96),
        surfaceContainer: p.neutral(94),
        surfaceContainerHigh: p.neutral(92),
        surfaceContainerHighest: p.neutral(90),

        surfaceVariant: p.neutralVariant(90),
        onSurfaceVariant: p.neutralVariant(30 - 12 * cBoost),
        outline: p.neutralVariant(50 - 18 * cBoost),
        outlineVariant: p.neutralVariant(80 - 20 * cBoost),

        inverseSurface: p.neutral(20),
        inverseOnSurface: p.neutral(95),
        inversePrimary: p.primary(80),
        scrim: '#000000',
        shadow: '#000000'
      };
    }

    const result = {
      isDark,
      seedColor,
      schemeStyle,
      roles
    };
    schemeCache.set(cacheKey, result);
    if (schemeCache.size > 40) {
      const firstKey = schemeCache.keys().next().value;
      schemeCache.delete(firstKey);
    }
    return result;
  }

  function isValidHex(hex) {
    return typeof hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(hex.trim());
  }

  function getContrastForeground(hex) {
    const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
    const y = relativeLuminance(r, g, b);
    return y > 0.34 ? '#111116' : '#FFFFFF';
  }

  /**
   * Produces CSS custom property map for MD3 system tokens + YouTube --yt-spec-* tokens.
   */
  function schemeToCssVariables(scheme, overrides = {}) {
    const r = scheme.roles;
    const isDark = scheme.isDark;
    const rawText = overrides.customTextColor;
    const rawBtn = overrides.customButtonColor;
    const hasCustomText = isValidHex(rawText);
    const hasCustomBtn = isValidHex(rawBtn);

    const textPrimary = hasCustomText ? rawText.trim() : r.onSurface;
    const textSecondary = hasCustomText ? hexToRgba(textPrimary, 0.72) : r.onSurfaceVariant;
    const buttonBg = hasCustomBtn ? rawBtn.trim() : r.surfaceContainerHigh;
    const buttonFg = hasCustomBtn ? getContrastForeground(buttonBg) : textPrimary;
    const buttonHoverBg = hasCustomBtn ? hexToRgba(buttonBg, 0.84) : r.surfaceContainerHighest;

    const iconSize = Math.max(14, Math.min(28, Number(overrides.iconSize) || 20));
    const iconRounding = Math.max(0, Math.min(100, overrides.iconRounding !== undefined ? Number(overrides.iconRounding) : 50));
    const iconRadiusPct = Math.round(iconRounding * 0.5);
    const iconStrokeWidth = iconRounding > 20 ? Math.round((iconRounding - 20) * 0.42) : 0;

    const [pr, pg, pb] = hexToRgb(r.primary);
    const [sr, sg, sb] = hexToRgb(r.surface);
    const [osr, osg, osb] = hexToRgb(textPrimary);

    return {
      // Official MD3 System Color Tokens
      '--md-sys-color-primary': r.primary,
      '--md-sys-color-primary-rgb': `${pr}, ${pg}, ${pb}`,
      '--md-sys-color-on-primary': r.onPrimary,
      '--md-sys-color-primary-container': r.primaryContainer,
      '--md-sys-color-on-primary-container': r.onPrimaryContainer,
      '--md-sys-color-secondary': r.secondary,
      '--md-sys-color-on-secondary': r.onSecondary,
      '--md-sys-color-secondary-container': r.secondaryContainer,
      '--md-sys-color-on-secondary-container': r.onSecondaryContainer,
      '--md-sys-color-tertiary': r.tertiary,
      '--md-sys-color-on-tertiary': r.onTertiary,
      '--md-sys-color-tertiary-container': r.tertiaryContainer,
      '--md-sys-color-on-tertiary-container': r.onTertiaryContainer,
      '--md-sys-color-error': r.error,
      '--md-sys-color-on-error': r.onError,
      '--md-sys-color-error-container': r.errorContainer,
      '--md-sys-color-on-error-container': r.onErrorContainer,
      '--md-sys-color-background': r.background,
      '--md-sys-color-on-background': textPrimary,
      '--md-sys-color-surface': r.surface,
      '--md-sys-color-surface-rgb': `${sr}, ${sg}, ${sb}`,
      '--md-sys-color-on-surface': textPrimary,
      '--md-sys-color-on-surface-rgb': `${osr}, ${osg}, ${osb}`,
      '--md-sys-color-surface-dim': r.surfaceDim,
      '--md-sys-color-surface-bright': r.surfaceBright,
      '--md-sys-color-surface-container-lowest': r.surfaceContainerLowest,
      '--md-sys-color-surface-container-low': r.surfaceContainerLow,
      '--md-sys-color-surface-container': r.surfaceContainer,
      '--md-sys-color-surface-container-high': r.surfaceContainerHigh,
      '--md-sys-color-surface-container-highest': r.surfaceContainerHighest,
      '--md-sys-color-surface-variant': r.surfaceVariant,
      '--md-sys-color-on-surface-variant': textSecondary,
      '--md-sys-color-outline': r.outline,
      '--md-sys-color-outline-variant': r.outlineVariant,
      '--md-sys-color-inverse-surface': r.inverseSurface,
      '--md-sys-color-inverse-on-surface': r.inverseOnSurface,
      '--md-sys-color-inverse-primary': r.inversePrimary,

      // Custom Text, Button & Icon Tokens
      '--ytmd3-text-primary': textPrimary,
      '--ytmd3-text-secondary': textSecondary,
      '--ytmd3-button-bg': buttonBg,
      '--ytmd3-button-fg': buttonFg,
      '--ytmd3-button-hover-bg': buttonHoverBg,
      '--ytmd3-icon-size': `${iconSize}px`,
      '--ytmd3-icon-radius': `${iconRadiusPct}%`,
      '--ytmd3-icon-stroke': String(iconStrokeWidth),

      // MD3 State Layers
      '--md-sys-state-hover': hexToRgba(textPrimary, 0.08),
      '--md-sys-state-focus': hexToRgba(textPrimary, 0.12),
      '--md-sys-state-pressed': hexToRgba(textPrimary, 0.14),
      '--md-sys-state-primary-hover': hexToRgba(r.primary, 0.10),
      '--md-sys-state-primary-pressed': hexToRgba(r.primary, 0.16),

      // YouTube Internal Design Tokens (--yt-spec-*) mapped to MD3
      '--yt-spec-base-background': r.surface,
      '--yt-spec-raised-background': r.surfaceContainerHigh,
      '--yt-spec-menu-background': r.surfaceContainerHigh,
      '--yt-spec-inverted-background': r.inverseSurface,
      '--yt-spec-additive-background': hexToRgba(textPrimary, isDark ? 0.08 : 0.06),
      '--yt-spec-outline': r.outlineVariant,
      '--yt-spec-outline-inverse': r.inverseOnSurface,

      '--yt-spec-general-background-a': r.surface,
      '--yt-spec-general-background-b': r.surfaceContainerLow,
      '--yt-spec-general-background-c': r.surfaceContainer,

      '--yt-spec-brand-background-solid': r.surfaceContainerLow,
      '--yt-spec-brand-background-primary': hexToRgba(r.surfaceContainerLow, 0.96),
      '--yt-spec-brand-background-secondary': hexToRgba(r.surfaceContainer, 0.95),
      '--yt-spec-frosted-glass-desktop': hexToRgba(r.surfaceContainerLow, 0.88),
      '--yt-spec-frosted-glass-mobile': hexToRgba(r.surfaceContainerLow, 0.90),

      '--yt-spec-text-primary': textPrimary,
      '--yt-spec-text-secondary': textSecondary,
      '--yt-spec-text-disabled': hexToRgba(textPrimary, 0.38),
      '--yt-spec-text-primary-inverse': r.inverseOnSurface,
      '--yt-spec-text-link': r.primary,

      '--yt-spec-call-to-action': r.primary,
      '--yt-spec-call-to-action-hover': r.primaryContainer,
      '--yt-spec-call-to-action-inverse': r.inversePrimary,
      '--yt-spec-suggested-action': r.secondaryContainer,
      '--yt-spec-suggested-action-inverse': r.primaryContainer,

      '--yt-spec-icon-active-other': textPrimary,
      '--yt-spec-icon-inactive': textSecondary,
      '--yt-spec-icon-disabled': hexToRgba(textPrimary, 0.38),
      '--yt-spec-brand-icon-active': r.primary,
      '--yt-spec-brand-icon-inactive': textSecondary,

      '--yt-spec-brand-button-background': hasCustomBtn ? buttonBg : r.primary,
      '--yt-spec-brand-button-background-hover': hasCustomBtn ? buttonHoverBg : r.primaryContainer,
      '--yt-spec-filled-button-text': hasCustomBtn ? buttonFg : r.onPrimary,
      '--yt-spec-filled-button-focus-outline': r.primary,
      '--yt-spec-mono-filled-bg': hasCustomBtn ? buttonBg : r.primary,
      '--yt-spec-mono-filled-text': hasCustomBtn ? buttonFg : r.onPrimary,
      '--yt-spec-mono-filled-hover': hasCustomBtn ? buttonHoverBg : r.primaryContainer,
      '--yt-spec-mono-tonal-bg': buttonBg,
      '--yt-spec-mono-tonal-hover': buttonHoverBg,
      '--yt-spec-mono-tonal-hover-inverse': hexToRgba(r.inverseOnSurface, 0.16),

      '--yt-spec-badge-chip-background': buttonBg,
      '--yt-spec-button-chip-background-hover': buttonHoverBg,
      '--yt-spec-chip-background-selected': r.secondaryContainer,
      '--yt-spec-chip-text-selected': r.onSecondaryContainer,
      '--yt-spec-touch-response': hexToRgba(r.primary, 0.16),
      '--yt-spec-touch-response-inverse': hexToRgba(r.inversePrimary, 0.2),
      '--yt-spec-selected-nav-background': r.secondaryContainer,
      '--yt-spec-10-percent-layer': r.outlineVariant,

      '--yt-spec-themed-blue': r.primary,
      '--yt-spec-themed-green': r.tertiary,
      '--yt-spec-static-brand-red': r.primary,
      '--yt-spec-static-brand-gradient-linear': `linear-gradient(90deg, ${r.primary} 0%, ${r.tertiary} 100%)`,
      '--yt-spec-brand-subscribe-button-background': hasCustomBtn ? buttonBg : r.primary,
      '--yt-spec-brand-subscribe-button-text': hasCustomBtn ? buttonFg : r.onPrimary,
      '--yt-spec-commerce-tonal-hover': r.tertiaryContainer,
      '--yt-spec-error-indicator': r.error,
      '--yt-spec-wordmark-text': textPrimary,
      '--yt-spec-assistive-feed-themed-gradient-1': hexToRgba(r.primaryContainer, 0.45),
      '--yt-spec-assistive-feed-themed-gradient-2': hexToRgba(r.secondaryContainer, 0.35),
      '--yt-spec-assistive-feed-themed-gradient-3': hexToRgba(r.tertiaryContainer, 0.25),

      '--ytd-searchbox-background': r.surfaceContainerHigh,
      '--ytd-searchbox-legacy-button-color': buttonBg,
      '--ytd-searchbox-legacy-button-border-color': r.outlineVariant,
      '--ytd-searchbox-text-color': textPrimary,
      '--paper-toggle-button-checked-button-color': r.primary,
      '--paper-toggle-button-checked-bar-color': hexToRgba(r.primary, 0.5),
      '--paper-slider-active-color': r.primary,
      '--paper-slider-knob-color': r.primary
    };
  }

  /**
   * Extracts a vibrant seed hex color from raw RGBA pixel buffer (e.g., 24x24 video/thumbnail sample).
   */
  function extractVibrantSeedFromPixels(rgbaData) {
    if (!rgbaData || rgbaData.length < 4) return null;
    const buckets = new Map();
    for (let i = 0; i < rgbaData.length; i += 4) {
      const r = rgbaData[i];
      const g = rgbaData[i + 1];
      const b = rgbaData[i + 2];
      const a = rgbaData[i + 3];
      if (a < 128) continue;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
      const sat = max === 0 ? 0 : (max - min) / max;

      // Ignore near-black, near-white, and flat gray pixels
      if (lum < 0.08 || lum > 0.92 || sat < 0.22) continue;

      const rq = r >> 4;
      const gq = g >> 4;
      const bq = b >> 4;
      const key = (rq << 8) | (gq << 4) | bq;
      const score = sat * sat * (1 - Math.abs(lum - 0.5)) * 2;
      const prev = buckets.get(key) || { score: 0, rSum: 0, gSum: 0, bSum: 0, count: 0 };
      prev.score += score;
      prev.rSum += r;
      prev.gSum += g;
      prev.bSum += b;
      prev.count += 1;
      buckets.set(key, prev);
    }

    let best = null;
    for (const entry of buckets.values()) {
      if (!best || entry.score > best.score) best = entry;
    }
    if (!best) return null;
    return rgbToHex(best.rSum / best.count, best.gSum / best.count, best.bSum / best.count);
  }

  root.YTMD3Color = {
    DEFAULT_SETTINGS,
    COLOR_PRESETS,
    generateScheme,
    schemeToCssVariables,
    extractVibrantSeedFromPixels,
    hexToRgba,
    hexToRgb,
    rgbToHex,
    isValidHex,
    getContrastForeground
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
