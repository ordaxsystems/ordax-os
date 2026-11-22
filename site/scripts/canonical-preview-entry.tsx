/**
 * Surface-owned read-only Meridian composition.
 *
 * Installed ONLY into a disposable OS integration host at build time.
 * It composes the actual UI from Surface and reads host-local service contracts.
 * No account/store/device capability is supplied to this SSR presentation.
 */
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MeridianHome} from '../../system/surface/workspace/components/central/meridian-home';
import {WorkspaceNavigation} from '../../system/surface/workspace/components/central/meridian-navigation';
import {ServiceOverview} from '../../system/surface/workspace/components/central/service-overview';
import {WebSettings} from '../../system/surface/workspace/components/central/settings';
import {AccountPanel} from '../../system/surface/workspace/components/central/primitives';
import {FavoriteShortcutsPanel} from '../../system/surface/workspace/components/central/favorite-shortcuts';
import {ProfileCatalogPanel} from '../../system/surface/workspace/components/central/profile-catalog';
import {navigation} from '../../system/surface/workspace/components/central/config';
import {createSpacesView} from '../../system/surface/ui/spaces/presentation/view.mjs';
import {createSpaceExamples} from '../../system/surface/ui/spaces/presentation/examples.mjs';
import {surfaceMessageIds,translateSurfaceMessage} from '../../system/services/i18n/surface.mjs';
import '../../system/surface/ui/tokens.css';
import '../../system/surface/ui/color-palettes.css';
import '../../system/surface/ui/meridian.tokens.css';
import '../../system/surface/ui/meridian.css';
import '../../system/surface/ui/sidebar-layout.css';
import '../../system/surface/ui/spaces/presentation/styles.css';
import '../../system/surface/workspace/components/central/styles.css';
import '../../system/surface/workspace/components/central/meridian.css';

const disabled=()=>{};
const clean=(markup:string)=>markup
  .replace(/ xmlns="[^"]*"/g,'')
  .replace(/<link rel="preload"[^>]*>/g,'')
  .replace(/ href="https?:[^"]*"/g,' aria-disabled="true"');

const snapshotHome=(markup:string)=>markup
  .replace(/<time dateTime="[^"]*">[^<]*<\/time>/,
    '<time dateTime="2000-01-01T09:00:00.000Z">sábado, 1 de janeiro</time>')
  .replace(/<h1>(?:Bom dia|Boa tarde|Boa noite)([^<]*)<\/h1>/,'<h1>Bom dia$1</h1>');

export function renderMeridianPresentation() {
  // This static render is not a signed-in user or a real workspace session.
  const body=renderToStaticMarkup(
    <div className="window-workspace meridian-workspace demo-native-root"
      data-meridian="" data-material="paper" data-view="central"
      data-sidebar="expanded" data-compact="none" data-running="false">
      <div className="workspace-stage"><div className="central-presentation">
        <div className="os-shell"><main className="os-main"><div
          className="central-content" data-public-demo-content="true"/></main></div>
      </div></div>
      <div className="compact-reservation" aria-hidden="true"/>
      <WorkspaceNavigation onSidebarChange={disabled}
        state={{windows:[],active:null,compactActive:null,compactCollapsed:false}}
        dispatch={disabled} view="central"
        onToggleView={disabled} onCentral={disabled}/>
    </div>
  );
  const examples=createSpaceExamples();
  const spaces=createSpacesView().spacesView({
    spaces:examples.spaceExamples,spaceActivity:examples.spaceActivityExamples,
    spaceTemplates:examples.spaceTemplateExamples,
    activeSpace:'achegue',presentationSubject:'examples',networkOnline:true
  },{spacesQuery:'',spacesCategory:'Todos',spacesSort:'recent',spaceFavorites:{}});
  const render=(node:React.ReactElement)=>clean(renderToStaticMarkup(node));
  const views:Record<string,string>={
    home:clean(snapshotHome(renderToStaticMarkup(
      <MeridianHome theme="light" onOpen={disabled} onExample={disabled} onPrompt={disabled}/>
    ))),
    spaces:'<div data-meridian class="md-page--spaces">'+spaces+'</div>',
    apps:render(<FavoriteShortcutsPanel onOpen={disabled} showHelp/>),
    profiles:render(<ProfileCatalogPanel/>),
    account:render(<AccountPanel onOpen={disabled}/>),
    settings:render(<WebSettings onOpen={disabled}/>),
  };
  for(const area of ['projects','files','devices','activity','continuity'] as const)
    views[area]=render(<ServiceOverview area={area} onOpen={disabled}/>);
  return {
    chrome:clean(body),
    views,
    navigation:navigation.map(({name,target,rail})=>({name,target:target??name,rail:!!rail})),
    sourceCopy:Object.fromEntries(surfaceMessageIds().map(id=>[
      translateSurfaceMessage('pt-BR',id),translateSurfaceMessage('en-US',id)
    ])),
  };
}
