import { Component, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { createUnavailableAppStoreCatalogPort } from '../../contracts/app-store.mjs';
import { StoreCatalogProvider } from '../../surface/workspace/components/store/catalog-context';
import { Central } from '../../surface/workspace/components/central/central';
import { WebAccountProvider, useWebAccount } from '../../surface/workspace/components/central/account-context';
import { createWebAccountSession } from './account-session.mjs';
import { createWebPreferenceStore } from '../../adapters/web/preferences.mjs';
import { createPreferenceRuntime } from '../../services/preferences/runtime.mjs';
import { WebPreferencesProvider } from '../../surface/workspace/components/central/preferences-context';
import { createSurfaceBootScreen } from '../../surface/ui/boot-screen.mjs';
import { SURFACE_BOOT_SOURCE_MESSAGES } from '../../services/i18n/catalog/boot.mjs';
import '../../surface/ui/tokens.css';
import '../../surface/ui/color-palettes.css';
import '../../surface/ui/settings.css';
import '../../surface/ui/sidebar-hints.css';
import '../../surface/workspace/components/central/styles.css';
import '../../surface/ui/sidebar-layout.css';
import '../../surface/ui/boot-screen.css';
const boot = createSurfaceBootScreen(document);
// This composition currently uses pt-BR; boot text still has one canonical catalog.
const text = (id: keyof typeof SURFACE_BOOT_SOURCE_MESSAGES) => SURFACE_BOOT_SOURCE_MESSAGES[id];
boot.setStage(text('surface.boot.loadingSurface'));
const root = document.querySelector('#ordax-root');
if (!root) throw new Error('OrdaX composition root is missing #ordax-root');
let reactRoot: Root | undefined;
const route = createRootRoute();
const storeCatalog = createUnavailableAppStoreCatalogPort('web-store-transport-unavailable');
const accountSession = createWebAccountSession(window);
const preferences = createPreferenceRuntime(createWebPreferenceStore(window));
void accountSession.refresh();
const disposeServices = () => { accountSession.dispose(); preferences.dispose(); };
const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) disposeServices(); };
window.addEventListener('pagehide', onPageHide);
// Hot replacement owns a single React root and tears it down before consumed ports.
import.meta.hot?.dispose(() => { reactRoot?.unmount(); window.removeEventListener('pagehide', onPageHide); disposeServices(); });
class WorkspaceBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch() { boot.fail(text('surface.boot.failed')); }
  render() { return this.state.failed ? <p role="alert">{text('surface.boot.failed')}</p> : this.props.children; }
}
function SessionWorkspace() {
  const { identity } = useWebAccount();
  return <Central key={identity.state === 'signed-in' ? 'account:' + identity.subjectId : 'no-account'}/>;
}
function Workspace() {
  useEffect(() => { boot.ready(); }, []);
  return <><WebPreferencesProvider port={preferences}><WebAccountProvider session={accountSession}><StoreCatalogProvider port={storeCatalog}><SessionWorkspace/></StoreCatalogProvider></WebAccountProvider></WebPreferencesProvider><Toaster/></>;
}
const web = createRoute({
  getParentRoute: () => route, path: '/',
  component: Workspace
});
// Canonical Web product entry. Unknown paths do not become alternate product mounts.
const router = createRouter({basepath: '/',
  trailingSlash: 'always', routeTree: route.addChildren([web])});
try {
  boot.setStage(text('surface.boot.loadingApps'));
  document.documentElement.lang = 'pt-BR';
  reactRoot = createRoot(root);
  reactRoot.render(<WorkspaceBoundary><RouterProvider router={router}/></WorkspaceBoundary>);
} catch (error) {
  boot.fail(text('surface.boot.failed'));
  throw error;
}
