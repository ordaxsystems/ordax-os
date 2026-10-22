import React from 'react';
import {surfaceMessageIds,translateSurfaceMessage} from '../../system/services/i18n/surface.mjs';
import {renderToStaticMarkup} from 'react-dom/server';
import {MeridianHome} from '../../system/surface/workspace/components/central/meridian-home';
import {WorkspaceNavigation} from '../../system/surface/workspace/components/central/meridian-navigation';
import {ServiceOverview} from '../../system/surface/workspace/components/central/service-overview';
import {WebSettings} from '../../system/surface/workspace/components/central/settings';
import {AccountPanel} from '../../system/surface/workspace/components/central/primitives';
import {FavoriteShortcutsPanel} from '../../system/surface/workspace/components/central/favorite-shortcuts';
import {ProfileCatalogPanel} from '../../system/surface/workspace/components/central/profile-catalog';
import {createSpacesView} from '../../system/surface/ui/spaces/presentation/view.mjs';
import {createSpaceExamples} from '../../system/surface/ui/spaces/presentation/examples.mjs';
import '../../system/surface/ui/spaces/presentation/styles.css';
import {navigation} from '../../system/surface/workspace/components/central/config';
import '../../system/surface/ui/tokens.css';
import '../../system/surface/ui/color-palettes.css';
import '../../system/surface/workspace/components/central/styles.css';
import '../../system/surface/ui/sidebar-layout.css';
import '../../system/surface/ui/meridian.tokens.css';
import '../../system/surface/ui/meridian.css';
import '../../system/surface/workspace/components/central/meridian.css';
const noop=()=>{};
const canonicalizeSnapshotHome=(value:string)=>value
 .replace(/<time dateTime="[^"]*">[^<]*<\/time>/,'<time dateTime="2000-01-01T09:00:00.000Z">sábado, 1 de janeiro</time>')
 .replace(/<h1>(?:Bom dia|Boa tarde|Boa noite)([^<]*)<\/h1>/,'<h1>Bom dia$1</h1>');
const clean=(value:string)=>value.replace(/ xmlns="[^"]*"/g,'').replace(/<link rel="preload"[^>]*>/g,'').replace(/ href="https?:[^"]*"/g,' aria-disabled="true"');
export function snapshot(){
 const home=canonicalizeSnapshotHome(renderToStaticMarkup(<MeridianHome theme="light" onOpen={noop} onExample={noop} onPrompt={noop}/>));
 const chrome=renderToStaticMarkup(<div className="window-workspace meridian-workspace demo-native-root" data-meridian="" data-material="paper" data-view="central" data-sidebar="expanded" data-compact="none" data-running="false"><div className="workspace-stage"><div className="central-presentation"><div className="os-shell"><main className="os-main"><div className="central-content" data-public-demo-content>{/* Public renderer inserts the selected snapshot here. */}</div></main></div></div></div><div className="compact-reservation" aria-hidden="true"/><WorkspaceNavigation onSidebarChange={noop} state={{windows:[],active:null,compactActive:null,compactCollapsed:false}} dispatch={noop} view="central" onToggleView={noop} onCentral={noop}/></div>);
 const examples=createSpaceExamples();
 const spaces=createSpacesView().spacesView({spaces:examples.spaceExamples,spaceActivity:examples.spaceActivityExamples,spaceTemplates:examples.spaceTemplateExamples,activeSpace:'achegue',presentationSubject:'examples',networkOnline:true},{spacesQuery:'',spacesCategory:'Todos',spacesSort:'recent',spaceFavorites:{}});
 const views:Record<string,string>={spaces:'<div data-meridian class="md-page--spaces">'+spaces+'</div>',apps:clean(renderToStaticMarkup(<FavoriteShortcutsPanel onOpen={noop} showHelp/>)),profiles:clean(renderToStaticMarkup(<ProfileCatalogPanel/>)),account:clean(renderToStaticMarkup(<AccountPanel onOpen={noop}/>)),home:clean(home),settings:clean(renderToStaticMarkup(<WebSettings onOpen={noop}/>))};
 for(const area of ['projects','files','devices','activity','continuity'] as const) views[area]=clean(renderToStaticMarkup(<ServiceOverview area={area} onOpen={noop}/>));
 return {sourceCopy:Object.fromEntries(surfaceMessageIds().map(id=>[translateSurfaceMessage('pt-BR',id),translateSurfaceMessage('en-US',id)])),chrome:clean(chrome),views,navigation:navigation.map(({name,target,rail})=>({name,target:target??name,rail:!!rail}))};
}
