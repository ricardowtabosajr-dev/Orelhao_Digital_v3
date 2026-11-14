-- Guarda a "vista" do Street View de onde o orelhão foi marcado (posição da câmera do carro,
-- direção e inclinação), para o botão "Ver na rua" abrir exatamente olhando para o orelhão.
-- Pedido do usuário em 13/11/2026. Rode no SQL Editor do Supabase (depois da 006).

alter table public.orelhoes
  add column if not exists sv_lat     double precision,
  add column if not exists sv_lng     double precision,
  add column if not exists sv_heading double precision,  -- direção da câmera, 0–360 (0 = norte)
  add column if not exists sv_pitch   double precision;  -- inclinação, -90 (chão) a 90 (céu)

-- Mesma função da 006, agora também com a vista da câmera (opcional: Google Earth não manda).
drop function if exists public.marcar_posicao(bigint, double precision, double precision, text);
create or replace function public.marcar_posicao(
  p_id bigint,
  p_lat double precision,
  p_lng double precision,
  p_fonte text default null,               -- 'Street View' | 'Google Earth'
  p_sv_lat double precision default null,
  p_sv_lng double precision default null,
  p_sv_heading double precision default null,
  p_sv_pitch double precision default null
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
    origem_desc = 'Posição corrigida manualmente' || coalesce(' (' || nullif(trim(p_fonte), '') || ')', ''),
    sv_lat      = p_sv_lat,
    sv_lng      = p_sv_lng,
    sv_heading  = p_sv_heading,
    sv_pitch    = p_sv_pitch
  where id = p_id;

  insert into public.orelhoes_historico (orelhao_id, antes, depois)
  select p_id, v_antes, to_jsonb(o) - 'geom' from public.orelhoes o where id = p_id;

  return true;
end $$;

revoke all on function public.marcar_posicao(bigint, double precision, double precision, text, double precision, double precision, double precision, double precision) from public;
grant execute on function public.marcar_posicao(bigint, double precision, double precision, text, double precision, double precision, double precision, double precision) to anon, authenticated;
