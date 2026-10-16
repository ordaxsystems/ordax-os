// Localized shared presentation. No account, device or backend authority.
import {translateSurfaceMessage} from '../../../../services/i18n/surface.mjs';


export function createSpaceExamples(locale='pt-BR') {
 const m=id=>translateSurfaceMessage(locale,id);

// Fictional, opt-in presentation examples. Never authorized account data.
const spaceExamples = [
    { id: 'studio', featuredApps: ["studio", "notes", "files", "internet", "editor"], name: m("meridian.text.0024"), icon: 'aura', tone: 'clay', description: m("meridian.text.1106"), members: m("meridian.text.0733"), profile: m("meridian.text.0734"), modules: [m("meridian.text.1107"), m("meridian.text.0282"), m("meridian.text.0735")], permission: m("meridian.text.0736"), storage: m("meridian.text.1108") },
    { id: 'personal', featuredApps: ["notes", "files", "calendar", "music", "intelligence"], name: m("meridian.text.0737"), icon: 'sun', tone: 'sage', description: m("meridian.text.0738"), members: m("meridian.text.0739"), profile: m("meridian.text.0737"), modules: [m("meridian.text.0740"), m("meridian.text.1109"), m("meridian.text.0741")], permission: m("meridian.text.0742"), storage: m("meridian.text.1110") },
    { id: 'workshop', featuredApps: ["editor", "files", "notes", "intelligence"], name: m("meridian.text.1111"), icon: 'cube', tone: 'blue', description: m("meridian.text.0743"), members: m("meridian.text.0744"), profile: m("meridian.text.0458"), modules: [m("meridian.text.1112"), m("meridian.text.0745"), m("meridian.text.1113")], permission: m("meridian.text.0746"), storage: m("meridian.text.1114") },
    { id: 'achegue', name: m("meridian.text.1115"), icon: 'globe', tone: 'sage', description: m("meridian.text.0747"), members: m("meridian.text.0748"), profile: m("meridian.text.1116"), modules: [m("meridian.text.1116"), m("meridian.text.0749"), m("meridian.text.0750")], permission: m("meridian.text.1117"), storage: m("meridian.text.1118") },
    { id: 'pizza', name: m("meridian.text.1119"), icon: 'store', tone: 'amber', description: m("meridian.text.1120"), members: m("meridian.text.0751"), profile: m("meridian.text.1121"), modules: [m("meridian.text.0752"), m("meridian.text.0753"), m("meridian.text.1122")], permission: m("meridian.text.0754"), storage: m("meridian.text.1123") },
    { id: 'development', name: m("meridian.text.0459"), icon: 'terminal', tone: 'slate', description: m("meridian.text.0755"), members: m("meridian.text.0733"), profile: m("meridian.text.0459"), modules: [m("meridian.text.1107"), m("meridian.text.0756"), m("meridian.text.0757")], permission: m("meridian.text.0758"), storage: m("meridian.text.1124") },
    { id: 'ordax-site', name: m("meridian.text.1125"), icon: 'globe', tone: 'blue', description: m("meridian.text.0759"), members: m("meridian.text.0744"), profile: m("meridian.text.1034"), modules: [m("meridian.text.0760"), m("meridian.text.0761"), m("meridian.text.0762")], permission: m("meridian.text.1126"), storage: m("meridian.text.1127") },
    { id: 'stlforge', name: m("meridian.text.1128"), icon: 'cube', tone: 'amber', description: m("meridian.text.0763"), members: m("meridian.text.0744"), profile: m("meridian.text.0458"), modules: [m("meridian.text.0764"), m("meridian.text.0765"), m("meridian.text.0766")], permission: m("meridian.text.0767"), storage: m("meridian.text.1129") },
    { id: 'personal-projects', name: m("meridian.text.0768"), icon: 'folder', tone: 'rose', description: m("meridian.text.1130"), members: m("meridian.text.0739"), profile: m("meridian.text.0737"), modules: [m("meridian.text.0740"), m("meridian.text.0756"), m("meridian.text.0769")], permission: m("meridian.text.0742"), storage: m("meridian.text.1131") },
];
const spaceDashboards = {
    studio: { primary: true, group: m("meridian.text.0770"), recent: 4, metrics: [[m("meridian.text.0756"), '2', m("meridian.text.0771")], [m("meridian.text.0772"), '3', m("meridian.text.1132")], [m("meridian.text.0773"), '14h', m("meridian.text.0774")]] },
    personal: { group: m("meridian.text.0737"), recent: 8, metrics: [[m("meridian.text.0740"), '12', m("meridian.text.1133")], [m("meridian.text.1109"), '3', m("meridian.text.0775")]] },
    workshop: { primary: true, group: m("meridian.text.0304"), recent: 3, favorite: true, location: m("meridian.text.1134"), metrics: [[m("meridian.text.0752"), '12', m("meridian.text.0776")], { label: m("meridian.text.0777"), value: m("meridian.text.1135"), detail: m("meridian.text.1136"), progress: 67 }, [m("meridian.text.0764"), '156', m("meridian.text.0778")]], attention: { title: m("meridian.text.1137"), detail: m("meridian.text.0779"), time: m("meridian.text.0780") } },
    achegue: { group: m("meridian.text.0304"), recent: 1, location: m("meridian.text.1134"), metrics: [[m("meridian.text.0781"), '12.480', m("meridian.text.0782")], [m("meridian.text.1116"), '1.263', m("meridian.text.0783")], [m("meridian.text.0749"), '47', m("meridian.text.1138")]], attention: { title: m("meridian.text.0784"), detail: m("meridian.text.0785"), time: m("meridian.text.0786") } },
    pizza: { primary: true, group: m("meridian.text.0304"), recent: 2, location: m("meridian.text.1139"), metrics: [[m("meridian.text.0787"), '28', m("meridian.text.0778")], { label: m("meridian.text.0788"), value: m("meridian.text.1140"), detail: m("meridian.text.1136"), progress: 67 }, [m("meridian.text.0789"), m("meridian.text.1141"), m("meridian.text.0782")], [m("meridian.text.1122"), '6', m("meridian.text.0771")]], attention: { title: m("meridian.text.0790"), detail: m("meridian.text.0791"), time: m("meridian.text.0792") } },
    development: { primary: true, group: m("meridian.text.0459"), recent: 5, favorite: true, metrics: [[m("meridian.text.0756"), '4', m("meridian.text.0771")], [m("meridian.text.0793"), '3', m("meridian.text.0893")], { label: m("meridian.text.1142"), value: m("meridian.text.1143"), detail: m("meridian.text.0794"), tone: 'positive' }] },
    'ordax-site': { group: m("meridian.text.0304"), recent: 6, metrics: [[m("meridian.text.0795"), '2.846', m("meridian.text.1144")]] },
    stlforge: { group: m("meridian.text.0304"), recent: 7, metrics: [[m("meridian.text.0764"), '1.320', m("meridian.text.0796")]] },
    'personal-projects': { group: m("meridian.text.0737"), recent: 9, metrics: [[m("meridian.text.0756"), '7', m("meridian.text.0797")]] },
};
for (const space of spaceExamples)
    space.dashboard = spaceDashboards[space.id];
const spaceActivityExamples = [
    { space: 'pizza', title: m("meridian.text.1145"), time: m("meridian.text.0798"), icon: 'store' },
    { space: 'achegue', title: m("meridian.text.0799"), time: m("meridian.text.0800"), icon: 'briefcase' },
    { space: 'workshop', title: m("meridian.text.0801"), time: m("meridian.text.0780"), icon: 'cube' },
    { space: 'ordax-site', title: m("meridian.text.0802"), time: m("meridian.text.0786"), icon: 'globe' },
    { space: 'stlforge', title: m("meridian.text.1146"), time: m("meridian.text.0803"), icon: 'cube' },
];
const spaceTemplateExamples = [
    { id: 'local-business', name: m("meridian.text.0457"), icon: 'store', tone: 'amber' },
    { id: 'commerce', name: m("meridian.text.1033"), icon: 'briefcase', tone: 'rose' },
    { id: 'printing', name: m("meridian.text.0458"), icon: 'cube', tone: 'blue' },
    { id: 'website', name: m("meridian.text.1034"), icon: 'globe', tone: 'sage' },
    { id: 'software', name: m("meridian.text.0459"), icon: 'terminal', tone: 'slate' },
    { id: 'personal', name: m("meridian.text.0460"), icon: 'folder', tone: 'clay' },
];
const cityCover = new URL("../../../workspace/assets/demo-salvador-1.jpg", import.meta.url).href;
spaceExamples.find(space => space.id === "achegue").cover = cityCover;
 return {spaceExamples,spaceActivityExamples,spaceTemplateExamples};
}

export const {spaceExamples,spaceActivityExamples,spaceTemplateExamples}=createSpaceExamples();
