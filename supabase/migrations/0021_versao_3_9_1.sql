-- Extensão 3.9.1: só marca "Concluído" quando o ZIP chegou na pasta da empresa. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.9.1', 'Só marca Concluído quando o ZIP chegou na pasta; avisa se o download falhar ou o organizador não mover', '2026-11-16', '566e6f45ad67c7e93d980ce53e3664ad8903a4d8', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.9.1';
update public.extensao_versoes set principal = true where versao = '3.9.1';
