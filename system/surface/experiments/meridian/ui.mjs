import { presentationDestination } from '../../workspace/presentation.mjs';
import { icon } from './icons.mjs';
export { icon };
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const button = (label, action, glyph = '', kind = 'quiet') => `<button type="button" class="md-button md-button--${kind}" data-action="${esc(action)}" aria-label="${esc(label)}">${glyph ? icon(glyph,18) : ''}<span>${esc(label)}</span></button>`;
export const iconButton = (label, action, glyph, extra = '') => `<button type="button" class="md-icon-button ${extra}" data-action="${esc(action)}" aria-label="${esc(label)}" title="${esc(label)}" data-tooltip="${esc(label)}">${icon(glyph)}</button>`;
export const tag = (label, tone = '') => `<span class="md-tag ${tone ? `md-tag--${tone}` : ''}">${esc(label)}</span>`;
export const heading = (eyebrow, title, description = '', action = '') => `<header class="md-page-heading"><div><p class="md-eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${description ? `<p class="md-lead">${esc(description)}</p>` : ''}</div>${action}</header>`;
export const section = (title, action = '', subtitle = '') => `<div class="md-section-heading"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${action}</div>`;
export const empty = (title, text, action = '', glyph = 'folder') => `<div class="md-empty"><span class="md-empty-icon">${icon(glyph,32)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
export const avatar = (initials, tone = '') => `<span class="md-avatar ${tone ? `md-avatar--${tone}` : ''}">${esc(initials)}</span>`;
export const glyph = (name, tone = 'slate', size = 22) => `<span class="md-glyph md-glyph--${tone}">${icon(name,size)}</span>`;
export const switchRow = (title, description, checked, action) => `<button type="button" class="md-setting-row" data-action="${esc(action)}" role="switch" aria-checked="${checked}"><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span><span class="md-switch" aria-hidden="true"></span></button>`;
export function searchField(placeholder, name = 'catalog') { return `<label class="md-search-field">${icon('search',18)}<input type="search" name="${name}" data-search="${name}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" autocomplete="off"/></label>`; }
export function notice(message, tone = 'neutral') { return `<div class="md-notice md-notice--${tone}">${icon(tone === 'warning' ? 'wifi' : 'shield',18)}<p>${esc(message)}</p></div>`; }

// Presentation labels come from the same destination policy in rail/menu/dock.
export function presentationControl(presentation){const destination=presentationDestination(presentation);return {label:destination.target==='desktop'?'Área de trabalho':'Voltar à Central',icon:destination.target==='desktop'?'desktop':'central'};}
