-- Extensão 3.12.0: contadores por empresa. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.12.0', 'Contadores por empresa: cada empresa baixa com o login da Sefaz do seu contador; troca de contador sozinha na fila', '2026-11-17', '6ce7141c86e7a603df2ea82db829a23a4feb2985', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.12.0';
update public.extensao_versoes set principal = true where versao = '3.12.0';
