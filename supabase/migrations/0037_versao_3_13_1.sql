-- Extensão 3.13.1: download das empresas do DF pelo Agênci@Net. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.13.1', 'Empresas do DF baixam pelo CNPJ no Agênci@Net (DEC) com o certificado do escritório; Goiás igual', '2026-11-24', 'main', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.13.1';
update public.extensao_versoes set principal = true where versao = '3.13.1';
