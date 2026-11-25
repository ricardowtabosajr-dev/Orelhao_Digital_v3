-- Orelhão sem Street View: quando a aba do Street View (/rua) não acha fotos de rua perto do orelhão
-- e a pessoa clica em "Fechar esta aba", o orelhão fica marcado para todos: o pulso amarelo some
-- e o botão "Ver na rua (Street View)" fica travado. Se a posição do orelhão mudar, a marca é
-- desfeita sozinha (na posição nova pode haver Street View).
-- Rode no SQL Editor do Supabase (depois da 010).

alter table public.orelhoes add column if not exists sem_street_view boolean not null default false;

-- marca o orelhão como sem Street View (sem senha, como a marcação de posição da 006)
create or replace function public.marcar_sem_street_view(p_id bigint) returns boolean
language sql security definer set search_path = public as $$
  update public.orelhoes set sem_street_view = true where id = p_id returning true;
$$;
revoke all on function public.marcar_sem_street_view(bigint) from public;
grant execute on function public.marcar_sem_street_view(bigint) to anon, authenticated;

-- posição mudou: tira a marca
create or replace function public.orelhoes_limpa_sem_sv() returns trigger
language plpgsql as $$
begin
  if new.lat is distinct from old.lat or new.lng is distinct from old.lng then new.sem_street_view := false; end if;
  return new;
end $$;
drop trigger if exists orelhoes_limpa_sem_sv on public.orelhoes;
create trigger orelhoes_limpa_sem_sv before update of lat, lng on public.orelhoes
  for each row execute function public.orelhoes_limpa_sem_sv();
