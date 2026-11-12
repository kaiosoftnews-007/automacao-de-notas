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

## Publicar o site (Cloudflare Pages)

1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → escolher `automacao-de-notas`
2. Build command: deixar vazio · Build output directory: `web`
3. Cada push na branch `main` publica sozinho

## Banco (Supabase)

- Estrutura em `supabase/migrations/0001_schema.sql`
- O primeiro usuário criado no Supabase Auth vira administrador; os demais ficam esperando você ligar ao escritório deles
- A senha da Sefaz fica no Supabase Vault (criptografada). Só o robô, com a chave `service_role`, consegue ler
