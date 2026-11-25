import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, createThemeTokens, DEFAULT_THEME_COLOR, normalizeHexColor, THEME_PRESETS } from './theme.js';

test('accepts full and short hexadecimal colors and rejects malformed input', () => {
  assert.equal(normalizeHexColor(' #AbC '), '#aabbcc');
  assert.equal(normalizeHexColor('3568B0'), '#3568b0');
  for (const invalid of ['', '#12', '#12345', '#12345678', '#gggggg', 'red', null, {}, 'url(test)']) assert.equal(normalizeHexColor(invalid), null);
});

test('contrast calculation matches black and white reference colors', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
});

test('every preset and light or dark custom color keeps exact accent and readable foregrounds', () => {
  for (const color of [...THEME_PRESETS.map((preset) => preset.color), '#ffffff', '#000000', '#ffff00', '#00ff00', '#ff0000', '#777777', '#abcdef']) {
    const tokens = createThemeTokens(color);
    assert.equal(tokens['--accent-color'], color);
    assert.ok(contrastRatio(tokens['--accent-color'], tokens['--text-inverse']) >= 4.5, `${color}: button text`);
    assert.ok(contrastRatio(tokens['--accent-hover'], tokens['--accent-on-hover']) >= 4.5, `${color}: hover text`);
    assert.ok(contrastRatio(tokens['--accent-text'], '#f5f3ed') >= 4.8, `${color}: text on paper`);
    assert.ok(contrastRatio(tokens['--accent-border'], '#fcfbf8') >= 3, `${color}: focus border`);
    assert.ok(contrastRatio(tokens['--ink-700'], tokens['--ink-100']) >= 4.5, `${color}: selected label`);
  }
});

test('theme tokens do not replace status colors', () => {
  const tokens = createThemeTokens(DEFAULT_THEME_COLOR);
  assert.equal(Object.keys(tokens).some((key) => key.startsWith('--status-')), false);
  assert.throws(() => createThemeTokens('invalid'), TypeError);
});

test('custom colors across the RGB range remain readable', () => {
  for (let red = 0; red <= 255; red += 51) for (let green = 0; green <= 255; green += 51) for (let blue = 0; blue <= 255; blue += 51) {
    const color = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
    const tokens = createThemeTokens(color);
    assert.ok(contrastRatio(tokens['--text-inverse'], color) >= 4.5, `${color}: button`);
    assert.ok(contrastRatio(tokens['--accent-on-hover'], tokens['--accent-hover']) >= 4.5, `${color}: hover`);
    assert.ok(contrastRatio(tokens['--ink-700'], tokens['--ink-100']) >= 4.5, `${color}: selected item`);
  }
});
