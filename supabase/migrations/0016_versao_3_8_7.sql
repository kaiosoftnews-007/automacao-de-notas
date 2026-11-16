-- Extensão 3.8.7: espera o arquivo direto no Histórico de Downloads. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.8.7', 'Espera o arquivo direto no Histórico de Downloads (sem voltar à consulta)', '2026-11-15', '662ce6fa65015f347426aa70c8815f4b022cb6cc', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.8.7';
update public.extensao_versoes set principal = true where versao = '3.8.7';
