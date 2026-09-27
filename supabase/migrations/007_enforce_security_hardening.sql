-- Etapa 2/2: remove os acessos públicos antigos.
-- Aplique somente após o frontend com suporte à migration 006 estar publicado e validado.

begin;

drop policy if exists "public access to caixa transactions" on caixa.transactions;
revoke all on caixa.transactions from anon, authenticated;

drop policy if exists "public read caixa files" on storage.objects;
drop policy if exists "public upload caixa files" on storage.objects;
drop policy if exists "public delete caixa files" on storage.objects;

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
  if p_receipt_path is not null and not exists (
    select 1
    from caixa.authorized_receipt_uploads
    where path = p_receipt_path
      and transaction_id = p_id
      and manager_id = p_manager_id
      and expires_at > now()
  ) then
    raise exception 'Upload de comprovante não autorizado ou expirado';
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
    where path = p_receipt_path;
  end if;
end;
$$;

revoke all on function caixa.create_transaction(uuid, text, uuid, text, text, date, integer, text, text, text, text, text) from public;
grant execute on function caixa.create_transaction(uuid, text, uuid, text, text, date, integer, text, text, text, text, text) to anon, authenticated;

commit;
