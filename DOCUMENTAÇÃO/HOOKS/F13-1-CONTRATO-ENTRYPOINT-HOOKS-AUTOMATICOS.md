# F13.1 — Contrato Canônico de Entrypoint para Hooks Automáticos

**Data**: 2026-03-15 **Escopo**: hooks automáticos acionados por `.github/hooks/copilot-hooks.json`
**Status**: canônico para a trilha F13→F16

## Objetivo

Padronizar todos os scripts automáticos no modelo **script-orquestrador + lib dedicada**, reduzindo
lógica inline, acoplamento e risco de regressão.

## Hooks automáticos cobertos

1. `session-start.sh` (`sessionStart`)
2. `log-prompt.sh` (`userPromptSubmitted`)
3. `pre-tool-use.sh` (`preToolUse`)
4. `post-tool-use.sh` (`postToolUse`)
5. `agent-stop.sh` (`agentStop`)
6. `subagent-start.sh` (`subagentStart`)
7. `subagent-stop.sh` (`subagentStop`)
8. `pre-compact.sh` (`preCompact`)
9. `session-end.sh` (`sessionEnd`)

## Padrão obrigatório do script-orquestrador

Cada script automático deve cumprir, na ordem:

1. **Bootstrap mínimo**
   - `set -euo pipefail`
   - resolução de `HOOK_DIR`, `STATE_DIR`, `LOG_DIR`
   - leitura de input (`resolve_hook_runtime_input` quando disponível)
2. **Carregamento de libs**
   - carregar `hooks-lib/common.sh` (ou `hooks-lib/runtime/common.sh` via shim)
   - carregar **lib dedicada do próprio hook**
3. **Dispatch único**
   - chamar **uma função pública canônica** da lib dedicada
4. **Finalização canônica**
   - retorno de código de saída consistente
   - emissão de payload de resposta (quando aplicável ao hook)

## Assinatura canônica da função de lib

- Nome: `run_<nome_script_sem_extensao>_hook`
- Entrada: payload JSON bruto do hook + contexto resolvido por variáveis de ambiente
- Saída:
  - `stdout` com payload quando o hook exigir resposta
  - `exit 0` para sucesso
  - `exit != 0` apenas para falhas que devem interromper processamento

## Matriz alvo script -> lib dedicada -> função pública

| Script automático   | Lib dedicada alvo                           | Função pública canônica                                           |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `session-start.sh`  | `hooks-lib/lifecycle/session-start-lib.sh`  | `run_session_start_hook`                                          |
| `log-prompt.sh`     | `hooks-lib/lifecycle/log-prompt-lib.sh`     | `run_log_prompt_hook`                                             |
| `pre-tool-use.sh`   | `hooks-lib/policy/pre-tool-use-lib.sh`      | `run_pre_tool_use_hook`                                           |
| `post-tool-use.sh`  | `hooks-lib/policy/post-tool-use-lib.sh`     | `run_post_tool_use_hook`                                          |
| `agent-stop.sh`     | `hooks-lib/agent-stop-lib.sh`               | `run_agent_stop_hook` _(a consolidar sem quebrar contrato atual)_ |
| `subagent-start.sh` | `hooks-lib/lifecycle/subagent-start-lib.sh` | `run_subagent_start_hook`                                         |
| `subagent-stop.sh`  | `hooks-lib/lifecycle/subagent-stop-lib.sh`  | `run_subagent_stop_hook`                                          |
| `pre-compact.sh`    | `hooks-lib/lifecycle/pre-compact-lib.sh`    | `run_pre_compact_hook`                                            |
| `session-end.sh`    | `hooks-lib/lifecycle/session-end-lib.sh`    | `run_session_end_hook`                                            |

## Regra de “script fino” (critério objetivo)

Um script automático será considerado **fino** quando atender simultaneamente:

1. Não contém regra de negócio de domínio extensa; apenas bootstrap + validações de entrada +
   dispatch.
2. A maior parte da lógica (decisão, transformação, persistência) reside em lib(s) dedicada(s).
3. A função pública da lib cobre o fluxo principal de execução do hook.
4. O script não replica regras já presentes na lib dedicada.

## Política de fail-fast e tolerância

- **Fail-fast obrigatório**:
  - lib dedicada ausente
  - função pública ausente
  - contrato mínimo de entrada inválido
- **Fail-open permitido apenas quando explicitamente previsto**:
  - blocos auxiliares não críticos (ex.: analytics/relatórios em lifecycle)

## Exceção controlada do `agent-stop`

- `agent-stop.sh` permanece referência de integração com lib dedicada.
- A decomposição de `agent-stop-lib.sh` em módulos menores é fase posterior (**F15.2**).
- Durante F13/F14, o objetivo é preservar contrato externo estável do Stop.

## Critérios de aceite de F13.1

1. Contrato canônico publicado e versionado neste documento.
2. Matriz dos 9 hooks automáticos publicada com lib dedicada alvo e função pública.
3. Critério de script fino formalizado e pronto para enforcement em F16.
4. ROADMAP/PLANO/pending-tasks sincronizados com este contrato.
