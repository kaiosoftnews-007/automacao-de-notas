-- "Acesso à Sefaz-GO": a situação passa a se atualizar sozinha.
-- Toda vez que a extensão registra um download concluído (ou "sem notas"),
-- é sinal de que o login na Sefaz funcionou → Funcionando + data do último teste.
-- Não mexe na extensão (3.7.7 continua igual).

create or replace function public.login_sefaz_funcionou() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('concluido','sem_notas') then
    update credenciais_sefaz
       set situacao = 'ok', ultimo_teste = now()
     where escritorio_id = new.escritorio_id;
  end if;
  return new;
end $$;

drop trigger if exists ao_concluir_download_marca_login on public.downloads;
create trigger ao_concluir_download_marca_login after insert or update of status on public.downloads
  for each row execute function public.login_sefaz_funcionou();

-- Acerta agora quem já baixou com sucesso (o teste de hoje entra aqui).
-- Só conta download feito depois da última troca de senha.
update public.credenciais_sefaz c
   set situacao = 'ok', ultimo_teste = d.ultimo
  from (select escritorio_id, max(atualizado_em) ultimo
          from public.downloads
         where status in ('concluido','sem_notas')
         group by escritorio_id) d
 where d.escritorio_id = c.escritorio_id
   and (c.alterada_em is null or d.ultimo >= c.alterada_em);

-- Conferência
select e.nome, c.situacao, c.ultimo_teste
  from public.credenciais_sefaz c join public.escritorios e on e.id = c.escritorio_id;
