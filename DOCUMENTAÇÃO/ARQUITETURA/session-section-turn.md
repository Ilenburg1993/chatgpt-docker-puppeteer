# Arquitetura SESSION · SECTION · TURN

**Status**: Canônico · v2.0 **Última atualização**: 2026-03-10 **Propriedade**: `.github/hooks/` —
Sistema de Hooks do Agente

---

## 1. Conceitos e Hierarquia

```
SESSION
└── SECTION (1..*)
    └── TURN (1..*)
```

Os três conceitos formam uma hierarquia estrita. Todo trabalho do agente acontece sempre dentro de
um TURN ativo, que pertence a um SECTION ativa, que pertence a uma SESSION ativa.

### 1.1 SESSION

| Campo               | Descrição                                               |
| ------------------- | ------------------------------------------------------- |
| Cardinalidade       | **1 por ativação do Copilot Chat**                      |
| Boundary            | `session-start.sh` → `session-end.sh`                   |
| Persiste em         | `state/session-context.json` · `state/audit.jsonl`      |
| Encerramento válido | Usuário digita chave `ENCERRAR-XXXXXXXX` via Template F |

Uma SESSION nunca deve ser encerrada sem autorização explícita via `vscode_askQuestions` e validação
da close_key.

### 1.2 SECTION

| Campo          | Descrição                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Cardinalidade  | **1 ou mais por SESSION**                                                                            |
| Boundary       | `start-section.sh "nome"` → `section-end.sh` ou auto-close                                           |
| Número local   | `current_section.section_number` (1-based, por SESSION)                                              |
| Turn de início | `current_section.turn_start` (global) · `current_section.local_turn` (local)                         |
| Invariante     | Sempre deve haver uma SECTION ativa. Se ficar nula, `agent-stop.sh` cria "retomada" automaticamente. |

**O que semânticamente justifica uma mudança de SECTION:**

| Gatilho                       | Tipo      | Automático? | Observação                                   |
| ----------------------------- | --------- | ----------- | -------------------------------------------- |
| Mudança de fase lógica        | Semântico | Manual      | Ex: "análise" → "implementação"              |
| Git push bem-sucedido         | Evento    | Automático  | Entrega concluída → nova fase começa         |
| Mudança de escopo de trabalho | Semântico | Manual      | Ex: tarefa A → tarefa B não relacionada      |
| Reversão / bugfix urgente     | Semântico | Manual      | Contexto muda drasticamente                  |
| Compactação de conversa       | Técnico   | Automático¹ | Novo contexto = nova seção lógica            |
| Retomada após ausência        | Técnico   | Automático  | `agent-stop.sh` invariante: seção "retomada" |

> ¹ A compactação (`preCompact`) não dispara ainda — pode ser implementado futuramente.

### 1.3 TURN

| Campo          | Descrição                                                              |
| -------------- | ---------------------------------------------------------------------- |
| Cardinalidade  | **1 ou mais por SECTION** (≥1 por SESSION)                             |
| Boundary start | `log-prompt.sh` (evento `userPromptSubmitted`)                         |
| Boundary end   | `agent-stop.sh` (evento `agentStop`, incrementa `turn_count`)          |
| Número global  | `current_turn.number` = `session_stats.turn_count + 1`                 |
| Número local   | `current_turn.section_turn` = turno dentro da SECTION atual (**novo**) |
| Invariante     | Agente deve chamar `vscode_askQuestions` antes de encerrar cada TURN.  |

**O que semânticamente justifica uma mudança de TURN:**

| Gatilho                   | Tipo     | Automático?    | Observação                                    |
| ------------------------- | -------- | -------------- | --------------------------------------------- |
| Novo prompt do usuário    | Primário | Sim            | Sempre cria novo TURN (`userPromptSubmitted`) |
| Git push bem-sucedido     | Evento   | Sim (**novo**) | Entrega → turno "pós-push" marcado no state   |
| `start-turn.sh` explícito | Manual   | Não            | Agente declara intenção de novo turno         |

---

## 2. Estado — Schema v5

```jsonc
// state/session-context.json — campos relevantes ao ciclo SESSION/SECTION/TURN

{
  "session": {
    "id": "uuid",
    "started_at": "ISO8601",
    "close_key": "ENCERRAR-XXXXXXXX",
    "close_key_validated": false,
  },

  "session_stats": {
    "turn_count": 4, // global, nunca reseta — incrementado pelo agentStop
    "push_count": 1, // NOVO — número de git pushes na SESSION
    "last_push_at": "ISO8601", // NOVO — timestamp do último push
    "last_push_turn": 3, // NOVO — turn_count no momento do último push
    "section_count": 2,
  },

  "current_turn": {
    "number": 5, // global (= turn_count + 1)
    "section_turn": 2, // NOVO — local à section atual (reseta p/ 1 em cada section nova)
    "intent_declared": true,
    "intent": "Implementar feature X",
  },

  "current_section": {
    "name": "implementação",
    "section_number": 2,
    "turn_start": 4, // global: qual turn_count quando esta section começou
    "local_turn": 1, // NOVO — contador interno; reseta a 0 em start-section, incrementa em log-prompt
  },
}
```

---

## 3. Máquina de Estados

```
                    ┌─────────────────────────────────────┐
                    │              SESSION                 │
                    │                                      │
                    │  ┌──────────────────────────────┐   │
                    │  │          SECTION 1            │   │
                    │  │  ┌──────┐ ┌──────┐ ┌──────┐  │   │
                    │  │  │TURN 1│ │TURN 2│ │TURN 3│  │   │
                    │  │  └──────┘ └──────┘ └──────┘  │   │
                    │  └──────────────────────────────┘   │
                    │            ↓ section change          │
                    │  ┌──────────────────────────────┐   │
                    │  │          SECTION 2            │   │
                    │  │  ┌──────┐ ┌──────┐            │   │
                    │  │  │TURN 1│ │TURN 2│            │   │  ← section_turn reseta p/ 1
                    │  │  └──────┘ └──────┘            │   │
                    │  └──────────────────────────────┘   │
                    └─────────────────────────────────────┘
```

### Transições obrigatórias:

```
Evento: userPromptSubmitted
├── log-prompt.sh dispara
├── current_turn.* reseta
├── current_turn.number    = prev_turn_count + 1   (global, não reseta)
└── current_turn.section_turn = current_section.local_turn + 1  (local, reseta por section)

Evento: agentStop (fim do TURN)
├── agent-stop.sh dispara
├── session_stats.turn_count += 1
└── Exige vscode_askQuestions (enforcement)

Evento: start-section (mudança de SECTION)
├── start-section.sh dispara
├── section anterior é fechada (sectionEnd logado)
├── nova section criada (sectionStart logado)
├── current_section.local_turn = 0   ← RESETA AQUI
└── próximo TURN terá section_turn = 1 (calculado no log-prompt.sh)

Evento: gitPush (push bem-sucedido — NOVO)
├── .git/hooks/post-push dispara → on-git-push.sh
├── gitPush logado em audit.jsonl
├── session_stats.push_count += 1
├── session_stats.last_push_turn = current turn_count + 1
└── auto-section "pós-push" OU flag pending_new_section = true
    (ver Seção 5 para decisão de design)
```

---

## 4. Regras de Numeração

### 4.1 TURN global (`current_turn.number`)

- **Nunca reseta** na SESSION
- Inicia em 1, incrementa por prompt
- Preserva rastreabilidade histórica no audit.jsonl

### 4.2 TURN local / section (`current_turn.section_turn`)

- **Reseta para 1** a cada nova SECTION
- Calculado em `log-prompt.sh` como `current_section.local_turn + 1`
- Armazenado em `current_section.local_turn` para persistência entre prompts
- Exibido no briefing e systemMessage como: `TURN 2/5` (local/global)

**Exemplos:**

| Evento             | section_turn | turn.number (global) |
| ------------------ | ------------ | -------------------- |
| SESSION start      | —            | —                    |
| Prompt 1 (sec. 1)  | **1**        | 1                    |
| Prompt 2 (sec. 1)  | **2**        | 2                    |
| start-section("X") | (reseta→0)   | —                    |
| Prompt 3 (sec. 2)  | **1**        | 3                    |
| Prompt 4 (sec. 2)  | **2**        | 4                    |

---

## 5. Git Push como Gatilho de Fase (NOVO)

### 5.1 Problema

Quando o agente faz `git push`, o trabalho de uma fase lógica está concluído. Porém, o push acontece
**dentro** de um TURN ativo (não é um boundary natural). O agente continua respondendo após o push.

### 5.2 Opções consideradas

| Opção             | Descrição                                                                                                      | Prós                                      | Contras                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| A                 | `post-push` → auto `start-section.sh "pós-push"`                                                               | Totalmente automático                     | Fragmenta demais; pode ser inconveniente |
| B                 | `post-push` → flag `pending_new_section=true`, agente decide                                                   | Agente tem controle                       | Agente pode ignorar o flag               |
| C                 | `post-push` → log evento + incrementa push_count + systemMessage sugere                                        | Informativo; preserva autonomia           | Não é automático                         |
| **D** (escolhido) | `post-push` → log gitPush + flags + agente obrigado a declarar `start-section` OU `continue` via systemMessage | Automático no tracking, manual na decisão | Requer agent-stop.sh aware do flag       |

### 5.3 Implementação escolhida (Opção D)

O git `post-push` hook:

1. Loga evento `gitPush` em `audit.jsonl`
2. Incrementa `session_stats.push_count`
3. Escreve `session_stats.pending_section_after_push = true` em `session-context.json`

O `agent-stop.sh`, ao detectar `pending_section_after_push = true`:

1. Inclui no `systemMessage` do bloco de enforcement: **"Git push detectado — declare nova section
   ou confirme continuação na mesma"**
2. O agente DEVE chamar `start-section.sh "fase"` OU `continue-section.sh` (novo script simples que
   limpa o flag)
3. Ao abrir nova section, `local_turn` reseta → próximo prompt tem `section_turn = 1`

### 5.4 `continue-section.sh` (novo script auxiliar)

```bash
# Limpa o flag pending_section_after_push sem criar nova section.
# Uso: quando o agente decide continuar na section atual após um push.
```

---

## 6. Gatilhos Automáticos — Resumo Canônico

| Gatilho                        | Script envolvido            | O que acontece                                             |
| ------------------------------ | --------------------------- | ---------------------------------------------------------- |
| `userPromptSubmitted`          | `log-prompt.sh`             | Novo TURN inicia; section_turn incrementa                  |
| `agentStop`                    | `agent-stop.sh`             | TURN encerra; turn_count+=1; vscode_askQuestions req.      |
| `start-section.sh "nome"`      | `start-section.sh`          | Nova SECTION; local_turn=0; section_turn=1 no próximo TURN |
| `session-start.sh`             | `session-start.sh`          | Nova SESSION; section "início" criada (local_turn=0)       |
| `session-end.sh`               | `session-end.sh`            | SESSION encerra; requer close_key                          |
| `.git/hooks/post-push`         | `on-git-push.sh` (**novo**) | push_count+=1; flag pending_section_after_push=true        |
| `section.name == null` (guard) | `agent-stop.sh`             | Auto-cria section "retomada"                               |

---

## 7. Feedback ao Agente — systemMessage enrichment (agent-stop.sh)

O bloco `decision:block` do `agent-stop.sh` deve exibir:

```
SESSION: abc12345 | SECTION: "implementação" (#2) | TURN: 2/5 (local/global)
Push pendente: SIM → declare start-section OU continue-section
Tarefas alta prioridade: 3 | Média: 1 | Backlog: 2
Próxima: "Implementar dual numbering no log-prompt.sh"
Violações consecutivas: 0
```

Formato: `TURN: <section_turn>/<global_turn>` — dual display em toda saída do agente.

---

## 8. Invariantes do Sistema

1. **SESSION ∃ SECTION ∃ TURN**: Sempre devem estar ativos simultaneamente.
2. **section_turn ≥ 1**: Nunca 0 nem negativo quando em TURN ativo.
3. **turn_count monotônico**: Nunca decrementa na SESSION.
4. **Novo SECTION → section_turn reseta para 1**: Via `local_turn = 0` em `start-section.sh`.
5. **Push logado**: Todo `git push` bem-sucedido gera evento `gitPush` em `audit.jsonl`.
6. **Push → decisão obrigatória**: O agente não pode encerrar TURN sem tratar
   `pending_section_after_push`.

---

## 9. Mapa de Scripts (sessão atual)

| Script                 | Propósito                                                 | Modifica `session-context.json`? |
| ---------------------- | --------------------------------------------------------- | -------------------------------- |
| `session-start.sh`     | Inicia SESSION + section "início"                         | Sim (cria)                       |
| `session-end.sh`       | Encerra SESSION (requer close_key)                        | Sim (ended_at)                   |
| `start-section.sh`     | Cria nova SECTION (reseta local_turn=0)                   | Sim                              |
| `section-end.sh`       | Fecha SECTION explicitamente                              | Sim                              |
| `start-turn.sh`        | Declara intenção de TURN (logging)                        | Sim (intent_declared)            |
| `log-prompt.sh`        | Inicia TURN (userPromptSubmitted)                         | Sim (current_turn.\*)            |
| `agent-stop.sh`        | Encerra TURN; enforcement; auto-section                   | Sim (turn_count+=1)              |
| `on-git-push.sh`       | Processa git push (**novo**)                              | Sim (push_count, flag)           |
| `continue-section.sh`  | Confirma continuação após push (**novo**)                 | Sim (limpa flag)                 |
| `install-git-hooks.sh` | Instala hooks git (pre-commit, commit-msg, **post-push**) | Não                              |

---

## 10. Histórico de Fases de Implementação

### ✅ Fase 4 — Completa (commit `0900bcfa`)

| Tarefa                                                     | Status       |
| ---------------------------------------------------------- | ------------ |
| `start-section.sh`: `local_turn = 0` ao criar nova section | ✅ concluído |
| `log-prompt.sh`: calcular e armazenar `section_turn`       | ✅ concluído |
| `session-start.sh`: section "início" com `local_turn = 0`  | ✅ concluído |
| Criar `on-git-push.sh` (gitPush, push_count, flag)         | ✅ concluído |
| Criar `continue-section.sh` (limpa flag)                   | ✅ concluído |
| Atualizar `install-git-hooks.sh` para post-push            | ✅ concluído |
| `agent-stop.sh`: exibe `TURN: section_turn/global`         | ✅ concluído |
| Atualizar docs de protocolo + Template G                   | ✅ concluído |
| smoke-test: 99/99 PASS                                     | ✅ concluído |

### 🔄 Fase 5 — Planejamento (ver Seções 11–14)

Foco: resgate de contexto estruturado, sumários por seção, protocolo pós-seção, integração de
subagentes para geração de contexto.

---

## 11. Quando `agentStop` / `Stop` É Acionado — Especificação Completa

### 11.1 Nomenclatura oficial (documentação VS Code — 2026-03-10)

| Contexto                         | Nome usado                                                        |
| -------------------------------- | ----------------------------------------------------------------- |
| VS Code hooks docs (PascalCase)  | **`Stop`**                                                        |
| Copilot CLI / Claude Code format | **`agentStop`** (lowerCamelCase)                                  |
| Nosso `copilot-hooks.json`       | `agentStop` → convertido para `Stop` pelo VS Code automaticamente |

> **Fonte verificada**:
> [code.visualstudio.com/docs/copilot/customization/hooks](https://code.visualstudio.com/docs/copilot/customization/hooks)
> — FAQ: "VS Code converts lowerCamelCase hook event names (like `preToolUse`) to the PascalCase
> format used by VS Code."

A documentação oficial diz "Stop | Agent session ends" — mas esta descrição é **enganosa**. A
interpretação correta, confirmada pelo comportamento de `stop_hook_active` e pela menção a
"additional turns":

> "When a Stop hook blocks the agent from stopping, the agent continues running and the **additional
> turns** consume premium requests."

**Conclusão**: `Stop/agentStop` dispara ao final de **cada resposta completa do agente** (fim de
TURN), não apenas quando o chat é fechado. O termo "session ends" refere-se ao encerramento do ciclo
de resposta (não da conversa inteira).

### 11.2 Quando dispara

```
userPromptSubmitted → [ferramentas 0..N] → Stop/agentStop
                                                    ↑
                            Exatamente 1x por TURN, independente
                            do número de ferramentas usadas
```

**Não** dispara a cada ferramenta (isso é `PreToolUse` / `PostToolUse`). **Não** dispara durante
compactação (isso é `PreCompact`).

### 11.3 Flag `stop_hook_active`

Quando `agent-stop.sh` emite `decision: "block"`, o VS Code bloqueia o encerramento e força outro
ciclo. Na próxima execução do Stop:

- `stop_hook_active = true` no payload
- `agent-stop.sh` NÃO bloqueia quando `stop_hook_active = true` (anti-recursão)
- `block_count >= 1` também impede novo bloqueio (safety valve: máximo 1 retry)

### 11.4 ⚠️ Formato de saída — Divergência com documentação oficial

**Formato oficial VS Code**:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Motivo curto para o agente"
  }
}
```

**Nosso `agent-stop.sh` usa formato legado (Claude Code)**:

```json
{ "decision": "block", "systemMessage": "MENSAGEM LONGA" }
```

VS Code suporta o formato Claude Code por compatibilidade, e os smoke tests passam. Porém, para
conformidade futura, **Fase 5.1** deve atualizar para o formato híbrido:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Resumo curto para o agente"
  },
  "systemMessage": "Mensagem detalhada visível ao usuário"
}
```

### 11.5 ⭐ Oportunidade: SessionStart.additionalContext

A documentação oficial revela que `SessionStart` suporta injeção de contexto direta no LLM:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Última sessão: seção 'implementação' — commit 0900bcfa — 3 tarefas abertas"
  }
}
```

**Estado atual**: `session-start.sh` gera `session-briefing.md` e AGUARDA o agente lê-lo
manualmente.

**Proposta (Fase 5.3)**: `session-start.sh` emite `additionalContext` com resumo do briefing,
injetando-o automaticamente no contexto do LLM a cada nova sessão. O agente recebe o contexto sem
precisar ser instruído a ler o arquivo.

Isso endereça **Gap G2** (narrativa ausente entre sessões) diretamente.

### 11.6 PreCompact — Limitações confirmadas

> "The PreCompact hook uses the **common output format only**."

O formato comum não suporta `additionalContext`. Portanto:

- `preCompact` **não pode injetar** narrativa no contexto pós-compactação
- Solução: continuar criando checkpoint antes de compactar (já feito) + incluir checkpoint no
  `additionalContext` do `SessionStart` na próxima sessão

### 11.7 Sequência completa de um TURN (atualizada)

```
1. Usuário envia prompt
   → UserPromptSubmit → log-prompt.sh
      → reseta current_turn.*
      → incrementa current_section.local_turn
      → calcula section_turn = local_turn

2. Agente processa (0..N tool calls)
   → PreToolUse → pre-tool-use.sh   (a cada tool call)
   → PostToolUse → post-tool-use.sh (a cada tool call)
   → postToolUseFailure → tool-use-failure.sh (em falhas)

3. Agente termina de responder
   → Stop/agentStop → agent-stop.sh
      → calcula TURN_DURATION_S
      → verifica vscode_askQuestions (3 estratégias de detecção)
      → SE não foi chamado: hookSpecificOutput.decision="block" (max 1 retry)
      → SE foi chamado: registra turnEnd_authorized
      → incrementa session_stats.turn_count
      → reseta current_turn.* para o próximo turno
      → checkpoint (session-checkpoint.sh)
      → atualiza live summaries (section-current-summary.md, session-summary.md) [FASE 5]
      → sync de tarefas a cada 5 turnos
      → invariante: auto-cria seção "retomada" se section=null
```

### 11.8 Implicações para o agente

| Situação                            | O que o agente deve fazer                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| ANTES de encerrar qualquer resposta | Chamar `vscode_askQuestions` (Template A/B/C/D/E/F/G)                         |
| Após git push                       | Chamar `start-section.sh` OU `continue-section.sh` antes de encerrar          |
| Ao mudar de seção                   | Executar Protocolo Pós-Seção (ver Seção 13.3)                                 |
| Após compactação detectada          | Continuar — SessionStart.additionalContext garante contexto na próxima sessão |

---

## 12. Matriz de Resgate de Contexto (Estado Atual — v2.0)

### 12.1 O problema fundamental

O LLM perde toda a memória de curto prazo entre respostas (a janela de contexto contém o histórico
de conversa, mas pode ser truncada por compactação ou entre sessões). Os hooks fornecem memória
**fora da banda** via arquivos persistentes.

### 12.2 O que persiste em cada fronteira

| Fronteira             | O que PERSISTE                                         | O que É PERDIDO se a janela for compactada / nova session iniciar |
| --------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| **TURN → TURN**       | `session-context.json` (métricas agregadas)            | Saída de ferramentas dos turnos anteriores (memória LLM)          |
| (mesma section,       | `audit.jsonl` (log completo de eventos)                | Contexto de raciocínio ("por que fiz X")                          |
| mesma session)        | `pending-tasks.md` (tarefas abertas/fechadas)          | Intenção de turno (exceto se `start-turn.sh` foi chamado)         |
|                       | Arquivos editados no workspace                         | —                                                                 |
| **SECTION → SECTION** | Tudo do TURN→TURN +                                    | Contexto específico da seção anterior (o quê/por quê)             |
| (mesma session)       | `sectionEnd` / `sectionStart` logados em `audit.jsonl` | Raciocínio que levou à mudança de seção                           |
|                       | Schema v5: `current_section.*` atualizado              | **❌ Nenhum sumário semântico da seção encerrada**                |
| **SESSION → SESSION** | `session-briefing.md` (gerado em sessionStart)         | Toda a janela de contexto da sessão anterior                      |
| (nova ativação)       | `checkpoints/sess_*_latest.json` (último checkpoint)   | Raciocínio em progresso ("estava no meio de X")                   |
|                       | `pending-tasks.md` (persistido entre sessões)          | **❌ Narrativa: "o que estava acontecendo e por quê"**            |
|                       | `findings.jsonl` (findings acumulados)                 | —                                                                 |

### 12.3 Gaps críticos identificados

| Gap                                                                             | Impacto                                                              | Fronteira afetada |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------- |
| **G1**: Nenhum sumário semântico de seção                                       | Agente perde contexto ao mudar de seção dentro da mesma sessão       | SECTION→SECTION   |
| **G2**: `session-briefing.md` é template (dados estruturados), não narrativa    | Novo sessão recebe métricas mas não "o que estava sendo feito"       | SESSION→SESSION   |
| **G3**: Nenhum mecanismo de injeção de contexto entre TURNs (intra-seção)       | Agente precisa re-ler arquivos a cada turno para "lembrar" o que fez | TURN→TURN         |
| **G4**: `preCompact` só salva checkpoint — não gera sumário do que será perdido | Após compactação, agente não tem resumo do contexto truncado         | Compactação       |
| **G5**: `subagent-stop.sh` não captura resultado semântico do subagente         | Resultado de subagentes não é reutilizável em turnos futuros         | TURN interno      |

---

## 13. Propostas — Fase 5

### 13.1 Sumário de Seção (`generate-section-summary.sh`)

**Proposta**: criar script análogo a `generate-session-summary.sh`, chamado automaticamente por
`start-section.sh` ao fechar a seção anterior.

**Saída**: `.github/hooks/state/section-summaries/section-{N}-{nome}.md`

**Conteúdo mínimo** (gerado em shell, sem LLM):

```
## Seção: "implementação" (#2) — duração 1823s — 5 turnos
- Ferramentas: replace_string_in_file(12), run_in_terminal(8), read_file(6)
- Tarefas concluídas: 2 de alta prioridade
- Findings gerados: 0
- Commits/pushes: 1 (commit 0900bcfa)
- Veredicto: section encerrada normalmente (vscode_askQuestions chamado em 5/5 turnos)
```

**Variante com LLM (subagente)**: O agente pode, ao chamar `start-section.sh`, TAMBÉM chamar um
subagente para gerar um parágrafo narrativo do que foi feito. Este parágrafo é anexado ao
`section-summaries/section-N.md`. (Ver 13.2)

### 13.2 Arquitetura de Subagentes para Sumários

**Restrição fundamental**: Hooks bash não podem invocar agentes. Sumários ricos (LLM) só podem ser
gerados pelo **agente principal** via `runSubagent`.

**Duas abordagens:**

**Abordagem A — Inline (agente principal)**

```
Ao executar start-section.sh "nova-fase":
  1. [bash] start-section.sh fecha seção anterior e loga sectionEnd
  2. [agente] Chama runSubagent("Summarize section", prompt=contexto da seção)
  3. [agente] Escreve resultado em section-summaries/section-N-nome.md
  4. [bash] start-section.sh abre nova seção
```

Prós: simples, resultado imediato, narrativo rico Contras: adiciona custo de subagente ao turno de
mudança de seção; bloqueia o turno

**Abordagem B — Protocolo explícito (agente principal, turno dedicado)**

```
Ao mudar de seção:
  TURN de transição:
    1. Agente chama runSubagent("Section summary: X")
    2. Agente escreve section-summaries/
    3. Agente chama start-section.sh "nova-fase"
    4. Agente chama vscode_askQuestions (Template B — decisão de prosseguir)
```

Prós: turno explícito de transição; usuário vê o sumário antes de prosseguir Contras: adiciona um
turno extra a cada mudança de seção; mais cerimônia

**Abordagem C — Shell template + opt-in LLM (recomendada)**

```
start-section.sh sempre gera shell-template sumário (rápido, zero custo)
O agente, SE a seção foi longa (>3 turnos OU >N commits), PODE chamar
runSubagent para enriquecer o sumário (opcional, por decisão do agente).
```

Prós: sempre tem sumário mínimo; LLM só quando vale a pena; sem custo fixo

### 13.3 Protocolo Pós-Seção (Fase 5)

Ao chamar `start-section.sh "nova-fase"`, o agente deve executar o seguinte protocolo **antes** de
iniciar trabalho na nova seção:

```
PROTOCOLO PÓS-SEÇÃO (quando start-section.sh é chamado):

Obrigatório (sempre):
  [1] start-section.sh já faz: fecha seção anterior, loga sectionEnd, checkpoint
  [2] Agente lê .github/hooks/state/section-summaries/ (seção que acabou de fechar)
  [3] Agente declara start-turn.sh com intenção da nova seção

Condicional (quando seção anterior foi >3 turnos):
  [4] Gerar section summary com runSubagent (ou shell-template)
  [5] Anotar em pending-tasks.md se há tarefas abertas da seção anterior

Pré-requisito para nova seção (quando há mudança de domínio de trabalho):
  [6] Verificar quality gates relevantes (npm run lint, typecheck, etc.)
  [7] Confirmar estado limpo do git (nada pendente não-intencional)
```

**O que start-section.sh já faz automaticamente (não precisa o agente fazer):**

- Fecha a seção anterior (sectionEnd logado)
- Cria checkpoint (session-checkpoint.sh)
- Atualiza `session_stats.section_*`
- Exibe duração da seção no terminal

**O que o agente precisa fazer manualmente:**

- `start-turn.sh "intenção"` como primeiro ato da nova seção
- Sumário da seção anterior (opcional; via subagente ou shell script)
- Verificar `pending_section_after_push` flag (se veio de um push)

### 13.4 Injeção de Contexto no `session-briefing.md` (Fase 5)

**Proposta**: `session-start.sh` deve incluir as últimas N seções resumidas no
`session-briefing.md`.

Hoje o briefing mostra:

- Contagem de tarefas, findings, saúde do sistema, trends históricos, continuidade da sessão
  anterior

Proposta de adição:

```markdown
## Seções da última sessão

| Seção                    | Duração | Turnos | Resultado              |
| ------------------------ | ------- | ------ | ---------------------- |
| "implementação" (#3)     | 1823s   | 5      | ✅ fechada normalmente |
| "revisão-subagente" (#2) | 342s    | 2      | ✅ fechada normalmente |
| "início" (#1)            | 120s    | 1      | ✅ automática          |

→ Seção mais recente: "implementação" — última tarefa: "corrigir agent-stop.sh"
```

Fonte: `checkpoints/sess_*_latest.json` já armazena `current_section`. O campo `section_names` em
`session_stats` lista todas as seções da sessão anterior. Para adicionar duração/turnos por seção,
seria necessário enriquecer o checkpoint (ver Fase 5 schema).

### 13.5 Schema v6 — Proposta de Campos para Fase 5

```jsonc
// Adições ao session-context.json para suportar resgate de contexto rico

{
  "session_stats": {
    "section_history": [
      // NOVO — uma entrada por seção fechada
      {
        "name": "implementação",
        "number": 2,
        "turns": 5,
        "duration_s": 1823,
        "commits": 1,
        "tasks_done": 2,
        "summary_file": "section-summaries/section-2-implementacao.md",
        "closed_at": "ISO8601",
      },
    ],
  },
}
```

---

## 14. Questões Abertas (para decisão do usuário)

As questões abaixo precisam de resposta antes da implementação da Fase 5.

### Q1: Onde devem morar os sumários de seção?

| Opção | Local                                                | Git-tracked?    | Visível?   |
| ----- | ---------------------------------------------------- | --------------- | ---------- |
| A     | `.github/hooks/state/section-summaries/`             | Não (gitignore) | Só local   |
| B     | `DOCUMENTAÇÃO/RELATORIOS/sessoes/`                   | Sim             | Permanente |
| C     | `.github/hooks/checkpoints/` (junto aos checkpoints) | Não             | Só local   |

### Q2: Sumários de seção — shell template OU subagente OU ambos?

- **Shell template apenas**: zero custo, rápido, estruturado mas não narrativo
- **Subagente obrigatório**: rico mas adiciona custo e latência em toda mudança de seção
- **Shell template + subagente opt-in**: agente decide quando vale chamar o subagente (por ex.
  `seção longa > 3 turnos`)

### Q3: Protocolo pós-seção — grau de cerimônia?

- **Minimal**: apenas `start-turn.sh` + leitura do sumário da seção anterior (quando existir)
- **Padrão**: checklist de 3–4 passos definido e reforçado por `agent-stop.sh`
- **Amplo**: turno dedicado de transição (como Abordagem B da Seção 13.2)

### Q4: `preCompact` — gerar sumário LLM antes de compactar?

Antes da compactação do contexto, o sistema poderia pedir ao agente para gerar um parágrafo sobre "o
que estava fazendo" — este parágrafo seria injetado no novo contexto pós-compactação. Contudo, isso
exigiria output do `preCompact` hook (hoje ignorado pelo Copilot). Isso é viável no frame atual?

### Q5: `pending-tasks.md` — escopo de seção ou escopo de sessão?

Hoje `pending-tasks.md` é único e global (escopo de sessão). Seria útil ter subtarefas ligadas a
seções (para que o sumário da seção saiba quais tarefas foram abertas/fechadas nela)?

---

## 15. Invariantes do Sistema (atualizado — v2.0)

1. **SESSION ∃ SECTION ∃ TURN**: Sempre devem estar ativos simultaneamente.
2. **section_turn ≥ 1**: Nunca 0 nem negativo quando em TURN ativo.
3. **turn_count monotônico**: Nunca decrementa na SESSION.
4. **Novo SECTION → section_turn reseta para 1**: Via `local_turn = 0` em `start-section.sh`.
5. **Push logado**: Todo `git push` bem-sucedido gera evento `gitPush` em `audit.jsonl`.
6. **Push → decisão obrigatória**: O agente não pode encerrar TURN sem tratar
   `pending_section_after_push`.
7. **agentStop dispara 1x por TURN**: Exatamente após o agente terminar cada resposta.
8. **stop_hook_active previne recursão**: Quando `true`, `agent-stop.sh` não emite decision:block.
9. **block_count safety valve**: Máximo 1 retry por turno (evita looping infinito de bloqueios).

---

## 16. Mapa de Scripts — v2.0 (Fase 4 completa + Fase 5 projetada)

| Script                        | Propósito                                                          | Modifica `session-context.json`? | Fase  |
| ----------------------------- | ------------------------------------------------------------------ | -------------------------------- | ----- |
| `session-start.sh`            | Inicia SESSION + section "início"; gera `session-briefing.md`      | Sim (cria)                       | 1-4   |
| `session-end.sh`              | Encerra SESSION (requer close_key); gera relatório                 | Sim (ended_at)                   | 1-4   |
| `start-section.sh`            | Cria nova SECTION; local_turn=0; fecha anterior                    | Sim                              | 1-4   |
| `section-end.sh`              | Fecha SECTION explicitamente                                       | Sim                              | 1-4   |
| `start-turn.sh`               | Declara intenção de TURN (logging)                                 | Sim (intent_declared)            | 1-4   |
| `log-prompt.sh`               | Inicia TURN (userPromptSubmitted); calcula section_turn            | Sim (current_turn.\*)            | 1-4   |
| `agent-stop.sh`               | Encerra TURN; enforcement vscode_askQuestions; auto-section; sync  | Sim (turn_count+=1)              | 1-4   |
| `on-git-push.sh`              | Processa git push: push_count, flag                                | Sim (push_count, flag)           | 4     |
| `continue-section.sh`         | Confirma continuação após push (limpa flag)                        | Sim (limpa flag)                 | 4     |
| `session-checkpoint.sh`       | Snapshot incremental (chamado a cada turn e antes de compact)      | Não (cria checkpoint)            | 2-4   |
| `pre-compact.sh`              | Checkpoint antes de compactação; loga evento                       | Sim (compaction_count)           | 2-4   |
| `generate-session-summary.sh` | Relatório Markdown da sessão (chamado por session-end.sh)          | Não (stdout)                     | 2-4   |
| `generate-section-summary.sh` | **PROPOSTO** — Sumário por seção (chamado por start-section.sh)    | Não (cria section-summaries/)    | **5** |
| `subagent-start.sh`           | Tracking de início de subagente                                    | Sim (subagent_calls)             | 2-4   |
| `subagent-stop.sh`            | Tracking de fim de subagente                                       | Sim (subagent_calls)             | 2-4   |
| `install-git-hooks.sh`        | Instala hooks git (pre-commit, commit-msg, post-push)              | Não                              | 1-4   |
| `session-watchdog.sh`         | Detecta sessões estagnadas e context corrompido (chamado no start) | Não (gera watchdog-report.json)  | 2-4   |
| `sync-tasks-to-docs.sh`       | Sincroniza pending-tasks.md para DOCUMENTAÇÃO/ (a cada 5 turnos)   | Não                              | 3-4   |

---

## Referências cruzadas

- `DOCUMENTAÇÃO/HOOKS/PROTOCOLO-AUTORIZACAO.md` — protocolo de autorização
- `DOCUMENTAÇÃO/HOOKS/REFERENCIA-HOOKS.md` — referência dos hooks
- `.github/AGENTS.md` — Templates A–G, protocolo completo
- `.github/instructions/hooks-protocol.instructions.md` — sempre carregado pelo Copilot
- `.github/hooks/state/session-briefing.md` — briefing gerado em cada sessionStart
