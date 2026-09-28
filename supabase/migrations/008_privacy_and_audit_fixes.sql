-- 008_privacy_and_audit_fixes.sql
-- 1. Protege a privacidade dos comprovantes de depósito (LGPD): comprovantes públicos apenas para despesas ativas.
-- 2. Blinda o search_path nas funções de auditoria e exclusão lógica.
-- 3. Adiciona a função segura de edição de transações com registro no log de auditoria.

begin;

-- 1. View pública: não expõe caminhos de comprovantes de depósitos (entradas PIX / dados bancários de alunos e pais)
create or replace view caixa.transactions_public
with (security_barrier = true)
as
select
  transactions.id,
  transactions.type,
  transactions.name,
  null::text as student_name,
  null::text as class_name,
  transactions.vendor_name,
  transactions.occurred_on,
  transactions.amount_cents,
  case when transactions.type = 'expense' then transactions.receipt_path else null end as receipt_path,
  case when transactions.type = 'expense' then transactions.receipt_name else null end as receipt_name,
  null::timestamptz as deleted_at,
  transactions.created_at,
  transactions.updated_at,
  null::text as created_by_name,
  null::text as updated_by_name
from caixa.transactions as transactions
where transactions.deleted_at is null;

revoke all on caixa.transactions_public from public;
grant select on caixa.transactions_public to anon, authenticated;

-- 2. Storage helper: comprovante público APENAS para despesa ativa. Depósitos exigem autorização do gestor.
create or replace function caixa.can_read_receipt(p_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, caixa, extensions
as $$
  select exists (
    select 1
    from caixa.transactions
    where receipt_path = p_path
      and type = 'expense'
      and deleted_at is null
  ) or exists (
    select 1
    from caixa.authorized_receipt_reads
    where path = p_path and expires_at > now()
  );
$$;

-- 3. Blindar search_path em set_transaction_deleted
create or replace function caixa.set_transaction_deleted(
  p_manager_id uuid, p_pin text, p_transaction_id uuid, p_deleted boolean
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

  update caixa.transactions
  set deleted_at = case when p_deleted then now() else null end,
      updated_at = now(),
      updated_by_name = actor
  where id = p_transaction_id;

  if not found then raise exception 'Transação não encontrada'; end if;

  insert into caixa.audit_log (transaction_id, actor_name, action)
  values (p_transaction_id, actor, case when p_deleted then 'deleted' else 'restored' end);
end;
$$;

-- 4. Blindar search_path em get_transaction_audit
create or replace function caixa.get_transaction_audit(
  p_manager_id uuid, p_pin text, p_transaction_id uuid
)
returns table (actor_name text, action text, happened_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, caixa, extensions
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

-- 5. Função de edição com autenticação por PIN e registro de auditoria
create or replace function caixa.update_transaction(
  p_manager_id uuid,
  p_pin text,
  p_transaction_id uuid,
  p_name text,
  p_occurred_on date,
  p_amount_cents integer,
  p_student_name text default null,
  p_class_name text default null,
  p_vendor_name text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, caixa, extensions
as $$
declare
  actor text;
  v_type text;
begin
  actor := caixa.authenticate_manager(p_manager_id, p_pin);
  if actor is null then raise exception 'Usuário ou PIN inválido'; end if;
  if p_amount_cents <= 0 then raise exception 'Valor inválido'; end if;

  select type into v_type
  from caixa.transactions
  where id = p_transaction_id;

  if not found then raise exception 'Transação não encontrada'; end if;

  if v_type = 'deposit' and (nullif(trim(p_student_name), '') is null or nullif(trim(p_class_name), '') is null) then
    raise exception 'Informe o aluno e a turma';
  end if;

  if v_type = 'expense' and nullif(trim(p_vendor_name), '') is null then
    raise exception 'Informe o local ou fornecedor';
  end if;

  update caixa.transactions
  set name = trim(p_name),
      occurred_on = p_occurred_on,
      amount_cents = p_amount_cents,
      student_name = case when v_type = 'deposit' then nullif(trim(p_student_name), '') else null end,
      class_name = case when v_type = 'deposit' then nullif(trim(p_class_name), '') else null end,
      vendor_name = case when v_type = 'expense' then nullif(trim(p_vendor_name), '') else null end,
      updated_at = now(),
      updated_by_name = actor
  where id = p_transaction_id;

  insert into caixa.audit_log (transaction_id, actor_name, action)
  values (p_transaction_id, actor, 'updated');
end;
$$;

revoke all on function caixa.can_read_receipt(text) from public;
revoke all on function caixa.set_transaction_deleted(uuid, text, uuid, boolean) from public;
revoke all on function caixa.get_transaction_audit(uuid, text, uuid) from public;
revoke all on function caixa.update_transaction(uuid, text, uuid, text, date, integer, text, text, text) from public;

grant execute on function caixa.can_read_receipt(text) to anon, authenticated;
grant execute on function caixa.set_transaction_deleted(uuid, text, uuid, boolean) to anon, authenticated;
grant execute on function caixa.get_transaction_audit(uuid, text, uuid) to anon, authenticated;
grant execute on function caixa.update_transaction(uuid, text, uuid, text, date, integer, text, text, text) to anon, authenticated;

commit;
