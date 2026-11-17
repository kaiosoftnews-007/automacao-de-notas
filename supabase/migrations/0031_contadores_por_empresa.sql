-- Contadores por empresa (17/11/2026).
-- Alguns escritórios têm um contador diferente para cada empresa: o download na Sefaz tem que entrar
-- com o CPF/senha do contador responsável por aquela empresa.
--   • contadores: vários por escritório, senha no Vault (igual ao login do escritório).
--   • empresas.contador_id: em branco = usa o login do escritório (Acesso à Sefaz), como antes.
--   • extensao_obter_credencial ganha p_contador (opcional): extensões antigas continuam funcionando.
-- E cadastra o escritório RM CONTABILIDADE com os contadores e as empresas da planilha CONTROLE FISCAL RANGEL.

create table if not exists public.contadores (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios(id) on delete cascade,
  nome text not null,
  cpf text,
  senha_secret_id uuid,
  situacao text not null default 'nao_testado' check (situacao in ('nao_testado','ok','recusada','erro')),
  ultimo_teste timestamptz,
  alterada_em timestamptz,
  alterada_por uuid references auth.users(id),
  criado_em timestamptz not null default now(),
  unique (escritorio_id, nome)
);
alter table public.contadores enable row level security;
drop policy if exists cont_ler on public.contadores;
create policy cont_ler on public.contadores for select to authenticated using (public.pode_ver(escritorio_id));
drop policy if exists cont_excluir on public.contadores;
create policy cont_excluir on public.contadores for delete to authenticated using (public.pode_ver(escritorio_id));
-- inclusão e alteração só pela função salvar_contador (a senha vai para o Vault)

-- Apaga a senha do Vault ao excluir (mesma função da 0002; recriada aqui porque não existe em produção).
create or replace function public.apagar_senha_vault() returns trigger
language plpgsql security definer set search_path = public, vault as $$
begin
  if old.senha_secret_id is not null then
    delete from vault.secrets where id = old.senha_secret_id;
  end if;
  return old;
end $$;

drop trigger if exists ao_excluir_contador on public.contadores;
create trigger ao_excluir_contador after delete on public.contadores
  for each row execute function public.apagar_senha_vault();

alter table public.empresas add column if not exists contador_id uuid references public.contadores(id) on delete set null;
create index if not exists empresas_contador on public.empresas (contador_id);

-- Inclui (p_id nulo) ou altera um contador. Senha em branco = mantém a atual.
create or replace function public.salvar_contador(p_escritorio uuid, p_id uuid, p_nome text, p_cpf text, p_senha text default null)
returns uuid language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid := p_id; v_secret uuid; v_cpf text := nullif(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g'), '');
begin
  if not public.pode_ver(p_escritorio) then raise exception 'sem permissão'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'informe o nome do contador'; end if;
  if v_id is null then
    insert into contadores (escritorio_id, nome) values (p_escritorio, trim(p_nome)) returning id into v_id;
  elsif not exists (select 1 from contadores where id = v_id and escritorio_id = p_escritorio) then
    raise exception 'contador não encontrado';
  end if;
  select senha_secret_id into v_secret from contadores where id = v_id;
  if p_senha is not null and p_senha <> '' then
    if v_secret is null then v_secret := vault.create_secret(p_senha, 'sefaz_contador_' || v_id::text, 'Senha Sefaz-GO de contador');
    else perform vault.update_secret(v_secret, p_senha); end if;
  end if;
  update contadores
     set nome = trim(p_nome), cpf = v_cpf, senha_secret_id = v_secret,
         situacao = case when (p_senha is not null and p_senha <> '') or cpf is distinct from v_cpf then 'nao_testado' else situacao end,
         alterada_em = now(), alterada_por = auth.uid()
   where id = v_id;
  return v_id;
end $$;
revoke all on function public.salvar_contador(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.salvar_contador(uuid, uuid, text, text, text) to authenticated;

-- Login da Sefaz para a extensão: do contador da empresa (p_contador) ou, sem contador, o do escritório.
drop function if exists public.extensao_obter_credencial(uuid);
create or replace function public.extensao_obter_credencial(p_escritorio uuid, p_contador uuid default null)
returns table (cpf text, senha text) language sql stable security definer set search_path = public, vault as $$
  select c.cpf, s.decrypted_secret
    from contadores c join vault.decrypted_secrets s on s.id = c.senha_secret_id
   where p_contador is not null and c.id = p_contador and c.escritorio_id = p_escritorio and c.cpf is not null and public.pode_ver(p_escritorio)
  union all
  select c.cpf, s.decrypted_secret
    from credenciais_sefaz c join vault.decrypted_secrets s on s.id = c.senha_secret_id
   where p_contador is null and c.escritorio_id = p_escritorio and public.pode_ver(p_escritorio);
$$;
revoke all on function public.extensao_obter_credencial(uuid, uuid) from public, anon;
grant execute on function public.extensao_obter_credencial(uuid, uuid) to authenticated;

-- A extensão avisa quando a Sefaz recusou o CPF/senha de um contador (aparece em Acesso à Sefaz).
create or replace function public.extensao_contador_recusado(p_contador uuid)
returns void language sql security definer set search_path = public as $$
  update contadores set situacao = 'recusada', ultimo_teste = now()
   where id = p_contador and public.pode_ver(escritorio_id);
$$;
revoke all on function public.extensao_contador_recusado(uuid) from public, anon;
grant execute on function public.extensao_contador_recusado(uuid) to authenticated;

-- "Funcionando": download concluído marca o login usado (do contador da empresa ou do escritório).
create or replace function public.login_sefaz_funcionou() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cont uuid;
begin
  if new.status in ('concluido','sem_notas') then
    select contador_id into v_cont from empresas where id = new.empresa_id;
    if v_cont is null then
      update credenciais_sefaz set situacao = 'ok', ultimo_teste = now() where escritorio_id = new.escritorio_id;
    else
      update contadores set situacao = 'ok', ultimo_teste = now() where id = v_cont;
    end if;
  end if;
  return new;
end $$;

-- ================= RM CONTABILIDADE =================
do $$
declare v_esc uuid;
begin
  select id into v_esc from escritorios where upper(nome) like 'RM CONTABILIDADE%' order by criado_em limit 1;
  if v_esc is null then
    insert into escritorios (nome) values ('RM CONTABILIDADE') returning id into v_esc;
  end if;

  insert into contadores (escritorio_id, nome)
  select v_esc, n from unnest(array['Wendel','Marco','Cleiber','Wallas']) n
  on conflict (escritorio_id, nome) do nothing;

  insert into empresas (escritorio_id, codigo, razao_social, cnpj, ie, uf, regime, atividade, obrigacoes, contador_id)
  select v_esc, x.codigo, x.razao, x.cnpj, x.ie, 'GO', x.regime, x.atividade, x.obrig::text[], c.id
    from (values
('2', 'GIOVANNA DE SOUZA OLIVEIRA', '25.284.880/0001-04', '106683632', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('5', 'STEFANY ESTER DE SOUSA COMERCIO DE MOVEIS', '43.207.286/0001-93', '108615073', 'presumido', 'Comércio', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('8', 'ALEX BRAGA PRESTADORA DE SERVICOS EIRELI', '13.835.223/0001-10', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('10', 'IMPERIO ZL MERCEARIA UNIPESSOAL LTDA', '45.259.352/0001-02', '108860889', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('12', 'AGR MIRANDA COMERCIO DE PRODUTOS ALIMENTICIOS', '38.024.572/0001-83', '109615409', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('13', 'MS INDUSTRIA E COMERCIO DE DOCES LTDA', '08.659.131/0001-97', '104092920', 'real', 'Indústria', '{impt_nfs,apuracao,efd_reinf}', 'Cleiber'),
('15', 'WALLAS BORGES PEREIRA 01042664145', '29.773.750/0001-88', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wallas'),
('20', 'BMTCA ATIVOS AMBIENTAIS S/A', '24.825.785/0001-08', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Marco'),
('21', 'ASCOPLAN PARTICIPACOES LTDA', '05.493.760/0001-00', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Cleiber'),
('22', 'I.M.E.I CONSULTORIA E TREINAMENTO EMPRESARIAL LTDA', '01.843.447/0001-95', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Cleiber'),
('28', 'HUANA KARLA', '28.080.942/0001-46', '106967282', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Cleiber'),
('29', 'MARILAC AUTO CENTER LTDA', '41.939.615/0001-65', '108409635', 'simples', 'Comércio/Serviço', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('30', 'LOPES EXPRESS LTDA', '47.809.257/0001-52', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('36', 'MAILY', '36.306.978/0001-23', '107877465', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('42', 'RESTAURANTE E CHURRASCARIA PIMENTA DE CHEIRO LTDA', '56.031.894/0001-31', '201707519', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('46', 'M T COMERCIO DE ALIMENTOS LTDA', '32.582.107/0001-81', '108149994', 'presumido', 'Comércio', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('50', 'VALLE DISTRIBUIÇÃO LTDA', '61.282.480/0001-15', '202842576', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('52', 'FREE ART EVENTOS LTDA SEM MOVIMENTO', '02.501.734/0001-80', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wallas'),
('54', 'TCM SERVICOS CONSTRUCOES E PUBLICIDADES LTDA', '41.619.120/0001-59', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('55', 'R G DE JESUS PRESTATIVA CONSTRUCOES E REFORMAS', '44.613.226/0001-33', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('58', 'ALMEIDA REPARACAO AUTOMOTIVA LTDA', '39.265.685/0001-33', '202967794', 'presumido', 'Comércio/Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('62', 'REINO DO ISOPOR UNIPESSOAL LTDA', '11.954.522/0001-49', '104849002', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('67', 'R.J CONSTRUTORA E EMPREITEIRA LTDA', '33.425.408/0001-64', null, 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('73', 'EMPORIO ELITE', '65.499.424/0001-98', '203876113', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('75', 'ELEGANCE FUNILARIA', '65.425.940/0001-78', '204220998', 'simples', 'Serviço', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('77', 'OLIVEIRA E ROSSI', '15.397.281/0001-35', '105316067', 'presumido', 'Comércio', '{impt_nfs,apuracao,efd_reinf}', 'Cleiber'),
('79', 'B&M CENTRO AUTOMOTIVO EIRELI', '27.377.261/0001-81', '107762633', 'presumido', 'Comércio/Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('80', 'FELIPE MARIANO DE SOUZA 02864287170', '29.763.353/0001-25', '107285320', 'simples', 'Comércio/Serviço', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('82', 'EMPORIO INOVE EIRELI', '33.767.568/0001-91', '107641321', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('83', 'ADAC ATACADISTA DE AUTOPECAS E ACESSORIOS EIRELI', '32.185.547/0001-03', '107466228', 'presumido', 'Comércio', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('85', 'F E S AGROINDUSTRIAL', '65.471.274/0001-04', '203869320', 'presumido', 'Comércio', '{impt_nfs,apuracao,efd_reinf}', 'Cleiber'),
('86', 'EURO REPARACAO AUTOMOTIVA', '64.693.562/0001-40', '204220980', 'simples', 'Comércio/Serviço', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('88', 'ARAGUAIA MOVEIS', '52.676.847/0001-94', '200890921', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('90', 'MAX BEER DISTRIBUIDORA DE BEBIDAS', '32.714.140/0001-18', '200099167', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('94', 'EMPORIA NA DESPENSA', '15.553.588/0001-88', '105340561', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('97', 'SALATIEL PERSONAL BUSINESS', '32.720.061/0001-10', '107520877', 'presumido', 'Comércio/Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Wendel'),
('98', 'ADM - PRESTADORA DE SERVICOS', '13.719.063/0001-44', '105027421', 'presumido', 'Serviço', '{impt_nfs,apuracao,efd_reinf}', 'Marco'),
('99', 'NORTE E SUL SERVICO LTDA', '49.462.775/0001-78', '200655434', 'simples', 'Comércio/Serviço', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('104', 'ESTIMULARE EMS', '43.876.817/0001-30', null, 'simples', 'Serviço', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('105', 'LUCY CLEYDE BARRETO DA SILVA', '12.641.982/0001-80', '104823623', 'simples', 'Comércio/Serviço', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('106', 'DIEGO MOREIRA LEITE 70289079101', '44.258.602/0001-19', '201831015', 'simples', 'Comércio/Serviço', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('108', 'LEANDRO SILVA DOS SANTOS 00170883213', '37.569.385/0001-12', '108453405', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel'),
('110', 'GEORGE MILLER MARQUES MACIEL 03137487137', '38.161.707/0001-52', null, 'mei', 'Comércio/Serviço', '{impt_nfs,apuracao}', 'Wendel'),
('113', 'FORTALEZA COMPONENTES ELETRONICOS LTDA', '08.624.510/0001-41', '104082445', 'simples', 'Comércio/Serviço', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('116', 'TORII SUSHI FOOD', '43.716.077/0001-75', '108665950', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('125', 'HAMMER BRAND INDUSTRIA E COMERCIO LTDA', '53.821.860/0001-52', '201182130', 'simples', 'Indústria', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('126', 'VOVO NANA PRODUTOS ORGANICOS UNIPESSOAL LTDA', '45.047.235/0001-77', '108901173', 'simples', 'Indústria', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('142', 'WALER PEREIRA JALES', '19.933.388/0001-01', '105978400', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Marco'),
('156', '43.202.075 ANDREIA CORREIA DA SILVA FONSECA', '43.202.075/0001-68', '108591158', 'presumido', 'Comércio', '{impt_nfs,apuracao,efd_reinf}', 'Marco'),
('158', '28794807 JANAINA MARCAL GOMES', '28.794.807/0001-62', '107998050', 'simples', 'Comércio', '{impt_nfs,apuracao,pgdas}', 'Wendel')
    ) as x(codigo, razao, cnpj, ie, regime, atividade, obrig, contador)
    join contadores c on c.escritorio_id = v_esc and c.nome = x.contador
   where not exists (select 1 from empresas e where e.escritorio_id = v_esc
                       and regexp_replace(coalesce(e.cnpj,''), '\D', '', 'g') = regexp_replace(x.cnpj, '\D', '', 'g'));
end $$;
