# Instruções para todos os agentes

**Propósito**: fornecer o baseline curto e permanente para agentes de IA neste workspace.  
**Status documental**: Canônico.  
**Público**: agentes de IA e mantenedores do repositório.  
**Última atualização**: 28 de fevereiro de 2026.

Este arquivo é lido automaticamente por qualquer agente de IA (Copilot, Claude, ChatGPT, etc.) que
interaja com o workspace. Ele complementa o `.github/copilot-instructions.md` e usa
`.github/instructions/project-canon.instructions.md` como baseline curto e estável.

- Responder em português brasileiro (pt-BR) ao interagir com humanos ou ao escrever documentação.
- Presumir Node.js 24+ com ESM obrigatório (`import` / `export`).
- Tratar `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md` como a arquitetura oficial.
- Tratar `DOCUMENTAÇÃO/ARQUITETURA/README.md` como o índice canônico da arquitetura.
- Aplicar estas instruções junto com `.github/copilot-instructions.md` e os `*.instructions.md`
  relevantes.

## Mapa estável do repositório

- `src/`: código de runtime do produto.
- Dentro de `src/`, trate `src/agent/` como a camada de workers operacionais do runtime, distinta
  de `src/missions/` e de `agents/` na raiz.
- `tests/`: testes, harness, suporte e quarentena em `legacy/`.
- `scripts/`: automação operacional, manutenção e tooling interno.
- `DOCUMENTAÇÃO/`: documentação canônica do projeto.
- `.github/`: instruções permanentes, skills, workflows e agentes.

## Rotas canônicas

- Arquitetura oficial: `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`
- Hub de arquitetura: `DOCUMENTAÇÃO/ARQUITETURA/README.md`
- Status geral da documentação: `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md`
- Baseline curto: `.github/instructions/project-canon.instructions.md`
- Guia operacional para agentes: `.github/copilot-instructions.md`

> Estas instruções têm prioridade equivalente às do `copilot-instructions.md` e são carregadas
> automaticamente pelo VS Code graças a `chat.useAgentsMdFile`.
