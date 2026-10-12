import { useState } from 'react';
import { COLOR_THEME_OPTIONS } from '../../../../services/preferences/color-palette.mjs';
import { accessibilityContrastPreference, accessibilityMotionPreference, accessibilityTextScalePreference } from '../../../../services/preferences/accessibility.mjs';
import { SETTINGS_SOURCE_MESSAGES } from '../../../../services/i18n/catalog/settings.mjs';
import { useWebPreferences } from './preferences-context';

const sections = ['appearance', 'accessibility'] as const;
const accessibility = [accessibilityContrastPreference, accessibilityMotionPreference, accessibilityTextScalePreference];
const text = (id: keyof typeof SETTINGS_SOURCE_MESSAGES) => SETTINGS_SOURCE_MESSAGES[id];

export function WebSettings() {
  const [section, setSection] = useState<typeof sections[number]>('appearance');
  const { colorTheme, setColorTheme, snapshot, setPreference, persistence } = useWebPreferences();
  return <section className="ordax-app-extension web-settings" data-app-extension="settings-overview" data-ordax-settings-overview-view>
    <div className="ordax-settings-view">
      <header className="ordax-settings-header"><span className="ordax-settings-eyebrow">{text('settings.eyebrow')}</span><h2 className="ordax-settings-title">{text(`settings.section.${section}`)}</h2><p className="ordax-settings-subtitle">{text(`settings.section.${section}.subtitle`)}</p></header>
      <nav className="ordax-settings-navigation" aria-label={text('settings.navigation.aria')}>{sections.map(id => <button type="button" key={id} className="ordax-settings-navigation-item" data-active={section === id} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{text(`settings.section.${id}`)}</button>)}</nav>
      {section === 'appearance' ? <section className="ordax-settings-section"><span className="ordax-settings-section-kicker">{text('settings.preference.appearance.label')}</span><h3 className="ordax-settings-section-title">{text('settings.preference.appearance.title')}</h3><p className="ordax-settings-section-copy">{text('settings.preference.appearance.description')}</p><div className="ordax-settings-options">{COLOR_THEME_OPTIONS.map(option => <button type="button" key={option.value} className="ordax-settings-option" data-color-theme={option.value} data-selected={colorTheme === option.value} aria-pressed={colorTheme === option.value} onClick={() => setColorTheme(option.value)}>
        <span className="ordax-settings-theme-preview" aria-hidden="true" data-theme-preview={option.value === 'native' ? 'dark' : option.value} data-ordax-palette={option.value === 'native' ? 'native' : 'standard'} data-palette-preview={option.value === 'native' ? 'native' : 'standard-' + option.value}><span className="ordax-settings-theme-rail"/><span className="ordax-settings-theme-body"/></span>
        <span className="ordax-settings-option-copy"><strong>{option.label}</strong><small>{text(`settings.preference.appearance.option.${option.value}.description` as keyof typeof SETTINGS_SOURCE_MESSAGES)}</small></span><span className="ordax-settings-option-marker">{colorTheme === option.value ? text('settings.preference.active') : ''}</span>
      </button>)}</div></section> : accessibility.map(preference => <section className="ordax-settings-section" key={preference.id}><span className="ordax-settings-section-kicker">{preference.label}</span><h3 className="ordax-settings-section-title">{preference.title}</h3><p className="ordax-settings-section-copy">{preference.description}</p><div className="ordax-settings-options">{preference.options.map((option: { value: string; label: string }) => <button type="button" key={option.value} className="ordax-settings-option ordax-settings-preference-option" data-preference-id={preference.id} data-selected={snapshot[preference.id] === option.value} aria-pressed={snapshot[preference.id] === option.value} onClick={() => setPreference(preference.id, option.value)}><span className="ordax-settings-option-copy"><strong>{option.label}</strong><small>{preference.description}</small></span><span className="ordax-settings-option-marker">{snapshot[preference.id] === option.value ? text('settings.preference.active') : ''}</span></button>)}</div></section>)}
      <p className="ordax-settings-section-copy ordax-settings-persistence" role="status">{persistence === 'session-only' ? 'O navegador não permitiu salvar. Preferências válidas apenas nesta sessão.' : 'Preferências salvas neste navegador. Sincronização entre dispositivos ainda não está conectada.'}</p>
    </div>
  </section>;
}
