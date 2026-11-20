-- Ferramenta SDR (Administração): pesquisa coletiva por município — lousa, situação da ligação e
-- repasse ao consultor. Tudo protegido pela mesma senha do SDR da migração 008 (sdr_password).
-- Rode no SQL Editor do Supabase DEPOIS da 008. Não tem senha para trocar aqui.

-- um registro por município ("uf|municipio" sem acento, minúsculo)
create table if not exists public.sdr_registros (
  chave text primary key,
  uf text not null,
  municipio text not null,
  dados jsonb not null default '{}'::jsonb,  -- notas, email, telefone, nomeContato, cargoContato, consultorNome, campanha, ploomesId, estagio, contatosValidos, qtd
  status text,                               -- última situação da ligação: retorno | sem_contato | agenda | sem_interesse | interessante | retornar
  atendente text,                            -- quem mexeu por último
  atualizado_em timestamptz not null default now()
);
-- histórico: cada situação marcada (tipo status) e cada pesquisa de outra pessoa (tipo pesquisa)
create table if not exists public.sdr_acoes (
  id bigserial primary key,
  chave text not null references public.sdr_registros(chave) on delete cascade,
  em timestamptz not null default now(),
  tipo text not null,
  status text,
  atendente text,
  desfeita boolean not null default false
);
create index if not exists sdr_acoes_chave on public.sdr_acoes (chave, em);
-- quem pesquisa (nome do Webex) e o papel escolhido ao entrar
create table if not exists public.sdr_atendentes (
  nome text primary key,
  papel text not null default 'sdr',
  visto_em timestamptz not null default now()
);
alter table public.sdr_registros enable row level security;   -- sem policies: só pelas funções abaixo
alter table public.sdr_acoes enable row level security;
alter table public.sdr_atendentes enable row level security;

create or replace function public.sdr_exige_senha(p_senha text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.sdr_senha_ok(p_senha) then raise exception 'senha incorreta' using errcode = '28P01'; end if;
end $$;

-- registro em JSON, com o histórico (sem as ações desfeitas)
create or replace function public.sdr_registro_json(p_chave text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('chave', r.chave, 'uf', r.uf, 'municipio', r.municipio, 'dados', r.dados, 'status', r.status,
           'atendente', r.atendente, 'atualizadoEm', r.atualizado_em,
           'acoes', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'em', a.em, 'tipo', a.tipo, 'status', a.status, 'atendente', a.atendente) order by a.em)
                                from public.sdr_acoes a where a.chave = r.chave and not a.desfeita), '[]'::jsonb))
    from public.sdr_registros r where r.chave = p_chave;
$$;

-- lê tudo (ou só o que mudou depois de p_desde): { registros: [...], atendentes: [...], agora }
create or replace function public.sdr_ler(p_senha text, p_desde timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sdr_exige_senha(p_senha);
  return jsonb_build_object(
    'agora', now(),
    'registros', coalesce((select jsonb_agg(public.sdr_registro_json(r.chave)) from public.sdr_registros r
                            where p_desde is null or r.atualizado_em > p_desde), '[]'::jsonb),
    'atendentes', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'papel', papel) order by nome) from public.sdr_atendentes), '[]'::jsonb));
end $$;

-- entra com o nome e o papel (sdr | consultor)
create or replace function public.sdr_entrar(p_senha text, p_nome text, p_papel text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.sdr_exige_senha(p_senha);
  if coalesce(trim(p_nome), '') = '' then raise exception 'informe o nome'; end if;
  insert into public.sdr_atendentes (nome, papel, visto_em) values (trim(p_nome), case when p_papel = 'consultor' then 'consultor' else 'sdr' end, now())
  on conflict (nome) do update set papel = excluded.papel, visto_em = now();
  return true;
end $$;

-- grava campos da lousa / do consultor (só os campos enviados mudam) e, se quiser, a situação da ligação
create or replace function public.sdr_salvar(p_senha text, p_chave text, p_uf text, p_municipio text, p_campos jsonb,
                                             p_atendente text, p_status text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare atual public.sdr_registros;
begin
  perform public.sdr_exige_senha(p_senha);
  if coalesce(trim(p_atendente), '') = '' then raise exception 'informe quem está pesquisando'; end if;
  if p_status is not null and p_status not in ('retorno', 'sem_contato', 'agenda', 'sem_interesse', 'interessante', 'retornar') then
    raise exception 'situação inválida';
  end if;
  select * into atual from public.sdr_registros where chave = p_chave;
  insert into public.sdr_registros (chave, uf, municipio, dados, status, atendente, atualizado_em)
  values (p_chave, upper(p_uf), p_municipio, coalesce(p_campos, '{}'::jsonb), p_status, p_atendente, now())
  on conflict (chave) do update
    set dados = public.sdr_registros.dados || coalesce(p_campos, '{}'::jsonb),
        status = coalesce(p_status, public.sdr_registros.status),
        atendente = p_atendente, atualizado_em = now();
  -- outra pessoa pesquisando o mesmo município: fica registrado no histórico
  if atual.chave is not null and p_status is null and coalesce(atual.atendente, '') <> p_atendente then
    insert into public.sdr_acoes (chave, tipo, status, atendente) values (p_chave, 'pesquisa', 'nota', p_atendente);
  end if;
  -- situação nova: entra no histórico
  if p_status is not null and p_status is distinct from atual.status then
    insert into public.sdr_acoes (chave, tipo, status, atendente) values (p_chave, 'status', p_status, p_atendente);
  end if;
  return public.sdr_registro_json(p_chave);
end $$;

-- desfaz uma ação do histórico (a situação volta para a anterior)
create or replace function public.sdr_desfazer(p_senha text, p_acao bigint, p_atendente text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform public.sdr_exige_senha(p_senha);
  update public.sdr_acoes set desfeita = true where id = p_acao returning chave into k;
  if k is null then raise exception 'ação não encontrada'; end if;
  update public.sdr_registros
     set status = (select status from public.sdr_acoes where chave = k and tipo = 'status' and not desfeita order by em desc limit 1),
         atendente = p_atendente, atualizado_em = now()
   where chave = k;
  return public.sdr_registro_json(k);
end $$;

-- importação única do estado da plataforma antiga ({ contatos: { chave: {...} }, atendentes: [...] })
create or replace function public.sdr_importar(p_senha text, p_estado jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare k text; r jsonb; a jsonb; n integer := 0;
begin
  perform public.sdr_exige_senha(p_senha);
  for k, r in select * from jsonb_each(coalesce(p_estado -> 'contatos', '{}'::jsonb)) loop
    insert into public.sdr_registros (chave, uf, municipio, dados, status, atendente, atualizado_em)
    values (k, upper(r ->> 'uf'), r ->> 'mun',
            (r - 'mun' - 'uf' - 'acoes' - 'status' - 'atendente' - 'atualizadoEm' - 'contatoEm' - 'pesquisaEm'),
            nullif(r ->> 'status', ''), r ->> 'atendente', coalesce((r ->> 'atualizadoEm')::timestamptz, now()))
    on conflict (chave) do nothing;
    if found then
      n := n + 1;
      for a in select * from jsonb_array_elements(coalesce(r -> 'acoes', '[]'::jsonb)) loop
        insert into public.sdr_acoes (chave, em, tipo, status, atendente)
        values (k, (a ->> 'em')::timestamptz, coalesce(a ->> 'tipo', 'status'), a ->> 'status', a ->> 'atendente');
      end loop;
    end if;
  end loop;
  insert into public.sdr_atendentes (nome) select trim(x) from jsonb_array_elements_text(coalesce(p_estado -> 'atendentes', '[]'::jsonb)) x
   where trim(x) <> '' on conflict (nome) do nothing;
  return n;
end $$;

revoke all on function public.sdr_exige_senha(text) from public;
revoke all on function public.sdr_registro_json(text) from public;
revoke all on function public.sdr_ler(text, timestamptz) from public;
revoke all on function public.sdr_entrar(text, text, text) from public;
revoke all on function public.sdr_salvar(text, text, text, text, jsonb, text, text) from public;
revoke all on function public.sdr_desfazer(text, bigint, text) from public;
revoke all on function public.sdr_importar(text, jsonb) from public;
grant execute on function public.sdr_ler(text, timestamptz) to anon, authenticated;
grant execute on function public.sdr_entrar(text, text, text) to anon, authenticated;
grant execute on function public.sdr_salvar(text, text, text, text, jsonb, text, text) to anon, authenticated;
grant execute on function public.sdr_desfazer(text, bigint, text) to anon, authenticated;
grant execute on function public.sdr_importar(text, jsonb) to anon, authenticated;
