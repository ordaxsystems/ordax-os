// Shared Meridian rail structure; presenters supply environment-bound actions.
export const MERIDIAN_RAIL_DESTINATIONS = Object.freeze([
 {key:'home',name:'Início',englishName:'Home',icon:'LayoutGrid',glyph:'central'},
 {key:'intelligence',name:'Aura',englishName:'Aura',icon:'Sparkles',glyph:'aura',group:'principal'},
 {key:'spaces',name:'Espaços',englishName:'Spaces',icon:'WalletCards',glyph:'spaces',group:'principal'},
 {key:'apps',name:'Aplicativos',englishName:'Applications',icon:'LayoutGrid',glyph:'apps',group:'principal'},
 {key:'profiles',name:'Perfis profissionais',englishName:'Professional profiles',icon:'BriefcaseBusiness',glyph:'profiles',group:'ecossistema'},
 {key:'devices',name:'Dispositivos',englishName:'Devices',icon:'MonitorSmartphone',glyph:'devices',group:'ecossistema'},
 {key:'store',name:'Loja',englishName:'Store',icon:'ShoppingBag',glyph:'store',group:'ecossistema'},
].map(item=>Object.freeze(item)));
