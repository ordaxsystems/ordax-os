import { defineFirstPartyApp } from "../../apps/app-contract.mjs";
import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { validateAppPresentationManifest } from "../../contracts/app-presentation-manifest.mjs";
export function defineExternalFirstPartyApp(componentValue,presentationValue){
 const component=defineComponentManifest(componentValue);
 if(component.kind!=="app"||component.releaseMode!=="component-slot")throw new TypeError("External first-party presentation requires a component-slot app");
 const presentation=validateAppPresentationManifest(presentationValue,{appId:component.id,appVersion:component.version});
 const bundledLocales=Object.freeze([presentation.sourceLocale,...Object.keys(presentation.translations)]);
 const app=defineFirstPartyApp({id:component.id,title:component.title,description:presentation.description,monogram:presentation.monogram,singleton:presentation.singleton,component,localization:{sourceLocale:presentation.sourceLocale,bundledLocales,packPolicy:"component-scoped"},requiredCapabilities:[],optionalCapabilities:[],panels:[{kind:"extension",extensionId:component.id,label:component.title,title:component.title,body:""}]});
 return Object.freeze({...app,presentation:Object.freeze({sourceLocale:presentation.sourceLocale,source:Object.freeze({title:component.title,description:presentation.description}),translations:presentation.translations})});
}
export function externalAppCopy(app,locale){if(!app?.presentation||typeof app.presentation!=="object")throw new TypeError("External app presentation metadata is missing");const source=app.presentation.source;const translated=app.presentation.translations?.[locale]??null;return Object.freeze({title:translated?.title??source.title,description:translated?.description??source.description});}
