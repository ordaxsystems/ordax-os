import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
  assert.match(membersSurface, /idempotency\.current\.get\(key\)/);
  assert.match(membersSurface, /reloadRemoteState\(spaceId\)/);
  assert.match(membersSurface, /page\.nextCursor/);
  assert.match(membersSurface, /Carregar mais/);
  assert.doesNotMatch(membersSurface, /\bfetch\s*\(/);
  assert.doesNotMatch(membersSurface, /supabase|ordax_mutate_space_membership_v1|\/account\/space-membership-actions/);
  assert.doesNotMatch(membersSurface, /localStorage|sessionStorage|indexedDB/);
});

test('Surface does not infer management authority from member role', () => {
  assert.doesNotMatch(membersSurface, /role\s*===\s*['"]admin['"]/);
  assert.doesNotMatch(membersSurface, /role\s*===\s*['"]owner['"]/);
  assert.match(membersSurface, /const canManageMembers = capabilityState === 'ready' && capability\?\.canManageMembers === true/);
  assert.match(membersSurface, /memberRole !== 'owner'/);
});

test('Space members Surface invalidates stale same-Space reads and refreshes server authority after mutations', () => {
  assert.match(membersSurface, /const membersReadGeneration = useRef\(0\)/);
  assert.match(membersSurface, /const capabilityReadGeneration = useRef\(0\)/);
  assert.match(membersSurface, /membersReadGeneration\.current !== generation/);
  assert.match(membersSurface, /capabilityReadGeneration\.current !== generation/);
  assert.match(membersSurface, /await Promise\.all\(\[\s*readPage\(targetSpaceId, null, false\),\s*readCapability\(targetSpaceId\),\s*\]\)/);
  assert.match(membersSurface, /setActionError\([\s\S]*?await readCapability\(spaceId\)/);
});

test('Space members Surface resets remote presentation and idempotency state when selected Space changes', () => {
  assert.match(membersSurface, /currentSpace\.current = spaceId/);
  assert.match(membersSurface, /membersReadGeneration\.current \+= 1/);
  assert.match(membersSurface, /capabilityReadGeneration\.current \+= 1/);
  assert.match(membersSurface, /idempotency\.current\.clear\(\)/);
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
