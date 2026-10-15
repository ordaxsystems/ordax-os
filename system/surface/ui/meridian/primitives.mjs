import {icon} from "./icons.mjs";
export {icon};
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const button = (label, action, glyph = '', kind = 'quiet') => `<button type="button" class="md-button md-button--${kind}" data-action="${esc(action)}" aria-label="${esc(label)}">${glyph ? icon(glyph,18) : ''}<span>${esc(label)}</span></button>`;
export const iconButton = (label, action, glyph, extra = '') => `<button type="button" class="md-icon-button ${extra}" data-action="${esc(action)}" aria-label="${esc(label)}" title="${esc(label)}" data-tooltip="${esc(label)}">${icon(glyph)}</button>`;
export const tag = (label, tone = '') => `<span class="md-tag ${tone ? `md-tag--${tone}` : ''}">${esc(label)}</span>`;
export const glyph = (name, tone = 'slate', size = 22) => `<span class="md-glyph md-glyph--${tone}">${icon(name,size)}</span>`;
