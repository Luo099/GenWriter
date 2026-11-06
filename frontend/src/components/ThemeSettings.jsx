import { useState, useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import { DEFAULT_THEME_COLOR, THEME_PRESETS, contrastingText, getThemeColor, normalizeHexColor, resetThemeColor, setThemeColor, subscribeTheme } from '../utils/theme';

export default function ThemeSettings() {
  const color = useSyncExternalStore(subscribeTheme, getThemeColor, () => DEFAULT_THEME_COLOR);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');
  const choose = (next) => { setThemeColor(next); setDraft(null); setError(''); };
  const submit = (event) => {
    event.preventDefault();
    const next = normalizeHexColor(draft ?? color);
    if (!next) { setError('请输入有效色值，如 #A96E3B'); return; }
    choose(next);
  };

  return <section className="theme-settings" aria-labelledby="theme-label">
    <div className="theme-settings-label"><span id="theme-label">主题色</span><button type="button" className="workspace-ghost" disabled={color === DEFAULT_THEME_COLOR && draft === null} onClick={() => { resetThemeColor(); setDraft(null); setError(''); }}>恢复默认</button></div>
    <div className="theme-presets" role="group" aria-label="预设主题色">{THEME_PRESETS.map((preset) => <button type="button" key={preset.color} className={`theme-preset${color === preset.color ? ' selected' : ''}`} aria-label={preset.name} aria-pressed={color === preset.color} onClick={() => choose(preset.color)}>
      <span className="theme-swatch" style={{ backgroundColor: preset.color, color: contrastingText(preset.color) }}>{color === preset.color && <Check size={16} strokeWidth={2.5} />}</span><span>{preset.name}</span>
    </button>)}</div>
    <form className="theme-custom" onSubmit={submit} noValidate>
      <label htmlFor="theme-hex">自定义</label>
      <div className="theme-custom-controls"><input type="color" aria-label="选取主题色" value={color} onInput={(event) => choose(event.currentTarget.value)} onChange={(event) => choose(event.target.value)} /><input id="theme-hex" aria-label="主题色色值" aria-invalid={Boolean(error)} aria-describedby={error ? 'theme-color-error' : undefined} value={draft ?? color.toUpperCase()} onChange={(event) => { setDraft(event.target.value); setError(''); }} autoComplete="off" spellCheck={false} maxLength={32} /><button type="submit" className="workspace-action">应用</button></div>
      {error && <p className="theme-error" id="theme-color-error" role="alert">{error}</p>}
    </form>
  </section>;
}
