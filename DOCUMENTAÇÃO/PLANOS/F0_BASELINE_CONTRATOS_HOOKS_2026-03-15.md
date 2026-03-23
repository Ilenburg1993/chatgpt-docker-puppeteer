# Fase 0 — Baseline e Contratos Comportamentais do Hooks System

**Data**: 2026-03-15 **Status**: ✅ Concluída **Escopo**: congelar o comportamento atual dos hooks
automáticos como referência de não-regressão.

## Objetivo da F0

Estabelecer uma baseline verificável do sistema atual antes da modularização (F1+), cobrindo:

1. matriz de eventos esperados por hook automático;
2. snapshot de regras críticas de governança (askQuestions / Template F / close_key / session_id);
3. validação canônica de regressão (smoke).

## Evidência de baseline verde

- Execução: `bash .github/hooks/scripts/smoke-test.sh --quiet`
- Resultado: **PASS 244/244**

## Matriz de hooks automáticos (contrato baseline)

Fonte primária de binding runtime: `.github/hooks/copilot-hooks.json`.

| Hook Copilot          | Script                      | Timeout | Eventos/efeitos esperados (baseline)                                                                                                                                                                                             |
| --------------------- | --------------------------- | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionStart`        | `scripts/session-start.sh`  |     60s | Inicializa `state/session-context.json`, gera `state/session-briefing.md`, registra `sessionStart`, cria seção inicial.                                                                                                          |
| `userPromptSubmitted` | `scripts/log-prompt.sh`     |     30s | Registra `userPromptSubmitted`, inicializa/atualiza TURN e SubTurn, pode registrar `sessionResumeDetected`, emite obrigação de leitura (`requiredDocs_obligation_set`) no TURN inicial.                                          |
| `preToolUse`          | `scripts/pre-tool-use.sh`   |     30s | Registra `preToolUse`, aplica guardrails de policy, valida checklist TODO, registra leitura obrigatória (`requiredDoc_read`) e pode negar ações ilegítimas (incluindo fechamento de sessão fora do fluxo).                       |
| `postToolUse`         | `scripts/post-tool-use.sh`  |     30s | Registra `postToolUse`, processa resposta de `vscode_askQuestions`, governa continuidade/escalonamento, registra `askQuestions_response` e eventos correlatos, valida close key e aciona fechamento automático quando aplicável. |
| `agentStop`           | `scripts/agent-stop.sh`     |     45s | Avalia autorização de fechamento de TURN; em caso inválido retorna `decision:block`; registra `turnEnd_authorized`/`turnEnd_invalid_authorization`/`turnEnd_no_askQuestions` e eventos de bloqueio/reentrada.                    |
| `subagentStart`       | `scripts/subagent-start.sh` |     30s | Registra `subagentStart`; integra com estratégia de delegação para autorização de TURN.                                                                                                                                          |
| `subagentStop`        | `scripts/subagent-stop.sh`  |     30s | Registra `subagentStop` com guard de sessão.                                                                                                                                                                                     |
| `preCompact`          | `scripts/pre-compact.sh`    |     30s | Registra `preCompact` e atualiza contadores de compactação.                                                                                                                                                                      |
| `sessionEnd`          | `scripts/session-end.sh`    |     60s | Fecha seção ativa, gera resumo de sessão, valida presença de key de encerramento e pode criar `SESSION_CLOSE_NO_KEY.flag`.                                                                                                       |

## Snapshot de regras críticas (congelamento F0)

1. **Encerramento de SESSION exige Template F + close key válida**
   - Fluxo legítimo: `vscode_askQuestions` (Template F) → usuário informa `ENCERRAR-XXXXXXXX` →
     `post-tool-use.sh` valida e aciona fechamento automático.

2. **Resposta de continuidade (A/D/E) não autoriza fechamento de TURN/SESSION**
   - Após askQuestions não-Template F, o fluxo deve continuar; tentativa de encerrar é
     invalidada/bloqueada.

3. **Regra de último ato do TURN**
   - `vscode_askQuestions` precisa ser o último passo válido; exceção permitida: `manage_todo_list`
     imediatamente após askQuestions para bookkeeping final.

4. **Leituras obrigatórias de início/retomada**
   - `session-briefing.md`, `pending-tasks.md` e `session-context.json` devem ser lidos; pendência
     invalida autorização de fechamento.

5. **Session ID guard + healing defensivo**
   - Escritas no contexto exigem reconciliação de `session_id`, com caminhos de cura controlada para
     mismatch.

6. **Protocolo TODO obrigatório no TURN**
   - Turnos com trabalho devem iniciar checklist e manter último item como chamada de continuidade
     via `vscode_askQuestions`.

7. **Fechamento direto de sessão pelo agente é proibido**
   - Chamadas diretas fora do fluxo de Template F + validação de key são negadas no hardening.

## Referências canônicas usadas

- `.github/hooks/copilot-hooks.json`
- `.github/hooks/contracts/events-contract.md`
- `.github/hooks/contracts/session-context.schema.json`
- `.github/instructions/hooks-protocol.instructions.md`
- `.github/AGENTS.md`
- `.github/hooks/scripts/pre-tool-use.sh`
- `.github/hooks/scripts/post-tool-use.sh`
- `.github/hooks/scripts/agent-stop.sh`
- `.github/hooks/hooks-lib/agent-stop-lib.sh`
- `.github/hooks/scripts/log-prompt.sh`

## Conclusão

A Fase 0 está **concluída** com baseline registrada, contratos comportamentais explícitos e smoke
canônico verde. A partir daqui, mudanças de F1+ devem manter paridade com este documento como
referência de regressão.
