// Localized shared presentation. No account, device or backend authority.
import {translateSurfaceMessage} from '../../../services/i18n/surface.mjs';
import { icon, button, esc, tag, notice, glyph } from '../meridian/primitives.mjs';
import { createJourneyContext } from './context.mjs';

export function createJourneyView(locale='pt-BR') {
 const m=id=>translateSurfaceMessage(locale,id);
 const rejectFirstRun = kind => {if (kind === 'setup') throw new TypeError('First Run setup is owned by system/surface/ui/first-run.mjs');};
 const {currentContext}=createJourneyContext(locale);
const rows = values => `<dl class="md-journey-facts">${values.map(item => `<div><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd></div>`).join('')}</dl>`;
const operationGroups = {
    update: [{ label: m("meridian.text.1083"), steps: ['idle', 'checking', 'current', 'offline'] }, { label: m("meridian.text.1084"), steps: ['available', 'compatibility', 'storage', 'incompatible'] }, { label: m("meridian.text.0664"), steps: ['download', 'paused', 'verify', 'invalid', 'stage'] }, { label: m("meridian.text.0107"), steps: ['restart', 'deferred', 'health'] }, { label: m("meridian.text.0665"), steps: ['rollback-review', 'rollback', 'retained', 'complete'] }],
    recovery: [{ label: m("meridian.text.0163"), steps: ['diagnosis', 'report', 'missing', 'unavailable'] }, { label: m("meridian.text.0666"), steps: ['options', 'repair'] }, { label: m("meridian.text.0667"), steps: ['impact'] }, { label: m("meridian.text.0668"), steps: ['restoring', 'failed', 'complete'] }],
    files: [{ label: m("meridian.text.0669"), steps: ['browse', 'preview', 'favorites', 'missing'] }, { label: m("meridian.text.0667"), steps: ['create', 'review', 'share', 'conflict', 'denied', 'readonly', 'full', 'trash'] }, { label: m("meridian.text.1085"), steps: ['complete', 'restored'] }],
    storage: [{ label: m("meridian.text.0670"), steps: ['volumes', 'readonly', 'full', 'missing'] }, { label: m("meridian.text.0671"), steps: ['persistence'] }],
    power: [{ label: m("meridian.text.1086"), steps: ['review'] }, { label: m("meridian.text.0672"), steps: ['restart', 'shutdown', 'complete'] }],
};
function operationProgress(kind, state) {
    const groups = operationGroups[kind];
    if (!groups)
        return null;
    const current = groups.findIndex(group => group.steps.includes(state.step));
    return { current, total: groups.length, markup: `<aside class="md-journey-trail md-operation-trail" aria-label="${m("meridian.text.0682")} ${esc(kind === 'update' ? m("meridian.text.0673") : kind === 'recovery' ? m("meridian.text.0674") : kind === 'storage' ? 'armazenamento' : kind === 'files' ? 'arquivos' : m("meridian.text.0676"))}"><p class="md-eyebrow">${kind === 'recovery' ? m("meridian.text.0677") : m("meridian.text.1087")}</p><ol>${groups.map((group, index) => `<li ${index === current ? 'aria-current="step"' : ''}><span>${index + 1}</span><p>${esc(group.label)}</p></li>`).join('')}</ol><p class="md-hint">${kind === 'recovery' ? m("meridian.text.0678") : kind === 'storage' ? m("meridian.text.0679") : kind === 'files' ? m("meridian.text.0680") : m("meridian.text.0681")}</p></aside>` };
}
function accountIntro() { return `<aside class="md-account-intro"><span class="md-account-orbit" aria-hidden="true">${icon('spaces', 44)}</span><p class="md-eyebrow">${m("meridian.text.0686")}</p><h2>${m("meridian.text.1090")}<br>${m("meridian.text.1089")}</h2><p>${m("meridian.text.0685")}</p><ul><li>${icon('spaces', 19)}<span>${m("meridian.text.1088")}</span></li><li>${icon('shield', 19)}<span>${m("meridian.text.0684")}</span></li><li>${icon('desktop', 19)}<span>${m("meridian.text.0683")}</span></li></ul></aside>`; }
function storyboardFields(definition, state, topics) {
    const frame = definition.screens[state.step];
    return frame.topicFields ? (topics.find(item => item.id === state.entity)?.fields ?? []) : frame.fields ?? [];
}
function entityFor(kind, id, data, topics) {
    const collection = { space: data.spaces, profile: data.profiles, store: data.store, device: data.devices, settings: topics };
    return collection[kind]?.find(item => item.id === id) ?? null;
}
function fieldMarkup(field, state) {
    const value = state.fields[field.id] ?? field.value ?? '';
    const id = `md-journey-${field.id}`;
    const control = field.options
        ? `<select id="${id}" data-story-field="${esc(field.id)}">${field.options.map(option => `<option value="${esc(option.value)}" ${value === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select>` : field.multiline
        ? `<textarea id="${id}" data-story-field="${esc(field.id)}" maxlength="${field.max ?? 1000}" rows="4">${esc(value)}</textarea>` : `<input id="${id}" data-story-field="${esc(field.id)}" value="${esc(value)}" maxlength="${field.max ?? 64}" autocomplete="off"/>`;
    return `<label class="md-field md-journey-field" for="${id}"><span>${esc(field.label)}</span>${control}</label>`;
}
function journeyView(kind, definition, state, data, ui) {
    rejectFirstRun(kind);
    const frame = definition.screens[state.step];
    const { space, files, project } = currentContext(data);
    const entity = entityFor(kind, state.entity, data, ui.lab.topics);
    const fields = storyboardFields(definition, state, ui.lab.topics);
    const confirm = frame.confirm;
    const nextDisabled = confirm && state.fields[`confirm:${state.step}`] !== true;
    const history = state.visited.filter(id => id === state.step || !definition.screens[id].tone || definition.screens[id].tone === 'success');
    const completedFields = Object.entries(state.fields).filter(([key]) => !key.startsWith('confirm:') && key !== 'streamLength');
    const pending = ui.windows;
    const unavailableEntity = ['space', 'profile', 'store', 'device', 'settings'].includes(kind) && !entity;
    const progress = operationProgress(kind, state);
    const displayTitle = kind === 'settings' && state.step === 'edit' ? entity?.name ?? frame.title : frame.title;
    const displayText = kind === 'settings' && state.step === 'edit' ? entity?.detail ?? frame.text : frame.text;
    const stepIcon = kind === 'settings' ? entity?.icon ?? definition.icon : definition.icon;
    const planned = kind === 'profile' && entity?.id === 'law';
    if (unavailableEntity || planned)
        return `<div class="md-journey-unavailable">${glyph('shield', 'amber', 32)}<h3>${planned ? m("meridian.text.0687") : m("meridian.text.0688")}</h3><p>${planned ? m("meridian.text.0689") : m("meridian.text.0690")}</p>${button(m("meridian.text.0691"), 'journey-close', 'arrow')}${planned ? rows([{ label: m("meridian.text.1091"), value: m("meridian.text.0692") }, { label: m("meridian.text.0693"), value: m("meridian.text.0694") }]) : ''}</div>`;
    return `<div class="md-journey" data-story="${kind}" data-story-step="${state.step}" data-tone="${frame.tone ?? 'neutral'}">
 <div class="md-journey-context"><span>${esc(entity?.name ?? definition.label)}</span>${progress ? `<span class="md-step-count">${m("meridian.text.0175")} ${progress.current + 1} de ${progress.total}</span>` : ''}</div>
 <div class="md-journey-layout">${progress ? progress.markup : kind === 'identity' ? accountIntro() : `<aside class="md-journey-trail" aria-label="${m("meridian.text.0697")}"><p class="md-eyebrow">${m("meridian.text.1093")}</p><ol>${history.map(id => `<li ${id === state.step ? 'aria-current="step"' : ''}><span>${id === state.step ? icon('arrow', 13) : icon('check', 13)}</span><p>${esc(kind === 'settings' ? ({ edit: m("meridian.text.1014"), pending: m("meridian.text.0887"), complete: m("meridian.text.0696"), undo: m("meridian.text.1092") }[id] ?? definition.screens[id].title) : definition.screens[id].title)}</p></li>`).join('')}</ol></aside>`}
 <section class="md-journey-step"><div class="md-journey-step-icon md-glyph--${frame.tone === 'warning' ? 'amber' : frame.tone === 'success' ? 'sage' : 'clay'}">${icon(frame.tone === 'success' ? 'check' : stepIcon, 30)}</div>
 <h3 id="md-story-title" tabindex="-1" ${kind === 'identity' ? "role=\"heading\" aria-level=\"1\"" : kind === 'recovery' ? "role=\"heading\" aria-level=\"2\"" : ''}>${esc(displayTitle)}</h3><p class="md-journey-description" ${frame.tone === 'warning' ? 'role="alert"' : ''} ${kind === 'intelligence' && state.step === 'stream' ? 'data-story-stream' : ''}>${esc(kind === 'intelligence' && state.step === 'stream' ? frame.text.slice(0, state.fields.streamLength ?? 0) : displayText)}</p>
 ${frame.entity && entity ? `<div class="md-journey-entity">${glyph(entity.icon ?? definition.icon, entity.tone ?? 'sage', 26)}<div><strong>${esc(entity.name)}</strong><p>${esc(entity.description ?? entity.detail ?? '')}</p></div></div>` : ''}
 ${frame.phase != null ? `<div class="md-journey-progress"><label for="md-story-progress">${esc(frame.progressLabel ?? (kind === 'update' ? ({ checking: m("meridian.text.0698"), download: m("meridian.text.0699"), verify: m("meridian.text.1096"), stage: m("meridian.text.0700"), health: m("meridian.text.0701"), rollback: m("meridian.text.0702") }[state.step] ?? m("meridian.text.0888")) : kind === 'recovery' ? m("meridian.text.0702") : m("meridian.text.0888")))} <span>${frame.phase}%</span></label><progress id="md-story-progress" value="${frame.phase}" max="100">${frame.phase}%</progress></div>` : ''}
 ${frame.code ? `<div class="md-journey-code"><span>${m("meridian.text.0704")}</span><strong>${esc(frame.code)}</strong><small>${m("meridian.text.0703")}</small></div>` : ''}
 ${frame.storageSummary ? `<section class="md-storage-summary" aria-label="${m("meridian.text.0707")}"><div class="md-storage-device">${glyph('folder', 'sage', 28)}<div><strong>${m("meridian.text.0939")}</strong><p>${m("meridian.text.1097")} ${esc(ui.lab.system.host)}</p></div></div><dl>${[{ label: m("meridian.text.0889"), value: ui.lab.system.capacity }, { label: m("meridian.text.0932"), value: ui.lab.system.used }, { label: m("meridian.text.0705"), value: ui.lab.system.free }].map(item => `<div><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd></div>`).join('')}</dl><p class="md-storage-note">${icon('shield', 16)} ${m("meridian.text.0706")}</p></section>` : ''}
 ${frame.volumeList ? `<section class="md-journey-volumes" aria-label="${m("meridian.text.1099")}"><h4>${m("meridian.text.1098")}</h4>${ui.lab.system.volumes.map(item => `<div>${glyph(item.icon, 'sage')}<span><strong>${esc(item.name)}</strong><p>${esc(item.detail)}</p><small>${esc(item.mode)}</small></span></div>`).join('')}</section>` : ''}
 ${frame.sources ? `<div class="md-journey-sources"><h4>${m("meridian.text.0711")}</h4><p>${esc(project?.name ?? m("meridian.text.1100"))} \u00B7 ${esc(space.name)}</p>${files.length ? files.map(file => `<label><input type="checkbox" data-story-field="source:${esc(file.id)}" ${state.revokedSources?.includes(file.id) ? 'disabled' : state.fields[`source:${file.id}`] === false ? '' : 'checked'}/><span>${icon(file.icon, 17)}${esc(file.name)}${state.revokedSources?.includes(file.id) ? m("meridian.text.0708") : ''}</span></label>`).join('') : `<p>${m("meridian.text.0709")}</p>`}<small>${m("meridian.text.0710")}</small></div>` : ''}
 ${frame.fileList ? `<section class="md-files-overview" aria-label="${m("meridian.text.0716")}"><header><div><p class="md-eyebrow">${esc(space.name)}</p><h4>${state.step === 'favorites' ? m("meridian.text.0712") : m("meridian.text.0713")}</h4></div><span>${files.length} ${files.length === 1 ? 'item' : m("meridian.common.items")}</span></header>${files.length ? `<ul>${files.map(file => `<li>${glyph(file.icon, file.tone)}<div><strong>${esc(file.name)}</strong><small>${esc(file.kind)}</small></div><span>${esc(file.size)}</span></li>`).join('')}</ul>` : `<div class="md-files-empty"><p>${m("meridian.text.0715")}</p><small>${m("meridian.text.0714")}</small></div>`}<p class="md-files-origin">${icon('folder', 15)} ${m("meridian.text.1101")} ${esc(space.name)}</p></section>` : ''}
 ${frame.pending ? `<div class="md-journey-pending"><h4>${m("meridian.text.0719")}</h4><p>${pending.length} ${pending.length === 1 ? 'janela aberta' : 'janelas abertas'} \u00B7 ${ui.pendingDraftCount ?? 0} ${(ui.pendingDraftCount ?? 0) === 1 ? m("meridian.common.draft") : m("meridian.common.drafts")} ${m("meridian.text.0892")}</p><p>${(ui.pendingDraftCount ?? 0) > 0 ? m("meridian.text.0717") : m("meridian.text.0718")}</p></div>` : ''}
 ${frame.network ? `<div class="md-network-picker"><p class="md-field-label">${m("meridian.text.0723")}</p><button type="button" class="md-network-option" data-action="story-move:network-connecting" aria-label="${m("meridian.text.0050")}"><span class="md-network-signal">${icon('wifi', 25)}</span><span><strong>${m("meridian.text.0024")}</strong><small>${m("meridian.text.0722")}</small></span><span class="md-network-connect">${m("meridian.text.0721")} ${icon('chevron', 17)}</span></button><p class="md-network-help">${icon('shield', 16)} ${m("meridian.text.0720")}</p></div>` : ''}
 ${frame.rows ? rows(frame.rows) : ''}
 ${fields.length ? `<div class="md-journey-fields">${fields.map(field => fieldMarkup(field, state)).join('')}</div>` : ''}
 ${frame.summary && completedFields.length ? rows(completedFields.map(([key, value]) => { const spec = (definition.summaryFields ?? []).concat(Object.values(definition.screens).flatMap(s => s.fields ?? [])).concat(ui.lab.topics.flatMap(t => t.fields ?? [])).find(f => f.id === key); return { label: spec?.label ?? key, value: spec?.options?.find(o => o.value === value)?.label ?? String(value) }; })) : ''}
 ${frame.note ? `<p class="md-hint">${esc(frame.note)}</p>` : ''}
 ${frame.receipt ? `<div class="md-journey-receipt" role="status">${icon('check', 22)}<div><strong>${m("meridian.text.1085")}</strong><p>${esc(frame.receipt)}</p></div></div>` : ''}
 ${confirm ? `<label class="md-journey-consent"><input type="checkbox" data-story-field="confirm:${state.step}" ${!nextDisabled ? 'checked' : ''}/><span>${esc(confirm)}</span></label>` : ''}
 <div class="md-journey-actions">${state.trail.length ? button(m("meridian.text.0691"), 'story-back', 'arrow') : ''}
 ${frame.next ? `<button type="button" class="md-button md-button--${frame.primaryAction ? 'quiet' : 'solid'}" data-action="story-next" ${nextDisabled ? 'disabled' : ''}>${esc(frame.nextLabel ?? m("meridian.text.0028"))} ${icon('arrow', 18)}</button>` : ''}
 ${frame.finish ? button(frame.finish, 'story-finish', 'check', 'solid') : ''}
 ${(frame.network ? [] : frame.actions ?? []).map(item => button(item.label, `story-move:${item.target}`, '', frame.primaryAction === item.target ? 'solid' : 'quiet')).join('')}</div>
 ${frame.links?.length ? `<div class="md-journey-links">${frame.links.map(link => button(link.label, link.action, 'arrow')).join('')}</div>` : ''}
 ${frame.conditions?.length ? `<details class="md-journey-conditions"><summary>${m("meridian.text.0725")}</summary><p>${m("meridian.text.0724")}</p><div>${frame.conditions.map(item => button(item.label, `story-move:${item.target}`, 'sliders')).join('')}</div></details>` : ''}
 </section></div></div>`;
}
function journeyFrame(title, body, fullscreen = false, kind = '') {
    rejectFirstRun(kind);
    if (!fullscreen)
        return `<dialog class="md-dialog md-dialog--journey ${kind === 'settings' ? 'md-dialog--settings' : ''}" aria-labelledby="md-panel-title"><header class="md-panel-header"><div><p class="md-eyebrow">${"ORDAX"}</p><h2 id="md-panel-title">${esc(title)}</h2></div>${button(m("meridian.text.0726"), 'journey-close', 'close')}</header><div class="md-panel-body">${body}</div><div class="md-panel-feedback" role="status" aria-live="polite"></div></dialog>`;
    return `<main class="md-stage" data-flow="${esc(kind)}" tabindex="-1" id="meridian-main"><header class="md-stage-header"><span class="md-stage-brand"><img src="/system/surface/ui/brand/ordax-symbol.png" alt="" width="30" height="30"/>${m("meridian.text.1104")}</span>${button(m("meridian.text.0691"), 'journey-close', 'close')}</header><div class="md-stage-body"><p class="md-eyebrow">${kind === 'identity' ? m("meridian.text.1102") : kind === 'recovery' ? m("meridian.text.1103") : m("meridian.text.0727")}</p><h1>${esc(title)}</h1>${body}</div></main>`;
}
function lockScreen(ui) {
    return `<main class="md-stage md-lock-stage" tabindex="-1" id="meridian-main"><div class="md-lock-card"><p class="md-lock-brand">${m("meridian.text.1104")}</p><span class="md-lock-symbol">${icon('profiles', 48)}</span><p class="md-eyebrow">${m("meridian.text.0732")}</p><h1>${m("meridian.text.0731")}</h1><p>${m("meridian.text.0730")}</p>${ui.lockError ? notice(m("meridian.text.0728"), 'warning') : ''}<div class="md-lock-actions">${button(m("meridian.text.1105"), 'lab-unlock', 'arrow', 'solid')}${button(m("meridian.text.0729"), 'lab-lock-error', 'shield')}</div></div></main>`;
}
 return {storyboardFields,entityFor,journeyView,journeyFrame,lockScreen};
}

export const {storyboardFields,entityFor,journeyView,journeyFrame,lockScreen}=createJourneyView();
