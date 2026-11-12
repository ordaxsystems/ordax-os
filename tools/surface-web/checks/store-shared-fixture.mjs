// Browser-only regression data. Never imported by either product composition.
import {mountStoreExperience, mountStoreWindows} from '../../../system/surface/ui/store-experience.mjs';
import {createStoreViewLifecycle} from '../../../system/surface/ui/store-view-lifecycle.mjs';
import {createPreferenceRuntime} from '../../../system/services/preferences/runtime.mjs';
import {createSurfaceLocalization} from '../../../system/services/i18n/surface.mjs';
import {createUnavailableAppStoreCatalogPort} from '../../../system/contracts/app-store.mjs';

if (!['127.0.0.1','localhost'].includes(location.hostname)) throw Error('Loopback regression only');
const preferences = createPreferenceRuntime({schema:'ordax.preference-store/1',load:()=>({}),save:()=>{}});
const localization = createSurfaceLocalization(preferences);
const lifecycle = createStoreViewLifecycle(localization);
const entry = {appId:'proof-app',title:'Aplicativo verificado de teste',state:'available',installedVersion:null,availableVersion:'1.0.0',installable:true,updatable:false,removable:false,blockedReason:null,artifactIdentityVerified:true,provenanceVerified:true};
const snapshot = {schema:'ordax.app-store-catalog/2',state:'ready',entries:[entry],reason:null,authority:'none'};
const catalogListeners = new Set();
const catalog = {schema:'ordax.app-store-catalog-port/2',authority:'none',getSnapshot:()=>snapshot,subscribe(listener){catalogListeners.add(listener);return()=>catalogListeners.delete(listener);}};
const requests = [];
const requestPort = {schema:'ordax.app-lifecycle-request-port/1',authority:'none',async requestLifecycle(request){requests.push(request);return {...request,schema:'ordax.app-lifecycle-request-result/1',state:'accepted',reason:null};}};
const web = mountStoreExperience(document.querySelector('#web'),{catalogPort:createUnavailableAppStoreCatalogPort(),surfaceLifecycle:lifecycle});
const native = mountStoreWindows(document.querySelector('#native'),catalog,lifecycle,requestPort);
window.storeProof = {requests,entry,snapshot,catalogListeners,lifecycle,web,native};
