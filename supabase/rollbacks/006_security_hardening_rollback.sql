-- Rollback emergencial da etapa 006. Não execute após a migration 007.

begin;

drop policy if exists "read active caixa receipts" on storage.objects;
drop policy if exists "upload authorized caixa receipts" on storage.objects;
drop policy if exists "delete pending caixa receipts" on storage.objects;

drop function if exists caixa.list_transactions(uuid, text);
drop function if exists caixa.authorize_receipt_upload(uuid, text, uuid, text);
drop function if exists caixa.authorize_receipt_read(uuid, text, text);
drop function if exists caixa.can_read_receipt(text);
drop function if exists caixa.can_write_pending_receipt(text);

create or replace function caixa.authenticate_manager(p_manager_id uuid, p_pin text)
returns text
language sql
security definer
set search_path = pg_catalog, caixa, extensions
as $$
  select display_name
  from caixa.managers
  where id = p_manager_id
    and active = true
    and pin_hash = extensions.crypt(p_pin, pin_hash);
$$;

create or replace function caixa.create_transaction(
  p_manager_id uuid, p_pin text, p_id uuid, p_type text, p_name text,
  p_occurred_on date, p_amount_cents integer, p_student_name text default null,
  p_class_name text default null, p_vendor_name text default null,
  p_receipt_path text default null, p_receipt_name text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, caixa, extensions
as $$
declare actor text;
begin
  actor := caixa.authenticate_manager(p_manager_id, p_pin);
  if actor is null then raise exception 'Usuário ou PIN inválido'; end if;
  if p_type not in ('deposit', 'expense') then raise exception 'Tipo inválido'; end if;
  if p_type = 'deposit' and (nullif(trim(p_student_name), '') is null or nullif(trim(p_class_name), '') is null) then
    raise exception 'Informe o aluno e a turma';
  end if;
  if p_type = 'expense' and nullif(trim(p_vendor_name), '') is null then
    raise exception 'Informe o local ou fornecedor';
  end if;

  insert into caixa.transactions (
    id, type, name, occurred_on, amount_cents, student_name, class_name,
    vendor_name, receipt_path, receipt_name, created_by_name, updated_by_name
  ) values (
    p_id, p_type, trim(p_name), p_occurred_on, p_amount_cents,
    nullif(trim(p_student_name), ''), nullif(trim(p_class_name), ''),
    nullif(trim(p_vendor_name), ''), p_receipt_path, p_receipt_name, actor, actor
  );
  insert into caixa.audit_log (transaction_id, actor_name, action)
  values (p_id, actor, 'created');
end;
$$;

revoke all on function caixa.authenticate_manager(uuid, text) from public;
revoke all on function caixa.create_transaction(uuid, text, uuid, text, text, date, integer, text, text, text, text, text) from public;
grant execute on function caixa.authenticate_manager(uuid, text) to anon, authenticated;
grant execute on function caixa.create_transaction(uuid, text, uuid, text, text, date, integer, text, text, text, text, text) to anon, authenticated;

drop view if exists caixa.transactions_public;
drop table if exists caixa.authorized_receipt_reads;
drop table if exists caixa.authorized_receipt_uploads;
drop table if exists caixa.manager_auth_attempts;

commit;
