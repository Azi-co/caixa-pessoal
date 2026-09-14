create extension if not exists pgcrypto;

create schema if not exists caixa;
revoke all on schema caixa from public;
grant usage on schema caixa to anon, authenticated, service_role;

create table if not exists caixa.transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('deposit', 'expense')),
  name text not null check (char_length(trim(name)) between 1 and 120),
  occurred_on date not null,
  amount_cents integer not null check (amount_cents > 0),
  receipt_path text,
  receipt_name text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table caixa.transactions enable row level security;
grant select, insert, update, delete on caixa.transactions to anon, authenticated;

create policy "public access to caixa transactions" on caixa.transactions
for all to anon, authenticated using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('caixa-files', 'caixa-files', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "public read caixa files" on storage.objects for select to anon, authenticated
using (bucket_id = 'caixa-files');
create policy "public upload caixa files" on storage.objects for insert to anon, authenticated
with check (bucket_id = 'caixa-files');
create policy "public delete caixa files" on storage.objects for delete to anon, authenticated
using (bucket_id = 'caixa-files');

