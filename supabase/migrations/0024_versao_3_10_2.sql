-- Extensão 3.10.2: atualização com um clique grava só os arquivos que mudaram. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.10.2', 'Atualização mais rápida: grava só os arquivos que mudaram', '2026-11-16', '91dfbf3a5bf7bacdc54aec5edcdcaf98859db318', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.10.2';
update public.extensao_versoes set principal = true where versao = '3.10.2';
