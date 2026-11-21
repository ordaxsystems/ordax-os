// Localized shared presentation. No account, device or backend authority.
import {translateSurfaceMessage} from '../../../../services/i18n/surface.mjs';
import { button, iconButton, glyph, icon, esc, tag } from '../../meridian/primitives.mjs';

export function createSpacesView(locale='pt-BR') {
 const m=id=>translateSurfaceMessage(locale,id);

const favoriteKey = (data, id) => JSON.stringify([data.presentationSubject ?? 'lia', id]);
function isSpaceFavorite(data, ui, space) { return ui.spaceFavorites?.[favoriteKey(data, space.id)] ?? space.dashboard?.favorite ?? false; }
function filterSpaces(data, ui) {
    const normalize = value => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    const query = normalize(ui.spacesQuery ?? '').trim();
    return data.spaces.filter(space => (!query || normalize([space.name, space.description, space.profile, space.dashboard?.location ?? ''].join(" ")).includes(query)) && (!ui.spacesCategory || ui.spacesCategory === m("meridian.text.0804") || (ui.spacesCategory === m("meridian.text.0287") ? isSpaceFavorite(data, ui, space) : space.dashboard?.group === ui.spacesCategory))).sort((a, b) => ui.spacesSort === 'name' ? a.name.localeCompare(b.name, locale) : (a.dashboard?.recent ?? 100) - (b.dashboard?.recent ?? 100));
}
// Each space supplies its own indicators; tuples remain compatible with older fixtures.
const spaceMetrics = space => (space.dashboard?.metrics ?? [[m("meridian.text.0772"), space.members, m("meridian.text.0805")]]).map(item => Array.isArray(item) ? { label: item[0], value: item[1], detail: item[2] } : item).filter(item => item && item.label);
function metrics(space, compact = false) {
    const items = spaceMetrics(space);
    if (!items.length)
        return '';
    return `<dl class="md-spaces-metrics ${compact ? 'is-compact' : ''}" aria-label="${m("meridian.text.1149")} ${esc(space.name)}">${items.map(item => {
        const hasValue = item.value !== null && item.value !== undefined && item.value !== '';
        const progress = typeof item.progress === 'number' && Number.isFinite(item.progress) ? Math.max(0, Math.min(100, item.progress)) : null;
        const tone = ['positive', 'attention', 'neutral'].includes(item.tone) ? item.tone : 'neutral';
        return `<div class="md-spaces-metric is-${tone}"><dt>${item.icon ? icon(item.icon, 15) : ''}${esc(item.label)}</dt><dd class="${hasValue ? '' : 'is-unavailable'}">${hasValue ? esc(item.value) : '—'}</dd>${progress !== null ? `<meter min="0" max="100" value="${progress}" aria-label="${esc(item.label)}">${progress}%</meter>` : ''}${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</div>`;
    }).join('')}</dl>`;
}
function activeSpaceHero(space) {
    const location = space.dashboard?.location;
    return `<section class="md-spaces-hero ${space.cover ? 'has-cover' : ''} md-art--${esc(space.tone)}" aria-labelledby="md-active-space-name">
 <div class="md-spaces-hero-identity">${space.cover ? `<img class="md-spaces-hero-cover" src="${esc(space.cover)}" alt=""/>` : ''}<div class="md-spaces-hero-art" aria-hidden="true">${icon(space.icon, 100)}</div>
 <div class="md-spaces-hero-top"><span class="md-spaces-active-label"><i aria-hidden="true"></i>${m("meridian.text.0808")}</span><div>${button(m("meridian.text.0806"), `select-space:${space.id}`, 'arrow', 'light')}${iconButton(`${m("meridian.text.0807")} ${space.name}`, `space:${space.id}`, 'settings')}</div></div>
 <div class="md-spaces-hero-name">${glyph(space.icon, space.tone, 36)}<div class="md-spaces-hero-copy"><div class="md-spaces-hero-title"><h2 id="md-active-space-name">${esc(space.name)}</h2>${tag(space.dashboard?.group ?? space.profile, space.tone)}</div>${space.description ? `<p>${esc(space.description)}</p>` : ''}<div class="md-spaces-hero-meta">${location ? `<span>${icon('globe', 13)}${esc(location)}</span>` : ''}${space.members ? `<span>${icon('profiles', 14)}${esc(space.members)}</span>` : ''}</div></div></div></div>
 ${metrics(space)}${space.dashboard?.attention ? `<div class="md-spaces-hero-attention">${icon('bell', 16)}<span><strong>${esc(space.dashboard.attention.title)}</strong><small>${esc(space.dashboard.attention.detail)}</small></span>${button(m("meridian.text.0285"), `space:${space.id}`, 'arrow', 'quiet')}</div>` : ''}</section>`;
}
function favoriteButton(data, ui, space) { const active = isSpaceFavorite(data, ui, space); return `<button type="button" class="md-spaces-favorite ${active ? 'is-favorite' : ''}" data-action="spaces-favorite:${esc(space.id)}" aria-label="${active ? m("meridian.text.0894") : m("meridian.text.1150")} ${esc(space.name)} ${active ? 'dos' : 'aos'} ${m("meridian.text.0809")}" aria-pressed="${active}">${icon('star', 18)}</button>`; }
function spaceCard(space, data, ui, compact = false) { return `<article class="md-spaces-card ${compact ? 'is-small' : ''} md-art--${esc(space.tone)}">${compact ? glyph(space.icon, space.tone, 25) : `<div class="md-spaces-cover" aria-hidden="true"><span>${icon(space.icon, 48)}</span><i></i><b>${esc(space.name.split(" ")[0])}</b></div>`}${favoriteButton(data, ui, space)}<div class="md-spaces-card-body"><div class="md-spaces-card-title"><h3>${esc(space.name)}</h3>${tag(space.dashboard?.group ?? space.profile, space.tone)}</div><p>${esc(space.description)}</p>${!compact && space.dashboard?.location ? `<small class="md-spaces-location">${icon('globe', 13)} ${esc(space.dashboard.location)}</small>` : ''}${compact ? `<small class="md-spaces-small-metric">${esc(spaceMetrics(space)[0]?.value ?? space.members)} \u00B7 ${esc(spaceMetrics(space)[0]?.label ?? m("meridian.text.0772"))}</small>` : metrics(space, true)}<footer>${button(m("meridian.text.0806"), `select-space:${space.id}`, 'arrow', compact ? 'quiet' : 'solid')}${iconButton(`${m("meridian.text.0807")} ${space.name}`, `space:${space.id}`, 'settings')}</footer></div></article>`; }
function dashboard(data, ui) {
    const active = data.spaces.find(space => space.id === data.activeSpace);
    const visible = filterSpaces(data, ui), primary = visible.filter(space => space.dashboard?.primary), others = visible.filter(space => !space.dashboard?.primary);
    const alerts = data.spaces.filter(space => space.dashboard?.attention), activity = (data.spaceActivity ?? []).filter(item => data.spaces.some(space => space.id === item.space));
    return `<div class="md-spaces-dashboard"><div class="md-spaces-center"><header class="md-spaces-page-header"><div><p class="md-eyebrow">${m("meridian.text.1152")}</p><h1>${m("meridian.text.0838")}</h1><p>${m("meridian.text.0837")}</p></div>${button(m("meridian.text.0810"), 'panel:new-space', 'plus', 'solid')}</header>
 ${active ? activeSpaceHero(active) : ''}
 <section aria-labelledby="md-spaces-list-title"><div class="md-spaces-list-heading"><h2 id="md-spaces-list-title">${m("meridian.text.0836")} <span>${visible.length}</span></h2><div class="md-spaces-controls"><div class="md-spaces-filters" role="group" aria-label="${m("meridian.text.0835")}">${[m("meridian.text.0804"), m("meridian.text.0304"), m("meridian.text.0459"), m("meridian.text.0287")].map(value => `<button type="button" data-action="spaces-filter:${value}" aria-pressed="${(ui.spacesCategory ?? m("meridian.text.0804")) === value}">${value}</button>`).join('')}</div><button type="button" class="md-button" data-action="spaces-sort" aria-label="${m("meridian.text.0834")} ${ui.spacesSort === 'name' ? 'nome' : 'recentes'}">${icon('refresh', 14)} ${ui.spacesSort === 'name' ? m("meridian.text.0813") : m("meridian.text.0814")}</button></div></div>
 <p class="md-spaces-result ${ui.spacesQuery ? 'has-query' : ''}" role="status">${visible.length} ${visible.length === 1 ? m("meridian.text.0815") : m("meridian.text.0816")}${ui.spacesQuery ? ` para \u201C${esc(ui.spacesQuery)}\u201D` : ''}</p>
 ${primary.length ? `<div class="md-spaces-cards">${primary.map(space => spaceCard(space, data, ui)).join('')}</div>` : ''}
 ${others.length ? `<h3 class="md-spaces-others-title">${primary.length ? m("meridian.text.0817") : m("meridian.text.1151")} <span>${others.length}</span></h3><div class="md-spaces-others">${others.map(space => spaceCard(space, data, ui, true)).join('')}</div>` : ''}
 ${!visible.length ? `<div class="md-spaces-empty">${glyph('search', 'sage', 30)}<h3>${m("meridian.text.0820")}</h3><p>${m("meridian.text.0819")}</p>${button(m("meridian.text.0818"), 'spaces-clear', 'refresh')}</div>` : ''}
 </section><section class="md-spaces-privacy">${icon('shield', 20)}<div><strong>${m("meridian.text.0895")}</strong><p>${m("meridian.text.0833")}</p></div>${button(m("meridian.text.0821"), 'panel:memory', 'arrow')}</section>
 </div><aside class="md-spaces-insights" aria-label="${m("meridian.text.0832")}">
 <section class="md-spaces-insight"><header><h2>${icon('aura', 23)} ${m("meridian.text.1023")}</h2>${tag(data.networkOnline ? m("meridian.text.0705") : m("meridian.text.0822"), 'sage')}</header><p>${alerts.length ? `${alerts.length} ${m("meridian.text.0823")}` : m("meridian.text.0824")}</p><div class="md-spaces-alerts">${alerts.map(space => `<button type="button" data-action="space:${space.id}">${glyph(space.icon, space.tone, 19)}<span><strong>${esc(space.name)}</strong><small>${esc(space.dashboard.attention.detail)}</small><time>${esc(space.dashboard.attention.time)}</time></span></button>`).join('')}</div>${button(m("meridian.text.0825"), 'route:intelligence', 'arrow')}</section>
 <section class="md-spaces-insight"><header><h2>${m("meridian.text.0831")}</h2>${button(m("meridian.text.0826"), 'route:activity', 'arrow')}</header>${activity.map(item => { const space = data.spaces.find(space => space.id === item.space); return `<button class="md-spaces-event" type="button" data-action="space:${space.id}">${glyph(item.icon, space.tone, 18)}<span><strong>${esc(item.title)}</strong><small>${esc(space.name)}</small><time>${esc(item.time)}</time></span></button>`; }).join('') || `<p>${m("meridian.text.0827")}</p>`}</section>
 <section class="md-spaces-insight"><header><h2>${m("meridian.text.0830")}</h2>${button(m("meridian.text.0828"), 'route:store', 'arrow')}</header><div class="md-spaces-templates">${(data.spaceTemplates ?? []).map(item => `<button type="button" data-action="spaces-template:${esc(item.id)}" aria-label="${m("meridian.text.0829")} ${esc(item.name)}">${glyph(item.icon, item.tone, 24)}<span>${esc(item.name)}</span></button>`).join('')}</div></section>
 </aside></div>`;
}
function spacesView(data, ui) {
    return `<div class="md-spaces-body"><label class="md-spaces-search" for="md-spaces-search">${icon('search', 18)}<input id="md-spaces-search" type="search" data-spaces-search value="${esc(ui.spacesQuery ?? '')}" placeholder="${m("meridian.text.0840")}" aria-label="${m("meridian.text.0839")}"/></label>${dashboard(data, ui)}</div>`;
}
 return {isSpaceFavorite,filterSpaces,spacesView};
}

export const {isSpaceFavorite,filterSpaces,spacesView}=createSpacesView();
