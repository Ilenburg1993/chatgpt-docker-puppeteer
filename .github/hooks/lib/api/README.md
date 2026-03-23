# lib/api/ — Módulos da Hook Payload API

Sistema modular de parsing e acesso ao payload JSON recebido pelos hooks do VS Code Copilot.

## Carregamento

Todos os módulos são carregados pelo loader principal:

```bash
source "$HOOK_DIR/lib/hook-payload-api.sh"
```

Após o `source`, chame `hook_api_parse "$json_input"` para popular todas as variáveis `HOOK_*`.

## Módulos

| Arquivo                 | Módulo               | Responsabilidade                                            |
| ----------------------- | -------------------- | ----------------------------------------------------------- |
| `01-vars.sh`            | Variáveis            | Declara e reseta (`_hook_api_reset`) todas as vars `HOOK_*` |
| `02-parse.sh`           | Parsing              | Extrai campos do JSON por evento (`hook_api_parse`)         |
| `03-validate.sh`        | Validação básica     | Valida campos obrigatórios do payload                       |
| `04-predicates.sh`      | Predicados           | Funções booleanas: `is_session_start`, `is_tool_use`, etc.  |
| `05-output.sh`          | Output               | Gera resposta JSON para a plataforma                        |
| `06-query.sh`           | Consultas            | Consultas ao estado da sessão                               |
| `07-state.sh`           | Estado               | Leitura/escrita no `session.json`                           |
| `08-risk.sh`            | Risco                | Detecção de tentativas de bypass e bloqueio                 |
| `09-metrics.sh`         | Métricas             | Contadores de uso de ferramentas                            |
| `10-close-key.sh`       | Close-key            | Geração, validação e rotação da chave de encerramento       |
| `11-compact-context.sh` | Compactação          | Contexto de compactação (`PreCompact`)                      |
| `12-subagent.sh`        | Subagente            | Rastreamento de subagentes (`SubagentStart`/`SubagentStop`) |
| `13-state-version.sh`   | Versionamento        | Migração de schema do `session.json`                        |
| `14-validate-events.sh` | Validação de eventos | Validação semântica por tipo de evento                      |
| `15-audit.sh`           | Auditoria            | Escrita em `audit.jsonl` (`hook_log_audit`)                 |
| `16-lifecycle.sh`       | Ciclo de vida        | Controle de turno, seção e eventos de ciclo de vida         |

## Padrão lazy-load (`*_load()`)

Módulos pesados ou de uso infrequente expõem uma função `hook_<modulo>_load()` em vez de executar
código no momento do `source`. Isso evita custo de inicialização em hooks que não precisam do
módulo.

### Funções lazy disponíveis

| Função                    | Módulo                  | Quando chamar                                             |
| ------------------------- | ----------------------- | --------------------------------------------------------- |
| `hook_metrics_load`       | `09-metrics.sh`         | Antes de ler/atualizar contadores de ferramentas          |
| `hook_close_key_load`     | `10-close-key.sh`       | Antes de validar ou rodar a close-key                     |
| `hook_subagent_load`      | `12-subagent.sh`        | Antes de processar eventos `SubagentStart`/`SubagentStop` |
| `hook_state_version_load` | `13-state-version.sh`   | Antes de verificar/migrar versão do state                 |
| `hook_validate_load`      | `14-validate-events.sh` | Antes de validar payload por tipo de evento               |

### Exemplo de uso

```bash
source "$HOOK_DIR/lib/hook-payload-api.sh"
hook_api_parse "$INPUT"

# Lazy: só carrega métricas se o evento envolver uma tool call
if is_tool_use; then
  hook_metrics_load
  hook_api_load_metrics
fi

# Lazy: só carrega close-key se o evento for PostToolUse de vscode_askQuestions
if is_ask_questions_post; then
  hook_close_key_load
  hook_close_key_validate "$HOOK_RESPONSE_TEXT"
fi
```

### Regra geral

> Chame `hook_<modulo>_load()` uma única vez por invocação de hook, antes de usar qualquer função do
> módulo. A função é idempotente: chamá-la duas vezes não causa efeito colateral.
