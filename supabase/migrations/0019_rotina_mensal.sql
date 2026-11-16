-- Rotina automática: "toda semana" (dias da semana, como antes) ou "uma vez por mês" (dia do mês).
-- Quem dispara agora é a extensão do computador escolhido em "Baixar em" (escritorios.pc_padrao):
-- a cada minuto ela chama extensao_agendar, que cria o pedido quando chega o dia e a hora.
alter table public.rotinas add column if not exists frequencia text not null default 'semanal';
alter table public.rotinas drop constraint if exists rotinas_frequencia_check;
alter table public.rotinas add constraint rotinas_frequencia_check check (frequencia in ('semanal','mensal'));
alter table public.rotinas add column if not exists dia_mes int not null default 1;   -- 31 = último dia do mês
alter table public.rotinas drop constraint if exists rotinas_dia_mes_check;
alter table public.rotinas add constraint rotinas_dia_mes_check check (dia_mes between 1 and 31);

-- Cria (no máximo uma vez por dia, ou por mês na rotina mensal) o pedido agendado de cada escritório
-- cujo computador escolhido é p_pc. Se o computador estava desligado no horário, cria quando ele voltar
-- (no mesmo dia, na semanal; em qualquer dia do mês depois do dia marcado, na mensal).
create or replace function public.extensao_agendar(p_pc uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; n int := 0;
  agora timestamp := now() at time zone 'America/Sao_Paulo';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ultimo int; inicio timestamptz; comp date;
begin
  if auth.uid() is null then return 0; end if;
  for r in select ro.* from rotinas ro join escritorios e on e.id = ro.escritorio_id
            where ro.ativa and e.pc_padrao = p_pc loop
    if r.frequencia = 'mensal' then
      ultimo := extract(day from (date_trunc('month', hoje) + interval '1 month - 1 day'))::int;
      if extract(day from hoje)::int < least(r.dia_mes, ultimo) then continue; end if;
      if extract(day from hoje)::int = least(r.dia_mes, ultimo) and agora::time < r.horario then continue; end if;
      inicio := date_trunc('month', hoje)::timestamp at time zone 'America/Sao_Paulo';
    else
      if not (extract(dow from hoje)::int = any(r.dias_semana)) or agora::time < r.horario then continue; end if;
      inicio := hoje::timestamp at time zone 'America/Sao_Paulo';
    end if;
    if exists (select 1 from execucoes x where x.escritorio_id = r.escritorio_id
                and x.origem = 'agendada' and x.solicitada_em >= inicio) then continue; end if;
    comp := case when r.periodo = 'mes_atual' then date_trunc('month', hoje)::date
                 else (date_trunc('month', hoje) - interval '1 month')::date end;
    insert into execucoes (escritorio_id, origem, status, pc_id, competencia)
    values (r.escritorio_id, 'agendada', 'aguardando_pc', p_pc, to_char(comp, 'YYYY-MM-DD'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.extensao_agendar(uuid) from public, anon;
grant execute on function public.extensao_agendar(uuid) to authenticated;
