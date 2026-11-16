-- Extensão 3.8.9: Acesso Restrito em branco → sai e entra de novo sozinha. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.8.9', 'Acesso Restrito em branco: sai pelo Logout do portal e entra de novo sozinha', '2026-11-15', '293857ac415e513da3ea5aa766c5db4a693bef4c', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.8.9';
update public.extensao_versoes set principal = true where versao = '3.8.9';
