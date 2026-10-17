import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const membersSurface = readFileSync(new URL('../system/surface/workspace/components/central/space-members-panel.tsx', import.meta.url), 'utf8');
const accountContext = readFileSync(new URL('../system/surface/workspace/components/central/account-context.tsx', import.meta.url), 'utf8');
const spacesExperience = readFileSync(new URL('../system/surface/workspace/components/central/spaces-experience.tsx', import.meta.url), 'utf8');

test('Space members Surface stays behind canonical account-session boundaries', () => {
  for (const required of [
    'useWebAccount()',
    'members.list({ spaceId: targetSpaceId, cursor })',
    'actorCapability.read({ spaceId: targetSpaceId })',
    'membershipActions.changeMemberRole',
    'membershipActions.suspendMember',
    'membershipActions.reactivateMember',
    'membershipActions.removeMember',
  ]) assert.ok(membersSurface.includes(required), required);
  for (const forbidden of ['fetch(', 'supabase', 'ordax-account-gateway', '.rpc(', 'localStorage', 'sessionStorage', 'indexedDB']) {
    assert.ok(!membersSurface.includes(forbidden), forbidden);
  }
  assert.ok(accountContext.includes('actorCapability: session.actorCapability'));
  assert.ok(accountContext.includes('membershipActions: session.membershipActions'));
});

test('administrative presentation is gated only by the server-authored capability', () => {
  assert.ok(membersSurface.includes('capability?.canManageMembers === true'));
  assert.ok(membersSurface.includes("const canOperate = adminPresentation && memberRole !== 'owner'"));
  assert.ok(!membersSurface.includes("role === 'admin'"));
  assert.ok(!membersSurface.includes("role === 'owner'"));
  assert.ok(membersSurface.includes("Object.freeze(['admin', 'member', 'viewer'])"));
  assert.ok(!membersSurface.includes("Object.freeze(['owner'"));
});

test('member mutations use stable UUID retry identity and server rereads instead of optimistic authority', () => {
  for (const required of [
    'retryKeys = useRef(new Map<string, string>())',
    'createUuidIdempotencyKey()',
    'retryKeys.current.get(signature)',
    'retryKeys.current.delete(signature)',
    'setItems([]);',
    'setNextCursor(null);',
    'setCapability(null);',
    'Promise.all([readPage(targetSpaceId, null, false), readActorCapability(targetSpaceId)])',
    'retryKeys.current.delete(signature);\n      if (currentSpace.current !== targetSpaceId) return;',
  ]) assert.ok(membersSurface.includes(required), required);
  assert.ok(!/setItems\([^\n]*(?:role|state|removed)/.test(membersSurface));
});

test('remove is an explicit destructive confirmation and Space changes clear ephemeral mutation state', () => {
  for (const required of [
    '<Dialog open={removeTarget !== null}',
    'variant="destructive"',
    'Remover membro do Space?',
    'retryKeys.current.clear()',
    'setRemoveTarget(null)',
    'currentSpace.current !== targetSpaceId',
  ]) assert.ok(membersSurface.includes(required), required);
});

test('Spaces experience describes the real boundary without claiming unsupported membership flows', () => {
  for (const required of ['lista e a gest', 'capability autoritativa', 'Convites', 'transfer']) {
    assert.ok(spacesExperience.includes(required), required);
  }
});
