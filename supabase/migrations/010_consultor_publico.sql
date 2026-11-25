-- Cartão do orelhão (mapa): mostra, SEM senha, um resumo da Ação TUPs para cada município:
-- consultor, SDR (e status da ligação), situação comercial, temperatura e TUPs (base / pretendida).
-- Lê a planilha da Ação TUPs já gravada (migração 008), mas devolve só esses campos —
-- valor contratual, proposta, estágio, observações e o resto da planilha continuam só com a senha.
-- A "situação comercial" já sai pronta daqui (não expõe o valor): "Proposta encaminhada" quando há
-- valor contratual; senão o estágio ou o status da planilha.
-- Rode no SQL Editor do Supabase (pode rodar de novo por cima da versão anterior).

create or replace function public.acao_tups_consultores() returns jsonb
language sql stable security definer set search_path = public as $$
  with l as (select dados from public.acao_tups_leitura where id = 1),
  arr as (
    select
      case when jsonb_typeof(l.dados -> 'municipios') = 'array' then l.dados -> 'municipios' else '[]'::jsonb end as municipios,
      case when jsonb_typeof(l.dados -> 'consultores') = 'array' then l.dados -> 'consultores' else '[]'::jsonb end as consultores,
      case when jsonb_typeof(l.dados -> 'atuacao') = 'array' then l.dados -> 'atuacao' else '[]'::jsonb end as atuacao
    from l
  )
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    -- aba de municípios (base)
    select jsonb_build_object(
      'fonte', 'base', 'uf', m ->> 'uf', 'municipio', m ->> 'municipio',
      'consultor', m ->> 'consultor', 'sdr', m ->> 'sdr', 'temperatura', m ->> 'temperatura',
      'orelhoes', m -> 'orelhoes', 'qtdPretendida', m -> 'qtdPretendida',
      'situacao', case
        when coalesce(trim(m ->> 'valorContratualTexto'), '') <> '' or jsonb_typeof(m -> 'valorContratual') = 'number' then 'Proposta encaminhada'
        else coalesce(nullif(trim(m ->> 'estagio'), ''), nullif(trim(m ->> 'statusOrig'), ''), '—') end
    ) as x
    from arr, jsonb_array_elements(arr.municipios) m
    union all
    -- aba de consultores (só o nome)
    select jsonb_build_object('fonte', 'consultores', 'uf', c ->> 'uf', 'municipio', c ->> 'municipio', 'consultor', c ->> 'consultor')
    from arr, jsonb_array_elements(arr.consultores) c
    where coalesce(trim(c ->> 'consultor'), '') <> ''
    union all
    -- aba de atuação do SDR (nome, status da ligação e aba, para pegar a mais recente)
    select jsonb_build_object('fonte', 'atuacao', 'uf', a ->> 'uf', 'municipio', a ->> 'municipio', 'sdr', a ->> 'sdr', 'status', a ->> 'status', 'aba', a -> 'aba')
    from arr, jsonb_array_elements(arr.atuacao) a
  ) t;
$$;

revoke all on function public.acao_tups_consultores() from public;
grant execute on function public.acao_tups_consultores() to anon, authenticated;
