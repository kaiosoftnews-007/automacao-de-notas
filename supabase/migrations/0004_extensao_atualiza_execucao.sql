-- A extensão marca a execução pedida pelo botão "Baixar agora" como rodando/concluída.
create policy exe_atualizar on public.execucoes for update to authenticated
  using (public.pode_ver(escritorio_id)) with check (public.pode_ver(escritorio_id));
