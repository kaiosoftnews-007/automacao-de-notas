# Automação de Notas

Download automático dos XMLs de NF-e no portal da Sefaz Goiás e painel de controle para escritórios contábeis.

## Partes do sistema

- **web/**: site com painel geral (admin), painel por escritório, cadastro de empresas e acompanhamento das entregas
- **supabase/**: banco de dados, autenticação e regras de acesso (cada escritório vê só as suas empresas)
- **robo/**: rotina que entra na Sefaz-GO, baixa os XMLs (entrada e saída) por empresa e registra o resultado no painel

## Fluxo da Sefaz-GO (manual, hoje)

1. Login em portal.sefaz.go.gov.br (CPF e senha do contador)
2. Acesso Restrito (ASP) → Baixar XML NFE (às vezes pede login de novo)
3. Consulta de Notas Recebidas: período, inscrição estadual, tipo (Entrada/Saída), modelo Todos, canceladas Não
4. Pesquisar → Baixar todos os arquivos → "Baixar documentos e eventos"
5. O pedido entra numa fila; o ZIP fica no "Histórico de Downloads de XMLs" por 7 dias
