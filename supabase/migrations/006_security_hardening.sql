-- Etapa 1/2: prepara os recursos seguros sem quebrar o frontend ainda publicado.
-- Aplique esta migration, publique e valide o novo frontend; só depois aplique 007.

begin;

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
  transactions.receipt_path,
  transactions.receipt_name,
  null::timestamptz as deleted_at,
  transactions.created_at,
  transactions.updated_at,
  null::text as created_by_name,
  null::text as updated_by_name
from caixa.transactions as transactions
where transactions.deleted_at is null;

revoke all on caixa.transactions_public from public;
grant select on caixa.transactions_public to anon, authenticated;

create table caixa.manager_auth_attempts (
  id bigint generated always as identity primary key,
  manager_id uuid not null,
  client_key text not null,
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);

create index manager_auth_attempts_lookup_idx
on caixa.manager_auth_attempts (manager_id, client_key, attempted_at desc);

alter table caixa.manager_auth_attempts enable row level security;
revoke all on caixa.manager_auth_attempts from public, anon, authenticated;

create or replace function caixa.authenticate_manager(p_manager_id uuid, p_pin text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, caixa, extensions
as $$
declare
  request_headers jsonb := '{}'::jsonb;
  request_origin text;
  current_client_key text;
  failed_attempts integer;
  actor text;
begin
  begin
    request_headers := coalesce(
      nullif(current_setting('request.headers', true), ''),
      '{}'
    )::jsonb;
  exception when others then
    request_headers := '{}'::jsonb;
  end;

  request_origin := coalesce(
    nullif(split_part(request_headers ->> 'x-forwarded-for', ',', 1), ''),
    nullif(request_headers ->> 'cf-connecting-ip', ''),
    nullif(request_headers ->> 'x-real-ip', ''),
    'unknown'
  );
  current_client_key := encode(extensions.digest(request_origin, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_manager_id::text || current_client_key, 0));

  delete from caixa.manager_auth_attempts
  where attempted_at < now() - interval '24 hours';

  select count(*) into failed_attempts
  from caixa.manager_auth_attempts
  where manager_id = p_manager_id
    and client_key = current_client_key
    and succeeded = false
    and attempted_at > now() - interval '15 minutes';

  if failed_attempts >= 5 then
    raise exception 'Muitas tentativas. Aguarde 15 minutos e tente novamente.';
  end if;

  select display_name into actor
  from caixa.managers
  where id = p_manager_id
    and active = true
    and pin_hash = extensions.crypt(p_pin, pin_hash);

  insert into caixa.manager_auth_attempts (
    manager_id, client_key, succeeded
  ) values (
    p_manager_id, current_client_key, actor is not null
  );

  return actor;
end;
$$;

revoke all on function caixa.authenticate_manager(uuid, text) from public;
grant execute on function caixa.authenticate_manager(uuid, text) to anon, authenticated;

create or replace function caixa.list_transactions(
  p_manager_id uuid,
  p_pin text
)
returns setof caixa.transactions
language plpgsql
security definer
set search_path = pg_catalog, caixa, extensions
as $$
begin
  if caixa.authenticate_manager(p_manager_id, p_pin) is null then
    raise exception 'Usuário ou PIN inválido';
  end if;

  return query
  select transactions.*
  from caixa.transactions as transactions
  order by transactions.occurred_on desc, transactions.created_at desc;
end;
$$;

revoke all on function caixa.list_transactions(uuid, text) from public;
grant execute on function caixa.list_transactions(uuid, text) to anon, authenticated;

create table caixa.authorized_receipt_uploads (
  path text primary key,
  transaction_id uuid not null,
  manager_id uuid not null references caixa.managers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table caixa.authorized_receipt_uploads enable row level security;
revoke all on caixa.authorized_receipt_uploads from public, anon, authenticated;

create table caixa.authorized_receipt_reads (
  path text primary key,
  manager_id uuid not null references caixa.managers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table caixa.authorized_receipt_reads enable row level security;
revoke all on caixa.authorized_receipt_reads from public, anon, authenticated;

create or replace function caixa.authorize_receipt_upload(
  p_manager_id uuid,
  p_pin text,
  p_transaction_id uuid,
  p_receipt_path text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, caixa, extensions
as $$
begin
  if caixa.authenticate_manager(p_manager_id, p_pin) is null then
    raise exception 'Usuário ou PIN inválido';
  end if;

  if p_receipt_path is null
    or char_length(p_receipt_path) > 240
    or p_receipt_path !~ ('^' || p_transaction_id::text || '/[^/]{1,180}\.(pdf|PDF|png|PNG|jpe?g|JPE?G)$')
    or p_receipt_path like '%..%'
  then
    raise exception 'Caminho de comprovante inválido';
  end if;

  delete from caixa.authorized_receipt_uploads
  where expires_at <= now();

  insert into caixa.authorized_receipt_uploads (
    path, transaction_id, manager_id, expires_at
  ) values (
    p_receipt_path, p_transaction_id, p_manager_id, now() + interval '10 minutes'
  )
  on conflict (path) do update
  set manager_id = excluded.manager_id,
      transaction_id = excluded.transaction_id,
      expires_at = excluded.expires_at,
      created_at = now();
end;
$$;

create or replace function caixa.authorize_receipt_read(
  p_manager_id uuid,
  p_pin text,
  p_receipt_path text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, caixa, extensions
as $$
begin
  if caixa.authenticate_manager(p_manager_id, p_pin) is null then
    raise exception 'Usuário ou PIN inválido';
  end if;

  if not exists (
    select 1
    from caixa.transactions
    where receipt_path = p_receipt_path
  ) then
    raise exception 'Comprovante não encontrado';
  end if;

  delete from caixa.authorized_receipt_reads
  where expires_at <= now();

  insert into caixa.authorized_receipt_reads (
    path, manager_id, expires_at
  ) values (
    p_receipt_path, p_manager_id, now() + interval '2 minutes'
  )
  on conflict (path) do update
  set manager_id = excluded.manager_id,
      expires_at = excluded.expires_at,
      created_at = now();
end;
$$;

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
    where receipt_path = p_path and deleted_at is null
  ) or exists (
    select 1
    from caixa.authorized_receipt_reads
    where path = p_path and expires_at > now()
  );
$$;

create or replace function caixa.can_write_pending_receipt(p_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, caixa, extensions
as $$
  select exists (
    select 1
    from caixa.authorized_receipt_uploads
    where path = p_path and expires_at > now()
  );
$$;

revoke all on function caixa.authorize_receipt_upload(uuid, text, uuid, text) from public;
revoke all on function caixa.authorize_receipt_read(uuid, text, text) from public;
revoke all on function caixa.can_read_receipt(text) from public;
revoke all on function caixa.can_write_pending_receipt(text) from public;
grant execute on function caixa.authorize_receipt_upload(uuid, text, uuid, text) to anon, authenticated;
grant execute on function caixa.authorize_receipt_read(uuid, text, text) to anon, authenticated;
grant execute on function caixa.can_read_receipt(text) to anon, authenticated;
grant execute on function caixa.can_write_pending_receipt(text) to anon, authenticated;

create policy "read active caixa receipts" on storage.objects
for select to anon, authenticated
using (bucket_id = 'caixa-files' and caixa.can_read_receipt(name));

create policy "upload authorized caixa receipts" on storage.objects
for insert to anon, authenticated
with check (bucket_id = 'caixa-files' and caixa.can_write_pending_receipt(name));

create policy "delete pending caixa receipts" on storage.objects
for delete to anon, authenticated
using (bucket_id = 'caixa-files' and caixa.can_write_pending_receipt(name));

-- Versão de transição: mantém o frontend antigo funcionando e consome a
-- autorização quando a chamada vier do frontend novo.
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

  if p_receipt_path is not null then
    delete from caixa.authorized_receipt_uploads
    where path = p_receipt_path
      and transaction_id = p_id
      and manager_id = p_manager_id;
  end if;
end;
$$;

revoke all on function caixa.create_transaction(uuid, text, uuid, text, text, date, integer, text, text, text, text, text) from public;
grant execute on function caixa.create_transaction(uuid, text, uuid, text, text, date, integer, text, text, text, text, text) to anon, authenticated;

commit;
