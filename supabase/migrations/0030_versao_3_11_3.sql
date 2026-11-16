-- Extensão 3.11.3: atualização pela página da extensão (escolher a pasta uma vez), sem organizador. Vira a versão principal.
insert into public.extensao_versoes (versao, descricao, publicada_em, ref, principal)
values ('3.11.3', 'Atualização pela página da extensão: escolhe a pasta uma vez e depois só clica em Atualizar agora (sem organizador)', '2026-11-16', '7c3bdf9ce029465ae3b3af4e729e878330b39ed7', false)
on conflict (versao) do update set ref = excluded.ref, descricao = excluded.descricao;
update public.extensao_versoes set principal = false where principal and versao <> '3.11.3';
update public.extensao_versoes set principal = true where versao = '3.11.3';
