import { materialOptions, findMaterial } from '../catalog.mjs';
import { esc, icon } from '../ui.mjs';

// Settings and the quick panel render the same collection. The miniature reads
// the actual scoped tokens, including each palette's light/dark colour scheme.
export function materialCollection(ui,scope='settings'){
 const selected=findMaterial(ui.material)??materialOptions[0];
 return `<p class="md-material-intro">Escolha a atmosfera do seu OrdaX. O trabalho, os contextos e as janelas continuam no mesmo lugar.</p>
 <div class="md-material-options" role="group" aria-label="Coleção de materiais Meridian">${materialOptions.map(item=>`<button id="md-material-${esc(scope)}-${item.id}" type="button" data-action="material:${item.id}" class="md-material-option ${selected.id===item.id?'is-active':''}" aria-pressed="${selected.id===item.id}" aria-label="${esc(item.name+' · '+item.mode)}">
 <span class="md-material-swatch" data-material-preview="${item.id}" aria-hidden="true"><span class="md-material-mini-rail"><i></i><i></i><i></i></span><span class="md-material-mini-page"><i class="md-material-mini-heading"></i><span class="md-material-mini-composer"><i></i></span><span class="md-material-mini-cards"><i></i><i></i></span></span></span>
 <span class="md-material-name"><strong>${esc(item.name)}</strong><span>${esc(item.mode)}</span>${selected.id===item.id?icon('check',16):''}</span><small>${esc(item.copy)}</small></button>`).join('')}</div>
 <p class="md-hint" role="status" aria-live="polite">${esc(selected.name)} em uso nesta sessão. Recarregar o preview restaura o material do link.</p>`;
}
