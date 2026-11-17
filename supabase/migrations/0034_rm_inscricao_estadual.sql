-- RM CONTABILIDADE: as empresas importadas pelo painel ficaram sem a inscrição estadual (17/11/2026).
-- Preenche a IE pelo CNPJ (planilha CONTROLE FISCAL RANGEL), só onde está em branco, no escritório que tem os
-- contadores Wendel/Marco/Cleiber/Wallas ligados a essas empresas. As 12 sem IE na planilha (serviço) continuam sem.
with rm(cnpj, ie) as (values
    ('25284880000104', '106683632'),
    ('43207286000193', '108615073'),
    ('45259352000102', '108860889'),
    ('38024572000183', '109615409'),
    ('08659131000197', '104092920'),
    ('28080942000146', '106967282'),
    ('41939615000165', '108409635'),
    ('36306978000123', '107877465'),
    ('56031894000131', '201707519'),
    ('32582107000181', '108149994'),
    ('61282480000115', '202842576'),
    ('39265685000133', '202967794'),
    ('11954522000149', '104849002'),
    ('65499424000198', '203876113'),
    ('65425940000178', '204220998'),
    ('15397281000135', '105316067'),
    ('27377261000181', '107762633'),
    ('29763353000125', '107285320'),
    ('33767568000191', '107641321'),
    ('32185547000103', '107466228'),
    ('65471274000104', '203869320'),
    ('64693562000140', '204220980'),
    ('52676847000194', '200890921'),
    ('32714140000118', '200099167'),
    ('15553588000188', '105340561'),
    ('32720061000110', '107520877'),
    ('13719063000144', '105027421'),
    ('49462775000178', '200655434'),
    ('12641982000180', '104823623'),
    ('44258602000119', '201831015'),
    ('37569385000112', '108453405'),
    ('08624510000141', '104082445'),
    ('43716077000175', '108665950'),
    ('53821860000152', '201182130'),
    ('45047235000177', '108901173'),
    ('19933388000101', '105978400'),
    ('43202075000168', '108591158'),
    ('28794807000162', '107998050')
), esc as (
  select emp.escritorio_id from empresas emp join rm on rm.cnpj = regexp_replace(coalesce(emp.cnpj,''),'\D','','g')
   where emp.contador_id is not null
   group by 1 order by count(*) desc limit 1
)
update empresas emp set ie = rm.ie
  from rm, esc
 where emp.escritorio_id = esc.escritorio_id
   and coalesce(emp.ie, '') = ''
   and regexp_replace(coalesce(emp.cnpj,''),'\D','','g') = rm.cnpj
   and not exists (select 1 from empresas o where o.escritorio_id = esc.escritorio_id and o.ie = rm.ie);
