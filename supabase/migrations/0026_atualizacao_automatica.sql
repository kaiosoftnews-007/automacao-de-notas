-- 3.11.0: andamento/erro da atualização automática da extensão, mostrado em Atualizações.
alter table public.computadores add column if not exists atualizacao text;
