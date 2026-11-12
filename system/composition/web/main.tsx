import { ProfileCatalogProvider } from '../../surface/workspace/components/central/profile-catalog-context';
import { Component, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { createUnavailableAppStoreCatalogPort } from '../../contracts/app-store.mjs';
import { createUnavailableWebIntelligencePort } from '../../adapters/web/intelligence.mjs';
import { StoreCatalogProvider } from '../../surface/workspace/components/store/catalog-context';
import { IntelligenceClientProvider } from '../../surface/workspace/components/intelligence/client-context';
import { Central } from '../../surface/workspace/components/central/central';
import { WebAccountProvider, useWebAccount } from '../../surface/workspace/components/central/account-context';
import { createWebAccountSession } from './account-session.mjs';
import { createWebEntryLifecycle, isLocalWebLayoutPreview, WEB_LOGIN_PATH } from './auth-entry-gate.mjs';
import { createWebPreferenceStore } from '../../adapters/web/preferences.mjs';
import { createPreferenceRuntime } from '../../services/preferences/runtime.mjs';
import { WebPreferencesProvider } from '../../surface/workspace/components/central/preferences-context';
import { createSurfaceBootScreen } from '../../surface/ui/boot-screen.mjs';
import { SURFACE_BOOT_SOURCE_MESSAGES } from '../../services/i18n/catalog/boot.mjs';
import '../../surface/ui/tokens.css';
import '../../surface/ui/color-palettes.css';
import '../../surface/ui/settings.css';
import '../../surface/ui/notification-center.css';
import '../../surface/ui/sidebar-hints.css';
import '../../surface/workspace/components/central/styles.css';
import '../../surface/ui/sidebar-layout.css';
import '../../surface/ui/brand/symbol.css';
import '../../surface/ui/boot-screen.css';
import '../../surface/ui/meridian.tokens.css';
import '../../surface/ui/meridian.css';
import '../../surface/workspace/components/central/meridian.css';
import '../../surface/ui/journeys/settings.css';
import './responsive.css';
const readWebProfileCatalog = (signal: AbortSignal) => import('./profile-catalog').then(module => module.readWebProfileCatalog(signal));

type IdentitySnapshot = {
  state: 'unavailable' | 'signed-out' | 'signed-in';
  subjectId: string | null;
  displayName: string | null;
};

document.documentElement.setAttribute('data-meridian', '');
const boot = createSurfaceBootScreen(document);
// This composition currently uses pt-BR; boot text still has one canonical catalog.
const text = (id: keyof typeof SURFACE_BOOT_SOURCE_MESSAGES) => SURFACE_BOOT_SOURCE_MESSAGES[id];
boot.setStage(text('surface.boot.loadingSurface'));
const rootCandidate = document.querySelector('#ordax-root');
if (!rootCandidate) throw new Error('OrdaX composition root is missing #ordax-root');
const compositionRoot: Element = rootCandidate;
let reactRoot: Root | undefined;
let releaseIdentityGate = () => {};
let releaseEntryLifecycle = () => {};
const route = createRootRoute();
const storeCatalog = createUnavailableAppStoreCatalogPort('web-store-transport-unavailable');
// Web consumes the canonical Intelligence port. Until a supported transport is composed,
// the adapter remains explicitly unavailable rather than owning a second provider or API.
const intelligence = createUnavailableWebIntelligencePort();
const accountSession = createWebAccountSession(window);
const preferences = createPreferenceRuntime(createWebPreferenceStore(window));
const localLayoutPreview = isLocalWebLayoutPreview(window);
const disposeServices = () => {
  releaseIdentityGate();
  releaseIdentityGate = () => {};
  releaseEntryLifecycle();
  accountSession.dispose();
  preferences.dispose();
};
const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) disposeServices(); };
window.addEventListener('pagehide', onPageHide);
// Hot replacement owns a single React root and tears it down before consumed ports.
import.meta.hot?.dispose(() => { reactRoot?.unmount(); window.removeEventListener('pagehide', onPageHide); disposeServices(); });
class WorkspaceBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed:true}; }
  componentDidCatch() { boot.fail(text('surface.boot.failed')); }
  render() { return this.state.failed ? <p role="alert">{text('surface.boot.failed')}</p> : this.props.children; }
}
function SessionWorkspace() {
  const { identity } = useWebAccount();
  if (!localLayoutPreview && identity.state !== 'signed-in') return null;
  return <Central key={identity.state === 'signed-in' ? 'account:' + identity.subjectId : 'layout-preview'}/>;
}
function Workspace() {
  useEffect(() => { boot.ready(); }, []);
  return <><WebPreferencesProvider port={preferences}><WebAccountProvider session={accountSession}><StoreCatalogProvider port={storeCatalog}><IntelligenceClientProvider port={intelligence}><ProfileCatalogProvider read={readWebProfileCatalog}><SessionWorkspace/></ProfileCatalogProvider></IntelligenceClientProvider></StoreCatalogProvider></WebAccountProvider></WebPreferencesProvider><Toaster/></>;
}
const web = createRoute({
  getParentRoute: () => route, path: '/',
  component: Workspace
});
// The build base owns both asset URLs and the Router mount. A relative default
// is rooted at / for the canonical host; an explicitly mounted bundle may use
// --base /preview-os/ without changing the product's routes or permissions.
const sourceCompositionBasepath = '/system/composition/web/';
const webBasepath = import.meta.env.BASE_URL === './'
  ? '/'
  : import.meta.env.BASE_URL === '/' && window.location.pathname.startsWith(sourceCompositionBasepath)
    ? sourceCompositionBasepath
    : import.meta.env.BASE_URL;
const router = createRouter({basepath: webBasepath,
  trailingSlash: 'always', routeTree: route.addChildren([web])});

// Keep one identity subscription across initial verification and transient
// failures. A later authenticated refresh can restore the workspace without
// reloading the page or trusting stale session/device state.
const entry = createWebEntryLifecycle({
  allowLocalLayoutPreview: localLayoutPreview,
  onWorkspace() {
    if (reactRoot) return;
    compositionRoot.replaceChildren();
    boot.setStage(text('surface.boot.loadingApps'));
    reactRoot = createRoot(compositionRoot);
    reactRoot.render(<WorkspaceBoundary><RouterProvider router={router}/></WorkspaceBoundary>);
  },
  onLogin() {
    reactRoot?.unmount();
    reactRoot = undefined;
    window.location.replace(WEB_LOGIN_PATH);
  },
  onUnavailable() {
    reactRoot?.unmount();
    reactRoot = undefined;
    if (!boot.isFinished()) {
      boot.fail(text('surface.boot.failed'));
      return;
    }
    // The boot screen is terminal after ready(). Never leave a blank page if
    // an authenticated session becomes unavailable after the first render.
    const notice = document.createElement('p');
    notice.className = 'ordax-web-recovery';
    notice.setAttribute('role', 'alert');
    notice.textContent = text('surface.boot.failed');
    compositionRoot.replaceChildren(notice);
  },
});
releaseEntryLifecycle = () => entry.dispose();

async function startAuthenticatedWorkspace() {
  boot.setStage(text('surface.boot.loadingApps'));
  document.documentElement.lang = 'pt-BR';

  // Subscribed before the first request, but no Surface mounts until the
  // initial same-origin session read completes. The existing account session
  // owns later focus/online refresh; this compositor never retries commands.
  releaseIdentityGate = accountSession.identity.subscribe((snapshot: IdentitySnapshot) => {
    entry.update(snapshot);
  });
  await accountSession.refresh();
  entry.start(accountSession.identity.getSnapshot() as IdentitySnapshot);
}

void startAuthenticatedWorkspace().catch(error => {
  boot.fail(text('surface.boot.failed'));
  throw error;
});
