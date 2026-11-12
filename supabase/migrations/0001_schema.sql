-- Automação de Notas: estrutura do banco
-- Papéis: 'admin' (vê tudo) e 'escritorio' (vê só o próprio escritório)

create extension if not exists supabase_vault;

-- ============ Tabelas ============

create table public.escritorios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  email_contato text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  papel text not null default 'escritorio' check (papel in ('admin','escritorio')),
  escritorio_id uuid references public.escritorios(id) on delete set null,
  criado_em timestamptz not null default now()
);

-- Login da Sefaz: um por escritório. A senha fica no Vault (criptografada); aqui só o id do segredo.
create table public.credenciais_sefaz (
  escritorio_id uuid primary key references public.escritorios(id) on delete cascade,
  nome_contador text,
  cpf text not null,
  senha_secret_id uuid,
  situacao text not null default 'nao_testado' check (situacao in ('nao_testado','ok','recusada','erro')),
  ultimo_teste timestamptz,
  alterada_em timestamptz,
  alterada_por uuid references auth.users(id)
);

create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios(id) on delete cascade,
  codigo text,
  razao_social text not null,
  cnpj text,
  ie text,
  uf text not null default 'GO',
  regime text check (regime in ('simples','presumido','real','mei','outro')),
  atividade text,
  baixar_entrada boolean not null default true,
  baixar_saida boolean not null default true,
  incluir_eventos boolean not null default true,
  modelo text not null default 'todos' check (modelo in ('todos','55','65')),
  exibir_canceladas boolean not null default false,
  obrigacoes text[] not null default '{}',
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
create index on public.empresas (escritorio_id);
create unique index empresas_ie_unica on public.empresas (escritorio_id, ie) where ie is not null and ie <> '';

create table public.rotinas (
  escritorio_id uuid primary key references public.escritorios(id) on delete cascade,
  ativa boolean not null default true,
  dias_semana int[] not null default '{1,2,3,4,5}',      -- 0=dom ... 6=sáb
  horario time not null default '06:00',
  periodo text not null default 'mes_anterior' check (periodo in ('mes_anterior','mes_atual')),
  pasta_destino text not null default 'C:\Notas',
  tentativas int not null default 3,
  avisar_email boolean not null default true,
  resumo_diario boolean not null default true,
  avisar_whatsapp boolean not null default false,
  atualizada_em timestamptz not null default now()
);

create table public.execucoes (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios(id) on delete cascade,
  origem text not null default 'agendada' check (origem in ('agendada','manual')),
  status text not null default 'pendente' check (status in ('pendente','rodando','concluida','com_erros','falhou')),
  solicitada_em timestamptz not null default now(),
  iniciada_em timestamptz,
  finalizada_em timestamptz
);
create index on public.execucoes (escritorio_id, solicitada_em desc);

create table public.downloads (
  id uuid primary key default gen_random_uuid(),
  execucao_id uuid references public.execucoes(id) on delete set null,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  escritorio_id uuid not null references public.escritorios(id) on delete cascade,
  competencia date not null,                               -- sempre dia 1 do mês
  tipo text not null check (tipo in ('entrada','saida')),
  status text not null default 'fila' check (status in ('fila','processando','concluido','sem_notas','erro')),
  qtd_notas int,
  arquivo text,
  mensagem text,
  tentativa int not null default 1,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on public.downloads (empresa_id, competencia);
create index on public.downloads (escritorio_id, criado_em desc);

create table public.entregas (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null,
  obrigacao text not null,
  status text not null check (status in ('ok','pendente','atrasado','na')),
  atualizado_por uuid references auth.users(id),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, competencia, obrigacao)
);

create table public.alertas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid references public.escritorios(id) on delete cascade,
  empresa_id uuid references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('erro','mudanca','aviso')),
  titulo text not null,
  detalhe text,
  acao text,                                               -- ex.: 'atualizar_senha', 'baixar_novas', 'tentar_de_novo'
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por uuid references auth.users(id)
);
create index on public.alertas (escritorio_id, criado_em desc);

create table public.robo_status (
  id text primary key default 'principal',
  ultimo_sinal timestamptz,
  versao text,
  maquina text
);

-- ============ Funções de acesso ============

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where user_id = auth.uid() and papel = 'admin');
$$;

create or replace function public.meu_escritorio() returns uuid
language sql stable security definer set search_path = public as $$
  select escritorio_id from perfis where user_id = auth.uid();
$$;

create or replace function public.pode_ver(esc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or esc = public.meu_escritorio();
$$;

-- Cria o perfil quando alguém é cadastrado no Auth. O primeiro usuário vira admin.
create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (user_id, email, nome, papel)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)),
          case when exists (select 1 from perfis) then 'escritorio' else 'admin' end);
  return new;
end $$;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

-- Salvar/trocar a senha da Sefaz (vai criptografada para o Vault)
create or replace function public.salvar_credencial_sefaz(p_escritorio uuid, p_cpf text, p_senha text, p_nome_contador text default null)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  if not public.pode_ver(p_escritorio) then raise exception 'sem permissão'; end if;
  select senha_secret_id into v_id from credenciais_sefaz where escritorio_id = p_escritorio;
  if p_senha is not null and p_senha <> '' then
    if v_id is null then
      v_id := vault.create_secret(p_senha, 'sefaz_' || p_escritorio::text, 'Senha Sefaz-GO do escritório');
    else
      perform vault.update_secret(v_id, p_senha);
    end if;
  end if;
  insert into credenciais_sefaz (escritorio_id, cpf, nome_contador, senha_secret_id, situacao, alterada_em, alterada_por)
  values (p_escritorio, p_cpf, p_nome_contador, v_id, 'nao_testado', now(), auth.uid())
  on conflict (escritorio_id) do update
    set cpf = excluded.cpf,
        nome_contador = coalesce(excluded.nome_contador, credenciais_sefaz.nome_contador),
        senha_secret_id = excluded.senha_secret_id,
        situacao = case when p_senha is not null and p_senha <> '' then 'nao_testado' else credenciais_sefaz.situacao end,
        alterada_em = now(), alterada_por = auth.uid();
end $$;

-- Só o robô (chave service_role) lê a senha aberta
create or replace function public.robo_obter_credencial(p_escritorio uuid)
returns table (cpf text, senha text) language sql security definer set search_path = public, vault as $$
  select c.cpf, s.decrypted_secret
  from credenciais_sefaz c join vault.decrypted_secrets s on s.id = c.senha_secret_id
  where c.escritorio_id = p_escritorio;
$$;
revoke all on function public.robo_obter_credencial(uuid) from public, anon, authenticated;
grant execute on function public.robo_obter_credencial(uuid) to service_role;

-- ============ Segurança (RLS) ============

alter table public.escritorios enable row level security;
alter table public.perfis enable row level security;
alter table public.credenciais_sefaz enable row level security;
alter table public.empresas enable row level security;
alter table public.rotinas enable row level security;
alter table public.execucoes enable row level security;
alter table public.downloads enable row level security;
alter table public.entregas enable row level security;
alter table public.alertas enable row level security;
alter table public.robo_status enable row level security;

create policy esc_ler on public.escritorios for select to authenticated using (public.pode_ver(id));
create policy esc_admin on public.escritorios for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

create policy perfil_ler on public.perfis for select to authenticated using (user_id = auth.uid() or public.eh_admin());
create policy perfil_admin on public.perfis for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

-- credenciais: leitura sim (sem a senha); escrita só pela função salvar_credencial_sefaz
create policy cred_ler on public.credenciais_sefaz for select to authenticated using (public.pode_ver(escritorio_id));

create policy emp_ler on public.empresas for select to authenticated using (public.pode_ver(escritorio_id));
create policy emp_escrever on public.empresas for all to authenticated using (public.pode_ver(escritorio_id)) with check (public.pode_ver(escritorio_id));

create policy rot_ler on public.rotinas for select to authenticated using (public.pode_ver(escritorio_id));
create policy rot_escrever on public.rotinas for all to authenticated using (public.pode_ver(escritorio_id)) with check (public.pode_ver(escritorio_id));

create policy exe_ler on public.execucoes for select to authenticated using (public.pode_ver(escritorio_id));
create policy exe_pedir on public.execucoes for insert to authenticated with check (public.pode_ver(escritorio_id) and origem = 'manual' and status = 'pendente');

create policy dl_ler on public.downloads for select to authenticated using (public.pode_ver(escritorio_id));

create policy ent_ler on public.entregas for select to authenticated
  using (exists (select 1 from empresas e where e.id = empresa_id and public.pode_ver(e.escritorio_id)));
create policy ent_escrever on public.entregas for all to authenticated
  using (exists (select 1 from empresas e where e.id = empresa_id and public.pode_ver(e.escritorio_id)))
  with check (exists (select 1 from empresas e where e.id = empresa_id and public.pode_ver(e.escritorio_id)));

create policy al_ler on public.alertas for select to authenticated using (public.eh_admin() or public.pode_ver(escritorio_id));
create policy al_resolver on public.alertas for update to authenticated using (public.eh_admin() or public.pode_ver(escritorio_id));

create policy robo_ler on public.robo_status for select to authenticated using (true);

-- Uma rotina padrão para cada escritório novo
create or replace function public.rotina_padrao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into rotinas (escritorio_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger ao_criar_escritorio after insert on public.escritorios
  for each row execute function public.rotina_padrao();

-- Alerta automático quando o robô registra erro ou "sem notas"
create or replace function public.alerta_de_download() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nome text;
begin
  if new.status in ('erro','sem_notas') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select razao_social into v_nome from empresas where id = new.empresa_id;
    insert into alertas (escritorio_id, empresa_id, tipo, titulo, detalhe, acao)
    values (new.escritorio_id, new.empresa_id,
            case when new.status = 'erro' then 'erro' else 'aviso' end,
            case when new.status = 'erro' then 'Download falhou' else 'Nenhuma nota de ' || new.tipo || ' no período' end,
            v_nome || coalesce(' · ' || new.mensagem, ''),
            case when new.status = 'erro' then 'tentar_de_novo' end);
  end if;
  return new;
end $$;
create trigger ao_mudar_download after insert or update of status on public.downloads
  for each row execute function public.alerta_de_download();
