import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const contract=JSON.parse(read('docs/contracts/first-run.json'));
const keyboard=JSON.parse(read('docs/contracts/keyboard-layout.json'));
const ui=read('system/surface/ui/first-run.mjs');
const css=read('system/surface/ui/first-run.css');
const lock=read('system/surface/ui/local-session-lock.mjs');
const native=read('system/composition/native/main.mjs');
const windowsEmulator=read('tools/windows-emulator/main.mjs');
const firstRunBrowserSmoke=read('tools/surface-native/first-run-browser-smoke.mjs');
const provenance=read('docs/architecture/MERIDIAN-PROVENANCE.md');

test('launch-baseline journey is explicit and canonical',()=>{
 assert.deepEqual(contract.flow,['welcome','language','keyboard','region','network','account','security','privacy','name','review','complete']);
 assert.ok(contract.flow.indexOf('account')<contract.flow.indexOf('security'));
 assert.equal(contract.regional.keyboard_layout_selector_exposed,true);
 assert.deepEqual(contract.regional.public_launch_locales,['pt-BR','en-US']);
 assert.equal(contract.completion.receipt_written_after_required_owner_writes,true);
 assert.equal(contract.review.second_authoritative_store_allowed,false);
});

test('first run consumes existing owners instead of Meridian backends',()=>{
 for(const token of ['assertNetworkManagementPort','assertKeyboardLayoutPort','assertDeviceProfilePort','assertLocalSessionPort','assertIdentitySessionPort','assertIdentityActionsPort','assertIdentityCredentialsPort']) assert.ok(ui.includes(token),token);
 for(const token of ['keyboardLayout,','deviceProfile,','powerActions,']) assert.ok(native.includes(token),token);
 assert.ok(ui.includes('preferencePort.setManyConfirmed'));
 assert.ok(ui.includes('keyboardPort.configure'));
 assert.ok(ui.includes('deviceProfilePort.rename'));
 assert.ok(ui.includes('credentialsPort.recover'));
 assert.ok(ui.includes('store.save(completeFirstRunState(draft))'));
 assert.ok(!ui.includes('experiments/meridian'));
 assert.ok(!ui.includes('localStorage'));
 assert.ok(!ui.includes('sessionStorage'));
});

test('Chromium First Run smoke serializes its module entry dependencies',()=>{
 assert.ok(firstRunBrowserSmoke.includes('scenario(modules,css,entry,nativeStateAdapter)'));
 assert.ok(firstRunBrowserSmoke.includes('import(urls[entry])'));
 assert.ok(firstRunBrowserSmoke.includes('import(urls[nativeStateAdapter])'));
 assert.ok(firstRunBrowserSmoke.includes('JSON.stringify(ENTRY)'));
 assert.ok(firstRunBrowserSmoke.includes('JSON.stringify(NATIVE_STATE_ADAPTER)'));
});

test('Windows emulator preserves canonical confirmed preference semantics',()=>{
 assert.ok(windowsEmulator.includes('createPreferenceRuntime'));
 assert.ok(windowsEmulator.includes('PREFERENCE_STORE_SCHEMA'));
 assert.ok(windowsEmulator.includes('saveConfirmed(next)'));
 assert.ok(!windowsEmulator.includes('schema: "ordax.preference-runtime/1"'));
});

test('completion is fail-closed and protects ambiguous receipt writes',()=>{
 assert.ok(ui.includes('let receiptAttempted = false'));
 assert.ok(ui.includes('receiptAttempted = true'));
 assert.ok(ui.includes('if (!receiptAttempted)'));
 assert.ok(ui.includes('nova tentativa idempotente'));
 assert.ok(ui.includes('verifyFirstRunIdentitySession'));
 assert.ok(ui.includes('rollbackFailed'));
 assert.equal(contract.persistence.preferences_confirmed_before_receipt,true);
});

test('account secrets and local protection remain separate',()=>{
 assert.ok(ui.includes('identityPasswordDraft'));
 assert.ok(ui.includes('localSessionSecretDraft'));
 assert.ok(!/draft\s*=\s*\{[^}]*password/is.test(ui));
 assert.ok(ui.includes('Não reutilizamos nem armazenamos a senha da Conta'));
 assert.ok(lock.includes('dataset.localSessionSecretToggle'));
 assert.ok(lock.includes('aria-pressed'));
});

test('keyboard apply state is honest',()=>{
 assert.equal(keyboard.first_run.selector_exposed,true);
 assert.equal(keyboard.first_run.immediate_apply_claim_allowed,false);
 assert.equal(keyboard.first_run.restart_offer_owner,'canonical-power-actions');
 assert.ok(ui.includes('keyboardSnapshot?.restartRequired'));
 assert.ok(ui.includes('powerPort.execute("restart")'));
});

test('modal keyboard accessibility and responsive states are present',()=>{
 for(const token of ['aria-modal','aria-live','event.key === "Tab"','event.shiftKey','event.key === "Escape"','event.key !== "Enter"']) assert.ok(ui.includes(token),token);
 assert.ok(css.includes('@media (max-width: 820px)'));
 assert.ok(css.includes('@media (max-width: 520px)'));
 assert.ok(css.includes('prefers-reduced-motion'));
 assert.ok(css.includes(':focus-visible'));
});

test('Meridian gate revalidation stays scoped and preserves SSOT',()=>{
 assert.ok(provenance.includes('Scoped Launch-Baseline revalidation — First Run'));
 assert.ok(provenance.includes('no import, merge or cherry-pick from the experimental Meridian runtime'));
 assert.ok(provenance.includes('B-09 remains a blocker'));
});

