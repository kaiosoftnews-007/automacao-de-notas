-- Extensão 3.10.3: atualizar acha a pasta de dentro com o manifest.json e mostra o motivo do erro. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.10.3', 'Atualizar: acha sozinha a pasta com o manifest.json e mostra o motivo exato do erro', '2026-11-16', '33c7f86398b640ca21dd1b9061491140d1d8dbfd', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.10.3';
update public.extensao_versoes set principal = true where versao = '3.10.3';
