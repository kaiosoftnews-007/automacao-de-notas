-- Extensão 3.11.2: atualização automática confere a cada minuto e ao abrir o Chrome. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.11.2', 'Atualização automática confere a cada minuto e assim que o Chrome abre', '2026-11-16', '53c6c80b20f0a1b207cb3b22f49f7cc673af3869', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.11.2';
update public.extensao_versoes set principal = true where versao = '3.11.2';
