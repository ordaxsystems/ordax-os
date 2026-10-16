// Localized shared presentation. No account, device or backend authority.
import {translateSurfaceMessage} from '../../../../services/i18n/surface.mjs';
import { createSpacesView } from './view.mjs';
import { createSpaceExamples } from './examples.mjs';
import { esc, button } from '../../meridian/primitives.mjs';

export function createSpacesPresentation(locale='pt-BR') {
 const m=id=>translateSurfaceMessage(locale,id);
 const {spacesView}=createSpacesView(locale); const {spaceExamples,spaceActivityExamples,spaceTemplateExamples}=createSpaceExamples(locale);
// Local examples only. No account session, transport, storage, or command authority.
/** @param {ShadowRoot} root @param {{onNavigate?:(title:string)=>void}} options */
function mountSpacesPresentation(root, { onNavigate = () => { } } = {}) {
    const data = { spaces: structuredClone(spaceExamples), spaceActivity: spaceActivityExamples, spaceTemplates: spaceTemplateExamples, activeSpace: 'achegue', presentationSubject: 'examples', networkOnline: true };
    const ui = { spacesQuery: '', spacesCategory: m("meridian.text.0804"), spacesSort: 'recent', spaceFavorites: {} };
    const page = root.querySelector('[data-spaces-page]');
    const dialog = root.querySelector('dialog');
    let returnFocus = null;
    function render(focusAction) {
        page.innerHTML = spacesView(data, ui);
        if (focusAction) {
            const target = [...page.querySelectorAll('[data-action]')].find(item => item.dataset.action === focusAction);
            target?.focus();
        }
    }
    function close() { dialog.close(); returnFocus?.focus(); }
    function show(title, body, trigger) {
        returnFocus = trigger;
        dialog.innerHTML = `<form method="dialog"><header><h2>${esc(title)}</h2><button aria-label="${m("meridian.text.0726")}" value="close">${"×"}</button></header>${body}<footer><button value="close" class="md-button">${m("meridian.text.0726")}</button></footer></form>`;
        dialog.showModal();
    }
    function create(template, trigger) {
        show(m("meridian.text.0462"), `<p>${m("meridian.text.0843")}</p><label>${m("meridian.text.0452")}<input name="spaceName" maxlength="80" required placeholder="${m("meridian.text.0453")}"/></label><label>${m("meridian.text.0896")}<select name="template">${data.spaceTemplates.map(item => `<option value="${esc(item.id)}" ${template === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><p class="md-space-example-note">${m("meridian.text.0842")}</p><button type="button" class="md-button md-button--solid" data-example-create>${m("meridian.text.0841")}</button>`, trigger);
    }
    function click(event) {
        const target = event.target.closest?.('[data-action]');
        if (!target)
            return;
        const action = target.dataset.action;
        const split = action.indexOf(':');
        const name = split < 0 ? action : action.slice(0, split), id = split < 0 ? '' : action.slice(split + 1);
        if (name === 'spaces-filter') {
            ui.spacesCategory = id;
            render(action);
        }
        else if (name === 'spaces-sort') {
            ui.spacesSort = ui.spacesSort === 'name' ? 'recent' : 'name';
            render(action);
        }
        else if (name === 'spaces-clear') {
            ui.spacesQuery = '';
            ui.spacesCategory = m("meridian.text.0804");
            render();
            page.querySelector('[data-spaces-search]')?.focus();
        }
        else if (name === 'spaces-favorite') {
            const space = data.spaces.find(item => item.id === id);
            if (!space)
                return;
            const key = JSON.stringify(['examples', id]);
            ui.spaceFavorites[key] = !(ui.spaceFavorites[key] ?? space.dashboard?.favorite ?? false);
            render(action);
        }
        else if (name === 'select-space') {
            if (data.spaces.some(item => item.id === id)) {
                data.activeSpace = id;
                render();
                page.querySelector('.md-spaces-hero').scrollIntoView({ block: 'nearest' });
            }
        }
        else if (name === 'space') {
            const space = data.spaces.find(item => item.id === id);
            if (space)
                show(space.name, `<p>${esc(space.description)}</p><dl><dt>${m("meridian.text.0772")}</dt><dd>${esc(space.members)}</dd><dt>${m("meridian.text.0424")}</dt><dd>${space.modules.map(esc).join(" · ")}</dd><dt>${m("meridian.text.0290")}</dt><dd>${esc(space.permission)}</dd><dt>${m("meridian.text.0877")}</dt><dd>${esc(space.storage)}</dd></dl><p class="md-space-example-note">${m("meridian.text.0844")}</p>`, target);
        }
        else if (name === 'spaces-template')
            create(id, target);
        else if (name === 'panel' && id === 'new-space')
            create('', target);
        else if (name === 'route') {
            const routes = { intelligence: m("meridian.text.1155"), activity: m("meridian.text.1156"), store: m("meridian.text.1157") };
            if (routes[id])
                onNavigate(routes[id]);
        }
        else if (name === 'panel' && id === 'memory')
            show(m("meridian.text.0845"), `<p>${m("meridian.text.0846")}</p>`, target);
    }
    function input(event) { if (!event.target.matches('[data-spaces-search]'))
        return; const position = event.target.selectionStart; ui.spacesQuery = event.target.value; render(); const field = page.querySelector('[data-spaces-search]'); field.focus(); if (position !== null)
        field.setSelectionRange(position, position); }
    function confirm(event) { if (!event.target.closest('[data-example-create]'))
        return; const form = dialog.querySelector('form'); if (!form.reportValidity())
        return; const name = form.elements.namedItem('spaceName').value.trim(); if (!name)
        return; dialog.querySelector('.md-space-example-note').textContent = `${name}${m("meridian.text.0847")}`; }
    function cancel() { returnFocus?.focus(); }
    page.addEventListener('click', click);
    page.addEventListener('input', input);
    dialog.addEventListener('click', confirm);
    dialog.addEventListener('close', cancel);
    render();
    return { setMaterial(material) { root.querySelector('[data-meridian]').setAttribute('data-material', material); }, destroy() { page.removeEventListener('click', click); page.removeEventListener('input', input); dialog.removeEventListener('click', confirm); dialog.removeEventListener('close', cancel); if (dialog.open)
            close(); page.innerHTML = ''; } };
}
 return {mountSpacesPresentation};
}

export function mountSpacesPresentation(root,options={}) { return createSpacesPresentation(options.locale??'pt-BR').mountSpacesPresentation(root,options); }
