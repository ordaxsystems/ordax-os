// Localized shared presentation. No account, device or backend authority.
import {translateSurfaceMessage} from '../../../services/i18n/surface.mjs';
import {displayScalePreference} from '../../../services/preferences/display.mjs';


export function createJourneyScenarios(locale='pt-BR') {
 const m=id=>translateSurfaceMessage(locale,id);

// Shared fictional Settings/resource scenarios for Web and USB.
// First Run is owned only by ../first-run.mjs; its old design storyboard is
// preserved in docs/evidence/first-run-ssot-2026-10-17, outside runtime imports.
// Presentation only: completion/effect fields never authorize backend commands.
// Names/measurements/versions here are examples, never runtime discoveries.
// Canonical owner mapping: docs/evidence/meridian-round2/coverage.md.
const action = (label, target) => ({ label, target });
const row = (label, value) => ({ label, value });
const screen = (title, text, next = null, extra = {}) => ({ title, text, next, ...extra });
const problem = (title, text, next, extra = {}) => screen(title, text, next, { tone: 'warning', nextLabel: m("meridian.text.0898"), ...extra });
const choice = (id, label, options, value) => ({ id, label, options: options.map(([value, label]) => ({ value, label })), value });
const systemFixture = Object.freeze({
    localUser: m("meridian.text.0002"), media: m("meridian.text.0003"), host: m("meridian.text.0004"),
    layout: m("meridian.text.0899"), capacity: m("meridian.text.0900"), used: m("meridian.text.0901"), free: m("meridian.text.0902"),
    volumes: [{ name: "ORDAX-ESP", detail: m("meridian.text.0005"), mode: m("meridian.text.0006"), icon: 'shield' },
        { name: "ORDAX", detail: m("meridian.text.0007"), mode: m("meridian.text.0905"), icon: 'desktop' },
        { name: "ORDAX-DATA", detail: m("meridian.text.0008"), mode: m("meridian.text.0009"), icon: 'folder' }],
    persistence: [row(m("meridian.text.0010"), m("meridian.text.0011")), row(m("meridian.text.0012"), m("meridian.text.0907")), row(m("meridian.text.0013"), m("meridian.text.0014")), row(m("meridian.text.0015"), m("meridian.text.0016")), row(m("meridian.text.0908"), m("meridian.text.0017"))],
});
const storyboards = {
    update: { label: m("meridian.text.0091"), icon: 'refresh', owner: m("meridian.text.0928"), start: 'idle', screens: {
            idle: screen(m("meridian.text.0092"), m("meridian.text.0929"), 'checking', { nextLabel: m("meridian.text.0093"), rows: [row(m("meridian.text.0930"), m("meridian.text.0931")), row(m("meridian.text.0932"), m("meridian.text.0094")), row(m("meridian.text.0095"), m("meridian.text.0096")), row(m("meridian.text.0097"), m("meridian.text.0098"))] }),
            checking: screen(m("meridian.text.0933"), m("meridian.text.0934"), 'available', { phase: 8, nextLabel: m("meridian.text.0099"), conditions: [action(m("meridian.text.0100"), 'current'), action(m("meridian.text.0101"), 'offline')] }),
            current: screen(m("meridian.text.0102"), m("meridian.text.0103"), 'checking', { nextLabel: m("meridian.text.0935") }),
            offline: problem(m("meridian.text.0104"), m("meridian.text.0105"), 'checking'),
            available: screen(m("meridian.text.0850"), m("meridian.text.0106"), 'compatibility', { nextLabel: m("meridian.text.0851"), rows: [row(m("meridian.text.0936"), m("meridian.text.0852")), row(m("meridian.text.0937"), m("meridian.text.0938")), row(m("meridian.text.0107"), m("meridian.text.0108")), row(m("meridian.text.0109"), m("meridian.text.0110"))] }),
            compatibility: screen(m("meridian.text.0111"), m("meridian.text.0112"), 'download', { rows: [row(m("meridian.text.0113"), m("meridian.text.0939")), row(m("meridian.text.0114"), m("meridian.text.0115")), row(m("meridian.text.0116"), m("meridian.text.0096"))], confirm: m("meridian.text.0117"), nextLabel: m("meridian.text.0118"), conditions: [action(m("meridian.text.0119"), 'storage'), action(m("meridian.text.0120"), 'incompatible')] }),
            storage: problem(m("meridian.text.0121"), m("meridian.text.0122"), 'compatibility', { links: [{ label: m("meridian.text.0123"), action: 'journey:storage' }] }),
            incompatible: problem(m("meridian.text.0124"), m("meridian.text.0125"), 'idle', { nextLabel: m("meridian.text.0126") }),
            download: screen(m("meridian.text.0940"), m("meridian.text.0127"), 'verify', { phase: 36, nextLabel: m("meridian.text.0028"), actions: [action(m("meridian.text.0941"), 'paused')], conditions: [action(m("meridian.text.0128"), 'paused')] }),
            paused: screen(m("meridian.text.0942"), m("meridian.text.0129"), 'download', { nextLabel: m("meridian.text.0943") }),
            verify: screen(m("meridian.text.0944"), m("meridian.text.0130"), 'stage', { phase: 58, nextLabel: m("meridian.text.0028"), conditions: [action(m("meridian.text.0131"), 'invalid')] }),
            invalid: problem(m("meridian.text.0945"), m("meridian.text.0132"), 'checking', { nextLabel: m("meridian.text.0946") }),
            stage: screen(m("meridian.text.0133"), m("meridian.text.0134"), 'restart', { phase: 76, nextLabel: m("meridian.text.0135") }),
            restart: screen(m("meridian.text.0136"), m("meridian.text.0137"), 'health', { confirm: m("meridian.text.0138"), nextLabel: m("meridian.text.0947"), pending: true, statusLabel: m("meridian.text.0139"), rows: [row(m("meridian.text.0948"), m("meridian.text.0140")), row(m("meridian.text.0141"), m("meridian.text.0142"))], actions: [action(m("meridian.text.0949"), 'deferred')] }),
            deferred: screen(m("meridian.text.0143"), m("meridian.text.0144"), 'restart', { nextLabel: m("meridian.text.0135"), statusLabel: m("meridian.text.0139"), effect: 'update-pending' }),
            health: screen(m("meridian.text.0145"), m("meridian.text.0146"), 'complete', { phase: 94, nextLabel: m("meridian.text.0853"), conditions: [action(m("meridian.text.0147"), 'rollback-review')] }),
            'rollback-review': screen(m("meridian.text.0148"), m("meridian.text.0149"), 'rollback', { tone: 'warning', confirm: m("meridian.text.0150"), nextLabel: m("meridian.text.0151") }),
            rollback: screen(m("meridian.text.0152"), m("meridian.text.0153"), 'retained', { phase: 75, nextLabel: m("meridian.text.0028") }),
            retained: screen(m("meridian.text.0950"), m("meridian.text.0154"), null, { tone: 'success', finish: m("meridian.text.0155"), receipt: m("meridian.text.0156") }),
            complete: screen(m("meridian.text.0157"), m("meridian.text.0158"), null, { tone: 'success', finish: m("meridian.text.0155"), statusLabel: m("meridian.text.0159"), receipt: m("meridian.text.0160") }),
        } },
    recovery: { label: m("meridian.text.0116"), icon: 'shield', owner: m("meridian.text.0951"), start: 'diagnosis', fullscreen: true, screens: {
            diagnosis: screen(m("meridian.text.0952"), m("meridian.text.0161"), 'options', { rows: [row(m("meridian.text.0953"), "M-REC-001"), row(m("meridian.text.0113"), m("meridian.text.0955")), row(m("meridian.text.0141"), m("meridian.text.0162")), row(m("meridian.text.0163"), m("meridian.text.0164"))], conditions: [action(m("meridian.text.0165"), 'missing'), action(m("meridian.text.0166"), 'unavailable')], nextLabel: m("meridian.text.0167") }),
            options: screen(m("meridian.text.0168"), m("meridian.text.0169"), 'impact', { nextLabel: m("meridian.text.0170"), actions: [action(m("meridian.text.0171"), 'report'), action(m("meridian.text.0172"), 'repair')] }),
            report: screen(m("meridian.text.0173"), m("meridian.text.0174"), 'options', { rows: [row(m("meridian.text.0175"), m("meridian.text.0176")), row(m("meridian.text.0956"), m("meridian.text.0177")), row(m("meridian.text.0957"), m("meridian.text.0178"))], nextLabel: m("meridian.text.0179") }),
            impact: screen(m("meridian.text.0958"), m("meridian.text.0180"), 'restoring', { rows: [row(m("meridian.text.0013"), m("meridian.text.0181")), row(m("meridian.text.0010"), m("meridian.text.0182")), row(m("meridian.text.0183"), m("meridian.text.0184"))], confirm: m("meridian.text.0185"), nextLabel: m("meridian.text.0186") }),
            restoring: screen(m("meridian.text.0959"), m("meridian.text.0187"), 'complete', { phase: 65, nextLabel: m("meridian.text.0028"), conditions: [action(m("meridian.text.0188"), 'failed')] }),
            failed: problem(m("meridian.text.0189"), m("meridian.text.0190"), 'diagnosis'),
            repair: screen(m("meridian.text.0960"), m("meridian.text.0191"), 'options', { nextLabel: m("meridian.text.0192"), rows: [row(m("meridian.text.0193"), m("meridian.text.0961")), row(m("meridian.text.0194"), m("meridian.text.0195"))] }),
            missing: problem(m("meridian.text.0196"), m("meridian.text.0197"), 'diagnosis'),
            unavailable: problem(m("meridian.text.0198"), m("meridian.text.0199"), 'diagnosis', { actions: [action(m("meridian.text.0200"), 'repair')] }),
            complete: screen(m("meridian.text.0201"), m("meridian.text.0202"), null, { tone: 'success', finish: m("meridian.text.0203"), receipt: m("meridian.text.0204") }),
        } },
};
Object.assign(storyboards, {
    identity: { label: m("meridian.text.0019"), icon: 'profiles', owner: m("meridian.text.0205"), start: 'sign-in', fullscreen: true, screens: {
            overview: screen(m("meridian.text.0206"), m("meridian.text.0207"), null, { rows: [row(m("meridian.text.0962"), m("meridian.text.0208")), row(m("meridian.text.0019"), m("meridian.text.0209"))], actions: [action(m("meridian.text.0963"), 'sign-in'), action(m("meridian.text.0210"), 'sign-up'), action(m("meridian.text.0211"), 'session'), action(m("meridian.text.0073"), 'guest')], links: [{ label: m("meridian.text.0212"), action: 'lab-lock' }, { label: m("meridian.text.0964"), action: 'journey:power' }] }),
            'sign-in': screen(m("meridian.text.0965"), m("meridian.text.0213"), 'connected', { nextLabel: m("meridian.text.0068"), actions: [action(m("meridian.text.0065"), 'sign-up'), action(m("meridian.text.0022"), 'guest')], links: [{ label: m("meridian.text.0214"), action: 'story-move:recover' }, { label: m("meridian.text.0215"), action: 'story-move:overview' }], conditions: [action(m("meridian.text.0216"), 'unavailable'), action(m("meridian.text.0217"), 'denied')] }),
            'sign-up': screen(m("meridian.text.0218"), m("meridian.text.0219"), 'connected', { nextLabel: m("meridian.text.0220"), actions: [action(m("meridian.text.0070"), 'sign-in')] }),
            connected: screen(m("meridian.text.0221"), m("meridian.text.0222"), null, { effect: 'identity-connected', tone: 'success', finish: m("meridian.text.0223") }),
            guest: screen(m("meridian.text.0966"), m("meridian.text.0224"), null, { effect: 'identity-guest', finish: m("meridian.text.0073") }),
            session: screen(m("meridian.text.0225"), m("meridian.text.0226"), null, { rows: [row(m("meridian.text.0227"), m("meridian.text.0967")), row(m("meridian.text.0962"), m("meridian.text.0228"))], actions: [action(m("meridian.text.0229"), 'logout'), action(m("meridian.text.0230"), 'switch'), action(m("meridian.text.0231"), 'privacy')], conditions: [action(m("meridian.text.0968"), 'expired')] }),
            logout: screen(m("meridian.text.0232"), m("meridian.text.0233"), 'guest', { confirm: m("meridian.text.0234"), nextLabel: m("meridian.text.0229") }),
            switch: screen(m("meridian.text.0235"), m("meridian.text.0236"), 'other', { nextLabel: m("meridian.text.0237") }),
            other: screen(m("meridian.text.0238"), m("meridian.text.0239"), null, { effect: 'identity-other', finish: m("meridian.text.0028"), tone: 'success' }),
            expired: problem(m("meridian.text.0240"), m("meridian.text.0241"), 'sign-in', { effect: 'identity-expired', nextLabel: m("meridian.text.0968"), actions: [action(m("meridian.text.0073"), 'guest')] }),
            unavailable: problem(m("meridian.text.0242"), m("meridian.text.0243"), 'sign-in', { actions: [action(m("meridian.text.0073"), 'guest')] }),
            denied: problem(m("meridian.text.0244"), m("meridian.text.0245"), 'sign-in'),
            recover: screen(m("meridian.text.0246"), m("meridian.text.0247"), 'sign-in', { nextLabel: m("meridian.text.0248"), conditions: [action(m("meridian.text.0029"), 'unavailable')] }),
            privacy: screen(m("meridian.text.0249"), m("meridian.text.0969"), 'session', { fields: [choice('sync', m("meridian.text.0250"), [['paused', m("meridian.text.0970")], ['review', m("meridian.text.0076")]], 'paused'), choice('memory', m("meridian.text.0251"), [['ask', m("meridian.text.0078")], ['off', m("meridian.text.0252")]], 'ask')], nextLabel: m("meridian.text.0253") }),
        } },
    power: { label: m("meridian.text.0254"), icon: 'pause', owner: m("meridian.text.0255"), start: 'review', screens: {
            review: screen(m("meridian.text.0256"), m("meridian.text.0257"), null, { pending: true, actions: [action(m("meridian.text.0971"), 'restart'), action(m("meridian.text.0972"), 'shutdown')], links: [{ label: m("meridian.text.0258"), action: 'journey:update' }, { label: m("meridian.text.0212"), action: 'lab-lock' }] }),
            restart: screen(m("meridian.text.0973"), m("meridian.text.0259"), 'complete', { confirm: m("meridian.text.0260"), nextLabel: m("meridian.text.0261") }),
            shutdown: screen(m("meridian.text.0974"), m("meridian.text.0262"), 'complete', { confirm: m("meridian.text.0260"), nextLabel: m("meridian.text.0263") }),
            complete: screen(m("meridian.text.0264"), m("meridian.text.0265"), null, { tone: 'success', finish: m("meridian.text.0975") }),
        } },
    storage: { label: m("meridian.text.0854"), icon: 'folder', owner: m("meridian.text.0976"), start: 'volumes', screens: {
            volumes: screen(m("meridian.text.0266"), m("meridian.text.0267"), 'persistence', { volumeList: true, storageSummary: true, nextLabel: m("meridian.text.0268"), conditions: [action(m("meridian.text.0269"), 'readonly'), action(m("meridian.text.0855"), 'full'), action(m("meridian.text.0270"), 'missing')] }),
            persistence: screen(m("meridian.text.0271"), m("meridian.text.0272"), 'volumes', { rows: systemFixture.persistence, nextLabel: m("meridian.text.0273"), links: [{ label: m("meridian.text.0274"), action: 'journey:files' }, { label: m("meridian.text.0275"), action: 'journey:recovery' }] }),
            readonly: problem(m("meridian.text.0276"), m("meridian.text.0277"), 'volumes'),
            full: problem(m("meridian.text.0278"), m("meridian.text.0279"), 'volumes'),
            missing: problem(m("meridian.text.0280"), m("meridian.text.0281"), 'volumes'),
        } },
    files: { label: m("meridian.text.0282"), icon: 'file', owner: m("meridian.text.0283"), start: 'browse', screens: {
            browse: screen(m("meridian.text.0977"), m("meridian.text.0284"), 'preview', { fileList: true, nextLabel: m("meridian.text.0285"), actions: [action(m("meridian.text.0286"), 'create'), action(m("meridian.text.0287"), 'favorites'), action(m("meridian.text.0978"), 'trash')], conditions: [action(m("meridian.text.0979"), 'missing')] }),
            preview: screen(m("meridian.text.0288"), m("meridian.text.0289"), 'review', { rows: [row(m("meridian.text.0980"), m("meridian.text.0981")), row(m("meridian.text.0290"), m("meridian.text.0291"))], nextLabel: m("meridian.text.0292"), links: [{ label: m("meridian.text.0293"), action: 'journey:storage' }] }),
            create: screen(m("meridian.text.0294"), m("meridian.text.0295"), 'review', { fields: [{ id: 'fileName', label: m("meridian.text.0296"), value: m("meridian.text.0982"), max: 64 }], nextLabel: m("meridian.text.0297") }),
            favorites: screen(m("meridian.text.0298"), m("meridian.text.0299"), 'browse', { fileList: true, nextLabel: m("meridian.text.0300"), conditions: [action(m("meridian.text.0301"), 'missing')] }),
            review: screen(m("meridian.text.0302"), m("meridian.text.0303"), 'complete', { fields: [choice('fileAction', m("meridian.text.0304"), [['create', m("meridian.text.0286")], ['rename', m("meridian.text.0305")], ['copy', m("meridian.text.0983")], ['move', m("meridian.text.0984")], ['trash', m("meridian.text.0985")]], 'rename')], confirm: m("meridian.text.0306"), nextLabel: m("meridian.text.0307"), conditions: [action(m("meridian.text.0308"), 'denied'), action(m("meridian.text.0309"), 'conflict'), action(m("meridian.text.0269"), 'readonly'), action(m("meridian.text.0856"), 'full')], actions: [action(m("meridian.text.0857"), 'share')] }),
            share: screen(m("meridian.text.0858"), m("meridian.text.0310"), 'complete', { fields: [choice('recipient', m("meridian.text.0986"), [['member', m("meridian.text.0987")], ['self', m("meridian.text.0311")]], 'member'), choice('expiry', m("meridian.text.0988"), [['session', m("meridian.text.0312")], ['day', m("meridian.text.0989")]], 'session')], confirm: m("meridian.text.0313"), nextLabel: m("meridian.text.0990"), conditions: [action(m("meridian.text.0991"), 'denied')] }),
            conflict: screen(m("meridian.text.0314"), m("meridian.text.0315"), 'complete', { fields: [choice('conflict', m("meridian.text.0316"), [['both', m("meridian.text.0992")], ['rename', m("meridian.text.0317")]], 'both')], confirm: m("meridian.text.0318"), nextLabel: m("meridian.text.0993") }),
            denied: problem(m("meridian.text.0319"), m("meridian.text.0320"), 'browse'),
            readonly: problem(m("meridian.text.0321"), m("meridian.text.0322"), 'review'),
            full: problem(m("meridian.text.0323"), m("meridian.text.0324"), 'review', { links: [{ label: m("meridian.text.0123"), action: 'journey:storage' }] }),
            missing: problem(m("meridian.text.0325"), m("meridian.text.0326"), 'browse'),
            trash: screen(m("meridian.text.0327"), m("meridian.text.0328"), 'restored', { rows: [row(m("meridian.text.0994"), m("meridian.text.0995")), row(m("meridian.text.0936"), m("meridian.text.0996"))], confirm: m("meridian.text.0859"), nextLabel: m("meridian.text.0860"), conditions: [action(m("meridian.text.0997"), 'conflict')] }),
            restored: screen(m("meridian.text.0998"), m("meridian.text.0329"), null, { finish: m("meridian.text.0300"), tone: 'success', receipt: m("meridian.text.0999") }),
            complete: screen(m("meridian.text.1000"), m("meridian.text.0330"), null, { finish: m("meridian.text.0300"), tone: 'success', summary: true, receipt: m("meridian.text.0331") }),
        } },
});
function packageStoryboard(profile = false) {
    return { label: profile ? m("meridian.text.0332") : m("meridian.text.1001"), icon: profile ? 'profiles' : 'store',
        owner: profile ? m("meridian.text.1002") : m("meridian.text.1003"), start: 'details', screens: {
            details: screen(profile ? m("meridian.text.0333") : m("meridian.text.0334"), profile ? m("meridian.text.0335") : m("meridian.text.0336"), 'compatibility', { entity: true, rows: [row(m("meridian.text.1004"), m("meridian.text.0337")), row(m("meridian.text.0338"), m("meridian.text.0339")), row(m("meridian.text.0980"), m("meridian.text.0340")), row(m("meridian.text.1005"), m("meridian.text.0341"))], nextLabel: m("meridian.text.0861"), actions: [action(m("meridian.text.0342"), 'update'), action(m("meridian.text.0343"), 'remove')] }),
            compatibility: screen(m("meridian.text.0344"), m("meridian.text.0345"), 'permissions', { rows: [row(m("meridian.text.1006"), m("meridian.text.0346")), row(m("meridian.text.1007"), m("meridian.text.0347")), row(m("meridian.text.0348"), m("meridian.text.0349"))], nextLabel: m("meridian.text.0350"), conditions: [action(m("meridian.text.0351"), 'incompatible'), action(m("meridian.text.0352"), 'unavailable'), action(m("meridian.text.0101"), 'offline'), action(m("meridian.text.0353"), 'blocked')] }),
            permissions: screen(m("meridian.text.0354"), m("meridian.text.0355"), 'download', { confirm: m("meridian.text.1008"), nextLabel: profile ? m("meridian.text.1009") : m("meridian.text.0356"), rows: [row(m("meridian.text.0282"), m("meridian.text.0357")), row(m("meridian.text.0358"), m("meridian.text.0359")), row(m("meridian.text.1010"), m("meridian.text.0360"))], actions: [action(m("meridian.text.0361"), 'denied')] }),
            denied: screen(m("meridian.text.0362"), m("meridian.text.0363"), 'permissions', { nextLabel: m("meridian.text.0364") }),
            download: screen(m("meridian.text.1011"), m("meridian.text.0365"), 'verify', { phase: 28, nextLabel: m("meridian.text.0862"), conditions: [action(m("meridian.text.0366"), 'offline')] }),
            verify: screen(m("meridian.text.0367"), m("meridian.text.1012"), 'stage', { phase: 52, nextLabel: m("meridian.text.0368"), conditions: [action(m("meridian.text.1013"), 'blocked')] }),
            stage: screen(m("meridian.text.0369"), m("meridian.text.0370"), 'activate', { phase: 70, nextLabel: m("meridian.text.0371"), conditions: [action(m("meridian.text.0372"), 'failed')] }),
            activate: screen(profile ? m("meridian.text.0373") : m("meridian.text.0374"), m("meridian.text.0375"), 'health', { phase: 84, nextLabel: m("meridian.text.0376") }),
            health: screen(m("meridian.text.0377"), m("meridian.text.0378"), 'complete', { phase: 94, nextLabel: m("meridian.text.0379"), conditions: [action(m("meridian.text.0380"), 'failed')] }),
            complete: screen(profile ? m("meridian.text.0381") : m("meridian.text.0382"), profile ? m("meridian.text.0383") : m("meridian.text.0384"), null, { tone: 'success', finish: m("meridian.text.0385"), result: 'available', receipt: m("meridian.text.0386"), actions: [action(m("meridian.text.1014"), 'configure'), action(m("meridian.text.0343"), 'remove'), action(m("meridian.text.0387"), 'update')], links: profile ? [{ label: m("meridian.text.0388"), action: 'journey:communication' }] : [] }),
            configure: screen(m("meridian.text.0389"), m("meridian.text.0390"), 'complete', { fields: [choice('visibility', m("meridian.text.1015"), [['private', m("meridian.text.0311")], ['opt-in', m("meridian.text.0391")]], 'private')], nextLabel: m("meridian.text.1016") }),
            update: screen(m("meridian.text.0392"), m("meridian.text.0393"), 'compatibility', { nextLabel: m("meridian.text.0387") }),
            remove: screen(profile ? m("meridian.text.0394") : m("meridian.text.0863"), m("meridian.text.0395"), 'removed', { confirm: m("meridian.text.0396"), nextLabel: m("meridian.text.0397"), rows: [row(m("meridian.text.0398"), m("meridian.text.1017")), row(m("meridian.text.0399"), m("meridian.text.0400")), row(m("meridian.text.0401"), m("meridian.text.1018"))] }),
            removed: screen(m("meridian.text.0402"), m("meridian.text.0403"), null, { finish: m("meridian.text.0385"), result: 'removed', tone: 'success', actions: [action(m("meridian.text.0864"), 'details')] }),
            offline: problem(m("meridian.text.0404"), m("meridian.text.0405"), 'compatibility'),
            unavailable: problem(m("meridian.text.0406"), m("meridian.text.0407"), 'details'),
            incompatible: problem(m("meridian.text.0408"), m("meridian.text.0409"), 'details'),
            blocked: problem(m("meridian.text.0410"), m("meridian.text.0411"), 'details'),
            failed: screen(m("meridian.text.0412"), m("meridian.text.0413"), 'retained', { tone: 'warning', nextLabel: m("meridian.text.0414") }),
            retained: screen(m("meridian.text.0415"), m("meridian.text.0416"), null, { finish: m("meridian.text.0385"), receipt: m("meridian.text.0417"), actions: [action(m("meridian.text.1019"), 'compatibility')] }),
        } };
}
storyboards.store = packageStoryboard();
storyboards.profile = packageStoryboard(true);
Object.assign(storyboards, {
    space: { label: m("meridian.text.0418"), icon: 'spaces', owner: m("meridian.text.0419"), start: 'details', screens: {
            details: screen(m("meridian.text.0420"), m("meridian.text.0421"), 'impact', { entity: true, rows: [row(m("meridian.text.0422"), m("meridian.text.1020")), row(m("meridian.text.1021"), m("meridian.text.0423")), row(m("meridian.text.0424"), m("meridian.text.0425"))], nextLabel: m("meridian.text.0865"), actions: [action(m("meridian.text.0426"), 'members'), action(m("meridian.text.0427"), 'create')], conditions: [action(m("meridian.text.1022"), 'revoked'), action(m("meridian.text.0428"), 'unavailable')] }),
            impact: screen(m("meridian.text.0429"), m("meridian.text.0430"), 'selected', { pending: true, rows: [row(m("meridian.text.0866"), m("meridian.text.0431")), row(m("meridian.text.0432"), m("meridian.text.0433")), row(m("meridian.text.1023"), m("meridian.text.1024")), row(m("meridian.text.0290"), m("meridian.text.0434"))], confirm: m("meridian.text.0435"), nextLabel: m("meridian.text.1025") }),
            selected: screen(m("meridian.text.1026"), m("meridian.text.0436"), null, { effect: 'space-selected', tone: 'success', finish: m("meridian.text.1027") }),
            members: screen(m("meridian.text.0437"), m("meridian.text.0438"), 'details', { rows: [row(m("meridian.text.1020"), m("meridian.text.0439")), row(m("meridian.text.1028"), m("meridian.text.1029")), row(m("meridian.text.1030"), m("meridian.text.0440"))], actions: [action(m("meridian.text.0441"), 'leave')], nextLabel: m("meridian.text.0442") }),
            leave: screen(m("meridian.text.0443"), m("meridian.text.0444"), 'revoked', { confirm: m("meridian.text.0445"), nextLabel: m("meridian.text.0446") }),
            revoked: screen(m("meridian.text.0447"), m("meridian.text.0448"), null, { tone: 'warning', finish: m("meridian.text.1031"), effect: 'space-unavailable' }),
            unavailable: problem(m("meridian.text.0449"), m("meridian.text.0450"), 'details'),
            create: screen(m("meridian.text.0238"), m("meridian.text.0451"), 'provision', { fields: [{ id: 'spaceName', label: m("meridian.text.0452"), value: m("meridian.text.0453"), max: 64 }, choice('template', m("meridian.text.1032"), [['blank', m("meridian.text.0454")], ['design', m("meridian.text.0455")], ['local-business', m("meridian.text.0457")], ['commerce', m("meridian.text.1033")], ['printing', m("meridian.text.0458")], ['website', m("meridian.text.1034")], ['software', m("meridian.text.0459")], ['personal', m("meridian.text.0460")]], 'blank')], confirm: m("meridian.text.0461"), nextLabel: m("meridian.text.0462") }),
            provision: screen(m("meridian.text.0867"), m("meridian.text.0463"), 'created', { phase: 60, nextLabel: m("meridian.text.0028"), conditions: [action(m("meridian.text.0868"), 'create-error')] }),
            'create-error': problem(m("meridian.text.0464"), m("meridian.text.0465"), 'create'),
            created: screen(m("meridian.text.0087"), m("meridian.text.0466"), null, { tone: 'success', summary: true, finish: m("meridian.text.0467"), receipt: m("meridian.text.0468") }),
        } },
    intelligence: { label: m("meridian.text.1035"), icon: 'aura', owner: m("meridian.text.1036"), start: 'sources', screens: {
            sources: screen(m("meridian.text.1037"), m("meridian.text.0469"), 'stream', { sources: true, fields: [choice('model', m("meridian.text.0470"), [['local', m("meridian.text.0471")], ['remote', m("meridian.text.0472")]], 'local')], nextLabel: m("meridian.text.1038"), conditions: [action(m("meridian.text.0473"), 'model-error'), action(m("meridian.text.0869"), 'source-denied')] }),
            stream: screen(m("meridian.text.0474"), m("meridian.text.0475"), 'suggestion', { phase: 52, nextLabel: m("meridian.text.0476"), actions: [action(m("meridian.text.1039"), 'cancelled')], conditions: [action(m("meridian.text.1040"), 'model-error')] }),
            cancelled: screen(m("meridian.text.1041"), m("meridian.text.0477"), 'sources', { nextLabel: m("meridian.text.0870") }),
            suggestion: screen(m("meridian.text.0478"), m("meridian.text.0479"), 'review', { nextLabel: m("meridian.text.0871"), rows: [row(m("meridian.text.0980"), m("meridian.text.1042")), row(m("meridian.text.1043"), m("meridian.text.0480"))], actions: [action(m("meridian.text.0481"), 'declined')] }),
            review: screen(m("meridian.text.0482"), m("meridian.text.0483"), 'running', { sources: true, rows: [row(m("meridian.text.1044"), m("meridian.text.1045")), row(m("meridian.text.0484"), m("meridian.text.0485")), row(m("meridian.text.0282"), m("meridian.text.0486")), row(m("meridian.text.1046"), m("meridian.text.0487"))], confirm: m("meridian.text.1047"), nextLabel: m("meridian.text.0488"), actions: [action(m("meridian.text.1048"), 'declined')], conditions: [action(m("meridian.text.0489"), 'denied')] }),
            declined: screen(m("meridian.text.0490"), m("meridian.text.0491"), 'sources', { nextLabel: m("meridian.text.0492") }),
            running: screen(m("meridian.text.1049"), m("meridian.text.0493"), 'complete', { phase: 75, nextLabel: m("meridian.text.0494"), conditions: [action(m("meridian.text.0495"), 'failed')] }),
            complete: screen(m("meridian.text.0496"), m("meridian.text.0497"), null, { tone: 'success', receipt: m("meridian.text.0498"), finish: m("meridian.text.0499"), actions: [action(m("meridian.text.1050"), 'sources')] }),
            'model-error': problem(m("meridian.text.0500"), m("meridian.text.0501"), 'sources'),
            'source-denied': problem(m("meridian.text.0872"), m("meridian.text.0502"), 'sources'),
            denied: problem(m("meridian.text.0503"), m("meridian.text.0504"), 'review'),
            failed: problem(m("meridian.text.0505"), m("meridian.text.0506"), 'review'),
        } },
});
const displayScaleOptions = displayScalePreference.options.map(({value}) => [
    value,
    m(`settings.preference.display.option.${value}`),
]);
const settingsTopics = [
    { id: 'network', name: m("meridian.text.0507"), icon: 'wifi', detail: m("meridian.text.0508"), fields: [choice('network', m("meridian.text.0509"), [['studio', m("meridian.text.0510")], ['offline', m("meridian.text.0511")]], 'studio')] },
    { id: 'audio', name: m("meridian.text.0512"), icon: 'music', detail: m("meridian.text.0513"), fields: [choice('output', m("meridian.text.0514"), [['speakers', m("meridian.text.1051")], ['headset', m("meridian.text.0515")]], 'speakers')] },
    { id: 'display', name: m("meridian.text.0873"), icon: 'desktop', detail: m("meridian.text.0874"), fields: [choice('scale', m("meridian.text.0875"), displayScaleOptions, displayScalePreference.defaultValue)] },
    { id: 'keyboard', name: m("meridian.text.0516"), icon: 'terminal', detail: m("meridian.text.0517"), fields: [choice('layout', m("meridian.text.1052"), [['abnt2', m("meridian.text.0043")], ['us', m("meridian.text.0915")]], 'abnt2'), choice('language', m("meridian.text.0041"), [['pt', m("meridian.text.0518")], ['en', m("meridian.text.1053")]], 'pt')] },
    { id: 'region', name: m("meridian.text.0519"), icon: 'clock', detail: m("meridian.text.0520"), fields: [choice('zone', m("meridian.text.0521"), [['bahia', "America/Bahia"], ['sp', "America/Sao_Paulo"]], 'bahia')] },
    { id: 'battery', name: m("meridian.text.0522"), icon: 'battery', detail: m("meridian.text.0523"), fields: [choice('battery', m("meridian.text.0524"), [['normal', m("meridian.text.1054")], ['low', m("meridian.text.1055")], ['charging', m("meridian.text.0525")], ['unknown', m("meridian.text.0526")]], 'normal'), choice('powerMode', m("meridian.text.0527"), [['balanced', m("meridian.text.0876")], ['saving', m("meridian.text.1056")], ['performance', m("meridian.text.1057")]], 'balanced')] },
    { id: 'storage', name: m("meridian.text.0877"), icon: 'folder', detail: m("meridian.text.0528"), journey: 'storage' },
    { id: 'users', name: m("meridian.text.0529"), icon: 'profiles', detail: m("meridian.text.0530"), journey: 'identity' },
    { id: 'privacy', name: m("meridian.text.0531"), icon: 'shield', detail: m("meridian.text.0532"), fields: [choice('privacy', m("meridian.text.0533"), [['ask', m("meridian.text.0534")], ['deny', m("meridian.text.0535")]], 'ask')] },
    { id: 'security', name: m("meridian.text.0536"), icon: 'shield', detail: m("meridian.text.0537"), journey: 'recovery' },
    { id: 'updates', name: m("meridian.text.0538"), icon: 'refresh', detail: m("meridian.text.1058"), journey: 'update' },
    { id: 'accessibility', name: m("meridian.text.1059"), icon: 'sun', detail: m("meridian.text.0539"), fields: [choice('reading', m("meridian.text.0540"), [['standard', m("meridian.text.0541")], ['large', m("meridian.text.1060")]], 'standard')] },
];
Object.assign(storyboards, {
    settings: { label: m("meridian.text.0542"), icon: 'settings', owner: m("meridian.text.0543"), start: 'edit', screens: {
            edit: screen(m("meridian.text.1061"), m("meridian.text.0544"), 'pending', { topicFields: true, nextLabel: m("meridian.text.0545"), conditions: [action(m("meridian.text.0878"), 'unsupported'), action(m("meridian.text.0546"), 'denied')] }),
            pending: screen(m("meridian.text.0547"), m("meridian.text.0548"), 'complete', { summary: true, confirm: m("meridian.text.0549"), nextLabel: m("meridian.text.0550"), conditions: [action(m("meridian.text.0551"), 'failed')] }),
            complete: screen(m("meridian.text.0552"), m("meridian.text.0553"), null, { tone: 'success', summary: true, finish: m("meridian.text.0554"), actions: [action(m("meridian.text.0555"), 'undo')] }),
            undo: screen(m("meridian.text.0556"), m("meridian.text.0557"), 'edit', { nextLabel: m("meridian.text.0558") }),
            unsupported: problem(m("meridian.text.0559"), m("meridian.text.0560"), 'edit'),
            denied: problem(m("meridian.text.0561"), m("meridian.text.0562"), 'edit'),
            failed: problem(m("meridian.text.0563"), m("meridian.text.0564"), 'pending'),
        } },
    device: { label: m("meridian.text.0565"), icon: 'desktop', owner: m("meridian.text.1062"), start: 'discover', screens: {
            discover: screen(m("meridian.text.1063"), m("meridian.text.0566"), 'pair', { entity: true, nextLabel: m("meridian.text.0879"), conditions: [action(m("meridian.text.0567"), 'offline'), action(m("meridian.text.1064"), 'stale')] }),
            pair: screen(m("meridian.text.1065"), m("meridian.text.0568"), 'scope', { code: '482 916', confirm: m("meridian.text.0569"), nextLabel: m("meridian.text.0570"), conditions: [action(m("meridian.text.0571"), 'expired'), action(m("meridian.text.0572"), 'mismatch')] }),
            scope: screen(m("meridian.text.0880"), m("meridian.text.0573"), 'connected', { fields: [choice('capability', m("meridian.text.0574"), [['camera', m("meridian.text.0575")], ['audio', m("meridian.text.0576")], ['status', m("meridian.text.1066")]], 'status'), choice('duration', m("meridian.text.0484"), [['session', m("meridian.text.0577")]], 'session')], confirm: m("meridian.text.0578"), nextLabel: m("meridian.text.0579"), conditions: [action(m("meridian.text.1067"), 'denied')] }),
            connected: screen(m("meridian.text.0580"), m("meridian.text.0581"), 'revoked', { tone: 'success', summary: true, nextLabel: m("meridian.text.0582"), conditions: [action(m("meridian.text.0583"), 'offline')] }),
            revoked: screen(m("meridian.text.0584"), m("meridian.text.0585"), null, { finish: m("meridian.text.0586"), receipt: m("meridian.text.0587") }),
            offline: problem(m("meridian.text.0588"), m("meridian.text.0589"), 'discover'),
            stale: problem(m("meridian.text.1068"), m("meridian.text.0590"), 'discover'),
            expired: problem(m("meridian.text.0591"), m("meridian.text.0592"), 'pair'),
            mismatch: problem(m("meridian.text.0593"), m("meridian.text.0594"), 'discover'),
            denied: problem(m("meridian.text.0595"), m("meridian.text.0596"), 'scope'),
        } },
    communication: { label: m("meridian.text.0597"), icon: 'message', owner: m("meridian.text.1069"), start: 'discover', screens: {
            discover: screen(m("meridian.text.1070"), m("meridian.text.0598"), 'membership', { fields: [choice('presence', m("meridian.text.1015"), [['private', m("meridian.text.0599")], ['opt-in', m("meridian.text.0600")]], 'private')], nextLabel: m("meridian.text.1071"), rows: [row(m("meridian.text.0601"), m("meridian.text.0602")), row(m("meridian.text.0980"), m("meridian.text.1072"))] }),
            membership: screen(m("meridian.text.0603"), m("meridian.text.0604"), 'conversation', { confirm: m("meridian.text.0605"), nextLabel: m("meridian.text.1073"), conditions: [action(m("meridian.text.0606"), 'pending-member'), action(m("meridian.text.0546"), 'denied')] }),
            'pending-member': screen(m("meridian.text.0607"), m("meridian.text.0608"), 'membership', { nextLabel: m("meridian.text.0609") }),
            conversation: screen(m("meridian.text.1074"), m("meridian.text.0610"), 'pending', { fields: [{ id: 'message', label: m("meridian.text.0611"), value: m("meridian.text.0612"), max: 1000, multiline: true }], nextLabel: m("meridian.text.1075"), actions: [action(m("meridian.text.1076"), 'moderation')] }),
            pending: screen(m("meridian.text.0613"), m("meridian.text.0614"), 'delivered', { phase: 50, nextLabel: m("meridian.text.0881"), conditions: [action(m("meridian.text.0615"), 'failed')] }),
            delivered: screen(m("meridian.text.0882"), m("meridian.text.0616"), 'conversation', { tone: 'success', summary: true, nextLabel: m("meridian.text.0617"), actions: [action(m("meridian.text.1076"), 'moderation')] }),
            failed: problem(m("meridian.text.0618"), m("meridian.text.0619"), 'pending', { actions: [action(m("meridian.text.0620"), 'conversation')] }),
            moderation: screen(m("meridian.text.0621"), m("meridian.text.0622"), null, { actions: [action(m("meridian.text.0623"), 'blocked'), action(m("meridian.text.0624"), 'report'), action(m("meridian.text.0883"), 'leave')] }),
            blocked: screen(m("meridian.text.0884"), m("meridian.text.0625"), null, { finish: m("meridian.text.0626") }),
            report: screen(m("meridian.text.0627"), m("meridian.text.0628"), 'reported', { fields: [choice('reason', m("meridian.text.0629"), [['spam', m("meridian.text.0630")], ['conduct', m("meridian.text.1077")]], 'spam')], confirm: m("meridian.text.0631"), nextLabel: m("meridian.text.0632") }),
            reported: screen(m("meridian.text.0633"), m("meridian.text.0634"), null, { finish: m("meridian.text.0626") }),
            leave: screen(m("meridian.text.0885"), m("meridian.text.0635"), 'left', { confirm: m("meridian.text.0636"), nextLabel: m("meridian.text.0637") }),
            left: screen(m("meridian.text.0638"), m("meridian.text.0639"), null, { finish: m("meridian.text.0626") }),
            denied: problem(m("meridian.text.0640"), m("meridian.text.0641"), 'discover'),
        } },
});
 return {systemFixture,storyboards,settingsTopics};
}

export const {systemFixture,storyboards,settingsTopics}=createJourneyScenarios();
