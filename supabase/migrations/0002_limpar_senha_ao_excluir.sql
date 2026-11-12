-- Quando um escritório (ou o acesso dele) é excluído, apaga também a senha da Sefaz guardada no Vault
create or replace function public.apagar_senha_vault() returns trigger
language plpgsql security definer set search_path = public, vault as $$
begin
  if old.senha_secret_id is not null then
    delete from vault.secrets where id = old.senha_secret_id;
  end if;
  return old;
end $$;

drop trigger if exists ao_excluir_credencial on public.credenciais_sefaz;
create trigger ao_excluir_credencial after delete on public.credenciais_sefaz
  for each row execute function public.apagar_senha_vault();
