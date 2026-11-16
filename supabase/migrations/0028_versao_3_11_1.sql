-- Extensão 3.11.1: teste da atualização automática. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.11.1', 'Teste da atualização automática: popup mostra "atualização automática ligada"', '2026-11-16', '8d04b494be1cf2e94dfe56e2dae3bfd6145d761e', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.11.1';
update public.extensao_versoes set principal = true where versao = '3.11.1';
