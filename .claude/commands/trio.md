---
description: Opus planeja, Sonnet executa, Haiku faz o trabalho braçal
argument-hint: <tarefa>
---

Tarefa: $ARGUMENTS

Divisão de modelos para esta tarefa:

1. **Plano (Opus):** se ainda não estiver em modo de plano, use EnterPlanMode. Apresente um plano curto e objetivo e espere aprovação.
2. **Execução (Sonnet):** depois de aprovado, você mesmo faz as edições e roda os comandos.
3. **Trabalho braçal (Haiku):** delegue a subagentes com `model: haiku` as buscas em vários arquivos, leitura de logs, listagens e resumos. Use só o resultado resumido.
4. Não delegue ao Haiku decisões de arquitetura nem edições críticas.

Siga as regras de economia de tokens do CLAUDE.md. Resposta final curta.
