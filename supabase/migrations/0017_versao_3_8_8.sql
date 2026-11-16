-- Extensão 3.8.8: aceita várias empresas (IEs) no mesmo pedido. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.8.8', 'Baixa só as empresas selecionadas no painel (várias IEs no mesmo pedido)', '2026-11-15', '5c751a9bfbdc2c6b768cf9311a56d4c7ffcf40d4', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.8.8';
update public.extensao_versoes set principal = true where versao = '3.8.8';
