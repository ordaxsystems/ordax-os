-- OrdaX Network lifecycle: never leave an active group without an owner Space.

begin;

alter table private.ordax_network_audit_events
  drop constraint if exists ordax_network_audit_events_event_type_check;

alter table private.ordax_network_audit_events
  add constraint ordax_network_audit_events_event_type_check
  check (
    event_type in (
      'group-created',
      'group-joined',
      'group-left',
      'group-owner-lost',
      'direct-created',
      'message-sent',
      'space-blocked',
      'space-unblocked',
      'report-created'
    )
  );

create or replace function private.ordax_network_archive_group_on_owner_loss_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $lifecycle$
begin
  if old.owner_space_id is not null and new.owner_space_id is null then
    new.state := 'archived';

    update public.ordax_network_conversations c
    set state = 'closed'
    where c.kind = 'group'
      and c.group_id = new.group_id
      and c.state = 'active';

    insert into private.ordax_network_audit_events(
      actor_user_id,
      actor_space_id,
      event_type,
      resource_type,
      resource_id
    ) values (
      null,
      null,
      'group-owner-lost',
      'group',
      new.group_id::text
    );
  end if;

  return new;
end;
$lifecycle$;

revoke all on function private.ordax_network_archive_group_on_owner_loss_v1()
from public, anon, authenticated, service_role;

create trigger ordax_network_archive_group_on_owner_loss
before update of owner_space_id on public.ordax_network_groups
for each row
when (old.owner_space_id is not null and new.owner_space_id is null)
execute function private.ordax_network_archive_group_on_owner_loss_v1();

commit;
