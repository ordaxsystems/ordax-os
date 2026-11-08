import { isLocalStorePreviewOrigin } from './preview-origin.js';

// Never import demonstration data, reducers or simulated install actions on
// deployed/non-loopback origins. This is an isolated local design preview only.
if (!isLocalStorePreviewOrigin(window.location)) {
  const notice = document.createElement('main');
  notice.setAttribute('role', 'alert');
  notice.textContent = 'Prévia de demonstração da Loja indisponível fora do ambiente local.';
  document.body.replaceChildren(notice);
} else {
  const { mountStorePresentation } = await import('../../../surface/workspace/components/store/presentation/app.js');
  const presentation = mountStorePresentation(document);
  import.meta.hot?.dispose(() => presentation.destroy());
}
