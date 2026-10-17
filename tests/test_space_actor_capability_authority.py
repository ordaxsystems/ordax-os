from pathlib import Path
import re
import unittest
ROOT=Path(__file__).resolve().parents[1]
SQL=(ROOT/'infra/supabase/product/migrations/20261017110000_space_actor_capability_v1.sql').read_text(encoding='utf-8')
class SpaceActorCapabilityAuthorityTests(unittest.TestCase):
    def test_projection_uses_canonical_predicates(self):
        self.assertIn('ordax_policy.can_access_space(p_space_id)',SQL)
        self.assertIn('ordax_policy.can_admin_space(p_space_id)',SQL)
        self.assertIn('security definer',SQL)
        self.assertIn("set search_path = ''",SQL)
    def test_projection_is_read_only_and_authenticated_only(self):
        low=SQL.lower()
        for forbidden in ('insert into public.ordax_space_members','update public.ordax_space_members','delete from public.ordax_space_members'):
            self.assertNotIn(forbidden,low)
        self.assertIn('revoke all on function public.ordax_get_space_actor_capability_v1(uuid)',low)
        self.assertIn('grant execute on function public.ordax_get_space_actor_capability_v1(uuid)',low)
        self.assertIn('to authenticated',low)
    def test_projection_returns_only_bounded_presentation_fields(self):
        match=re.search(r'returns tables*((.*?))s*language',SQL.lower(),re.S);self.assertIsNotNone(match)
        fields=[line.strip().split()[0].rstrip(',') for line in match.group(1).splitlines() if line.strip()]
        self.assertEqual(fields,['space_id','user_id','role','state','can_manage_members'])
if __name__=='__main__': unittest.main()
