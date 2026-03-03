# Configuração do GitHub Copilot

**Propósito**: consolidar as fontes de contexto e a taxonomia permanente do ecossistema de
agentes.  
**Status documental**: Canônico.  
**Público**: GitHub Copilot, agentes compatíveis e mantenedores.  
**Última atualização**: 28 de fevereiro de 2026.

Este documento resume as configurações e recomendações específicas do repositório para trabalhar com
GitHub Copilot e outros agentes compatíveis no workspace.

## Fontes canônicas para contexto

Use estas fontes, nesta ordem, como base estável de contexto:

- `.github/AGENTS.md`
- `.github/README.md`
- `.github/instructions/project-canon.instructions.md`
- `.github/copilot-instructions.md`
- `DOCUMENTAÇÃO/ARQUITETURA/README.md`
- `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md`

## Localização de skills, agentes e prompts

- `.github/skills/`: procedimentos especializados e reutilizáveis.
- `.github/instructions/`: baseline persistente e instruções curtas.
- `.github/agents/`: agentes especializados do workspace.
- `.github/workflows/`: CI/CD e automações GitHub.
- `.github/prompts/`: prompts compartilhados sob demanda.

## Arquivo AGENTS.md

O `.github/AGENTS.md` deve permanecer curto, estável e sincronizado com
`.github/copilot-instructions.md`, sempre apontando para o hub de arquitetura e para o baseline em
`.github/instructions/project-canon.instructions.md`.

## Configurações de workspace recomendadas

Adicione ou mantenha as seguintes chaves em `.vscode/settings.json`:

```json
{
  "github.copilot.enable": true,
  "github.copilot.chat.experimental.enable": true,
  "github.copilot.inlineSuggest.enable": true,
  "github.copilot.openaiBaseUrl": "http://localhost:3008/v1",
  "github.copilot.chat.customOAIModels": {
    "qwen3-coder": { "endpoint": "http://localhost:3008/v1/chat/completions" }
  }
}
```

## Variáveis de ambiente

- `OPENAI_API_KEY` ou `GITHUB_COPILOT_OPENAI_API_KEY`: chave do serviço compatível com OpenAI.
- `COPILOT_CUSTOM_MODEL`: nome do modelo a usar.

## Taxonomia estável do repositório

- `src/`: runtime do produto.
- Dentro de `src/`, `src/agent/` é a camada de workers operacionais; `src/missions/` é o domínio de
  missão; `agents/` na raiz é suporte externo ao runtime.
- `tests/`: testes e harness.
- `scripts/`: automação operacional e manutenção.
- `DOCUMENTAÇÃO/`: documentação canônica.
- `.github/`: contrato permanente para agentes e automações.

## Observações adicionais

- Toda documentação e instrução permanente deve ser escrita em pt-BR.
- A arquitetura oficial vive em `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`.
- O índice canônico de arquitetura vive em `DOCUMENTAÇÃO/ARQUITETURA/README.md`.
- O status transversal e o backlog documental vivem em
  `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md`.
