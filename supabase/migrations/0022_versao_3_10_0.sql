-- Extensão 3.10.0: atualização com um clique (popup avisa versão nova; botão grava na pasta e recarrega). Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.10.0', 'Atualização com um clique: o popup avisa versão nova e o botão Atualizar a extensão grava na pasta e recarrega sozinho', '2026-11-16', '833779f3c61a9f663509ec80d949aa36ade01bc1', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.10.0';
update public.extensao_versoes set principal = true where versao = '3.10.0';
