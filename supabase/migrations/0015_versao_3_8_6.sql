-- Extensão 3.8.6: troca de contador pelo botão Sair da Sefaz. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.8.6', 'Troca de contador pelo botão Sair da própria Sefaz', '2026-11-13', 'e663aa30fe5a07da825ae0643d9db00f80f451f5', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.8.6';
update public.extensao_versoes set principal = true where versao = '3.8.6';
