// Localized shared presentation. No account, device or backend authority.
import {translateSurfaceMessage} from '../../../services/i18n/surface.mjs';
import { createJourneyScenarios } from './scenarios.mjs';
import { createSettingsJourneyCatalog } from './settings-catalog.mjs';
import { newStoryboard, moveStoryboard, previousStoryboard } from './navigation.mjs';
import { createJourneyView } from './view.mjs';
import { icon, esc } from '../meridian/primitives.mjs';

export function createSettingsJourneyRenderer(locale='pt-BR') {
 const m=id=>translateSurfaceMessage(locale,id);
 const {storyboards,systemFixture}=createJourneyScenarios(locale); const {settingsTopics,settingsJourneyTopics}=createSettingsJourneyCatalog(locale); const {journeyView,storyboardFields}=createJourneyView(locale);
const kinds = new Set(['settings', 'identity', 'update', 'recovery', 'storage', 'power']);
function settingsExamplesOverview() { return `<section class="wm-settings-examples"><h3>${m("meridian.text.1079")}</h3><p>${m("meridian.text.0650")}</p><nav class="wm-topic-grid" aria-label="${m("meridian.text.0649")}">${settingsTopics.map(topic => `<button type="button" class="wm-topic-card" data-settings-example="${esc(topic.id)}"><span class="wm-topic-icon">${icon(topic.icon, 23)}</span><span><strong>${esc(topic.name)}</strong><small>${esc(topic.detail)}</small><em class="wm-topic-status">${m("meridian.text.0648")}</em></span></button>`).join('')}</nav><div class="wm-choice-options"><button type="button" data-settings-example="continuity">${m("meridian.text.0075")}</button><button type="button" data-settings-example="memory">${m("meridian.text.0644")}</button></div></section>`; }
/**
 * Same renderer/navigation/scenarios as Meridian; effects are descriptive only.
 * No ports, commands, storage, credentials, account session or network access.
 * @param {HTMLElement} host
 * @param {{onAccount?:()=>void}} options
 */
function mountSettingsJourneys(host, { onAccount } = {}) {
    const doc = host.ownerDocument;
    const states = new Map();
    let current = null, dialog = null, returnFocus = null, destroyed = false;
    const data = { spaces: [], projects: [], files: [], devices: [], profiles: [], store: [], activeSpace: null };
    const ui = { windows: [], pendingDraftCount: 0, lab: { topics: settingsJourneyTopics, system: systemFixture } };
    function seed(definition, state) { for (const field of storyboardFields(definition, state, settingsJourneyTopics))
        if (!(field.id in state.fields))
            state.fields[field.id] = field.value ?? ''; }
    function ensureDialog() {
        if (dialog)
            return;
        dialog = doc.createElement('dialog');
        dialog.className = 'md-dialog md-dialog--journey';
        dialog.setAttribute('data-meridian', '');
        dialog.setAttribute('aria-labelledby', 'md-story-title');
        dialog.addEventListener('click', click);
        dialog.addEventListener('input', input);
        dialog.addEventListener('change', input);
        dialog.addEventListener('close', restoreFocus);
        doc.body.append(dialog);
    }
    function restoreFocus() { if (returnFocus?.isConnected)
        returnFocus.focus({ preventScroll: true }); }
    function close() { if (dialog?.open)
        dialog.close(); }
    function paint() {
        if (!current || !dialog)
            return;
        const { kind, key } = current, definition = storyboards[kind], state = states.get(key);
        seed(definition, state);
        const material = doc.documentElement.getAttribute('data-ordax-theme') ?? doc.documentElement.getAttribute('data-theme');
        dialog.setAttribute('data-material', material === 'dark' || material === 'native' ? 'ink' : 'paper');
        dialog.innerHTML = `<header class="md-panel-header"><div><p class="md-eyebrow">${m("meridian.text.0655")}</p><h2>${esc(definition.label)}</h2></div><button type="button" class="md-button" data-action="journey-close" aria-label="${m("meridian.text.0654")}">${icon('close', 18)}</button></header><div class="md-settings-example-banner"><p>${m("meridian.text.0653")} ${m("meridian.text.0652")}</p>${kind === 'identity' && onAccount ? `<button type="button" class="md-button" data-action="settings-real-account">${m("meridian.text.0651")}</button>` : ''}</div><div class="md-panel-body">${journeyView(kind, definition, state, data, ui)}</div>`;
        dialog.scrollTop = 0;
        dialog.querySelector('#md-story-title')?.focus({ preventScroll: true });
    }
    function open(id) {
        if (destroyed)
            return;
        const topic = settingsJourneyTopics.find(item => item.id === id);
        const kind = topic?.journey ?? (topic ? 'settings' : id);
        if (!kinds.has(kind) || !storyboards[kind])
            return;
        const entity = kind === 'settings' ? id : '';
        const key = JSON.stringify([kind, entity]);
        if (!states.has(key))
            states.set(key, newStoryboard(storyboards[kind], entity));
        const state = states.get(key);
        seed(storyboards[kind], state);
        if (kind === 'settings' && !state.beforeEdit)
            state.beforeEdit = { ...state.fields };
        if (!dialog?.open)
            returnFocus = doc.activeElement;
        ensureDialog();
        current = { kind, key };
        paint();
        if (!dialog.open) {
            dialog.showModal();
            dialog.querySelector('#md-story-title')?.focus({ preventScroll: true });
        }
    }
    function click(event) {
        const target = event.target.closest?.('[data-action]');
        if (!target || !dialog.contains(target))
            return;
        const action = target.dataset.action;
        if (action === 'journey-close') {
            close();
            return;
        }
        if (action === 'settings-real-account') {
            close();
            onAccount?.();
            return;
        }
        if (!current)
            return;
        const { kind, key } = current, definition = storyboards[kind], state = states.get(key), frame = definition.screens[state.step];
        if (action === 'story-finish') {
            if (frame.finish)
                close();
            return;
        }
        if (action.startsWith('journey:')) {
            open(action.slice(8));
            return;
        }
        let next = state;
        if (action === 'story-back')
            next = previousStoryboard(state);
        else if (action === 'story-next' || action.startsWith('story-move:'))
            next = moveStoryboard(definition, state, action === 'story-next' ? frame.next : action.slice(11));
        if (next === state)
            return;
        if (kind === 'settings' && next.step === 'undo')
            next.fields = { ...next.fields, ...state.beforeEdit };
        states.set(key, next);
        paint();
    }
    function input(event) {
        const target = event.target;
        if (!target.dataset.storyField || !current)
            return;
        const { kind, key } = current, definition = storyboards[kind], state = states.get(key), frame = definition.screens[state.step];
        const field = target.dataset.storyField, spec = storyboardFields(definition, state, settingsJourneyTopics).find(item => item.id === field);
        const confirmation = frame.confirm && field === 'confirm:' + state.step;
        if (!spec && !confirmation)
            return;
        const value = target.type === 'checkbox' ? target.checked : String(target.value).slice(0, spec?.max ?? 128);
        if (spec?.options && !spec.options.some(option => option.value === value))
            return;
        state.fields[field] = value;
        if (frame.confirm) {
            if (!confirmation) {
                state.fields['confirm:' + state.step] = false;
                const box = dialog.querySelector('[data-story-field="confirm:' + state.step + '"]');
                if (box)
                    box.checked = false;
            }
            const next = dialog.querySelector('[data-action="story-next"]');
            if (next)
                next.disabled = state.fields['confirm:' + state.step] !== true;
        }
    }
    function launcher(event) { const button = event.target.closest?.('[data-settings-example]'); if (button && host.contains(button))
        open(button.dataset.settingsExample); }
    host.addEventListener('click', launcher);
    return { open, overview: settingsExamplesOverview, destroy() { destroyed = true; host.removeEventListener('click', launcher); if (dialog) {
            dialog.removeEventListener('click', click);
            dialog.removeEventListener('input', input);
            dialog.removeEventListener('change', input);
            dialog.removeEventListener('close', restoreFocus);
            if (dialog.open)
                dialog.close();
            dialog.remove();
            dialog = null;
        } states.clear(); } };
}
 return {settingsExamplesOverview,mountSettingsJourneys};
}

export const {settingsExamplesOverview}=createSettingsJourneyRenderer();

/** The existing localization/preference owner supplies the locale. */
export function mountSettingsJourneys(host, options={}) {
 let instance=null, activeLocale=null, disposed=false;
 const resolve=()=>{
  if(disposed)return null;
  const locale=options.getLocale?.()??options.locale??'pt-BR';
  if(!instance||locale!==activeLocale){
   instance?.destroy();activeLocale=locale;
   instance=createSettingsJourneyRenderer(locale).mountSettingsJourneys(host,options);
  }
  return instance;
 };
 resolve();
 return {open(id){resolve()?.open(id);},overview(){return resolve()?.overview()??'';},destroy(){disposed=true;instance?.destroy();instance=null;}};
}
