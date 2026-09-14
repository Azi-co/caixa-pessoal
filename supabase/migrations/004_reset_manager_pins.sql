-- Redefine todos os PINs e exibe os novos códigos uma única vez.
-- Salve o resultado antes de fechar o SQL Editor.

with generated as materialized (
  select id, display_name,
    lpad(floor(random() * 1000000)::integer::text, 6, '0') as pin
  from caixa.managers
  where active = true
), updated as (
  update caixa.managers as managers
  set pin_hash = extensions.crypt(generated.pin, extensions.gen_salt('bf'))
  from generated
  where managers.id = generated.id
  returning managers.id
)
select generated.display_name as usuario, generated.pin
from generated
join updated using (id)
order by generated.display_name;
