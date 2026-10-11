import { Component, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { createUnavailableAppStoreCatalogPort } from '../../contracts/app-store.mjs';
import { StoreCatalogProvider } from '../../surface/workspace/components/store/catalog-context';
import { Central } from '../../surface/workspace/components/central/central';
import { createSurfaceBootScreen } from '../../surface/ui/boot-screen.mjs';
import { translateSurfaceMessage } from '../../services/i18n/surface.mjs';
import '../../surface/ui/tokens.css';
import '../../surface/workspace/components/central/styles.css';
import '../../surface/ui/boot-screen.css';
const boot = createSurfaceBootScreen(document);
const text = (id: string) => translateSurfaceMessage('pt-BR', id);
boot.setStage(text('surface.boot.loadingSurface'));
const root = document.querySelector('#ordax-root');
if (!root) throw new Error('OrdaX composition root is missing #ordax-root');
const route = createRootRoute();
const storeCatalog = createUnavailableAppStoreCatalogPort('web-store-transport-unavailable');
class WorkspaceBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch() { boot.fail(text('surface.boot.failed')); }
  render() { return this.state.failed ? <p role="alert">{text('surface.boot.failed')}</p> : this.props.children; }
}
function Workspace() {
  useEffect(() => { boot.ready(); }, []);
  return <><StoreCatalogProvider port={storeCatalog}><Central/></StoreCatalogProvider><Toaster/></>;
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
  createRoot(root).render(<WorkspaceBoundary><RouterProvider router={router}/></WorkspaceBoundary>);
} catch (error) {
  boot.fail(text('surface.boot.failed'));
  throw error;
}
