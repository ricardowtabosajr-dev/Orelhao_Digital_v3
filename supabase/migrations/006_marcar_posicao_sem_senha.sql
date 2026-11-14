-- Salvar a posição marcada no Street View / Google Earth SEM senha (pedido do usuário em 13/11/2026).
-- Só muda latitude/longitude; códigos e status continuam protegidos pela senha (atualizar_orelhao).
-- Cada alteração fica no histórico (orelhoes_historico, migration 003), com o "antes" e o "depois",
-- para dar para desfazer.
-- Rode no SQL Editor do Supabase.

create or replace function public.marcar_posicao(
  p_id bigint,
  p_lat double precision,
  p_lng double precision,
  p_fonte text default null      -- 'Street View' | 'Google Earth'
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_antes jsonb;
begin
  if p_lat is null or p_lng is null or p_lat not between -35 and 6 or p_lng not between -75 and -32 then
    raise exception 'Coordenadas fora do Brasil';
  end if;

  select to_jsonb(o) - 'geom' into v_antes from public.orelhoes o where id = p_id;
  if v_antes is null then return false; end if;

  update public.orelhoes set
    lat         = p_lat,
    lng         = p_lng,
    origem      = 'original',
    origem_desc = 'Posição corrigida manualmente' || coalesce(' (' || nullif(trim(p_fonte), '') || ')', '')
  where id = p_id;

  insert into public.orelhoes_historico (orelhao_id, antes, depois)
  select p_id, v_antes, to_jsonb(o) - 'geom' from public.orelhoes o where id = p_id;

  return true;
end $$;

revoke all on function public.marcar_posicao(bigint, double precision, double precision, text) from public;
grant execute on function public.marcar_posicao(bigint, double precision, double precision, text) to anon, authenticated;
