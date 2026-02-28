# Instruções para todos os agentes

Este arquivo é lido automaticamente por qualquer agente de IA (Copilot, Claude, ChatGPT, etc.) que
interaja com o workspace. Ele complementa o `.github/copilot-instructions.md` e serve de ponto único
quando há múltiplos agentes.

Para tarefas gerais de código, trate
`.github/instructions/project-canon.instructions.md` como o resumo canônico do repositório e
aplique-o junto com este `AGENTS.md`.

- Responder em português brasileiro (pt‑BR) sempre que comunicar com humanos ou gerar documentação.
- O projeto roda em Node.js 24+ com módulos ESM obrigatórios; use `import` / `export` e evite
  `require`.
- Siga as convenções descritas em `.github/copilot-instructions.md` (arquitetura, estilo,
  diretórios, etc.).
- Skills de auditoria e prompts estão em `.github/skills` e `.github/prompts` respectivamente.
  Use-os quando for relevante para tarefas de auditoria.
- Em chats que envolvam várias partes do código, aplique todas as instruções relevantes de
  `copilot-instructions.md`, deste `AGENTS.md` e quaisquer `*.instructions.md` correspondentes.

> Estas instruções têm prioridade equivalente às do `copilot-instructions.md` e são carregadas
> automaticamente pelo VS Code graças a `chat.useAgentsMdFile`.
