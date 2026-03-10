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

## Protocolo de encerramento por nível

### TURN — Comunicação recomendada (autônomo)

**TURNs encerram livremente.** O agente não precisa de autorização para encerrar um turno.
`vscode_askQuestions` é **recomendado** como boa prática de comunicação, não obrigatório.

**Casos em que chamar vscode_askQuestions é valioso (recomendado):**

- Tarefa concluída → Template A (próximo passo)
- Checkpoint periódico a cada ~5 TURNs → Template D
- Proposta arquitetural → Template C
- Sessão ociosa → Template E

**Nudge automático (não bloqueante):** O hook `agent-stop.sh` envia `systemMessage` informativo a
cada `HOOKS_TURN_NUDGE_INTERVAL` (padrão: 5) TURNs sem `vscode_askQuestions`. Não há
`decision:block`.

### SECTION — Autônoma (sem autorização do usuário)

O agente abre e fecha seções temáticas **autonomamente**, com base no contexto semântico do
trabalho. Não é necessário pedir autorização ao usuário — a decisão de mudar de fase
(`start-section.sh "nome"`) é tomada pelo próprio agente quando o escopo muda.

### SESSION — Autorização explícita obrigatória (chave de encerramento)

**Única ação que exige autorização expressa do usuário.** Requer:

1. `vscode_askQuestions` com **Template F** (Session Close)
2. Usuário digita a chave `ENCERRAR-XXXXXXXX` no campo livre do Template F
3. Sem a chave → `SESSION_CLOSE_NO_KEY.flag` → alerta no próximo briefing

### Commit e/ou Push — Protocolo obrigatório (Template G)

**Antes de qualquer `git commit` e/ou `git push`**, o agente DEVE invocar `vscode_askQuestions` com
**Template G** (Commit/Push Pre-Authorization), apresentando o estado das mudanças e as opções
disponíveis. O usuário orienta se deve: commitar+pushar agora, revisar com subagente, continuar
melhorando, etc.

---

## Ciclo de vida: SESSION → SECTION → TURN

**Invariante absoluto**: sempre deve haver SESSION + SECTION + TURN ativos simultaneamente.

### SESSION

- Criada pelo hook `sessionStart` (`session-start.sh`) — automático
- Encerrada pelo hook `sessionEnd` (`session-end.sh`) — automático
- Exige `vscode_askQuestions` Template F + close_key antes de encerrar

### SECTION (fase lógica nomeada)

- Aberta automaticamente: seção `"início"` criada em toda nova sessão com `local_turn=0`
- **Mudar de fase = abrir nova seção**: `bash .github/hooks/scripts/start-section.sh "nome"`
- Fecha automaticamente a anterior antes de abrir a nova
- **Resetar o turn local**: toda nova SECTION reseta `local_turn=0` → próximo TURN começa em
  `section_turn=1`
- Se `current_section == null`, `agent-stop.sh` auto-cria seção `"retomada"` (invariante)
- Exemplos de quando criar: análise → implementação → revisão → debug

### TURN (ciclo prompt→resposta)

- Início automático: `userPromptSubmitted` → `log-prompt.sh` loga `turnStart` com `section_turn` e
  `turn_number`
- `current_turn.section_turn` = turno local dentro da SECTION atual (reseta p/ 1 em cada nova
  section)
- `current_turn.number` = turno global na SESSION (nunca reseta)
- Display canônico no systemMessage: `TURN: <section_turn>/<global_turn>` (local/global)
- **Declarar intenção** como PRIMEIRO ato: `bash .github/hooks/scripts/start-turn.sh "intenção"`
- Fim automático: `agentStop` → `agent-stop.sh` gera `turnStart_enriched_auto` se intent não
  declarado

### Git Push — Gatilho de fase (NOVO)

Quando o agente executa `git push` com sucesso:

1. `.git/hooks/post-push` → `on-git-push.sh` loga evento `gitPush` em `audit.jsonl`
2. `session_stats.pending_section_after_push = true` é definido no contexto
3. Em `agent-stop.sh`: se esse flag estiver ativo, o systemMessage exige decisão:
   - **Abrir nova section**: `bash .github/hooks/scripts/start-section.sh "nome-da-fase"`
   - **Continuar na mesma**: `bash .github/hooks/scripts/continue-section.sh "motivo"`
4. Push como entrega → nova SECTION é recomendado semânticamente

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
| Antes de commit e/ou push               | **G** — Commit/Push Pre-Authorization   |

Templates completos em `.github/AGENTS.md` → seção "Protocolo vscode_askQuestions".

---

## Scripts de controle de fluxo (chamar via terminal)

```bash
# Declara intenção do turno — PRIMEIRO ato de todo turno de trabalho
bash .github/hooks/scripts/start-turn.sh "descrição da intenção"

# Abre nova seção temática (fecha a anterior, se houver; reseta section_turn p/ 1)
bash .github/hooks/scripts/start-section.sh "nome" ["descrição opcional"]

# Fecha seção manualmente com motivo
bash .github/hooks/scripts/section-end.sh "motivo"

# Confirma continuação na section atual após git push (limpa flag pending_section_after_push)
bash .github/hooks/scripts/continue-section.sh ["motivo"]

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

| Momento                    | Mecanismo                                   | Conteúdo                                                       |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Turno sem askQuestions     | `agent-stop.sh` → `decision:block`          | Estado atual: seção, TURN local/global, backlog, push pendente |
| Turno sem intent declarado | `agent-stop.sh` → `turnStart_enriched_auto` | Ferramentas usadas como proxy de intenção                      |
| Início de sessão           | `session-start.sh` → alerta no briefing     | Status watchdog, violations anteriores                         |
| `current_section == null`  | `agent-stop.sh` → auto-section              | Seção `"retomada"` criada automaticamente                      |
| `git push` bem-sucedido    | `post-push` → `on-git-push.sh`              | Evento `gitPush` + flag `pending_section_after_push`           |

---

## Encerramento de SESSION (extra-hardening)

1. Chamar `vscode_askQuestions` com Template F
2. Usuário deve digitar a chave `ENCERRAR-XXXXXXXX` (exibida no `session-briefing.md`)
3. Sem a chave → `SESSION_CLOSE_NO_KEY.flag` → alerta no próximo briefing
