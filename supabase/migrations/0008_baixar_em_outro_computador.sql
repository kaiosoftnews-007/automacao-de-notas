-- Baixar em outro computador: o pedido feito no painel (de qualquer máquina) vai para o
-- computador escolhido, que tem a extensão instalada e pega o pedido sozinho (extensão 3.8.0+).

-- Computadores com a extensão. A extensão se cadastra e dá sinal a cada minuto.
create table if not exists public.computadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  versao text,
  ultimo_sinal timestamptz,
  verificacao_desde timestamptz,          -- parado no "Confirme que é humano" desde quando (null = não está parado)
  criado_em timestamptz not null default now()
);
alter table public.computadores enable row level security;
drop policy if exists comp_ler on public.computadores;
create policy comp_ler on public.computadores for select to authenticated using (true);
drop policy if exists comp_admin on public.computadores;
create policy comp_admin on public.computadores for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- Computador escolhido para cada escritório (fica guardado) e para cada pedido.
alter table public.escritorios add column if not exists pc_padrao uuid references public.computadores(id) on delete set null;
alter table public.execucoes  add column if not exists pc_id     uuid references public.computadores(id) on delete set null;
-- O que baixar: competência escolhida no painel (aaaa-mm-01) e, se for uma empresa só, a IE dela.
alter table public.execucoes  add column if not exists competencia text;
alter table public.execucoes  add column if not exists ie text;

-- Novo status: pedido esperando o computador escolhido (o robô em Python não pega estes).
alter table public.execucoes drop constraint if exists execucoes_status_check;
alter table public.execucoes add constraint execucoes_status_check
  check (status in ('pendente','aguardando_pc','rodando','concluida','com_erros','falhou'));

drop policy if exists exe_pedir on public.execucoes;
create policy exe_pedir on public.execucoes for insert to authenticated
  with check (public.pode_ver(escritorio_id) and origem = 'manual' and status in ('pendente','aguardando_pc'));

-- A extensão pega o próximo pedido do seu computador (um pedido nunca é pego duas vezes).
create or replace function public.extensao_pegar_pedido(p_pc uuid)
returns setof public.execucoes language sql security invoker set search_path = public as $$
  update execucoes set status = 'rodando', iniciada_em = now()
   where id = (select id from execucoes
                where status = 'aguardando_pc' and pc_id = p_pc
                order by solicitada_em limit 1
                for update skip locked)
  returning *;
$$;
revoke all on function public.extensao_pegar_pedido(uuid) from public, anon;
grant execute on function public.extensao_pegar_pedido(uuid) to authenticated;
