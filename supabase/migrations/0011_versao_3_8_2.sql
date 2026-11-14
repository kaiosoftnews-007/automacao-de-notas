-- Extensão 3.8.2: contador de cliques próprio para o card "Acesso Restrito". Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.8.2', 'Continua sozinha depois que você clica no card Acesso Restrito', '2026-11-13', 'b36750cce7bbff48587759356c6ace9d434b1f8d', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.8.2';
update public.extensao_versoes set principal = true where versao = '3.8.2';
