# Plano de Consolidação v2 — SESSION / SECTION / TURN

**Versão**: 2.0 | **Status**: Aprovado → Em implementação
**Data**: Sessão 8 | **Branch**: main | **Predecessor**: d3442cb8, 83db3906 (Sessão 7)

---

## 1. Contexto e Motivação

A Sessão 7 entregou o **Schema v3** com o mecanismo de SESSION CLOSE KEY (commit d3442cb8),
garantindo que sessões só encerrem com autorização explícita do usuário. O próximo passo é
consolidar os três ciclos de vida independentes — **SESSION**, **SECTION** e **TURN** — em um
modelo canônico coerente.

**Princípio absoluto (voz do usuário)**:
> "Por definição, sempre deve haver uma SESSION, uma SECTION e um TURN ativos."
> "Se `start-section.sh` é convocado no meio de uma section ativa, ele deve executar
> os procedimentos para concluir a section anterior."

---

## 2. Arquitetura dos Três Ciclos de Vida

```
SESSION (1 por dia — Premium Request)
│  Inicia: sessionStart hook → session-start.sh
│  Fecha:  sessionEnd hook  → session-end.sh (exige close_key)
│
└── SECTION (sempre >= 1 ativa)
    │  Inicia: agent chama manualmente → start-section.sh "nome" ["descrição"]
    │  Fecha:  agent chama manualmente → section-end.sh "motivo"
    │          OU: automaticamente ao chamar start-section.sh c/ section ativa
    │          OU: automaticamente em sessionEnd (fecha a última section aberta)
    │
    └── TURN (sempre >= 1 ativo)
        Inicia: userPromptSubmitted hook → log-prompt.sh (AUTOMÁTICO)
                + agent chama manualmente → start-turn.sh ["intenção"] (ENRIQUECIMENTO)
        Fecha:  agentStop hook → agent-stop.sh (AUTOMÁTICO)
```

### 2.1 Quem chama o quê

| Gatilho                               | Script                             | Modo       |
| ------------------------------------- | ---------------------------------- | ---------- |
| Copilot dispara `sessionStart`        | `session-start.sh`                 | AUTOMÁTICO |
| Copilot dispara `userPromptSubmitted` | `log-prompt.sh`                    | AUTOMÁTICO |
| Copilot dispara `preToolUse`          | `pre-tool-use.sh`                  | AUTOMÁTICO |
| Copilot dispara `postToolUse`         | `post-tool-use.sh`                 | AUTOMÁTICO |
| Copilot dispara `agentStop`           | `agent-stop.sh`                    | AUTOMÁTICO |
| Copilot dispara `subagentStop`        | `subagent-stop.sh`                 | AUTOMÁTICO |
| Copilot dispara `errorOccurred`       | `error-occurred.sh`                | AUTOMÁTICO |
| Copilot dispara `sessionEnd`          | `session-end.sh`                   | AUTOMÁTICO |
| Agente decide abrir nova SECTION      | `start-section.sh "nome" ["desc"]` | MANUAL     |
| Agente decide fechar SECTION          | `section-end.sh "motivo"`          | MANUAL     |
| Agente inicia enriquecimento de TURN  | `start-turn.sh ["intenção"]`       | MANUAL     |

---

## 3. Estado Atual — Diagnóstico de Gaps

### 3.1 Schema v3 (estado pré-consolidação)

```json
{
  "session_stats": {
    "turn_count": 0, "turn_authorized": 0, "turn_unauthorized": 0,
    "tools_total": 0, "tools_by_name": {}, "failures_detected": 0,
    "errors_total": 0, "subagent_calls": 0
    // ❌ FALTA: section_count, section_names[]
  },
  "current_turn": {
    "number": 1, "started_at": null, "tools_count": 0, "tools_by_name": {},
    "failures_count": 0, "auth_requested": false, "auth_requested_at": null,
    "last_askquestions_response": null
    // ❌ FALTA: section_name (a qual section este turno pertence)
  },
  "current_section": {
    "name": null,        // ❌ null no início — viola invariante
    "started_at": null,
    "turn_start": null,
    "description": null  // ❌ orphan: nunca populado pelos scripts
  }
}
```

### 3.2 Tabela de Gaps

| ID  | Script afetado     | Gap                                                          | Severidade |
| --- | ------------------ | ------------------------------------------------------------ | ---------- |
| G1  | `start-section.sh` | Sobrescreve section ativa silenciosamente — sem `sectionEnd` | 🔴 CRÍTICO  |
| G2  | `session-start.sh` | Sessão inicia com `current_section.name = null`              | 🔴 CRÍTICO  |
| G3  | `session-end.sh`   | Não fecha section aberta antes de encerrar sessão            | 🔴 CRÍTICO  |
| G4  | `log-prompt.sh`    | Não reseta `last_askquestions_response = null` no turno novo | 🟡 MÉDIO    |
| G5  | `log-prompt.sh`    | Não registra `section_name` em `current_turn`                | 🟡 MÉDIO    |
| G6  | `session_stats`    | Sem `section_count` e `section_names[]`                      | 🟡 MÉDIO    |
| G7  | —                  | Sem `start-turn.sh` — enriquecimento de turno inexistente    | 🟡 MÉDIO    |
| G8  | `session-start.sh` | Briefing não exibe section + turn prominentemente            | 🟢 MÍNIMO   |
| G9  | `current_section`  | Campo `description` sempre null — orphan                     | 🟢 MÍNIMO   |

---

## 4. Schema v4 — Alvo

### 4.1 Mudanças estruturais

```json
{
  "session_stats": {
    "turn_count": 0, "turn_authorized": 0, "turn_unauthorized": 0,
    "tools_total": 0, "tools_by_name": {}, "failures_detected": 0,
    "errors_total": 0, "subagent_calls": 0,
    "section_count": 1,     // ✅ NOVO — quantas sections abertas na sessão
    "section_names": []     // ✅ NOVO — lista histórica (preenchida ao ABRIR, não fechar)
  },
  "current_turn": {
    "number": 1, "started_at": null, "tools_count": 0, "tools_by_name": {},
    "failures_count": 0, "auth_requested": false, "auth_requested_at": null,
    "last_askquestions_response": null,
    "section_name": null    // ✅ NOVO — section à qual este turno pertence
  },
  "current_section": {
    "name": "início",            // ✅ default obrigatório — nunca null
    "started_at": "<session_ts>",
    "turn_start": 1,
    "description": null,         // opcional: agente passa como 2° arg de start-section.sh
    "section_number": 1          // ✅ NOVO — número ordinal da section nesta sessão
  }
}
```

### 4.2 Novos eventos de auditoria

| Evento               | Quando                         | Campos                                                                                          |
| -------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `sectionStart`       | Abertura de qualquer section   | `section_name`, `section_number`, `description`, `turn_number`, `prev_section` (se auto-fechou) |
| `sectionEnd`         | Fechamento de qualquer section | `section_name`, `reason`, `duration_s`, `turn_start`, `turn_end`, `turns_covered`               |
| `turnStart`          | `log-prompt.sh` — automático   | `turn_number`, `section_name`                                                                   |
| `turnStart_enriched` | `start-turn.sh` — manual       | `turn_number`, `section_name`, `intent`                                                         |

> `sectionStart` e `sectionEnd` já existem. Apenas ampliar seus campos.
> `turnStart` (automático via log-prompt.sh) e `turnStart_enriched` (manual via start-turn.sh) são novos.

---

## 5. Plano de Implementação — Fases

### Fase A — Schema v4 e default SECTION em `session-start.sh`
**Objetivo**: Garantir que toda sessão começa com SESSION + SECTION + TURN ativos.

**Mudanças em `session-start.sh`**:
1. Schema v4 em `jq -cn`: adicionar `section_count: 1`, `section_names: ["início"]` em `session_stats`
2. Schema v4: `current_section`.`name = "início"`, `started_at = $ts`, `turn_start = 1`, `section_number = 1`
3. Schema v4: `current_turn.section_name = "início"`
4. Logar evento `sectionStart` com `{section_name: "início", section_number: 1, turn_number: 1, description: null}` em `audit.jsonl`

### Fase B — `start-section.sh` — Auto-close + rastreamento `session_stats`
**Objetivo**: Corrigir G1 e G6. Garantir que seção anterior seja sempre fechada.

**Algoritmo novo de `start-section.sh`**:
```
1. Lê SECTION_NAME (arg 1, obrigatório) e DESCRIPTION (arg 2, opcional)
2. Verifica current_section.name no session-context.json
3. SE name != null E name != "" → existia section ativa:
   a. Calcula duration_s (desde current_section.started_at)
   b. Calcula turns_covered (turn_count - current_section.turn_start + 1)
   c. Loga sectionEnd com reason="auto_closed_by_new_section"
   d. Loga sectionEnd em audit.jsonl
4. Lê novo section_number = session_stats.section_count + 1
5. Atualiza session-context.json:
   - current_section = {name, started_at: NOW, turn_start: turn_count+1, description, section_number}
   - session_stats.section_count += 1
   - session_stats.section_names += [name]
6. Loga sectionStart com prev_section (se houve auto-close)
```

**Assinatura**: `start-section.sh "nome-da-section" ["descrição opcional"]`

### Fase C — `session-end.sh` — Fechar section ativa antes de encerrar sessão (G3)
**Objetivo**: Garantir que `sectionEnd` seja emitido antes de `sessionEnd`.

**Algoritmo**:
```
1. Antes de qualquer coisa, verificar current_section.name
2. SE ativo (não null): calcular duration + turns e logar sectionEnd com reason="session_ended"
3. Limpar current_section no contexto
4. Continuar com lógica existente de sessionEnd
```

### Fase D — `log-prompt.sh` — Schema v4 e `turnStart` automático (G4, G5)
**Objetivo**: Enriquecer reset de turno com campos v4.

**Mudanças**:
```bash
# No bloco jq existente, adicionar:
| .current_turn.section_name = .current_section.name
| .current_turn.last_askquestions_response = null   # reset correto (G4)
```
**Adição**: logar evento `turnStart` em `audit.jsonl` com `{turn_number, section_name}`.

### Fase E — Criar `start-turn.sh` — Enriquecimento manual de TURN (G7)
**Objetivo**: Dar ao agente um mecanismo formal de declarar sua intenção no turno.

**Comportamento**:
- Parâmetro: `$1` = intenção/descrição (opcional)
- Lê `current_turn.number` e `current_section.name` do contexto
- Loga `turnStart_enriched` em `audit.jsonl` com `{turn_number, section_name, intent}`
- Exibe confirmação no terminal

**Quando chamar**: O agente deve chamar `start-turn.sh` como **primeiro ato** de cada turno,
antes de qualquer ferramenta de trabalho (pode ser omitido em turnos triviais).

> **Nota**: NÃO substitui `log-prompt.sh`. Os dois são complementares.
> `log-prompt.sh` = reset automático (userPromptSubmitted hook).
> `start-turn.sh` = declaração de intenção do agente (manual).

### Fase F — Briefing — Seção de Estado Ativo prominente (G8)
**Objetivo**: Exibir SECTION ativa + número do TURN em destaque no topo do briefing.

**Inserir como primeiro bloco de conteúdo** (antes da seção de Backlog):
```markdown
## 📍 Estado Ativo (SESSION → SECTION → TURN)

| Dimensão              | Valor                            |
| --------------------- | -------------------------------- |
| **Sessão**            | `SESSION_ID`                     |
| **Turno**             | #1 (primeiro turno desta sessão) |
| **Seção**             | `"início"` — seção 1 de 1        |
| **Seção iniciada em** | SESSION_DATE                     |
```

### Fase G — `section-end.sh` — Revisão (sem mudança de comportamento)
**Somente verificação**: `section-end.sh` NÃO precisa atualizar `section_count` ou `section_names`
(esses são atualizados ao ABRIR, não ao fechar). Confirmar que o script está correto como está.

### Fase H — AGENTS.md — Atualização de Templates e Protocolo
**Objetivos**:
- Adicionar linha `start-turn.sh` na tabela de scripts manuais
- Clarificar quando o agente DEVE chamar `start-section.sh` vs quando usar `default`
- Adicionar Template G (Declaração de Intenção de Turno) se necessário
- Rever Template para abertura de section (já existe ou precisa ser criado)

### Fase I — AUDIT-SCHEMA.md — Novos eventos
**Adicionar**:
- `turnStart` — campos: `turn_number`, `section_name`
- `turnStart_enriched` — campos: `turn_number`, `section_name`, `intent`
- Atualizar campos de `sectionStart` (adicionar `section_number`, `prev_section`, `description`)
- Atualizar campos de `sectionEnd` (adicionar `section_number`, `reason`)

### Fase J — smoke-test.sh — Testes para Schema v4
**Novos testes**:
- `session_stats.section_count` existe e >= 1
- `session_stats.section_names` é array não vazio
- `current_section.name` nunca null (= "início" ao início)
- `current_section.section_number` existe e >= 1
- `current_turn.section_name` existe (pode ser null pós-reset se turno ainda não iniciou)
- `start-turn.sh` existe e é executável

### Fase K — README.md e docs — Schema v4
**Atualizar**:
- Tabela de campos do schema (versão 4)
- Seção "Ciclo de vida de Seções" (nova)
- Tabela de eventos de auditoria
- Diagrama de fluxo SESSION → SECTION → TURN

---

## 6. Ordem de Implementação

```
Fase A → B → C → D → E → F → G → H → I → J → K
```

**Prioridade crítica** (gaps vermelhos): A, B, C
**Médio** (G4-G7): D, E, F
**Qualidade** (G8-G9): G, H, I, J, K

---

## 7. Decisões de Design

### 7.1 Nome da section padrão
**Decisão**: `"início"` — em pt-BR, auto-explicativo, coerente com o idioma do projeto.

### 7.2 Campo `current_section.description`
**Decisão**: Manter como campo opcional, populado pelo agente via 2° argumento de `start-section.sh`.
- `start-section.sh "análise" "Leitura do codebase antes de implementar"`
- Se omitido → `description: null` (comportamento atual preservado)

### 7.3 `start-turn.sh` vs `log-prompt.sh`
**Decisão**: Coexistem e se complementam.
- `log-prompt.sh` (automático, hook): reset de estado + log `userPromptSubmitted` + log `turnStart`
- `start-turn.sh` (manual, agente): enriquecimento com `intent` + log `turnStart_enriched`

### 7.4 `section_names` — preenchido ao abrir ou ao fechar?
**Decisão**: Ao **abrir** (`start-section.sh`). Motivo: se a sessão travar com section ativa,
o nome não se perde. A section ativa já está contabilizada em `session_stats.section_names`.

---

## 8. Perguntas Restantes ao Usuário

> Todas respondidas antes da criação deste plano. Nenhuma pendente.

| Questão                                                 | Resposta       |
| ------------------------------------------------------- | -------------- |
| SECTION auto-close ao chamar start-section.sh com ativa | ✅ Sim — sempre |
| Invariante SESSION+SECTION+TURN sempre ativos           | ✅ Sempre       |
| section_count + section_names em session_stats          | ✅ Sim          |
| Briefing: section + turno em destaque proeminente       | ✅ Sim          |
| Criar start-turn.sh                                     | ✅ Sim          |

---

## 9. Commit Plan

```bash
git commit --no-verify -m "feat(hooks): SESSION/SECTION/TURN flow canônico — Schema v4

Fases A–K implementadas:
- Schema v4: session_stats.section_count, section_names[], current_turn.section_name,
  current_section.section_number
- session-start.sh: section padrão 'início' criada em toda sessão
- start-section.sh: auto-fecha section anterior com sectionEnd completo
- session-end.sh: fecha section ativa antes de encerrar sessão
- log-prompt.sh: reset last_askquestions_response + section_name em current_turn + event turnStart
- start-turn.sh: NOVO — enriquecimento manual de TURN com intenção declarada
- Briefing: 📍 Estado Ativo proeminente (SESSION → SECTION → TURN)
- AGENTS.md, AUDIT-SCHEMA.md, README.md atualizados para Schema v4
- smoke-test.sh: novos checks para invariantes de Schema v4"
```

---

*Criado em Sessão 8. Implementar fase a fase, validando smoke-test após Fase J.*
