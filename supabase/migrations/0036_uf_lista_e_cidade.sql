-- 0036: UF passa a ser uma das 27 siglas (escolha na tela) e a cidade ganha campo próprio.
-- Empresas que tinham o nome da cidade no campo UF: a cidade vai para o campo novo e a UF fica GO.
alter table public.empresas add column if not exists cidade text;

-- 1) Antes de corrigir: lista o que será mudado (rode só este select se quiser conferir antes).
-- select es.nome as escritorio, e.razao_social, e.uf from public.empresas e join public.escritorios es on es.id = e.escritorio_id
--  where upper(trim(coalesce(e.uf,''))) not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO');

-- 2) Corrige todas as empresas de todos os escritórios.
update public.empresas
   set cidade = coalesce(nullif(trim(cidade), ''), nullif(initcap(trim(uf)), '')),
       uf = 'GO'
 where upper(trim(coalesce(uf, ''))) not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO');

update public.empresas set uf = upper(trim(uf)) where uf <> upper(trim(uf));

-- 3) Daqui para frente o banco só aceita sigla válida.
alter table public.empresas drop constraint if exists empresas_uf_valida;
alter table public.empresas add constraint empresas_uf_valida check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'));
