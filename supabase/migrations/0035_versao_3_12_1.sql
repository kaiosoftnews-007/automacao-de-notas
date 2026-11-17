-- Extensão 3.12.1: notas salvas na subpasta NOTAS da empresa. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.12.1', 'Notas salvas dentro da pasta NOTAS da empresa (EMPRESA\NOTAS\MMAAAA); cria a pasta NOTAS se não existir', '2026-11-17', '1fc3286cbddc4a6f37e217092c1174a612fb7464', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.12.1';
update public.extensao_versoes set principal = true where versao = '3.12.1';
