-- Extensão 3.10.1: popup mostra a versão instalada (teste da atualização com um clique). Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.10.1', 'Popup mostra a versão instalada embaixo do título (teste da atualização com um clique)', '2026-11-16', 'e11dafd7b2b9affd7dd2c2a60d2211f97132bca1', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.10.1';
update public.extensao_versoes set principal = true where versao = '3.10.1';
