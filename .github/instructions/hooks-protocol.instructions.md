---
name: 'Hooks Protocol'
description: 'Protocolo operacional obrigatório do sistema de hooks do Copilot'
applyTo: '**/*'
---

# Hooks Protocol — Protocolo Operacional Obrigatório

**Propósito**: regras de operação do sistema de hooks para agentes de IA. **Status**: Canônico.
**Última atualização**: 2026-03-10.

> Todo agente executando em sessão Copilot neste repositório DEVE seguir este protocolo.

---

## ⛔ REGRA ABSOLUTA — Encerrar sem autorização é PROIBIDO

**Antes de encerrar qualquer turno**, o agente DEVE:

1. Invocar a **ferramenta** `vscode_askQuestions` (tool call real, não texto)
2. Aguardar resposta do usuário

**Texto plano NÃO conta como autorização.** O hook `agent-stop.sh` detecta violações automaticamente
e bloqueia o encerramento com `{"decision":"block","systemMessage":"..."}` contendo o estado atual.

---

## Ciclo de vida: SESSION → SECTION → TURN

**Invariante absoluto**: sempre deve haver SESSION + SECTION + TURN ativos simultaneamente.

### SESSION

- Criada pelo hook `sessionStart` (`session-start.sh`) — automático
- Encerrada pelo hook `sessionEnd` (`session-end.sh`) — automático
- Exige `vscode_askQuestions` Template F + close_key antes de encerrar

### SECTION (fase lógica nomeada)

- Aberta automaticamente: seção `"início"` criada em toda nova sessão
- **Mudar de fase = abrir nova seção**: `bash .github/hooks/scripts/start-section.sh "nome"`
- Fecha automaticamente a anterior antes de abrir a nova
- Se `current_section == null`, `agent-stop.sh` auto-cria seção `"retomada"` (invariante)
- Exemplos de quando criar: análise → implementação → revisão → debug

### TURN (ciclo prompt→resposta)

- Início automático: `userPromptSubmitted` → `log-prompt.sh` loga `turnStart`
- **Declarar intenção** como PRIMEIRO ato: `bash .github/hooks/scripts/start-turn.sh "intenção"`
- Fim automático: `agentStop` → `agent-stop.sh` gera `turnStart_enriched_auto` se intent não
  declarado

---

## Protocolo vscode_askQuestions — Templates obrigatórios

| Quando usar                             | Template                                |
| --------------------------------------- | --------------------------------------- |
| Sessão sem prompt explícito             | **E** — Session Kickoff                 |
| Tarefa concluída                        | **A** — Next Step                       |
| ≥ 3 bugs encontrados                    | **B** — Bug Discovery                   |
| Proposta de upgrade arquitetural        | **C** — Upgrade Proposal                |
| `turn_count % 3 == 0 && turn_count > 0` | **D** — Checkpoint periódico            |
| Encerramento de sessão                  | **F** — Session Close (exige close_key) |

Templates completos em `.github/AGENTS.md` → seção "Protocolo vscode_askQuestions".

---

## Scripts de controle de fluxo (chamar via terminal)

```bash
# Declara intenção do turno — PRIMEIRO ato de todo turno de trabalho
bash .github/hooks/scripts/start-turn.sh "descrição da intenção"

# Abre nova seção temática (fecha a anterior, se houver)
bash .github/hooks/scripts/start-section.sh "nome" ["descrição opcional"]

# Fecha seção manualmente com motivo
bash .github/hooks/scripts/section-end.sh "motivo"

# Salva checkpoint antes de mudanças críticas
bash .github/hooks/scripts/session-checkpoint.sh

# Verifica saúde do sistema (watchdog)
bash .github/hooks/scripts/watchdog.sh --json

# Adiciona tarefa ao backlog
bash .github/hooks/scripts/add-task.sh alta "Título" "Descrição + gate de aceitação"

# Conclui tarefa
bash .github/hooks/scripts/complete-task.sh "padrão do título"

# Salva finding (bug/gap/melhoria)
bash .github/hooks/scripts/save-finding.sh "módulo" "severity" "type" "descrição"
```

---

## Leitura obrigatória no início de cada sessão

1. `.github/hooks/state/session-briefing.md` — gerado pelo `sessionStart`
2. `.github/hooks/state/pending-tasks.md` — backlog canônico
3. `.github/hooks/state/session-context.json` — estado vivo da sessão

---

## Feedback dinâmico — o que o sistema envia ao agente

| Momento                    | Mecanismo                                   | Conteúdo                                             |
| -------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| Turno sem askQuestions     | `agent-stop.sh` → `decision:block`          | Estado atual (seção, turno, backlog, próxima tarefa) |
| Turno sem intent declarado | `agent-stop.sh` → `turnStart_enriched_auto` | Ferramentas usadas como proxy de intenção            |
| Início de sessão           | `session-start.sh` → alerta no briefing     | Status watchdog, violations anteriores               |
| `current_section == null`  | `agent-stop.sh` → auto-section              | Seção `"retomada"` criada automaticamente            |

---

## Encerramento de SESSION (extra-hardening)

1. Chamar `vscode_askQuestions` com Template F
2. Usuário deve digitar a chave `ENCERRAR-XXXXXXXX` (exibida no `session-briefing.md`)
3. Sem a chave → `SESSION_CLOSE_NO_KEY.flag` → alerta no próximo briefing
