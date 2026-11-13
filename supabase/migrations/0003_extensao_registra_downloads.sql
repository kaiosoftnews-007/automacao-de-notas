-- A extensão do Chrome entra com o login do painel (não com a chave secreta).
-- Estas regras deixam esse login registrar os downloads do próprio escritório.
create policy dl_inserir on public.downloads for insert to authenticated
  with check (public.pode_ver(escritorio_id));
create policy dl_atualizar on public.downloads for update to authenticated
  using (public.pode_ver(escritorio_id)) with check (public.pode_ver(escritorio_id));
