-- Caixa-preta do discador (/telefone): linha do tempo de cada sessão aberta pelo QR Code,
-- para diagnosticar falhas de ligação. Rode no SQL Editor do Supabase (pode rodar por cima).
--
-- * Gravação: só pela função telefone_log_gravar (chamada pela rota /api/telefone-log), com
--   limite de tamanho e de quantidade. Ninguém lê a tabela pela chave pública (RLS sem policies).
-- * Leitura: só pela função telefone_log_ler, com a senha 'log_password' do app_config
--   (cadastrada à parte — NÃO fica neste arquivo, porque o repositório é público).
-- * Registros com mais de 15 dias são apagados sozinhos.
-- * Nunca entram no log: senha/login do ramal e token. O número discado chega mascarado.

create table if not exists public.telefone_eventos (
  id         bigserial primary key,
  sessao     text not null,              -- uma sessão = uma abertura do discador
  seq        int,                        -- ordem do evento dentro da sessão
  t_ms       int,                        -- milissegundos desde a abertura
  tipo       text not null,
  dados      jsonb,
  ip         text,                       -- mascarado (ex.: 177.32.x.x)
  local      text,                       -- cidade/estado aproximados (Vercel)
  criado_em  timestamptz not null default now()
);
create index if not exists telefone_eventos_sessao_idx on public.telefone_eventos (sessao, seq);
create index if not exists telefone_eventos_criado_idx on public.telefone_eventos (criado_em desc);
alter table public.telefone_eventos enable row level security;  -- sem policies: inacessível via API pública

-- Grava um lote de eventos de uma sessão. Devolve quantos gravou (0 = recusado).
create or replace function public.telefone_log_gravar(
  p_sessao text, p_eventos jsonb, p_ip text default null, p_local text default null
) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  v_n     int;
  v_total int;
begin
  if p_sessao is null or p_sessao !~ '^[A-Za-z0-9-]{8,64}$' then return 0; end if;
  if p_eventos is null or jsonb_typeof(p_eventos) <> 'array' then return 0; end if;
  v_n := jsonb_array_length(p_eventos);
  if v_n = 0 or v_n > 80 then return 0; end if;

  -- no máximo 600 eventos por sessão (evita enxurrada)
  select count(*) into v_total from public.telefone_eventos where sessao = p_sessao;
  if v_total + v_n > 600 then return 0; end if;

  -- limpeza ocasional do que passou de 15 dias
  if random() < 0.05 then
    delete from public.telefone_eventos where criado_em < now() - interval '15 days';
  end if;

  insert into public.telefone_eventos (sessao, seq, t_ms, tipo, dados, ip, local)
  select p_sessao,
         case when x->>'seq' ~ '^[0-9]{1,6}$' then (x->>'seq')::int end,
         case when x->>'t'   ~ '^[0-9]{1,9}$' then (x->>'t')::int end,
         left(coalesce(nullif(x->>'tipo', ''), '?'), 40),
         case
           when x->'dados' is null or jsonb_typeof(x->'dados') = 'null' then null
           when length((x->'dados')::text) <= 3000 then x->'dados'
           else jsonb_build_object('cortado', left((x->'dados')::text, 3000))
         end,
         left(p_ip, 64),
         left(p_local, 80)
  from jsonb_array_elements(p_eventos) as x
  where jsonb_typeof(x) = 'object';

  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Lê as sessões mais recentes (com a linha do tempo de cada uma). Senha errada -> null.
create or replace function public.telefone_log_ler(p_senha text, p_limite int default 40)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if p_senha is null or p_senha = '' or not exists (
    select 1 from public.app_config where key = 'log_password' and value = p_senha
  ) then
    return null;
  end if;

  return (
    with s as (
      select sessao, min(criado_em) as inicio, max(criado_em) as fim
        from public.telefone_eventos
       where criado_em > now() - interval '15 days'
       group by sessao
       order by min(criado_em) desc
       limit least(greatest(coalesce(p_limite, 40), 1), 200)
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'sessao', s.sessao,
             'inicio', s.inicio,
             'fim',    s.fim,
             'ip',     (select e.ip    from public.telefone_eventos e where e.sessao = s.sessao and e.ip    is not null order by e.id limit 1),
             'local',  (select e.local from public.telefone_eventos e where e.sessao = s.sessao and e.local is not null order by e.id limit 1),
             'eventos', (select jsonb_agg(jsonb_build_object('seq', e.seq, 't', e.t_ms, 'tipo', e.tipo, 'dados', e.dados, 'em', e.criado_em)
                                          order by e.seq nulls last, e.id)
                           from public.telefone_eventos e where e.sessao = s.sessao)
           ) order by s.inicio desc), '[]'::jsonb)
      from s
  );
end $$;

grant execute on function public.telefone_log_gravar(text, jsonb, text, text) to anon, authenticated;
grant execute on function public.telefone_log_ler(text, int) to anon, authenticated;
