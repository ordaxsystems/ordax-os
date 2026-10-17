import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const membersSurface = readFileSync(new URL('../system/surface/workspace/components/central/space-members-panel.tsx', import.meta.url), 'utf8');
const spacesExperience = readFileSync(new URL('../system/surface/workspace/components/central/spaces-experience.tsx', import.meta.url), 'utf8');

test('Space members Surface consumes only the canonical members read boundary', () => {
  assert.match(membersSurface, /useWebAccount\(\)/);
  assert.match(membersSurface, /members\.list\(\{ spaceId: targetSpaceId, cursor \}\)/);
  assert.match(membersSurface, /page\.nextCursor/);
  assert.match(membersSurface, /Carregar mais/);
  assert.doesNotMatch(membersSurface, /\bfetch\s*\(/);
  assert.doesNotMatch(membersSurface, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(membersSurface, /membershipActions|changeMemberRole|suspendMember|reactivateMember|removeMember/);
});

test('Space members Surface resets remote presentation state when the selected Space changes', () => {
  assert.match(membersSurface, /currentSpace\.current = spaceId/);
  assert.match(membersSurface, /setItems\(\[\]\)/);
  assert.match(membersSurface, /setNextCursor\(null\)/);
  assert.match(membersSurface, /currentSpace\.current !== targetSpaceId/);
  assert.match(membersSurface, /Nenhum membro é persistido no navegador/);
});

test('Spaces experience exposes real member read without claiming admin actions are connected', () => {
  assert.match(spacesExperience, /<SpaceMembersPanel\/>/);
  assert.match(spacesExperience, /A lista de membros do Space selecionado já usa a leitura autorizada real/);
  assert.match(spacesExperience, /ações administrativas de membros ainda aguardam contratos compatíveis de Surface/);
  assert.doesNotMatch(spacesExperience, /gestão de membros aguardam contratos e serviços compatíveis/);
});
