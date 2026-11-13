-- A extensão do Chrome usa o login da Sefaz cadastrado no painel (Acesso à Sefaz).
-- Só devolve o login do escritório que o usuário logado pode ver (ou de qualquer um, se for admin).
create or replace function public.extensao_obter_credencial(p_escritorio uuid)
returns table (cpf text, senha text) language sql stable security definer set search_path = public, vault as $$
  select c.cpf, s.decrypted_secret
  from credenciais_sefaz c join vault.decrypted_secrets s on s.id = c.senha_secret_id
  where c.escritorio_id = p_escritorio and public.pode_ver(p_escritorio);
$$;
revoke all on function public.extensao_obter_credencial(uuid) from public, anon;
grant execute on function public.extensao_obter_credencial(uuid) to authenticated;
