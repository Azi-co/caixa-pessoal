-- Execute somente se 001_initial.sql já foi aplicada na versão com login.

drop policy if exists "members read own transactions" on caixa.transactions;
drop policy if exists "members create own transactions" on caixa.transactions;
drop policy if exists "members update own transactions" on caixa.transactions;
drop policy if exists "members delete own transactions" on caixa.transactions;

drop policy if exists "caixa members read own files" on storage.objects;
drop policy if exists "caixa members upload own files" on storage.objects;
drop policy if exists "caixa members delete own files" on storage.objects;

alter table caixa.transactions drop column if exists user_id;
grant usage on schema caixa to anon, authenticated, service_role;
grant select, insert, update, delete on caixa.transactions to anon, authenticated;

drop policy if exists "public access to caixa transactions" on caixa.transactions;
create policy "public access to caixa transactions" on caixa.transactions
for all to anon, authenticated using (true) with check (true);

drop policy if exists "public read caixa files" on storage.objects;
create policy "public read caixa files" on storage.objects for select to anon, authenticated
using (bucket_id = 'caixa-files');

drop policy if exists "public upload caixa files" on storage.objects;
create policy "public upload caixa files" on storage.objects for insert to anon, authenticated
with check (bucket_id = 'caixa-files');

drop policy if exists "public delete caixa files" on storage.objects;
create policy "public delete caixa files" on storage.objects for delete to anon, authenticated
using (bucket_id = 'caixa-files');

drop policy if exists "members read own membership" on caixa.members;
drop function if exists caixa.is_member();
drop table if exists caixa.members;

