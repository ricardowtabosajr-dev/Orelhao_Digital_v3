-- Painel Ação TUPs (Administração): guarda a leitura da planilha "Ação TUPs.xlsx".
-- Ler e gravar só com a senha do SDR, conferida aqui dentro do banco (não fica no código do site).
-- Rode no SQL Editor do Supabase. TROQUE a senha abaixo antes de rodar.

create table if not exists public.app_config (key text primary key, value text not null);
alter table public.app_config enable row level security;  -- sem policies: inacessível via API pública

insert into public.app_config (key, value) values ('sdr_password', 'TROQUE_ESTA_SENHA')
on conflict (key) do nothing;

-- uma linha só: a leitura atual (cada carga substitui a anterior; a anterior fica guardada para desfazer)
create table if not exists public.acao_tups_leitura (
  id smallint primary key default 1 check (id = 1),
  dados jsonb not null,
  atualizado_por text,
  arquivo text,
  gravado_em timestamptz not null default now(),
  anterior jsonb
);
alter table public.acao_tups_leitura enable row level security;  -- sem policies: só pelas funções abaixo

create or replace function public.sdr_senha_ok(p_senha text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_senha is not distinct from (select value from public.app_config where key = 'sdr_password');
$$;

-- confere a senha (tela de entrada)
create or replace function public.acao_tups_entrar(p_senha text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.sdr_senha_ok(p_senha);
$$;

-- lê a leitura atual: { dados, atualizado_por, arquivo, gravado_em, tem_anterior } ou null
create or replace function public.acao_tups_ler(p_senha text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sdr_senha_ok(p_senha) then raise exception 'senha incorreta' using errcode = '28P01'; end if;
  return (select jsonb_build_object('dados', dados, 'atualizado_por', atualizado_por, 'arquivo', arquivo,
                                    'gravado_em', gravado_em, 'tem_anterior', anterior is not null)
            from public.acao_tups_leitura where id = 1);
end $$;

-- grava uma nova leitura (a atual vira "anterior")
create or replace function public.acao_tups_gravar(p_senha text, p_dados jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare agora timestamptz := now();
begin
  if not public.sdr_senha_ok(p_senha) then raise exception 'senha incorreta' using errcode = '28P01'; end if;
  if p_dados is null or jsonb_typeof(p_dados -> 'municipios') <> 'array' then raise exception 'leitura inválida'; end if;
  insert into public.acao_tups_leitura (id, dados, atualizado_por, arquivo, gravado_em, anterior)
  values (1, p_dados, p_dados ->> 'atualizadoPor', p_dados ->> 'arquivo', agora, null)
  on conflict (id) do update
    set anterior = public.acao_tups_leitura.dados,
        dados = excluded.dados, atualizado_por = excluded.atualizado_por,
        arquivo = excluded.arquivo, gravado_em = excluded.gravado_em;
  return agora;
end $$;

-- volta para a leitura anterior (desfaz a última carga)
create or replace function public.acao_tups_desfazer(p_senha text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.sdr_senha_ok(p_senha) then raise exception 'senha incorreta' using errcode = '28P01'; end if;
  update public.acao_tups_leitura
     set dados = anterior, anterior = dados, atualizado_por = anterior ->> 'atualizadoPor',
         arquivo = anterior ->> 'arquivo', gravado_em = now()
   where id = 1 and anterior is not null;
  return found;
end $$;

revoke all on function public.sdr_senha_ok(text) from public;
revoke all on function public.acao_tups_entrar(text) from public;
revoke all on function public.acao_tups_ler(text) from public;
revoke all on function public.acao_tups_gravar(text, jsonb) from public;
revoke all on function public.acao_tups_desfazer(text) from public;
grant execute on function public.acao_tups_entrar(text) to anon, authenticated;
grant execute on function public.acao_tups_ler(text) to anon, authenticated;
grant execute on function public.acao_tups_gravar(text, jsonb) to anon, authenticated;
grant execute on function public.acao_tups_desfazer(text) to anon, authenticated;
