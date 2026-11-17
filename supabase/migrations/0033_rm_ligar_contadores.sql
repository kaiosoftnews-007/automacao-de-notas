-- Conserta o cadastro dos contadores da RM CONTABILIDADE (17/11/2026).
-- A 0031 procurava o escritório pelo nome e só incluía empresas que ainda não existiam. Como as 50 empresas
-- já tinham sido importadas pelo painel, elas ficaram sem contador (e, se o escritório tinha outro nome,
-- a 0031 criou um "RM CONTABILIDADE" repetido). Aqui:
--   1) acha o escritório de verdade = o que tem mais empresas com estes CNPJs, sem contar o repetido;
--   2) apaga o repetido criado pela 0031 (só se não tiver nenhum download/pedido);
--   3) cria os contadores no escritório certo e liga cada empresa ao seu contador (só onde está em branco).
do $$
declare v_dup uuid; v_esc uuid;
begin
  create temp table rm_cont (cnpj text primary key, contador text) on commit drop;
  insert into rm_cont values
    ('25284880000104', 'Wendel'),
    ('43207286000193', 'Wendel'),
    ('13835223000110', 'Wendel'),
    ('45259352000102', 'Marco'),
    ('38024572000183', 'Wendel'),
    ('08659131000197', 'Cleiber'),
    ('29773750000188', 'Wallas'),
    ('24825785000108', 'Marco'),
    ('05493760000100', 'Cleiber'),
    ('01843447000195', 'Cleiber'),
    ('28080942000146', 'Cleiber'),
    ('41939615000165', 'Marco'),
    ('47809257000152', 'Wendel'),
    ('36306978000123', 'Marco'),
    ('56031894000131', 'Wendel'),
    ('32582107000181', 'Wendel'),
    ('61282480000115', 'Wendel'),
    ('02501734000180', 'Wallas'),
    ('41619120000159', 'Wendel'),
    ('44613226000133', 'Wendel'),
    ('39265685000133', 'Wendel'),
    ('11954522000149', 'Marco'),
    ('33425408000164', 'Wendel'),
    ('65499424000198', 'Wendel'),
    ('65425940000178', 'Wendel'),
    ('15397281000135', 'Cleiber'),
    ('27377261000181', 'Wendel'),
    ('29763353000125', 'Marco'),
    ('33767568000191', 'Wendel'),
    ('32185547000103', 'Wendel'),
    ('65471274000104', 'Cleiber'),
    ('64693562000140', 'Wendel'),
    ('52676847000194', 'Wendel'),
    ('32714140000118', 'Marco'),
    ('15553588000188', 'Wendel'),
    ('32720061000110', 'Wendel'),
    ('13719063000144', 'Marco'),
    ('49462775000178', 'Marco'),
    ('43876817000130', 'Marco'),
    ('12641982000180', 'Wendel'),
    ('44258602000119', 'Wendel'),
    ('37569385000112', 'Wendel'),
    ('38161707000152', 'Wendel'),
    ('08624510000141', 'Marco'),
    ('43716077000175', 'Marco'),
    ('53821860000152', 'Marco'),
    ('45047235000177', 'Marco'),
    ('19933388000101', 'Marco'),
    ('43202075000168', 'Marco'),
    ('28794807000162', 'Wendel');

  -- Repetido: criado hoje com o nome exato, só com empresas da planilha que também existem em outro escritório.
  select e.id into v_dup from escritorios e
   where e.nome = 'RM CONTABILIDADE' and e.criado_em >= '2026-11-17'
     and exists (select 1 from empresas x join empresas y on regexp_replace(coalesce(y.cnpj,''),'\D','','g') = regexp_replace(coalesce(x.cnpj,''),'\D','','g')
                  and y.escritorio_id <> e.id where x.escritorio_id = e.id)
     and not exists (select 1 from empresas x where x.escritorio_id = e.id and x.contador_id is null)   -- o da 0031 tem contador em todas
     and not exists (select 1 from empresas x where x.escritorio_id = e.id
                       and not exists (select 1 from empresas y where y.escritorio_id <> e.id
                                         and regexp_replace(coalesce(y.cnpj,''),'\D','','g') = regexp_replace(coalesce(x.cnpj,''),'\D','','g')))
     and not exists (select 1 from downloads d where d.escritorio_id = e.id)
     and not exists (select 1 from execucoes x where x.escritorio_id = e.id)
   limit 1;
  if v_dup is not null then delete from escritorios where id = v_dup; end if;

  select emp.escritorio_id into v_esc
    from empresas emp join rm_cont r on r.cnpj = regexp_replace(coalesce(emp.cnpj,''),'\D','','g')
   group by emp.escritorio_id order by count(*) desc limit 1;
  if v_esc is null then return; end if;

  insert into contadores (escritorio_id, nome)
  select v_esc, n from (select distinct contador n from rm_cont) s
  on conflict (escritorio_id, nome) do nothing;

  update empresas emp set contador_id = c.id
    from rm_cont r join contadores c on c.nome = r.contador and c.escritorio_id = v_esc
   where emp.escritorio_id = v_esc and emp.contador_id is null
     and regexp_replace(coalesce(emp.cnpj,''),'\D','','g') = r.cnpj;
end $$;
