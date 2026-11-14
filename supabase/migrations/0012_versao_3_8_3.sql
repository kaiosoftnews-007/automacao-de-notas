-- Extensão 3.8.3: espera até 3 min pelo resultado da consulta e tenta de novo. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.8.3', 'Espera a Sefaz lenta (até 3 min) e tenta a consulta de novo', '2026-11-13', '7104d834ffec164a5e7f6fc2d33a1e796b6ae417', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.8.3';
update public.extensao_versoes set principal = true where versao = '3.8.3';
