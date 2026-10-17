import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createScopedMemberActionAttempts } from '../system/services/spaces/member-action-attempts.mjs';

const membersSurface = readFileSync(new URL('../system/surface/workspace/components/central/space-members-panel.tsx', import.meta.url), 'utf8');
const accountContext = readFileSync(new URL('../system/surface/workspace/components/central/account-context.tsx', import.meta.url), 'utf8');
const spacesExperience = readFileSync(new URL('../system/surface/workspace/components/central/spaces-experience.tsx', import.meta.url), 'utf8');

test('Space members Surface consumes canonical read, actor capability and membership action boundaries', () => {
  assert.match(membersSurface, /useWebAccount\(\)/);
  assert.match(membersSurface, /members\.list\(\{ spaceId: targetSpaceId, cursor \}\)/);
  assert.match(membersSurface, /actorCapability\.read\(\{ spaceId: targetSpaceId \}\)/);
  assert.match(membersSurface, /capability\?\.canManageMembers/);
  assert.match(membersSurface, /membershipActions\.changeMemberRole/);
  assert.match(membersSurface, /membershipActions\.suspendMember/);
  assert.match(membersSurface, /membershipActions\.reactivateMember/);
  assert.match(membersSurface, /membershipActions\.removeMember/);
  assert.match(membersSurface, /crypto\.randomUUID\(\)/);
  assert.match(membersSurface, /attempts\.current\.begin/);
  assert.match(membersSurface, /attempt\.confirm\(\)/);
  assert.match(membersSurface, /reloadRemoteState\(spaceId\)/);
  assert.match(membersSurface, /page\.nextCursor/);
  assert.match(membersSurface, /Carregar mais/);
  assert.doesNotMatch(membersSurface, /\bfetch\s*\(/);
  assert.doesNotMatch(membersSurface, /supabase|ordax_mutate_space_membership_v1|\/account\/space-membership-actions/);
  assert.doesNotMatch(membersSurface, /localStorage|sessionStorage|indexedDB/);
});

test('Surface consumes target-specific server projection instead of inferring authority from role', () => {
  assert.doesNotMatch(membersSurface, /role\s*===\s*['"]admin['"]/);
  assert.doesNotMatch(membersSurface, /role\s*===\s*['"]owner['"]/);
  assert.doesNotMatch(membersSurface, /memberRole !== 'owner'/);
  assert.match(membersSurface, /const canManageMembers = capabilityState === 'ready' && capability\?\.canManageMembers === true/);
  assert.match(membersSurface, /member\.actions\.canChangeRole/);
  assert.match(membersSurface, /member\.actions\.assignableRoles\.includes\(role\)/);
  assert.match(membersSurface, /actions\.assignableRoles\.map/);
  assert.match(membersSurface, /actions\.canSuspend/);
  assert.match(membersSurface, /actions\.canReactivate/);
  assert.match(membersSurface, /actions\.canRemove/);
  assert.doesNotMatch(membersSurface, /memberState === 'active' && actions\.canSuspend/);
  assert.doesNotMatch(membersSurface, /memberState === 'suspended' && actions\.canReactivate/);
});

test('Space members Surface invalidates stale same-Space reads and refreshes server authority after mutations', () => {
  assert.match(membersSurface, /const membersReadGeneration = useRef\(0\)/);
  assert.match(membersSurface, /const capabilityReadGeneration = useRef\(0\)/);
  assert.match(membersSurface, /membersReadGeneration\.current !== generation/);
  assert.match(membersSurface, /capabilityReadGeneration\.current !== generation/);
  assert.match(membersSurface, /await Promise\.all\(\[\s*readPage\(targetSpaceId, null, false\),\s*readCapability\(targetSpaceId\),\s*\]\)/);
  assert.match(membersSurface, /setActionError\([\s\S]*?await readCapability\(spaceId\)/);
});

test('Space members Surface isolates stale mutation completions and retains uncertain scoped retries', () => {
  assert.match(membersSurface, /currentSpace\.current = spaceId/);
  assert.match(membersSurface, /membersReadGeneration\.current \+= 1/);
  assert.match(membersSurface, /capabilityReadGeneration\.current \+= 1/);
  assert.match(membersSurface, /actionGeneration\.current \+= 1/);
  assert.match(membersSurface, /actionGeneration\.current === generation/);
  assert.match(membersSurface, /pendingAction\.current = false/);
  assert.match(membersSurface, /attempts\.current\.clear\(\)/);
  assert.match(membersSurface, /identity\.state === 'signed-out'/);
  assert.match(membersSurface, /lastKnownSubject\.current !== subjectId/);
  assert.doesNotMatch(membersSurface, /idempotency\.current/);
  assert.match(membersSurface, /setItems\(\[\]\)/);
  assert.match(membersSurface, /setNextCursor\(null\)/);
  assert.match(membersSurface, /Nenhum membro é persistido no navegador/);
});

test('account context exposes only composed domain interfaces to the Surface', () => {
  assert.match(accountContext, /actorCapability: session\.actorCapability/);
  assert.match(accountContext, /membershipActions: session\.membershipActions/);
  assert.doesNotMatch(accountContext, /\bfetch\s*\(/);
  assert.doesNotMatch(accountContext, /supabase|ordax_mutate_space_membership_v1/);
});

test('Spaces experience documents real member management without weakening server authority', () => {
  assert.match(spacesExperience, /<SpaceMembersPanel\/>/);
  assert.match(spacesExperience, /lista e a gestão de membros do Space selecionado usam contratos reais/);
  assert.match(spacesExperience, /capability server-authoritative autoriza a sessão/);
  assert.match(spacesExperience, /servidor continua sendo a autoridade final/);
});

test('retry key survives a transient disconnect and is scoped to both subject and Space', () => {
  let count = 0;
  const attempts = createScopedMemberActionAttempts(() => String(++count));
  const base = { subjectId: 'actor-a', spaceId: 'space-a', action: 'suspend', targetUserId: 'member-a' };
  const first = attempts.begin(base);
  assert.equal(attempts.begin(base).idempotencyKey, first.idempotencyKey, 'retries must preserve the exact key');
  assert.notEqual(attempts.begin({ ...base, subjectId: 'actor-b' }).idempotencyKey, first.idempotencyKey);
  assert.notEqual(attempts.begin({ ...base, spaceId: 'space-b' }).idempotencyKey, first.idempotencyKey);
  assert.notEqual(attempts.begin({ ...base, targetUserId: 'member-b' }).idempotencyKey, first.idempotencyKey);
  assert.notEqual(attempts.begin({ ...base, action: 'reactivate' }).idempotencyKey, first.idempotencyKey);
  assert.equal(attempts.begin(base).idempotencyKey, first.idempotencyKey, 'other scopes never evict the pending retry');
});

test('role attempts cannot reuse idempotency keys across requested roles', () => {
  let count = 0;
  const attempts = createScopedMemberActionAttempts(() => String(++count));
  const base = { subjectId: 'actor-a', spaceId: 'space-a', action: 'change-role', targetUserId: 'member-a' };
  const first = attempts.begin({ ...base, role: 'admin' });
  const second = attempts.begin({ ...base, role: 'viewer' });
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  first.confirm();
  assert.equal(attempts.begin({ ...base, role: 'viewer' }).idempotencyKey, second.idempotencyKey);
});

test('late confirmations cannot delete replacement keys from a newer session epoch', () => {
  let count = 0;
  const attempts = createScopedMemberActionAttempts(() => String(++count));
  const scope = { subjectId: 'actor-a', spaceId: 'space-a', action: 'remove', targetUserId: 'member-a' };
  const obsolete = attempts.begin(scope);
  attempts.clear(); // definitive sign-out or confirmed identity replacement
  const current = attempts.begin(scope);
  obsolete.confirm();
  assert.equal(attempts.begin(scope).idempotencyKey, current.idempotencyKey);
  current.confirm();
  assert.notEqual(attempts.begin(scope).idempotencyKey, current.idempotencyKey);
});

test('scope keys are unambiguous and malformed attempts fail closed', () => {
  let count = 0;
  const attempts = createScopedMemberActionAttempts(() => String(++count));
  const a = attempts.begin({ subjectId: 'a:b', spaceId: 'c', action: 'suspend', targetUserId: 'd' });
  const b = attempts.begin({ subjectId: 'a', spaceId: 'b:c', action: 'suspend', targetUserId: 'd' });
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
  assert.throws(() => attempts.begin({ subjectId: '', spaceId: 'space-a', action: 'remove', targetUserId: 'member-a' }), /authenticated, scoped/);
});
