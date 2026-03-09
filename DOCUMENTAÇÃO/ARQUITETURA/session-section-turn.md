# Arquitetura SESSION · SECTION · TURN

**Status**: Canônico · v1.0
**Última atualização**: 2026-03-09
**Propriedade**: `.github/hooks/` — Sistema de Hooks do Agente

---

## 1. Conceitos e Hierarquia

```
SESSION
└── SECTION (1..*)
    └── TURN (1..*)
```

Os três conceitos formam uma hierarquia estrita. Todo trabalho do agente acontece sempre
dentro de um TURN ativo, que pertence a um SECTION ativa, que pertence a uma SESSION ativa.

### 1.1 SESSION

| Campo               | Descrição                                               |
| ------------------- | ------------------------------------------------------- |
| Cardinalidade       | **1 por ativação do Copilot Chat**                      |
| Boundary            | `session-start.sh` → `session-end.sh`                   |
| Persiste em         | `state/session-context.json` · `state/audit.jsonl`      |
| Encerramento válido | Usuário digita chave `ENCERRAR-XXXXXXXX` via Template F |

Uma SESSION nunca deve ser encerrada sem autorização explícita via `vscode_askQuestions` e validação da close_key.

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
    "close_key_validated": false
  },

  "session_stats": {
    "turn_count": 4,         // global, nunca reseta — incrementado pelo agentStop
    "push_count": 1,         // NOVO — número de git pushes na SESSION
    "last_push_at": "ISO8601", // NOVO — timestamp do último push
    "last_push_turn": 3,     // NOVO — turn_count no momento do último push
    "section_count": 2
  },

  "current_turn": {
    "number": 5,             // global (= turn_count + 1)
    "section_turn": 2,       // NOVO — local à section atual (reseta p/ 1 em cada section nova)
    "intent_declared": true,
    "intent": "Implementar feature X"
  },

  "current_section": {
    "name": "implementação",
    "section_number": 2,
    "turn_start": 4,         // global: qual turn_count quando esta section começou
    "local_turn": 1          // NOVO — contador interno; reseta a 0 em start-section, incrementa em log-prompt
  }
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

Quando o agente faz `git push`, o trabalho de uma fase lógica está concluído. Porém, o
push acontece **dentro** de um TURN ativo (não é um boundary natural). O agente continua
respondendo após o push.

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
1. Inclui no `systemMessage` do bloco de enforcement: **"Git push detectado — declare nova section ou confirme continuação na mesma"**
2. O agente DEVE chamar `start-section.sh "fase"` OU `continue-section.sh` (novo script simples que limpa o flag)
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
6. **Push → decisão obrigatória**: O agente não pode encerrar TURN sem tratar `pending_section_after_push`.

---

## 9. Mapa de Scripts (sessão atual)

| Script                 | Propósito                                                 | Modifica `session-context.json`? |
| ---------------------- | --------------------------------------------------------- | -------------------------------- |
| `session-start.sh`     | Inicia SESSION + section "início"                         | Sim (cria)                       |
| `session-end.sh`       | Encerra SESSION (requer close_key)                        | Sim (ended_at)                   |
| `start-section.sh`     | Cria nova SECTION (reseta local_turn=0)                   | Sim                              |
| `section-end.sh`       | Fecha SECTION explicitamente                              | Sim                              |
| `start-turn.sh`        | Declara intenção de TURN (logging)                        | Sim (intent_declared)            |
| `log-prompt.sh`        | Inicia TURN (userPromptSubmitted)                         | Sim (current_turn.*)             |
| `agent-stop.sh`        | Encerra TURN; enforcement; auto-section                   | Sim (turn_count+=1)              |
| `on-git-push.sh`       | Processa git push (**novo**)                              | Sim (push_count, flag)           |
| `continue-section.sh`  | Confirma continuação após push (**novo**)                 | Sim (limpa flag)                 |
| `install-git-hooks.sh` | Instala hooks git (pre-commit, commit-msg, **post-push**) | Não                              |

---

## 10. Plano de Implementação

### Fase 4.1 — Schema e contadores locais

1. `start-section.sh`: adicionar `current_section.local_turn = 0` ao criar nova section
2. `log-prompt.sh`: calcular `section_turn = local_turn + 1`; escrever `current_section.local_turn`
3. `session-start.sh`: garantir que section "início" também define `local_turn = 0`

### Fase 4.2 — Git post-push

4. Criar `on-git-push.sh` (loga gitPush, incrementa push_count, define flag)
5. Criar `continue-section.sh` (limpa flag, loga evento)
6. Atualizar `install-git-hooks.sh` para instalar `post-push` hook
7. Atualizar `agent-stop.sh` para ler e exibir `pending_section_after_push`

### Fase 4.3 — Display e feedback

8. Atualizar `agent-stop.sh` systemMessage para exibir `TURN: section_turn/global`
9. Atualizar `hooks-protocol.instructions.md` com nova semântica
10. Cobertura de smoke-test para novos invariantes

---

## Referências cruzadas

- `DOCUMENTAÇÃO/HOOKS/PROTOCOLO-AUTORIZACAO.md` — protocolo de autorização
- `DOCUMENTAÇÃO/HOOKS/REFERENCIA-HOOKS.md` — referência dos 18+ hooks
- `.github/AGENTS.md` — Templates A–F, protocolo completo
- `.github/instructions/hooks-protocol.instructions.md` — sempre carregado pelo Copilot
