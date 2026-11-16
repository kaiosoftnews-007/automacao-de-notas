-- Extensão 3.11.0: atualização automática pelo organizador (sem escolher pasta). Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.11.0', 'Atualização automática: confere a cada 30 min e se atualiza sozinha pelo organizador; aviso e botão em Atualizações', '2026-11-16', 'e905dc980c5d12f3cfa526b62895a6a85b4996c5', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.11.0';
update public.extensao_versoes set principal = true where versao = '3.11.0';
