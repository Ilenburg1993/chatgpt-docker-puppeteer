# PLANO — Upgrade de contexto e comandos pós-evento nos Hooks

**Status**: Proposto (execução iniciada nesta sessão)
**Data**: 2026-03-15
**Escopo**: `.github/hooks/*` + contratos + verificador

## 1) Objetivo

Implementar um fluxo robusto para que, após eventos específicos (principalmente `vscode_askQuestions` de continuidade), o agente:

1. **receba contexto/comando determinístico** via hook;
2. **tenha fallback obrigatório** quando a resposta do usuário estiver ambígua;
3. **execute auditoria automática de código** quando não houver instruções claras;
4. mantenha conformidade com protocolo de TODO/subturn/session.

## 2) Base oficial usada (VS Code Docs)

### Hooks e controle do fluxo
- `PostToolUse` pode injetar `hookSpecificOutput.additionalContext` e até bloquear fluxo com `decision: "block"`.
- `PreToolUse` pode decidir `permissionDecision` (`allow|deny|ask`) e injetar contexto adicional.
- `Stop` pode bloquear encerramento com `decision: "block"` e razão explícita.
- Hooks usam JSON estruturado de entrada/saída e têm precedência de decisão “mais restritiva vence”.

Fonte:
- https://code.visualstudio.com/docs/copilot/customization/hooks
- https://code.visualstudio.com/docs/copilot/customization/hooks#_stop

### Diagnóstico e garantia de entrega
- Agent Debug panel e Chat Debug view permitem confirmar:
  - tool calls disparados;
  - payload de entrada/saída dos tools;
  - contexto efetivamente enviado ao modelo.
- Chat customization diagnostics confirma se customizações/hooks foram carregadas.

Fonte:
- https://code.visualstudio.com/docs/copilot/chat/chat-debug-view
- https://code.visualstudio.com/docs/copilot/troubleshooting#_chat-customization-diagnostics

### Orquestração e ferramentas
- Sessão pode usar níveis de aprovação/autonomia e tool approval explícito.
- Subagentes e custom agents podem ser usados para pipelines coordenados com papéis específicos.

Fonte:
- https://code.visualstudio.com/docs/copilot/agents/agent-tools
- https://code.visualstudio.com/docs/copilot/agents/subagents
- https://code.visualstudio.com/docs/copilot/customization/custom-agents

## 3) Problema operacional que este upgrade resolve

Após `vscode_askQuestions` de continuidade, quando a resposta é vaga/ambígua, o agente pode:
- seguir sem direção clara;
- pular auditoria preventiva;
- encerrar turno com baixa qualidade de decisão.

Queremos tornar o comportamento **determinístico e auditável**: ambiguidade => **auto-auditoria obrigatória**.

## 4) Arquitetura proposta

### A. Classificador de clareza no `post-tool-use.sh`

Para respostas de `vscode_askQuestions` (não-Template F):
- classificar se a resposta é **clara** ou **ambígua**;
- quando ambígua:
  - registrar evento canônico (`askQuestions_continuation_unclear`);
  - persistir flags de obrigação de auditoria no `session-context.json`;
  - injetar `additionalContext` com comando operacional explícito: iniciar auditoria.

### B. Enforcement no `pre-tool-use.sh`

Enquanto `auto_audit_required=true` e `auto_audit_started=false`:
- permitir ferramentas de kickoff de auditoria (ex.: leitura/busca/diagnóstico);
- negar chamadas que desviem do fluxo (ex.: novo `vscode_askQuestions` ou edição direta sem auditoria inicial);
- registrar evento de bloqueio/controle (`autoAudit_pretool_deny`) quando aplicável;
- ao primeiro passo de auditoria válido, registrar `autoAudit_started`.

### C. Fechamento seguro no `agent-stop-lib.sh`

No cálculo de autorização do TURN:
- se `auto_audit_required=true` e `auto_audit_started=false`, invalidar autorização (`auto_audit_required_not_started`);
- gerar mensagem de block instruindo auditoria obrigatória antes de novo fechamento.

### D. Observabilidade e contratos

Atualizar:
- `events-contract.md` com novos eventos e semântica;
- `session-context.schema.json` com novos campos de estado;
- `verify-hook-delivery.sh` para métricas/warnings do novo fluxo.

## 5) Campos novos propostos (estado)

### `current_turn`
- `continuation_instruction_clear: boolean`
- `auto_audit_required: boolean`
- `auto_audit_required_at: string|null`
- `auto_audit_reason: string|null`
- `auto_audit_started: boolean`
- `auto_audit_started_at: string|null`
- `auto_audit_started_tool: string|null`

### `session_stats`
- `auto_audit_triggers: integer`

## 6) Eventos novos propostos

- `askQuestions_continuation_unclear`
- `autoAudit_started`
- `autoAudit_pretool_deny`

## 7) Estratégia de rollout

1. **Fase 1 (runtime)**: post/pre/stop com flags + enforcement mínimo.
2. **Fase 2 (contratos/docs)**: schema + events-contract + instruções operacionais.
3. **Fase 3 (verificação)**: smoke + `verify-hook-delivery.sh --scope turn` + validação no Agent Debug/Chat Debug.
4. **Fase 4 (hardening opcional)**: calibrar classificador de ambiguidade (regex/heurística) com dados reais de audit.

## 8) Critérios de aceite

- Dado askQuestions de continuidade com resposta ambígua:
  - evento `askQuestions_continuation_unclear` existe;
  - `current_turn.auto_audit_required=true`;
  - agente recebe contexto de comando para iniciar auditoria.
- Antes de iniciar auditoria, novas ações proibidas são negadas em `preToolUse` (com evento de rastreio).
- Se tentar encerrar sem auditoria inicial, `agentStop` bloqueia com razão explícita.
- `verify-hook-delivery.sh` evidencia os novos sinais no audit.

## 9) Riscos e mitigação

- **Falso positivo de ambiguidade**: calibrar heurística e manter whitelist de respostas claras.
- **Excesso de bloqueio**: limitar deny a ferramentas críticas de desvio, não bloquear leitura/pesquisa.
- **Ruído no audit**: manter eventos enxutos e com campos estáveis.

## 10) Próximas ações imediatas desta sessão

1. Implementar runtime (post/pre/stop).
2. Atualizar contratos/verificador.
3. Rodar smoke e verificador de entrega.
4. Ajustar heurística caso necessário.
