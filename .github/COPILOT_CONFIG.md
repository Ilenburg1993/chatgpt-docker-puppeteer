# Configuração do GitHub Copilot

Este documento resume as configurações e recomendações específicas do repositório para trabalhar com
a extensão GitHub Copilot / Copilot Chat no workspace.

## Localização de skills e prompts

- Skills de auditoria ficam em `.github/skills/<nome>/SKILL.md`.
- Prompts compartilhados estão em `.github/prompts/prompts.js`.
- A configuração de agente do VS Code (`chat.agentSkillsLocations`) deve incluir `.github/skills`
  para que as skills sejam carregadas.
- Ative `chat.useAgentsMdFile` para permitir leitura automática de `AGENTS.md`.
- Armazene qualquer arquivo JSON de agente em `.github/agents/` (ex: `audit-agent.json`).

## Arquivo AGENTS.md

Criamos um `.github/AGENTS.md` com diretrizes universais; mantenha-o em sincronização com
`copilot-instructions.md` e use-o quando múltiplos agentes de IA forem usados no workspace.

- O resumo canônico curto para tarefas gerais fica em
  `.github/instructions/project-canon.instructions.md`.

- Se desejar regras adicionais, adicione arquivos `.instructions.md` em `.github/instructions`
  (exemplo incluído) e configure `chat.instructionsFilesLocations`.

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

Essas opções permitem o uso de modelos compatíveis com OpenAI (Ollama, Claude, etc.) via o gateway
HTTP que o projeto expõe.

Outros campos `github.copilot.*` podem ser habilitados conforme necessário (métricas, autologout,
políticas de telemetria). Consulte a documentação do VS Code para a lista completa.

## Variáveis de ambiente

O container de desenvolvimento e os scripts usam variáveis de ambiente para controlar a integração:

- `OPENAI_API_KEY` ou `GITHUB_COPILOT_OPENAI_API_KEY` – chave do serviço do tipo OpenAI usado pelo
  gateway.
- `COPILOT_CUSTOM_MODEL` – nome do modelo a usar (ex. `qwen3-coder`).

As instruções para populares estas variáveis estão em `.env.example`.

## Política de organização (opcional)

Se o repositório estiver sob Copilot for Business, um diretório `copilot.policy/` pode conter
pacotes de política. Não há configuração nesta fase, mas a estrutura deve ser preservada.

## Observações adicionais

- Todos os prompts e SKILLs são escritos em Português, visto que os agentes humanos e automáticos
  que usam este repositório funcionam em PT‑BR.
- A equipe deve ativar o Telemetry somente em ambiente de debug; há flags experimentais para
  desabilitar telemetria em `settings.json`.

---

Este arquivo foi gerado automaticamente em 27 fev 2026.
