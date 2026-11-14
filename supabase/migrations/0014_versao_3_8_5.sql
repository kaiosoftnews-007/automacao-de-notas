-- Extensão 3.8.5: confere o contador logado na Sefaz antes de consultar. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.8.5', 'Confere o contador logado na Sefaz e troca se for de outro escritório', '2026-11-13', 'e0203b52c338480ff6ae101ab04dd73536edc32c', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.8.5';
update public.extensao_versoes set principal = true where versao = '3.8.5';
