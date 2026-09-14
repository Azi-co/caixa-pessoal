-- Portal da Transparência Escolar: campos, gestores, PIN e auditoria.
-- Execute uma única vez e salve os PINs exibidos no resultado.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table caixa.transactions
  add column if not exists student_name text,
  add column if not exists class_name text,
  add column if not exists vendor_name text,
  add column if not exists created_by_name text,
  add column if not exists updated_by_name text;

create table if not exists caixa.managers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists caixa.audit_log (
  id bigint generated always as identity primary key,
  transaction_id uuid not null,
  actor_name text not null,
  action text not null check (action in ('created', 'deleted', 'restored')),
  happened_at timestamptz not null default now()
);

alter table caixa.managers enable row level security;
alter table caixa.audit_log enable row level security;
revoke all on caixa.managers from anon, authenticated;
revoke all on caixa.transactions from anon, authenticated;
grant select on caixa.transactions, caixa.audit_log to anon, authenticated;

create or replace view caixa.managers_public as
select id, display_name from caixa.managers where active = true;
grant select on caixa.managers_public to anon, authenticated;

create or replace function caixa.authenticate_manager(p_manager_id uuid, p_pin text)
returns text
language sql
security definer
set search_path = caixa, public
as $$
  select display_name
  from caixa.managers
  where id = p_manager_id and active = true and pin_hash = extensions.crypt(p_pin, pin_hash);
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
set search_path = caixa, public
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
  insert into caixa.audit_log (transaction_id, actor_name, action) values (p_id, actor, 'created');
end;
$$;

create or replace function caixa.set_transaction_deleted(
  p_manager_id uuid, p_pin text, p_transaction_id uuid, p_deleted boolean
)
returns void
language plpgsql
security definer
set search_path = caixa, public
as $$
declare actor text;
begin
  actor := caixa.authenticate_manager(p_manager_id, p_pin);
  if actor is null then raise exception 'Usuário ou PIN inválido'; end if;
  update caixa.transactions
  set deleted_at = case when p_deleted then now() else null end,
      updated_at = now(), updated_by_name = actor
  where id = p_transaction_id;
  if not found then raise exception 'Transação não encontrada'; end if;
  insert into caixa.audit_log (transaction_id, actor_name, action)
  values (p_transaction_id, actor, case when p_deleted then 'deleted' else 'restored' end);
end;
$$;

revoke all on function caixa.authenticate_manager(uuid, text) from public;
revoke all on function caixa.create_transaction(uuid, text, uuid, text, text, date, integer, text, text, text, text, text) from public;
revoke all on function caixa.set_transaction_deleted(uuid, text, uuid, boolean) from public;
grant execute on function caixa.authenticate_manager(uuid, text) to anon, authenticated;
grant execute on function caixa.create_transaction(uuid, text, uuid, text, text, date, integer, text, text, text, text, text) to anon, authenticated;
grant execute on function caixa.set_transaction_deleted(uuid, text, uuid, boolean) to anon, authenticated;

-- Os PINs são gerados agora, armazenados apenas como hash e exibidos uma vez abaixo.
with generated as materialized (
  select display_name, lpad(floor(random() * 1000000)::integer::text, 6, '0') as pin
  from unnest(array['Tesouraria', 'Ayron', 'Ivana', 'Marcela', 'João Paulo']) as names(display_name)
), inserted as (
  insert into caixa.managers (display_name, pin_hash)
  select display_name, extensions.crypt(pin, extensions.gen_salt('bf')) from generated
  on conflict (display_name) do nothing
  returning display_name
)
select g.display_name as usuario, g.pin
from generated g join inserted i using (display_name)
order by g.display_name;
