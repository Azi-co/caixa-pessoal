create or replace function caixa.get_transaction_audit(
  p_manager_id uuid, p_pin text, p_transaction_id uuid
)
returns table (actor_name text, action text, happened_at timestamptz)
language plpgsql
security definer
set search_path = caixa, public
as $$
begin
  if caixa.authenticate_manager(p_manager_id, p_pin) is null then
    raise exception 'Usuário ou PIN inválido';
  end if;
  return query
  select audit_log.actor_name, audit_log.action, audit_log.happened_at
  from caixa.audit_log as audit_log
  where audit_log.transaction_id = p_transaction_id
  order by audit_log.happened_at desc;
end;
$$;

revoke all on function caixa.get_transaction_audit(uuid, text, uuid) from public;
grant execute on function caixa.get_transaction_audit(uuid, text, uuid) to anon, authenticated;
