-- Extensão 3.9.0: dispara a rotina automática (semanal ou mensal) sozinha. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.9.0', 'Rotina automática pela extensão (toda semana ou uma vez por mês), sem precisar do robô', '2026-11-15', '701b652594e5873389d96d77358843ed0e59500a', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.9.0';
update public.extensao_versoes set principal = true where versao = '3.9.0';
