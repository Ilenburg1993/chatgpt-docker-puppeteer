---
name: 'Hooks Protocol'
description: 'Protocolo operacional obrigatório do sistema de hooks do Copilot'
applyTo: '**/*'
---

# Hooks Protocol — Protocolo Operacional Obrigatório

**Propósito**: regras de operação do sistema de hooks para agentes de IA. **Status**: Canônico.
**Última atualização**: 2026-03-11 (v9.0 — Protocolo TODO Obrigatório).

> Todo agente executando em sessão Copilot neste repositório DEVE seguir este protocolo.

## Hierarquia canônica (anti-conflito)

Quando houver divergência textual entre arquivos de instrução, use esta precedência:

1. Hooks executáveis (`.github/hooks/scripts/*`, `.github/hooks/hooks-lib/*`)
2. Este protocolo (`.github/instructions/hooks-protocol.instructions.md`)
3. Baseline técnico (`.github/instructions/project-canon.instructions.md`)
4. Templates operacionais (`.github/AGENTS.md`)
5. Contexto complementar (`.github/copilot-instructions.md`)

> Política de governança: evitar duplicação de regras longas fora deste protocolo. Outros arquivos
> devem apontar para esta fonte em vez de reescrever as mesmas regras.

---

## ╔═══ PROTOCOLO TODO OBRIGATÓRIO (v9.0) — LEIA PRIMEIRO ═══╗

> **Todo turno de trabalho significativo DEVE seguir este protocolo, sem exceção.**

### Regras do Protocolo TODO (v9.0)

1. **Criar TODOs no início** — ao iniciar qualquer turno de trabalho, use `manage_todo_list` para
   criar a lista de tarefas. Não comece a trabalhar sem TODOs. Busque ter no mínimo 10 TODOs no
   backlog para manter o ciclo de trabalho fluindo.
2. **Último TODO = vscode_askQuestions** — o último item da lista DEVE ser:
   `"Chamar vscode_askQuestions [Template de CONTINUAÇÃO: A/D/E; Template F apenas por escalonamento explícito para fechamento de SESSION]"`
3. **Marcar e executar** — ao concluir cada tarefa, marque como `completed`. O último TODO
   (vscode_askQuestions) DEVE ser executado — não pulado.
4. **Não é opcional** — este é o único mecanismo confiável que garante comunicação com o usuário.
   Encerrar um turno sem chamar vscode_askQuestions viola o protocolo.
5. **Checklist de último ato (obrigatório)** — antes de encerrar resposta, confirmar: (a) o último
   TODO foi executado, (b) a chamada final foi `vscode_askQuestions`, (c) não haverá outra ação de
   trabalho após essa chamada.
6. **Se executar ferramenta após askQuestions final** — a autorização do TURN deve ser considerada
   invalidada; chame `vscode_askQuestions` novamente ao fim.
7. **Refresh imediato de TODO após askQuestions (obrigatório)** — após qualquer chamada de
   `vscode_askQuestions`, o próximo passo de ferramenta deve ser `manage_todo_list` para atualizar
   imediatamente o checklist (marcando execução do item e estado do turno).
8. **Exceção única de bookkeeping** — após esse `manage_todo_list` imediato, qualquer ferramenta de
   trabalho (não-bookkeeping) exige novo `vscode_askQuestions` ao fim do ciclo.
9. **Template F + KEY correta apenas no fechamento de SESSION/TURN** — Templates de continuidade
   (A/D/E) servem para seguir o trabalho e **não autorizam fechamento de TURN**. O fechamento
   autorizado exige Template F com escalonamento explícito para encerramento de SESSION e validação
   da `close_key`.
10. É terminantemente proibido tentar encerrar um turno de trabalho sem seguir este protocolo, seja
    pulando a chamada de `vscode_askQuestions`, seja utilizando o template errado, seja não
    validando a KEY correta que deve ser inserida pelo usuário. O sistema de hooks é projetado para
    bloquear essas violações, mas o agente deve seguir o protocolo por iniciativa própria.

> **Por que isso é crítico?** O hook `agent-stop.sh` emite `decision:block` quando
> `vscode_askQuestions` não foi chamado. Mas mesmo sem o block ser efetivo, o padrão de
> comportamento do agente deve incluir a chamada de vscode_askQuestions como ato final.

---

## ╔═══ SESSION PERSISTENTE — PRINCÍPIO FUNDAMENTAL (v8.0) ═══╗

> **O encerramento de uma SESSION, se o sistema estiver funcionando corretamente, deve ser um evento
> EXTREMAMENTE RARO.**

**REGRA ABSOLUTA — NUNCA VIOLAR:**

- O agente **NUNCA** deve chamar `session-close.sh` diretamente via `run_in_terminal`.
- Nem mesmo com a KEY correta. O `pre-tool-use.sh` (v8.0) **NEGA** essa chamada quando
  `close_key_validated=false`.
- O único fluxo legítimo: `vscode_askQuestions` Template F → usuário digita KEY → `post-tool-use.sh`
  executa `session-close.sh` automaticamente.

**SESSION end = EVENTO EXTREMAMENTE RARO. Toda SESSION deve ser mantida viva o máximo possível,
assim como os turns; por default, NUNCA encerre uma session ou turn .** O agente deve buscar
resolver tudo dentro da mesma sessão, utilizando seções e turns para organizar o trabalho, e sempre
atualizando os TODOS, mas mantendo a continuidade. O encerramento de sessão ou TURN só deve ocorrer
quando absolutamente necessário, e sempre seguindo o protocolo correto.

---

## ╔═══ DISTINÇÃO CRÍTICA — LEIA ANTES DE QUALQUER COISA ═══╗

```
SESSION  ≠  SECTION  ≠  TURN
```

| Conceito | O que é                 | Como encerra                                      | Autorização Required   |
| -------- | ----------------------- | ------------------------------------------------- | ---------------------- |
| **TURN** | 1 ciclo prompt→resposta | Com chamada a vscode_askQuestions como último ato | ✅ Protocolo TODO v9.0 |

> ⚠️ **IMPORTANTE**: `userPromptSubmitted` dispara SOMENTE ao digitar na **caixa de chat** do VS
> Code. Respostas ao `vscode_askQuestions` são **tool results** (postToolUse), NÃO novos prompts. Em
> sessões onde o usuário usa apenas `vscode_askQuestions`, este hook dispara raramente
> (≲1x/SESSION). Use `preToolUse` para reminders confiáveis (dispara antes de cada tool call). |
> **SECTION** | Fase lógica dentro da SESSION | `bash start-section.sh "nome"` | ❌ Nenhuma | |
> **SESSION** | 1 ativação do Copilot Chat | Template F + KEY + session-close.sh | ✅
> **OBRIGATÓRIA** |

> ⚠️ **REGRA DE OURO**: Terminar de escrever uma resposta = encerrar um **TURN**, NÃO a **SESSION**.
> A SESSION continua ativa enquanto a janela do chat estiver aberta. A SESSION só encerra quando:
> (1) usuário digita a chave `ENCERRAR-XXXXXXXX`, (2) `post-tool-use.sh` detecta KEY em
> `vscode_askQuestions` e chama `session-close.sh`.

### Fluxo de Encerramento de SESSION (3 etapas obrigatórias):

1. Agente chama `vscode_askQuestions` com **Template F** (exibindo a close_key)
2. Usuário digita a chave `ENCERRAR-XXXXXXXX` no campo livre
3. **`post-tool-use.sh` detecta a KEY automaticamente e executa `session-close.sh`** (agente não
   chama diretamente)

> **Sem estas 3 etapas** → `SESSION_CLOSE_NO_KEY.flag` → alerta no próximo briefing.

> **Verificação automática via hooks:** o hook `postToolUse` detecta automaticamente a `close_key`
> na resposta de `vscode_askQuestions` e registra `sessionClose_key_validated` no `audit.jsonl`.
> Isso confirma que a KEY foi enviada via tool call legítimo, não por texto plano. Texto plano **não
> conta** — apenas tool call real é registrado.

### Lembrete rápido (chamar a qualquer momento):

```bash
bash .github/hooks/scripts/session-reminder.sh
```

---

## Protocolo de encerramento por nível

### TURN — Protocolo TODO obrigatório (v9.0)

**TURNs com trabalho realizado DEVEM incluir chamada a `vscode_askQuestions` ao final.** O agente
NÃO deve encerrar um turno de trabalho sem chamar vscode_askQuestions.

**Protocolo TODO obrigatório em todo turno:**

1. Use `manage_todo_list` ao iniciar o turno — lista de tarefas é obrigatória
2. Inclua sempre como ÚLTIMO TODO: `"Chamar vscode_askQuestions [Template X]"`
3. Execute todos os TODOs em sequência — o último (vscode_askQuestions) não pode ser pulado

**Templates obrigatórios por contexto:**

- Tarefa concluída → Template A (próximo passo de conversa; não autoriza fechamento de TURN)
- Checkpoint periódico a cada ~15 TURNs → Template D
- Proposta arquitetural → Template C
- Sessão ociosa → Template E

**Regra de fechamento em modo estrito (não ambígua):**

- Em `session.strict_turn_close_requires_key=true`, o TURN continua exigindo `vscode_askQuestions`
  válido como último ato, com resposta explícita do usuário.
- Templates A/D/E são o fluxo padrão de continuidade/fechamento de TURN.
- Template F só deve ser usado quando houver escalonamento explícito para fechamento de SESSION; com
  Template F, a `close_key` correta permanece obrigatória.

**Mecanismo de enforcement (v7.0+):** O hook `agent-stop.sh` emite `decision:block` quando
`vscode_askQuestions` não foi chamado. O consecutive_unauthorized é incrementado a cada violação.
Violações são logadas como `agentStop_blocked` e `turnEnd_no_askQuestions` em `audit.jsonl`.

### SECTION — Autônoma (sem autorização do usuário)

O agente abre e fecha seções temáticas **autonomamente**, com base no contexto semântico do
trabalho. Não é necessário pedir autorização ao usuário — a decisão de mudar de fase
(`start-section.sh "nome"`) é tomada pelo próprio agente quando o escopo muda.

### SESSION — Autorização explícita obrigatória (chave de encerramento)

**Única ação que exige autorização expressa do usuário.** Requer:

1. `vscode_askQuestions` com **Template F** (Session Close)
2. Usuário digita a chave `ENCERRAR-XXXXXXXX` no campo livre do Template F
3. `post-tool-use.sh` detecta a KEY na resposta e executa `session-close.sh` automaticamente (agente
   **não** chama o script diretamente)
4. Sem validação automática da KEY → `SESSION_CLOSE_NO_KEY.flag` → alerta no próximo briefing

> **Por que o script é necessário?** O evento `sessionEnd` da plataforma VS Code Copilot **não
> dispara** quando a sessão termina abruptamente (crash/restart/timeout). O `session-close.sh`
> continua sendo o mecanismo confiável, mas sua execução deve ocorrer no fluxo automático de hooks
> após validação da KEY no `post-tool-use.sh`.

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

> **Semântica real**: `userPromptSubmitted` dispara apenas quando o usuário digita na **caixa de
> chat** do VS Code — não para respostas ao `vscode_askQuestions`. Em sessões onde o fluxo principal
> é via `vscode_askQuestions`, este hook dispara ≲1x por SESSION. As respostas ao askQuestions são
> registradas como `askQuestions_response` no `audit.jsonl` pelo `post-tool-use.sh`.

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

| Quando usar                             | Template                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------- |
| Sessão sem prompt explícito             | **E** — Session Kickoff                                                    |
| Tarefa concluída                        | **A** — Next Step (continuidade; não fecha TURN)                           |
| ≥ 3 bugs encontrados                    | **B** — Bug Discovery                                                      |
| Proposta de upgrade arquitetural        | **C** — Upgrade Proposal                                                   |
| `turn_count % 3 == 0 && turn_count > 0` | **D** — Checkpoint periódico                                               |
| Encerramento de sessão                  | **F** — Session Close (exige close_key; também fecha TURN em modo estrito) |
| Antes de commit e/ou push               | **G** — Commit/Push Pre-Authorization                                      |

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
