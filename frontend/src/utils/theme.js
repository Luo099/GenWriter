export const DEFAULT_THEME_COLOR = '#a96e3b';
export const THEME_STORAGE_KEY = 'genwriter-theme-color';
export const THEME_PRESETS = [
  { name: '暖棕', color: DEFAULT_THEME_COLOR },
  { name: '墨绿', color: '#2b5140' },
  { name: '靛蓝', color: '#3568b0' },
  { name: '紫藤', color: '#7655a4' },
  { name: '玫瑰', color: '#ad5365' },
  { name: '石墨', color: '#50545e' },
];

let currentColor = DEFAULT_THEME_COLOR;
const listeners = new Set();

export function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(hex)) return `#${[...hex].map((digit) => digit.repeat(2)).join('').toLowerCase()}`;
  return /^[\da-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
const hex = (channels) => `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
const mix = (first, second, amount) => hex(rgb(first).map((channel, index) => channel * (1 - amount) + rgb(second)[index] * amount));
const luminance = (color) => rgb(color).map((channel) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

export const contrastRatio = (first, second) => {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

export const contrastingText = (background) => contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000') ? '#ffffff' : '#000000';

function backgroundForText(background, foreground, minimum = 4.5) {
  if (contrastRatio(background, foreground) >= minimum) return background;
  const direction = foreground === '#ffffff' ? '#000000' : '#ffffff';
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mix(background, direction, step / 100);
    if (contrastRatio(candidate, foreground) >= minimum) return candidate;
  }
  return direction;
}

function readableColor(color, background, minimum) {
  for (let step = 0; step <= 100; step += 1) {
    const candidate = mix(color, '#000000', step / 100);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return '#000000';
}

/** Separate the user's exact accent from readable text and neutral status colors. */
export function createThemeTokens(value) {
  const color = normalizeHexColor(value);
  if (!color) throw new TypeError('Invalid theme color');
  const text = readableColor(color, '#f5f3ed', 5.5);
  const hover = mix(color, luminance(color) < 0.02 ? '#ffffff' : '#000000', 0.12);
  const focus = readableColor(color, '#fcfbf8', 3);
  const buttonText = contrastRatio(color, '#ffffff') >= 4.2 ? '#ffffff' : '#000000';
  const buttonBackground = backgroundForText(color, buttonText);
  const hoverDirection = buttonText === '#ffffff' && luminance(buttonBackground) < 0.02 ? '#ffffff' : '#000000';
  const buttonHover = backgroundForText(mix(buttonBackground, hoverDirection, 0.12), buttonText);
  const ink50 = mix('#fcfbf8', text, 0.04);
  const ink100 = mix('#fcfbf8', text, 0.09);
  const accentSoft = mix('#fcfbf8', text, 0.09);
  return {
    '--theme-color': color,
    '--button-primary-bg': buttonBackground,
    '--button-primary-hover': buttonHover,
    '--button-primary-text': buttonText,
    '--ink-50': ink50,
    '--ink-100': ink100,
    '--ink-200': mix('#fcfbf8', text, 0.2),
    '--ink-300': mix('#fcfbf8', text, 0.35),
    '--ink-400': mix('#fcfbf8', text, 0.55),
    '--ink-500': readableColor(color, '#fcfbf8', 3.2),
    '--ink-600': text,
    '--ink-700': text,
    '--ink-800': mix(text, '#000000', 0.2),
    '--ink-900': mix(text, '#000000', 0.4),
    '--accent-color': color,
    '--accent-hover': hover,
    '--accent-soft': accentSoft,
    '--accent-on-soft': contrastingText(accentSoft),
    '--ink-on-50': contrastingText(ink50),
    '--ink-on-100': contrastingText(ink100),
    '--accent-text': text,
    '--accent-border': focus,
    '--accent-on-hover': contrastingText(hover),
    '--text-inverse': contrastingText(color),
    '--text-link': text,
    '--focus-ring': `0 0 0 3px ${focus}40`,
  };
}

function applyTheme(color) {
  const tokens = createThemeTokens(color);
  Object.entries(tokens).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  const icon = document.querySelector('link[rel="icon"]');
  if (icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" fill="none"><rect width="40" height="40" rx="11" fill="${color}"/><path d="M12 28L16 14L28 10L25 23L12 28ZM12 28L21 19M18 30H29" stroke="${tokens['--text-inverse']}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="22" cy="18" r="2" fill="${tokens['--text-inverse']}"/></svg>`;
    icon.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(svg)}`);
  }
  currentColor = color;
  listeners.forEach((listener) => listener());
}

function storedColor() {
  try { return normalizeHexColor(window.localStorage.getItem(THEME_STORAGE_KEY)) || DEFAULT_THEME_COLOR; }
  catch { return DEFAULT_THEME_COLOR; }
}

export function setThemeColor(value) {
  const color = normalizeHexColor(value);
  if (!color) return false;
  applyTheme(color);
  try { window.localStorage.setItem(THEME_STORAGE_KEY, color); } catch { /* Keep the current appearance usable without storage. */ }
  return true;
}

export function resetThemeColor() {
  applyTheme(DEFAULT_THEME_COLOR);
  try { window.localStorage.removeItem(THEME_STORAGE_KEY); } catch { /* The current appearance still resets. */ }
}

export const getThemeColor = () => currentColor;
export const subscribeTheme = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

export function initializeTheme() {
  applyTheme(storedColor());
  const onStorage = (event) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) applyTheme(storedColor());
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
