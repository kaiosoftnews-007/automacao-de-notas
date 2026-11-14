-- Extensão 3.8.4: zip só com os arquivos do Chrome (organizador baixado à parte). Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.8.4', 'Zip sem o organizador (sem aviso do Windows Defender)', '2026-11-13', '2eb83b0219f59f70b1f1d7794a91e740c42e9dd7', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.8.4';
update public.extensao_versoes set principal = true where versao = '3.8.4';
