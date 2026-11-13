-- Pasta de cada empresa no computador. Dentro dela a automação cria a pasta do mês (ex.: 102026)
-- com Entrada_102026.zip e Saida_102026.zip.
alter table public.empresas add column if not exists pasta text;
