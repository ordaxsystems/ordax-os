export const APP_PRESENTATION_MANIFEST_SCHEMA = "ordax.app-presentation-manifest/1";
const APP_ID_RE=/^[a-z][a-z0-9-]{0,63}$/;
const SEMVER_RE=/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const LOCALE_RE=/^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const MONOGRAM_RE=/^[A-Z0-9]{1,8}$/;
const EXPECTED_FIELDS=new Set(["schema","appId","appVersion","authority","sourceLocale","description","monogram","singleton","translations"]);
const COPY_FIELDS=new Set(["title","description"]);
function exactFields(value,expected,label){const keys=Object.keys(value);if(keys.length!==expected.size||keys.some(k=>!expected.has(k)))throw new TypeError(`${label} fields are not canonical`);}
function boundedText(value,label,max){if(typeof value!=="string"||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError(`${label} is invalid`);return value;}
export function validateAppPresentationManifest(value,expected={}){
 if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError("App presentation manifest must be an object");
 exactFields(value,EXPECTED_FIELDS,"App presentation manifest");
 if(value.schema!==APP_PRESENTATION_MANIFEST_SCHEMA)throw new TypeError("App presentation manifest schema is incompatible");
 if(typeof value.appId!=="string"||!APP_ID_RE.test(value.appId))throw new TypeError("App presentation app id is invalid");
 if(typeof value.appVersion!=="string"||!SEMVER_RE.test(value.appVersion))throw new TypeError("App presentation app version is invalid");
 if(expected.appId!==undefined&&value.appId!==expected.appId)throw new TypeError("App presentation app identity drifted");
 if(expected.appVersion!==undefined&&value.appVersion!==expected.appVersion)throw new TypeError("App presentation app version drifted");
 if(value.authority!=="none")throw new TypeError("App presentation manifest must not carry authority");
 if(typeof value.sourceLocale!=="string"||!LOCALE_RE.test(value.sourceLocale))throw new TypeError("App presentation source locale is invalid");
 const description=boundedText(value.description,"App presentation description",320);
 if(typeof value.monogram!=="string"||!MONOGRAM_RE.test(value.monogram))throw new TypeError("App presentation monogram is invalid");
 if(typeof value.singleton!=="boolean")throw new TypeError("App presentation singleton flag is invalid");
 if(!value.translations||typeof value.translations!=="object"||Array.isArray(value.translations))throw new TypeError("App presentation translations are invalid");
 const translations={};
 for(const [locale,copy] of Object.entries(value.translations)){
  if(!LOCALE_RE.test(locale)||locale===value.sourceLocale)throw new TypeError("App presentation translation locale is invalid");
  if(!copy||typeof copy!=="object"||Array.isArray(copy))throw new TypeError("App presentation translation copy is invalid");
  exactFields(copy,COPY_FIELDS,"App presentation translation");
  translations[locale]=Object.freeze({title:boundedText(copy.title,"App presentation translated title",160),description:boundedText(copy.description,"App presentation translated description",320)});
 }
 return Object.freeze({schema:APP_PRESENTATION_MANIFEST_SCHEMA,appId:value.appId,appVersion:value.appVersion,authority:"none",sourceLocale:value.sourceLocale,description,monogram:value.monogram,singleton:value.singleton,translations:Object.freeze(translations)});
}
