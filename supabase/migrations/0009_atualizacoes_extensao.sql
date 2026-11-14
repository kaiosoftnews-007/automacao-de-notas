-- Tela "Atualizações": baixar a extensão de qualquer computador, histórico de versões,
-- excluir computadores e computador sai sozinho da lista quando a extensão é removida (3.8.1+).

-- ---------- Versões da extensão ----------
-- O código de cada versão fica no GitHub (tag em "ref"); o painel monta o zip na hora.
create table if not exists public.extensao_versoes (
  versao text primary key,
  descricao text,
  publicada_em date not null default current_date,
  ref text not null,                       -- tag do GitHub (ex.: v3.8.1)
  principal boolean not null default false,
  criado_em timestamptz not null default now()
);
create unique index if not exists extensao_versoes_uma_principal on public.extensao_versoes (principal) where principal;
alter table public.extensao_versoes enable row level security;
drop policy if exists ver_ler on public.extensao_versoes;
create policy ver_ler on public.extensao_versoes for select to authenticated using (true);
drop policy if exists ver_admin on public.extensao_versoes;
create policy ver_admin on public.extensao_versoes for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal) values
  ('3.8.0', 'Baixar pedidos feitos de outro computador', '2026-11-13', 'v3.8.0', false),
  ('3.8.1', 'Sai sozinha da lista ao remover a extensão', '2026-11-13', 'v3.8.1', true)
on conflict (versao) do nothing;

-- Troca a versão principal (só uma por vez).
create or replace function public.extensao_tornar_principal(p_versao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'sem permissão'; end if;
  if not exists (select 1 from extensao_versoes where versao = p_versao) then raise exception 'versão não encontrada'; end if;
  update extensao_versoes set principal = false where principal and versao <> p_versao;
  update extensao_versoes set principal = true where versao = p_versao;
end $$;
revoke all on function public.extensao_tornar_principal(text) from public, anon;
grant execute on function public.extensao_tornar_principal(text) to authenticated;

-- ---------- Login do painel que vai dentro do zip (credenciais.json) ----------
-- Senha guardada criptografada no Vault; só admin grava e lê.
create table if not exists public.extensao_login (
  id text primary key default 'principal' check (id = 'principal'),
  email text not null,
  senha_secret_id uuid,
  alterado_em timestamptz not null default now()
);
alter table public.extensao_login enable row level security;
drop policy if exists elog_ler on public.extensao_login;
create policy elog_ler on public.extensao_login for select to authenticated using (public.eh_admin());

create or replace function public.extensao_login_salvar(p_email text, p_senha text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if not public.eh_admin() then raise exception 'sem permissão'; end if;
  select senha_secret_id into v_id from extensao_login where id = 'principal';
  if v_id is null then v_id := vault.create_secret(p_senha, 'extensao_login', 'Login do painel dentro da extensão');
  else perform vault.update_secret(v_id, p_senha); end if;
  insert into extensao_login (id, email, senha_secret_id, alterado_em) values ('principal', lower(trim(p_email)), v_id, now())
  on conflict (id) do update set email = excluded.email, senha_secret_id = excluded.senha_secret_id, alterado_em = now();
end $$;
revoke all on function public.extensao_login_salvar(text, text) from public, anon;
grant execute on function public.extensao_login_salvar(text, text) to authenticated;

create or replace function public.extensao_login_ler()
returns table (email text, senha text) language plpgsql security definer set search_path = public, vault as $$
begin
  if not public.eh_admin() then raise exception 'sem permissão'; end if;
  return query select l.email, s.decrypted_secret::text
    from extensao_login l join vault.decrypted_secrets s on s.id = l.senha_secret_id where l.id = 'principal';
end $$;
revoke all on function public.extensao_login_ler() from public, anon;
grant execute on function public.extensao_login_ler() to authenticated;

-- ---------- Chave de remoção de cada computador ----------
-- Fica numa tabela à parte (só admin lê), para quem é de escritório não conseguir tirar computadores.
create table if not exists public.computadores_chave (
  pc_id uuid primary key references public.computadores(id) on delete cascade,
  chave uuid not null default gen_random_uuid()
);
alter table public.computadores_chave enable row level security;
drop policy if exists cch_ler on public.computadores_chave;
create policy cch_ler on public.computadores_chave for select to authenticated using (public.eh_admin());
insert into public.computadores_chave (pc_id) select id from public.computadores on conflict do nothing;

create or replace function public.criar_chave_computador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into computadores_chave (pc_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists computador_chave on public.computadores;
create trigger computador_chave after insert on public.computadores
  for each row execute function public.criar_chave_computador();

-- Computador excluído: pedidos que esperavam por ele não ficam presos.
create or replace function public.computador_excluido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update execucoes set status = 'falhou', finalizada_em = now()
   where pc_id = old.id and status = 'aguardando_pc';
  return old;
end $$;
drop trigger if exists computador_excluido on public.computadores;
create trigger computador_excluido before delete on public.computadores
  for each row execute function public.computador_excluido();

-- Chamado pela página que o Chrome abre quando a extensão é removida (sem login).
-- Só apaga com a chave certa daquele computador. Devolve o nome do computador removido.
create or replace function public.extensao_removida(p_pc uuid, p_chave uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if not exists (select 1 from computadores_chave where pc_id = p_pc and chave = p_chave) then return null; end if;
  delete from computadores where id = p_pc returning nome into v_nome;
  return v_nome;
end $$;
revoke all on function public.extensao_removida(uuid, uuid) from public;
grant execute on function public.extensao_removida(uuid, uuid) to anon, authenticated;
