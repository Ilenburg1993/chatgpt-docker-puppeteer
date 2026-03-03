# respostas/

**Propósito**: Saída das respostas dos LLMs — arquivos gerados pelo sistema de agentes contendo as respostas recebidas dos modelos de linguagem durante a execução de tarefas.  
**Status**: Artefato de runtime.  
**Público**: Desenvolvedores e usuários que inspecionam os resultados das tarefas executadas.  
**Última atualização**: 2 de março de 2026.

## ⚠️ Não comitar o conteúdo desta pasta

As respostas são artefatos de runtime gerados por execução e **não devem ser commitados**.

## O que esta pasta contém

Arquivos de resposta nomeados por task ID, nos formatos:
- `.txt` — resposta em texto simples
- `.md` — resposta em Markdown
- `.html` — resposta em HTML renderizado
- `.json` — resposta estruturada com metadados

## Regras de manutenção

- Use `npm run clean` para limpar respostas antigas
- Respostas relevantes devem ser copiadas manualmente para documentação antes de limpar

## Links relacionados

- Fila de tarefas: [`fila/`](../fila/)
- Infra de storage: [`src/infra/storage/`](../src/infra/storage/)
- Agente de missão: [`src/agent/`](../src/agent/)
