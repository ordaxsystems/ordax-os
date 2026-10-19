import { mountStoreOverviewControls } from './store-overview-controls.mjs';

const presentationTemplate = new URL('../workspace/components/store/presentation/template.html', import.meta.url);
// Vite otherwise serves a CSS file fetched with fetch() as a JavaScript HMR module.
const presentationStyles = new URL('../workspace/components/store/presentation/styles.css?direct', import.meta.url);
const presentationTokens = new URL('./meridian.tokens.css', import.meta.url);

async function readAsset(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Store presentation asset unavailable');
  return response.text();
}

// Native reads the same source assets that Vite embeds for Web. Resolve font URLs
// against their owner stylesheet, never against the host composition document.
function resolveCssUrls(css, base) {
  return css.replace(/url\(['"]?([^)'"\s]+)['"]?\)/g, (_, value) =>
    `url("${new URL(value, base).href}")`);
}

/** One Store presentation. Only capabilities/ports differ between compositions.
 * @param {HTMLElement} host
 * @param {{catalogPort:any, surfaceLifecycle:any, lifecycleRequestPort?:any,
 * modelHardwareReader?:any, modelMetricsPort?:any, appActivationPort?:any,
 * presentationAssets?:{template:string,styles:string,tokens:string}|null, material?:string}} options
 */
export function mountStoreExperience(host, {
  catalogPort, surfaceLifecycle, lifecycleRequestPort = null,
  modelHardwareReader = null, modelMetricsPort = null, appActivationPort = null,
  presentationAssets = null, material = 'paper',
}) {
  const documentObject = host.ownerDocument;
  const abort = new AbortController();
  let destroyed = false, preview = null, loading = false;
  let mode = catalogPort.getSnapshot().state === 'ready' ? 'official' : 'planned';
  host.classList.add('ordax-store-experience');
  host.setAttribute('data-meridian', '');
  host.dataset.material = material;
  host.innerHTML = '<header class="ordax-store-context"><div><strong data-store-context-title></strong><p data-store-context-note></p></div><button type="button" data-store-switch></button></header><section data-store-planned hidden><p data-store-preview-status role="status"></p><div data-store-preview-host></div></section><section data-store-official><div class="ordax-app-extension" data-app-extension="store-overview"></div></section>';
  const planned = host.querySelector('[data-store-planned]');
  const official = host.querySelector('[data-store-official]');
  const slot = official.querySelector('[data-app-extension="store-overview"]');
  const toggle = host.querySelector('[data-store-switch]');
  const status = host.querySelector('[data-store-preview-status]');
  const t = surfaceLifecycle.localization.translate;

  async function loadPreview() {
    if (preview || loading || destroyed) return;
    loading = true;status.hidden = false;status.textContent = t('store.presentation.loading');
    try {
      const [module, assets] = await Promise.all([
        import('../workspace/components/store/presentation/app.js'),
        presentationAssets ?? Promise.all([
          readAsset(presentationTemplate, abort.signal),
          readAsset(presentationStyles, abort.signal),
          readAsset(presentationTokens, abort.signal),
        ]).then(([template, styles, tokens]) => ({template, styles: resolveCssUrls(styles, presentationStyles), tokens})),
      ]);
      if (destroyed) return;
      const previewHost = host.querySelector('[data-store-preview-host]');
      const shadow = previewHost.shadowRoot ?? previewHost.attachShadow({mode:'open'});
      const sheet = new documentObject.defaultView.CSSStyleSheet();
      sheet.replaceSync(assets.tokens + '\n' + assets.styles);
      shadow.adoptedStyleSheets = [sheet];shadow.innerHTML = assets.template;
      preview = module.mountStorePresentation(shadow, {embedded:true, material});
      status.hidden = true;
    } catch {
      if (!destroyed) {status.hidden = false;status.textContent = t('store.presentation.failed');}
    } finally { loading = false; }
  }

  function renderContext() {
    if (destroyed) return;
    host.dataset.storeMode = mode;
    planned.hidden = mode !== 'planned';official.hidden = mode !== 'official';
    host.querySelector('[data-store-context-title]').textContent = t('store.presentation.' + mode);
    host.querySelector('[data-store-context-note]').textContent = t('store.presentation.' + mode + '.note');
    toggle.textContent = t('store.presentation.switch.' + mode);
    if (mode === 'planned') void loadPreview();
  }
  const onSwitch = () => {mode = mode === 'official' ? 'planned' : 'official';renderContext();};
  toggle.addEventListener('click', onSwitch);
  const controls = mountStoreOverviewControls(host, catalogPort, surfaceLifecycle,
    lifecycleRequestPort, modelHardwareReader, modelMetricsPort, appActivationPort, () => slot);
  const unsubscribe = surfaceLifecycle.localization.subscribe(renderContext);
  renderContext();
  return Object.freeze({
    setMaterial(value) {material = value;host.dataset.material = value;preview?.setMaterial(value);},
    destroy() {
      if (destroyed) return;
      destroyed = true;abort.abort();unsubscribe?.();controls.destroy();preview?.destroy();
      toggle.removeEventListener('click', onSwitch);host.replaceChildren();
    },
  });
}

/** Native window lifecycle adapter; no alternate Store renderer or catalog. */
export function mountStoreWindows(root, catalogPort, surfaceLifecycle,
  lifecycleRequestPort = null, modelHardwareReader = null, modelMetricsPort = null, appActivationPort = null) {
  let slot = null, instance = null;
  function render() {
    const next = root.querySelector('[data-window-id="store"] [data-app-extension="store-overview"]');
    if (next !== slot) {
      instance?.destroy();instance = null;slot = next;
      if (slot) instance = mountStoreExperience(slot, {catalogPort, surfaceLifecycle,
        lifecycleRequestPort, modelHardwareReader, modelMetricsPort, appActivationPort});
    }
    const materialRoot = root.closest?.('[data-material]') ?? root.ownerDocument.documentElement;
    instance?.setMaterial(root.dataset.ordaxTheme === 'dark' || materialRoot.dataset.material === 'ink' ? 'ink' : 'paper');
    if (slot) for (const name of ['data-ordax-contrast', 'data-ordax-motion', 'data-ordax-text-scale', 'data-ordax-display-scale']) {
      const value = root.getAttribute(name);
      if (value !== null) slot.setAttribute(name, value);
    }
  }
  const unsubscribe = surfaceLifecycle.subscribeRender(render);
  render();
  return Object.freeze({destroy() {unsubscribe?.();instance?.destroy();instance = null;slot = null;}});
}
