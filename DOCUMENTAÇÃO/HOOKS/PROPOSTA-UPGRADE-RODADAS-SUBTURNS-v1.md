# Proposta Completa — Upgrade de Rodadas/SubTurns no ciclo TURN

**Status**: Proposta técnica para implementação **Data**: 2026-03-14 **Escopo**: modelagem explícita
de rodadas (SubTurns), consolidação de schema/contratos e plano de rollout

---

## 1) Contexto e problema

Hoje o runtime já possui sinais de “subturnização” (ex.: `stop_hook_active`,
`current_turn.agentStop_invocations`, `subagent_delegated`), mas sem um **contrato explícito único**
para rodadas internas do TURN.

Isso gera ambiguidades operacionais em cenários críticos:

1. `agentStop` bloqueado e retomado no mesmo TURN lógico;
2. delegação para subagente e retomada do pai;
3. múltiplos `vscode_askQuestions` no mesmo TURN;
4. distinção entre “novo TURN” vs “continuação do TURN”.

Além disso, o modo estrito atual de fechamento (Template F + KEY válida) é altamente sensível à
ordem de eventos. Sem um modelo explícito de rodadas, o diagnóstico fica difuso e o custo de
manutenção sobe.

---

## 2) Objetivos do upgrade

### 2.1 Objetivo principal

Introduzir **SubTurn (Rodada)** como conceito de primeira classe no sistema de hooks, com:

- schema persistido explícito;
- eventos de auditoria explícitos;
- transições de estado determinísticas;
- rollout backward-compatible.

### 2.2 Objetivos secundários

- Reduzir ambiguidade forense em incidentes de autorização;
- Melhorar legibilidade do `audit.jsonl` para fluxos multi-etapa;
- Permitir automações futuras baseadas em rodadas (checkpoint, alertas, resumo por rodada);
- Preservar protocolo estrito de encerramento sem regressão.

### 2.3 Não objetivos

- Não alterar semântica de SESSION/SECTION;
- Não remover hardening de autorização;
- Não transformar resposta de `vscode_askQuestions` em novo TURN.

---

## 3) Premissas e invariantes (não negociáveis)

1. **SESSION ≠ SECTION ≠ TURN ≠ SUBTURN**;
2. SUBTURN **não** cria novo TURN;
3. TURN encerrado é imutável;
4. `session_id` do payload do VS Code permanece fonte de verdade;
5. Fechamento estrito de TURN continua exigindo fluxo válido de autorização;
6. Migração deve ser dual-write antes de qualquer leitura estrita.

---

## 4) Estado atual (As-Is)

### 4.1 Sinais existentes de rodada (implícitos)

- `current_turn.agentStop_invocations` (contagem técnica);
- `stop_hook_active` no payload de `agentStop`;
- `current_turn.subagent_delegated`;
- `current_turn.last_non_bookkeeping_tool`.

### 4.2 Limitações do As-Is

- Não há `current_turn.subturn.*` canônico;
- Não há eventos `subturnStart/subturnEnd` no contrato formal;
- Métricas e compliance são apenas turn-level;
- Debug de reentrância depende de inferência indireta.

---

## 5) Alternativas avaliadas

## 5.1 Alternativa A — Contador mínimo embutido no TURN

Adicionar apenas:

- `current_turn.subturn_number`;
- `session_stats.subturn_total`.

**Prós**: baixo custo, pouca mudança de código. **Contras**: pobre para forense e replays; sem
estado de rodada; sem motivo de transição.

---

## 5.2 Alternativa B — Event-sourcing puro (sem estado em contexto)

Toda rodada só em `audit.jsonl` (`subturnStart`, `subturnTransition`, `subturnEnd`).

**Prós**: trilha rica e append-only. **Contras**: leitura operacional cara; scripts de decisão ficam
dependentes de varredura de log.

---

## 5.3 Alternativa C — Modelo híbrido (estado compacto + eventos ricos) ✅

- Estado vivo de rodada no `session-context`;
- Histórico curto no contexto (ring buffer);
- Auditoria completa no `audit.jsonl`.

**Prós**:

- boa observabilidade + boa performance de leitura;
- decisão de autorização continua local e barata;
- forense completo sem heurísticas frágeis.

**Contras**:

- rollout mais cuidadoso (dual-write + dual-read);
- mais campos no schema.

**Decisão recomendada**: **Alternativa C (híbrida)**.

---

## 6) Proposta arquitetural recomendada (To-Be)

## 6.1 Extensão de schema (`session-context`) — versão proposta v10

### 6.1.1 Estado vivo da rodada atual

```json
{
  "current_turn": {
    "turn_id": "...",
    "subturn": {
      "number": 1,
      "subturn_id": "subturn_...",
      "state": "active",
      "reason": "turn_start",
      "started_at": "2026-03-14T00:00:00Z",
      "last_transition_at": "2026-03-14T00:00:00Z",
      "parent_turn_id": "...",
      "stop_hook_active": false,
      "requires_user_action": false,
      "authorization_snapshot": {
        "auth_requested": false,
        "ask_template": null,
        "close_key_found": false,
        "close_key_validated": false
      }
    }
  }
}
```

### 6.1.2 Histórico curto por TURN (ring buffer)

```json
{
  "current_turn": {
    "subturn_history": [
      {
        "number": 1,
        "subturn_id": "subturn_...",
        "state": "closed",
        "reason": "stop_blocked",
        "started_at": "...",
        "ended_at": "...",
        "duration_ms": 1200
      }
    ]
  }
}
```

### 6.1.3 Agregados de sessão

```json
{
  "session_stats": {
    "subturn_count": 0,
    "subturn_blocked": 0,
    "subturn_resumed": 0,
    "subturn_via_subagent": 0,
    "subturn_via_askquestions": 0
  }
}
```

---

## 6.2 Novos eventos no contrato (`events-contract.md`)

Adicionar eventos internos:

1. `subturnStart`
2. `subturnTransition`
3. `subturnEnd`
4. `subturnResume`

Campos mínimos recomendados:

- `session_id`, `turn_id`, `subturn_id`, `subturn_number`, `timestamp`;
- `reason` (enum);
- `from_state`, `to_state` (quando aplicável);
- `trigger_event` (`agentStop`, `postToolUse`, `subagentStart`, etc.);
- `stop_hook_active`;
- `authorization_snapshot` resumido.

---

## 6.3 Máquina de estados da rodada

Estados recomendados:

- `active`
- `blocked`
- `delegated`
- `waiting_user`
- `resumed`
- `closed`

Transições típicas:

1. `turn_start` → `active` (subturn 1)
2. `agentStop` bloqueado → `blocked` + `subturnEnd`
3. retomada (`stop_hook_active=true`) → `subturnResume` + novo `active`
4. `runSubagent` → `delegated`
5. retorno de subagente → `resumed`
6. `vscode_askQuestions` aguardando usuário → `waiting_user`
7. autorização válida final → `closed`

---

## 7) Integração por script (pontos de mudança)

## 7.1 `log-prompt.sh`

- Inicializar `current_turn.subturn` com `number=1`, `state=active`, `reason=turn_start`;
- resetar `subturn_history` no início do TURN;
- emitir `subturnStart` junto ao `turnStart`.

## 7.2 `pre-tool-use.sh`

- Em `runSubagent/search_subagent`: transicionar para `delegated`;
- emitir `subturnTransition` (`active` → `delegated`).

## 7.3 `post-tool-use.sh`

- Em `vscode_askQuestions`: transição para `waiting_user` quando apropriado;
- após resposta válida: `subturnResume` e/ou transição para `resumed`;
- atualizar `authorization_snapshot` da rodada.

## 7.4 `agent-stop.sh`

- Em block (`decision:block`): encerrar rodada atual (`subturnEnd reason=stop_blocked`) e abrir
  próxima rodada;
- Em `stop_hook_active=true`: registrar `subturnResume`;
- Em fechamento legítimo de TURN: encerrar última rodada (`reason=turn_closed_authorized`).

## 7.5 `agent-stop-lib.sh`

- extrair helpers:
  - `start_subturn(...)`
  - `transition_subturn(...)`
  - `end_subturn(...)`
  - `snapshot_subturn_auth(...)`
- manter `build_turn_block_payload` compatível, adicionando metadados de rodada quando disponíveis.

---

## 8) Compatibilidade e migração

## 8.1 Estratégia de rollout

### Fase P0 — Contrato e schema (sem comportamento)

- Atualizar `session-context.schema.json` e `events-contract.md`;
- adicionar campos opcionais (`additionalProperties` preservado).

### Fase P1 — Dual-write

- Scripts passam a escrever novos campos/eventos;
- leitura de decisão continua no caminho antigo.

### Fase P2 — Dual-read

- decisões usam novo modelo quando disponível;
- fallback para legado se ausente.

### Fase P3 — Read preferencial novo

- remover heurísticas antigas redundantes;
- manter fallback mínimo temporário.

### Fase P4 — Cleanup final

- remover campos legados substituídos por subturn explícito;
- ajustar smoke tests para modo final.

---

## 9) Plano de testes (obrigatório)

Adicionar casos no `smoke-test.sh` (sugestão de IDs):

1. `V90-44`: criação de `subturn` no `log-prompt.sh`;
2. `V90-45`: block em `agentStop` gera `subturnEnd(stop_blocked)`;
3. `V90-46`: `stop_hook_active=true` gera `subturnResume`;
4. `V90-47`: `runSubagent` gera transição `active→delegated`;
5. `V90-48`: askQuestions válido atualiza `authorization_snapshot` da rodada;
6. `V90-49`: fechamento autorizado do TURN encerra última rodada;
7. `V90-50`: dual-read mantém compatibilidade sem campos novos.

Validações de regressão recomendadas:

- `smoke-test.sh --quiet`
- consistência de schema em `session-context.schema.json`
- checagem de contrato em `events-contract.md`

---

## 10) Riscos e mitigação

| Risco                                       | Impacto | Mitigação                                                  |
| ------------------------------------------- | ------: | ---------------------------------------------------------- |
| Crescimento de payload em `session-context` |   Médio | ring buffer limitado (ex.: 20 rodadas)                     |
| Duplicidade de eventos em dual-write        |   Baixo | evento com `schema_version`/`producer` explícitos          |
| Regressão em autorização estrita            |    Alto | manter decisão antiga até P3 + smoke dedicado              |
| Ambiguidade de transições                   |   Médio | enum fechado de `reason` + tabela de transições permitidas |

---

## 11) Critérios de aceite do upgrade

1. `current_turn.subturn` existe e é atualizado de forma determinística;
2. eventos `subturn*` aparecem no audit com correlação `turn_id/subturn_id`;
3. cenários block/resume/subagente/askQuestions são rastreáveis sem heurística;
4. fluxo estrito de fechamento continua íntegro;
5. smoke suite cobre ao menos 6 cenários de rodada;
6. rollback simples via feature flag (`HOOKS_SUBTURN_ENABLED=false`).

---

## 12) Recomendação final

Implementar a **Alternativa C (híbrida)** em rollout faseado P0→P4.

Ela entrega o melhor equilíbrio entre:

- governança forte de autorização;
- rastreabilidade forense de alto nível;
- custo operacional baixo no runtime;
- migração segura sem quebrar sessões em andamento.

---

## 13) Próximos passos imediatos

1. Aprovar este documento como baseline da iniciativa;
2. abrir tarefas P0/P1 no backlog (`pending-tasks.md`);
3. atualizar contratos (`session-context.schema.json`, `events-contract.md`);
4. iniciar dual-write em `log-prompt.sh` e `agent-stop.sh`;
5. adicionar novos smoke tests antes de ativar leitura preferencial.

---

_Proposta preparada para iniciar implementação incremental com baixo risco de regressão._
