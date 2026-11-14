-- Correção de posição de orelhões, protegida por senha de edição.
-- Rode no SQL Editor do Supabase. TROQUE a senha abaixo antes de rodar.

create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;  -- sem policies: inacessível via API pública

insert into public.app_config (key, value) values ('edit_password', 'TROQUE_ESTA_SENHA')
on conflict (key) do nothing;

create or replace function public.atualizar_posicao(
  p_id bigint, p_lat double precision, p_lng double precision, p_senha text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_senha is distinct from (select value from public.app_config where key = 'edit_password') then
    return false;
  end if;
  if p_lat not between -35 and 6 or p_lng not between -75 and -32 then
    raise exception 'Coordenadas fora do Brasil';
  end if;
  update public.orelhoes
     set lat = p_lat, lng = p_lng, origem = 'original',
         origem_desc = 'Posição corrigida manualmente (Street View)'
   where id = p_id;
  return found;
end $$;

revoke all on function public.atualizar_posicao(bigint, double precision, double precision, text) from public;
grant execute on function public.atualizar_posicao(bigint, double precision, double precision, text) to anon, authenticated;
