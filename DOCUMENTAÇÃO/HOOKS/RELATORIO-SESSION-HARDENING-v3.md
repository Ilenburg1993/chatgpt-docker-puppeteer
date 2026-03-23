# Relatório de Hardening: Encerramento de SESSION sem Autorização

## Análise Forense Completa + Plano de Upgrades Massivos — v3.0

**Data**: 2026-03-10 **Autor**: Análise forense do agente (provocada por 2+ ocorrências confirmadas
de silent session close) **Status**: ATIVO — Implementação em curso **Chave de sessão atual**:
`ENCERRAR-112A46D8`

---

## 0. DISTINÇÃO CONCEITUAL OBRIGATÓRIA

> **Esta seção é a mais importante do documento. O agente LLM DEVE internalizá-la.**

### SESSION ≠ SECTION ≠ TURN

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SESSION (1 por ativação do Copilot Chat)                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  SECTION: "análise" (fase lógica)                                 │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │ TURN 1 (prompt → resposta)                                  │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │ TURN 2 (prompt → resposta)                                  │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  SECTION: "implementação" (nova fase)                             │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │ TURN 3 (prompt → resposta)                                  │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

| Conceito    | O que é                                                                                | Quem controla                    | Como fecha                                                                     | Autorização                   |
| ----------- | -------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| **SESSION** | 1 ativação do Copilot Chat. Tem ID único, close_key, compliance tracking               | Hook `sessionStart`/`sessionEnd` | Template F + usuário digita chave + execução automática via `post-tool-use.sh` | **OBRIGATÓRIA** — sem exceção |
| **SECTION** | Fase lógica de trabalho **dentro** de uma SESSION                                      | Agente via `start-section.sh`    | Automaticamente ao abrir nova seção, ou `section-end.sh`                       | Autônoma                      |
| **TURN**    | Ciclo único prompt→resposta. Começa com `userPromptSubmitted`, termina com `agentStop` | Hook automático                  | Exige `vscode_askQuestions` ao final (ou `decision:block`)                     | Obrigatória (v9.0)            |

### Regra de Ouro do Encerramento

```
TURN encerrado?     → Exige `vscode_askQuestions` (ou `decision:block` impede o fim do turno).
SECTION encerrada?  → LIVRE. Agente decide quando mudar de fase.
SESSION encerrada?  → BLOQUEADA sem: vscode_askQuestions (Template F) + KEY digitada pelo usuário + execução automática em `post-tool-use.sh`
```

**O problema recorrente**: O agente confunde "terminar de responder um TURN" com "encerrar a
SESSION". São coisas completamente diferentes. A SESSION só termina quando o usuário fecha o VS Code
ou a janela do chat — não quando o agente termina de escrever uma resposta.

---

## 1. Histórico de Violações

| Data       | Sessão     | Violação                                         | Diagnóstico                                                |
| ---------- | ---------- | ------------------------------------------------ | ---------------------------------------------------------- |
| 2026-03-09 | `a0be08af` | Silent close sem Template F                      | turn_count=2, `consecutive_unauthorized=0` incorreto       |
| 2026-03-10 | `dcf579af` | Silent close após v5.1                           | `turns_since_askQuestions=2`, `consecutive_unauthorized=2` |
| (esta)     | `dcf579af` | Idem — agente concluiu resposta sem askQuestions | Sistema ainda sem blocking                                 |

**Padrão**: Ocorre no FINAL de CADA TURN onde o agente "terminou" a tarefa e simplesmente parou de
escrever, sem chamar `vscode_askQuestions`.

---

## 2. Arquitetura Atual dos Hooks (Estado Real)

### 2.1 Mapa de Hooks Ativos

```
userPromptSubmitted
    → log-prompt.sh        [PONTO DE INJEÇÃO PERDIDO — não emite systemMessage]

preToolUse
    → pre-tool-use.sh      [PONTO DE INJEÇÃO PERDIDO — exit 0 sem systemMessage]

agentStop
    → agent-stop.sh        [ÚNICO PONTO DE NUDGE — mas POST-HOC]
```

### 2.2 Problema Fundamental: Todos os Lembretes são Post-Hoc

```
Ciclo atual (quebrado):
  1. Usuário envia mensagem
  2. log-prompt.sh roda → [SILÊNCIO — não injeta nada para o agente]
  3. Agente gera resposta → implementa código → termina
  4. agentStop → agent-stop.sh roda
  5. Emite systemMessage (nudge)
  6. [TARDE DEMAIS — o agente já terminou a resposta]
```

O `systemMessage` do `agentStop` vai para o PRÓXIMO turno, não para o turno atual. O agente que está
gerando a resposta nunca "vê" o nudge — ele só será visível quando o agente COMEÇAR o próximo turno.

**Conclusão**: O sistema atual tem 0% de eficácia para prevenir o último TURN de uma SESSION. O
agente termina de responder, não chama `vscode_askQuestions`, e a janela fecha — sem que nenhum
nudge tenha sido injetado durante a geração da resposta.

### 2.3 O Que log-prompt.sh NÃO Faz (Lacuna Crítica)

`log-prompt.sh` é o hook `userPromptSubmitted` — corre ANTES do agente gerar resposta. Ele PODERIA
injetar um `systemMessage` que o agente veria DURANTE a geração. Mas atualmente:

- Não emite nenhum JSON para stdout
- Não injeta nenhum lembrete de SESSION
- Nunca mostra a `close_key`
- Não distingue SESSION de SECTION de TURN

### 2.4 A Condição Incorreta de SESSION Close Reminder

Em `agent-stop.sh`, o lembrete de encerramento de SESSION só dispara quando:

```bash
# Linha ~415 — condição errada:
if [ "$_CTX_CLOSE_VALIDATED" = "false" ] && { [ "$_TURNS_SINCE_ASK" -ge 10 ] 2> /dev/null; }; then
```

**≥ 10 turnos sem askQuestions** — um limiar absurdamente alto. A maioria das sessions termina em
5-8 turns. Então o lembrete de SESSION close **nunca é mostrado** na prática.

### 2.5 Ausência de Distinção SESSION/SECTION/TURN nos Mensagens

O nudge atual mistura conceitos:

```
⚠ Turno encerrado sem vscode_askQuestions (2 turnos desde o último).
→ Template A se concluiu tarefa | Template D para checkpoint periódico
```

Isso é sobre TURN (Template A/D), mas não menciona que SESSION close é diferente e requer Template
F + KEY.

---

## 3. Taxonomia Completa de Falhas

### Falha #1 — Zero Injeção no Início do Turno

- **Onde**: `log-prompt.sh` (hook `userPromptSubmitted`)
- **Impacto**: O agente começa cada TURN sem nenhum lembrete de que precisa chamar
  `vscode_askQuestions` ao terminar
- **Fix**: Injetar `systemMessage` no início de CADA turno com: status atual, close_key, e instrução
  clara

### Falha #2 — Condição de SESSION Close Nunca Ativa

- **Onde**: `agent-stop.sh` linha ~415, condição `turns_since_askQuestions >= 10`
- **Impacto**: O lembrete específico de SESSION close (com close_key) nunca aparece
- **Fix**: Mostrar close_key em TODOS os nudges, não apenas quando >= 10

### Falha #3 — Nudge Post-Hoc Ineficaz para o Último TURN

- **Onde**: Arquitetural — `agentStop` só roda DEPOIS da resposta
- **Impacto**: O nudge do último TURN aparece no contexto APÓS o agente já ter parado
- **Fix parcial**: Injetar no INÍCIO (pre-tool-use ou log-prompt), que roda ANTES da resposta

### Falha #4 — Confusão Conceitual no Código de Nudge

- **Onde**: Mensagens de `agent-stop.sh` misturam TURN, SECTION e SESSION
- **Impacto**: O agente não distingue quando está encerrando um TURN vs quando a SESSION pode
  encerrar
- **Fix**: Separar claramente os três conceitos em toda mensagem de nudge

### Falha #5 — Ausência do Close Key na Maioria dos Nudges

- **Onde**: `agent-stop.sh` — close_key só aparece com >= 10 turns
- **Impacto**: O agente nunca sabe qual chave usar para encerrar a SESSION
- **Fix**: Incluir close_key em TODOS os nudges

### Falha #6 — Sem Reminder em pre-tool-use.sh

- **Onde**: `pre-tool-use.sh` — exit 0 silencioso
- **Impacto**: Cada chamada de ferramenta ocorre sem lembrar o agente do protocolo
- **Fix**: Injetar `systemMessage` periódico em `pre-tool-use.sh` (a cada N chamadas)

### Falha #7 — Instruções Não Suficientemente Incisivas

- **Onde**: `copilot-instructions.md`, `hooks-protocol.instructions.md`
- **Impacto**: As instruções explicam o protocolo mas não o enfatizam com urgência nos locais
  corretos
- **Fix**: Adicionar seção de alerta visual com SESSION close protocol em destaque

---

## 4. Plano de Upgrades Massivos (v3.0)

### 4.1 Upgrade #1 — log-prompt.sh: systemMessage em CADA Turno [CRÍTICO]

**Objetivo**: Injetar lembrete no início de CADA turno, ANTES do agente gerar resposta.

```json
{
  "systemMessage": "🔐 SESSION ATIVA: ENCERRAR-XXXXXX | TURN N/M | SECTION: nome\n⚠️ SESSÃO não pode encerrar sem: vscode_askQuestions Template F + usuário digita KEY + execução automática em post-tool-use.sh\n📌 TURN exige vscode_askQuestions. SESSION requer autorização explícita."
}
```

**Implementação**: `log-prompt.sh` deve emitir este JSON para stdout (assim como `agent-stop.sh`
faz).

### 4.2 Upgrade #2 — agent-stop.sh: SESSION Close em Todo Nudge [CRÍTICO]

**Objetivo**: Remover condição `>= 10` e sempre mostrar close_key quando há nudge.

```bash
# Antes (quebrado):
if [ "$_CTX_CLOSE_VALIDATED" = "false" ] && { [ "$_TURNS_SINCE_ASK" -ge 10 ] 2>/dev/null; }; then

# Depois (correto):
if [ "$_CTX_CLOSE_VALIDATED" = "false" ] && [ -n "$_CTX_CLOSE_KEY" ]; then
```

### 4.3 Upgrade #3 — Separação Conceitual em Todas as Mensagens [IMPORTANTE]

**Objetivo**: Cada mensagem de nudge deve distinguir explicitamente:

- O que é um TURN (livre)
- O que é uma SECTION (agente decide)
- O que é uma SESSION (requer autorização)

Formato padrão proposto:

```
📍 TURN N/M | SECTION: "nome" (#N) | 🔐 SESSION: ENCERRAR-KEY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
→ TURN termina LIVREMENTE (sem autorização)
→ SECTION muda via: bash start-section.sh "nome" (autônomo)
→ SESSION fecha SOMENTE com Template F + KEY + execução automática via post-tool-use.sh
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4.4 Upgrade #4 — pre-tool-use.sh: Injeção Seletiva [MODERADO]

**Objetivo**: A cada 3ª chamada de ferramenta (ou quando vscode_askQuestions detectado), injetar
lembrete.

**Implementação**: Contar `current_turn.tools_count` e quando divisível por 5, emitir reminder.

### 4.5 Upgrade #5 — Novo Script: session-reminder.sh [IMPORTANTE]

**Objetivo**: Script standalone para o agente chamar manualmente e receber/confirmar o protocolo de
encerramento.

```bash
bash .github/hooks/scripts/session-reminder.sh
# Saída: estado atual + close_key + instrução clara
```

### 4.6 Upgrade #6 — Briefing: Seção de Alta Visibilidade Permanente [IMPORTANTE]

**Objetivo**: Tornar a seção de SESSION close key no briefing impossível de ignorar.

**Mudança**: Mover a chave para o TOPO do briefing (antes de tudo), com caixa ASCII de destaque.

### 4.7 Upgrade #7 — hooks-protocol.instructions.md: Caixa de Alerta Visual [MODERADO]

**Objetivo**: Adicionar ao início das instruções uma caixa de alerta com o protocolo de 3 etapas.

### 4.8 Upgrade #8 — Monitoramento: audit.jsonl → Relatório de Distância SESSION Close [FUTURO]

**Objetivo**: Query que mostre "distância média entre vscode_askQuestions calls" por sessão, para
detectar sessões com alto risco de silent close.

---

## 5. Implementação (Ordem de Execução)

| Ordem | Arquivo                          | Mudança                                                 | Impacto     |
| ----- | -------------------------------- | ------------------------------------------------------- | ----------- |
| 1     | `log-prompt.sh`                  | Emitir systemMessage com SESSION reminder em cada turno | **CRÍTICO** |
| 2     | `agent-stop.sh`                  | Remover condição >= 10 para SESSION close key           | **CRÍTICO** |
| 3     | `agent-stop.sh`                  | Reformatar nudge com separação SESSION/SECTION/TURN     | **CRÍTICO** |
| 4     | `session-start.sh`               | Mover close_key para o TOPO do briefing                 | Importante  |
| 5     | `pre-tool-use.sh`                | Injetar reminder seletivo (a cada 5 tools)              | Moderado    |
| 6     | `session-reminder.sh`            | Novo script standalone                                  | Importante  |
| 7     | `hooks-protocol.instructions.md` | Caixa de alerta visual                                  | Moderado    |

---

## 6. Métricas de Sucesso

Após implementação, uma sessão bem-sucedida deve:

- [ ] Receber `systemMessage` com SESSION reminder em TODOS os turnos (via log-prompt.sh)
- [ ] Ver close_key em TODOS os nudges do agent-stop.sh
- [ ] Distinguir claramente SESSION/SECTION/TURN em todas as mensagens
- [ ] `consecutive_unauthorized` nunca chegar a > 0 em sessão nova
- [ ] SESSION sempre fechada via fluxo automático (`post-tool-use.sh` → `session-close.sh`)

---

## 7. Estado Atual do Sistema (2026-03-10)

```json
{
  "session_id": "dcf579af-502e-4bf2-9d92-75903f85b0a2",
  "close_key": "ENCERRAR-112A46D8",
  "turn_count": 11,
  "turns_since_askQuestions": 2,
  "consecutive_unauthorized": 2,
  "current_section": "analise-sessoes-abruptas",
  "wave2_uncommitted": true,
  "v5.1_uncommitted": true
}
```

**Diagnóstico imediato**: `consecutive_unauthorized: 2` — dois turns consecutivos sem
`vscode_askQuestions`. O sistema de nudge está disparando (v5.1) mas ainda é insuficiente porque só
aparece DEPOIS da resposta do agente.

---

## 8. Conclusão

O problema não é de threshold — é arquitetural. O agente nunca recebe lembretes durante a geração da
resposta porque todos os reminders disparam DEPOIS (`agentStop`). A solução é mover o ponto de
injeção para ANTES da resposta (`userPromptSubmitted` / `preToolUse`).

A distinção SESSION/SECTION/TURN também precisa ser mais explícita em cada mensagem do sistema, para
que o agente nunca confunda "terminar de escrever uma resposta de TURN" com "encerrar a SESSION".

**A SESSION só encerra quando o usuário digita a chave `ENCERRAR-XXXXXXXX` no Template F e o
`post-tool-use.sh` executa `session-close.sh` automaticamente.**

---

## 9. Apêndice — Audit v6.1 (2026-03-10, turno adicional)

### 9.1 Investigação: frequência de `userPromptSubmitted`

**Alegação**: usuário alegou que o hook `userPromptSubmitted` dispara apenas na PRIMEIRA mensagem de
toda a SESSION (muito raro), tornando o reminder da v6.0 em `log-prompt.sh` ineficaz.

**Verificação empírica** (audit.jsonl):

```
turnStart            : 18 eventos
userPromptSubmitted  : 18 eventos
```

**Conclusão**: `userPromptSubmitted` dispara **uma vez por TURN** (por mensagem do usuário), NÃO
apenas na primeira. A preocupação era infundada com base nos dados reais.

**Documentação oficial** (VS Code Copilot Hooks — consultada em 2026-03-10):

> Source: `code.visualstudio.com/docs/copilot/customization/hooks`
>
> | Evento             | Quando dispara                                   |
> | ------------------ | ------------------------------------------------ |
> | `SessionStart`     | "User submits the first prompt of a new session" |
> | `UserPromptSubmit` | "User submits a prompt" (qualquer prompt)        |
>
> ⚠️ **Discrepância de nome**: o evento oficial é `UserPromptSubmit` (sem sufixo -ed). O
> copilot-hooks.json usa `userPromptSubmitted` (com -ed). Por compatibilidade do VS Code com Claude
> Code / Copilot CLI, o hook está funcionando normalmente — confirmado pelos 18 eventos.

### 9.2 Verificação de chave via `vscode_askQuestions` — já implementada

O hook `post-tool-use.sh` já implementava verificação automática da chave de encerramento:

```bash
# Quando tool_name == "vscode_askQuestions" e TOOL_RESPONSE contém CURRENT_CLOSE_KEY:
→ Seta close_key_validated = true em session-context.json
→ Loga evento sessionClose_key_validated no audit.jsonl
→ Chama automaticamente bash session-close.sh "$CURRENT_CLOSE_KEY"
```

**Evidência**: campo `close_key_found` em cada evento `askQuestions_response` no audit.jsonl.

Isso garante:

- A KEY só pode ser validada via tool call real (`vscode_askQuestions`), não por texto plano
- O encerramento automático ocorre mesmo que o agente esqueça de chamar `session-close.sh`

### 9.3 Mudanças implementadas (v6.1)

| Arquivo                                               | Mudança                                          |
| ----------------------------------------------------- | ------------------------------------------------ |
| `.github/AGENTS.md`                                   | Caixa crítica SESSION/SECTION/TURN antes de tudo |
| `.github/copilot-instructions.md`                     | Idem — caixa crítica como PRIMEIRA seção         |
| `.github/instructions/hooks-protocol.instructions.md` | Nota de verificação automática via postToolUse   |
| Este relatório                                        | Seção 9: audit v6.1                              |

### 9.4 Métricas de sucesso atualizadas

- [x] `userPromptSubmitted` dispara por turno (confirmado: 18/18)
- [x] KEY verificada automaticamente via `post-tool-use.sh` (confirmado:
      `sessionClose_key_validated`)
- [x] SESSION/SECTION/TURN distinguidos nos 3 arquivos de instrução principais
- [x] close_key visível no topo do session-briefing.md (v6.0)
- [x] `agent-stop.sh` sempre exibe close_key quando `close_key_validated=false` (v6.0)
- [ ] Zero `consecutive_unauthorized` na próxima sessão (meta de longo prazo)

---

## 10. Descoberta Crítica: Semântica de Prompt — v6.2

**Data**: 2026-03-10 | **Gatilho**: Questão fundamental do usuário sobre o que constitui "um prompt"

### 10.1 Problema Identificado

O protocolo original tratava `userPromptSubmitted` como o principal gatilho de turno. Porém, na
prática real de uso do sistema:

- O usuário digita no chatbox **apenas 1 vez** (início da SESSION)
- Toda a comunicação subsequente é via **`vscode_askQuestions`**
- Respostas ao `vscode_askQuestions` são **tool results** (processadas por `postToolUse`)
- `userPromptSubmitted` disparava ~1-2x por SESSION total, nunca por "turno de trabalho"

### 10.2 Evidência (análise de audit.jsonl)

Correlação temporal entre `askQuestions_response` e `userPromptSubmitted`:

```
askQuestions_response @ 17:30  → SEM userPromptSubmitted subsequente imediato
askQuestions_response @ 17:31  → SEM userPromptSubmitted
askQuestions_response @ 17:32  → SEM userPromptSubmitted
userPromptSubmitted   @ 17:33  → usuário digitou mensagem nova no chatbox
```

Conclusão: `askQuestions_response` e `userPromptSubmitted` são **eventos distintos e
independentes**.

### 10.3 Arquitetura Real de Comunicação

```
SESSION start: [chatbox → userPromptSubmitted → log-prompt.sh]
  └─ SECTION N
       ├─ [agente trabalha]
       ├─ [agente chama vscode_askQuestions]
       ├─ [usuário responde → postToolUse → askQuestions_response em audit.jsonl]
       ├─ [agente trabalha]
       ├─ [agente chama vscode_askQuestions]
       ├─ [usuário responde → postToolUse → askQuestions_response]
       └─ ... (NUNCA mais usa chatbox)
SESSION end: [usuário digita ENCERRAR-KEY em askQuestions → post-tool-use.sh detecta KEY]
```

### 10.4 Mudanças Implementadas (v6.2)

| Arquivo                                               | Mudança                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.github/copilot-instructions.md`                     | Ciclo de vida TURN: nota que askQuestions responses são tool results (postToolUse), NÃO novos prompts           |
| `.github/copilot-instructions.md`                     | Adicionada nota `⚠️ userPromptSubmitted dispara SOMENTE para chatbox` antes da seção de comportamento do agente |
| `.github/AGENTS.md`                                   | Tabela de eventos: `userPromptSubmitted` agora descreve corretamente sua frequência real                        |
| `.github/AGENTS.md`                                   | Seção TURN: nota explícita sobre semântica do hook vs workflow real                                             |
| `.github/instructions/hooks-protocol.instructions.md` | Tabela conceitos: nota sobre `userPromptSubmitted` vs tool results                                              |
| `.github/instructions/hooks-protocol.instructions.md` | Seção TURN: bloco de "Semântica real" adicionado                                                                |
| `.github/hooks/scripts/pre-tool-use.sh`               | SESSION reminder a cada 30 tool calls (preToolUse é o hook mais confiável no workflow real)                     |

### 10.5 Métricas de Sucesso v6.2

- [x] `userPromptSubmitted` clarificado como "chatbox only" em todos os 3 documentos de instrução
- [x] `vscode_askQuestions` response identificada como canal principal (event:
      `askQuestions_response`)
- [x] SESSION reminder via `preToolUse` implementado (dispara antes de toda call de ferramenta)
- [x] 150/150 PASS (smoke-test)
- [ ] Zero confusão sobre TURN vs chatbox na próxima sessão (meta de longo prazo)

---

## 11. Hardening Estrutural v7.0 — decision:block no Stop Hook

**Data**: 2026-03-10 | **Gatilho**: Sessions continuam encerrando incorretamente — análise profunda
revelou causa raiz

### 11.1 Causa Raiz Identificada

Após análise exaustiva do código e da documentação oficial do VS Code:

1. **Bugagem na Estratégia 2 de detecção AUTH**: O código verificava "últimas 150 linhas do
   audit.jsonl" para qualquer `vscode_askQuestions`. Como o arquivo é cumulativo, sempre encontrava
   chamadas de **turnos anteriores** → `AUTH_REQUESTED=true` falso → blocking nunca disparava.

2. **Ausência de `decision:block`**: `agent-stop.sh` emitia apenas `systemMessage` (nudge
   informativo). O agente podia ignorar o nudge e encerrar o TURN livremente. O `decision:block` do
   Stop hook nunca foi implementado no formato correto.

### 11.2 API Oficial Confirmada (VS Code Stop Hook)

Documentação oficial (https://code.visualstudio.com/docs/copilot/customization/hooks):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Instrução ao agente sobre o que fazer para poder encerrar"
  }
}
```

- `stop_hook_active: true` no input → o agente já está rodando por causa de um block anterior (NUNCA
  bloquear quando `true`)
- `reason` é OBRIGATÓRIO quando `decision: "block"`
- Quando bloqueado: agente continua, pode chamar ferramentas, e tenta encerrar novamente → segundo
  invocation com `stop_hook_active: true`

### 11.3 Correções Implementadas

#### Fix 1: Remoção da Estratégia 2 (falso positivo)

**Antes (bugada)**:

```bash
if [ "$AUTH_REQUESTED" = "false" ] && [ "$LAST_PROMPT_LINE" -eq 0 ]; then
    RECENT_LINES=150  # verifica QUALQUER vscode_askQuestions nas últimas 150 linhas
    tail -n "$RECENT_LINES" "$AUDIT_FILE" | jq -re '...' → AUTH_REQUESTED=true (falso positivo)
fi
```

**Depois (removida em v7.0)**:

```bash
# Estratégia 2 REMOVIDA — era cross-turn. Estratégia 3 (CTX) é turn-scoped e correta.
```

A Estratégia 3 (`current_turn.auth_requested` do session-context.json) é:

- Setada por `post-tool-use.sh` quando `vscode_askQuestions` é chamado no turno atual
- Resetada por `agent-stop.sh` ao fim de cada turno (linha ~595)
- Perfeitamente scoped ao turno atual

#### Fix 2: decision:block implementado (Stop hook)

```bash
# Em agent-stop.sh, quando AUTH_REQUESTED=false e stop_hook_active=false e turn_count>=1:
jq -cn \
  --arg reason "$_BLOCK_REASON" \
  '{
        hookSpecificOutput: {
            hookEventName: "Stop",
            decision: "block",
            reason: $reason
        },
        systemMessage: "🚨 TURN BLOQUEADO (v7.0): vscode_askQuestions não foi chamado..."
    }'
exit 0
```

O `block` impede o agente de encerrar. O `reason` instrui o agente a usar Template A ou D.

### 11.4 Lógica de Decisão Completa (v7.0)

```
agentStop(stop_hook_active, AUTH_REQUESTED, turn_count)
    │
    ├─ stop_hook_active == true  → PERMITE (anti-loop)
    ├─ AUTH_REQUESTED == true    → PERMITE (askQuestions foi chamado ✓)
    ├─ turn_count == 0           → PERMITE (warm-up — primeiro turno)
    └─ DEFAULT                   → BLOQUEIA (decision:block)
           - Loga: agentStop_blocked em audit.jsonl
           - Cria: UNAUTHORIZED_CLOSE.flag
           - Output: hookSpecificOutput.decision=block + reason + systemMessage
           - exit 0 (não executa CTX update — turn ainda não encerrou)
```

### 11.5 Mudanças Implementadas

| Arquivo                                            | Mudança                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.github/hooks/scripts/agent-stop.sh`              | Estratégia 2 removida (RECENT_LINES=150)                                                 |
| `.github/hooks/scripts/agent-stop.sh`              | Header v7.0: "BLOCKING ESTRUTURAL via decision:block"                                    |
| `.github/hooks/scripts/agent-stop.sh`              | Bloco decision:block: condição, log, flag, JSON output, exit 0                           |
| `.github/hooks/scripts/agent-stop.sh`              | Bloco de log pós-block: `agentStop_unblocked_complied` / `agentStop_unblocked_no_comply` |
| `.github/hooks/scripts/smoke-test.sh`              | Grupo 18 (AS-1 a AS-6): 6 novos testes para decision:block                               |
| `DOCUMENTAÇÃO/HOOKS/ARQUITETURA-HOOKS-COMPLETA.md` | **NOVO**: documento canônico completo da arquitetura                                     |

### 11.6 Documentação de Arquitetura Criada

Novo arquivo: `DOCUMENTAÇÃO/HOOKS/ARQUITETURA-HOOKS-COMPLETA.md`

Cobre:

- API oficial do VS Code Copilot Hooks (todos os 8 eventos com schemas)
- Conceitos SESSION/SECTION/TURN com tabelas e diagramas ASCII
- Canal primário: `vscode_askQuestions` vs irrelevância de `userPromptSubmitted`
- Implementação completa dos nossos hooks
- Estado canônico: session-context.json schema
- Hardening v7.0: decision:block e seu fluxo
- Protocolo de encerramento de SESSION
- Templates A-G
- Diagrama completo do ciclo de vida

### 11.7 Métricas de Sucesso v7.0

- [x] Estratégia 2 removida de agent-stop.sh (causa raiz do falso positivo)
- [x] `decision:block` implementado no formato correto (hookSpecificOutput)
- [x] Anti-loop via guard `stop_hook_active` implementado e testado
- [x] 6 novos testes AS-1 a AS-6 no smoke-test.sh
- [x] **156/156 PASS** (150 anteriores + 6 novos testes AS-)
- [x] Arquivo de arquitetura completo criado (ARQUITETURA-HOOKS-COMPLETA.md)
- [ ] Validação comportamental real na próxima sessão

---

## 12. v8.0 — SESSION Extremamente Persistente (2026-03-10)

### 12.1 Diretriz do usuário

> "O objetivo é fazer com que as SESSIONS dure o máximo de tempo que for possível. Queremos SESSIONS
> extremamente persistentes. O fim de uma SESSION, se o sistema estiver funcionando corretamente,
> deve ser um evento EXTREMAMENTE raro. A questão fundamental é fazer hardening para IMPEDIR que o
> agente feche a SESSION."

### 12.2 Mecanismos de Encerramento Mapeados

| #     | Mecanismo                                                            | Status Anterior                        | Status v8.0               |
| ----- | -------------------------------------------------------------------- | -------------------------------------- | ------------------------- |
| 1     | Agente termina TURN silentemente → usuário fecha VS Code             | ✅ Mitigado (v7.0 decision:block)      | ✅ Mantido                |
| 2     | Usuário force-fecha VS Code durante diálogo                          | — Limitação de plataforma              | — Limitação de plataforma |
| 3     | Strategy 2 falso positivo autoriza SESSION indevidamente             | ✅ Corrigido (v7.0)                    | ✅ Mantido                |
| 4     | Agente não chama vscode_askQuestions em turnos subsequentes          | ✅ Mitigado (decision:block por turno) | ✅ Mantido                |
| **5** | **Agente chama session-close.sh diretamente (hallucination de KEY)** | ❌ Gap crítico                         | **✅ BLOQUEADO (v8.0)**   |

### 12.3 Implementações v8.0

#### Guard do Mecanismo 5 — pre-tool-use.sh

**Problema**: O agente poderia chamar `bash session-close.sh "ENCERRAR-XXXXXXXX"` diretamente via
`run_in_terminal`, sem que o usuário tivesse digitado a KEY em um `vscode_askQuestions` legítimo.
Isso poderia ocorrer por hallucination de KEY ou por chamada acidental.

**Solução**: Novo bloco em `pre-tool-use.sh` que intercepta chamadas `run_in_terminal` contendo
`session-close.sh` quando `close_key_validated=false`:

```bash
if [ "$TOOL_NAME" = "run_in_terminal" ]; then
  _M5_CMD="$(echo "$INPUT" | jq -r '.tool_input.command // ""')"
  if echo "$_M5_CMD" | grep -q "session-close\.sh"; then
    _M5_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE")"
    if [ "$_M5_VALIDATED" != "true" ]; then
      # Loga e nega a ferramenta
      jq -cn '{"permissionDecision": "deny", "additionalContext": "..."}'
      exit 0
    fi
  fi
fi
```

**Evento auditado**: `sessionClose_direct_blocked` em `audit.jsonl`

**Exceção**: Se `close_key_validated=true` (post-tool-use.sh já detectou a KEY), a chamada é
permitida como fallback.

#### Redução do Intervalo de SESSION Reminder

| Versão   | Intervalo (ferramentas) | Variável                                       |
| -------- | ----------------------- | ---------------------------------------------- |
| v6.2     | 30                      | `HOOKS_SESSION_REMINDER_TOOL_INTERVAL:-30`     |
| **v8.0** | **10**                  | **`HOOKS_SESSION_REMINDER_TOOL_INTERVAL:-10`** |

Lembretes mais frequentes = agente mais ciente da SESSION ativa = menor chance de fechar
inadvertidamente.

#### Hardening de Documentação (v8.0)

Todos os documentos canônicos agora têm o **Princípio Fundamental** v8.0 como **primeira seção**,
antes de qualquer outro conteúdo:

| Arquivo                                               | Bloco adicionado                                           |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `.github/AGENTS.md`                                   | `╔═ SESSION PERSISTENTE — PRINCÍPIO FUNDAMENTAL ═╗`        |
| `.github/copilot-instructions.md`                     | `╔═ SESSION PERSISTENTE — PRINCÍPIO FUNDAMENTAL (v8.0) ═╗` |
| `.github/instructions/hooks-protocol.instructions.md` | `╔═ SESSION PERSISTENTE — PRINCÍPIO FUNDAMENTAL (v8.0) ═╗` |

Bloco documental padronizado:

```
REGRA ABSOLUTA — NUNCA VIOLAR:
- O agente NUNCA deve chamar session-close.sh diretamente via run_in_terminal.
- Nem mesmo com a KEY correta. O pre-tool-use.sh (v8.0) NEGA essa chamada quando close_key_validated=false.
- O único fluxo legítimo: vscode_askQuestions Template F → usuário digita KEY → post-tool-use.sh executa session-close.sh automaticamente.
SESSION end = EVENTO EXTREMAMENTE RARO.
```

### 12.4 Fluxo de Encerramento Atualizado (v8.0)

```
ENCERRAMENTO DE SESSION (fluxo legítimo único):

  Agente
   ↓ chama vscode_askQuestions com Template F (exibe close_key)
  Usuário
   ↓ digita ENCERRAR-XXXXXXXX no campo livre
  post-tool-use.sh
   ↓ detecta KEY em tool_response
   ↓ seta close_key_validated=true em session-context.json
   ↓ chama session-close.sh automaticamente
  SESSION encerrada ✓

FLUXO BLOQUEADO (v8.0):

  Agente
   ↓ tenta: bash session-close.sh "ENCERRAR-XXXXXXXX"  ← run_in_terminal
  pre-tool-use.sh
   ↓ detecta "session-close.sh" no comando
   ↓ verifica close_key_validated=false
   ↓ emite permissionDecision:deny
   ↓ loga sessionClose_direct_blocked
  Ferramenta negada ✗
```

### 12.5 Arquivos Modificados em v8.0

| Arquivo                                               | Mudança                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `.github/hooks/scripts/pre-tool-use.sh`               | Guard Mecanismo 5 + intervalo reminder 30→10 + header v8.0                     |
| `.github/AGENTS.md`                                   | Bloco "SESSION PERSISTENTE — PRINCÍPIO FUNDAMENTAL" como primeira seção        |
| `.github/copilot-instructions.md`                     | Bloco "SESSION PERSISTENTE — PRINCÍPIO FUNDAMENTAL (v8.0)" como primeira seção |
| `.github/instructions/hooks-protocol.instructions.md` | Bloco "SESSION PERSISTENTE — PRINCÍPIO FUNDAMENTAL (v8.0)" como primeira seção |
| `.github/hooks/scripts/smoke-test.sh`                 | Grupo 19 (PR-1 a PR-6): 6 novos testes de persistência                         |

### 12.6 Métricas de Sucesso v8.0

- [x] Mecanismo 5 bloqueado: `session-close.sh` não pode ser chamado diretamente
- [x] `permissionDecision:deny` emitido e logado como `sessionClose_direct_blocked`
- [x] Intervalo de SESSION reminder reduzido de 30→10 ferramentas
- [x] Bloco "SESSION PERSISTENTE" adicionado como 1ª seção em todos os documentos canônicos
- [x] 6 novos testes PR-1 a PR-6 no smoke-test.sh
- [x] **162/162 PASS** (156 anteriores + 6 novos testes PR-)
- [x] Validação comportamental: bug encontrado → causa raiz identificada → v8.1 implementado

---

## 13. v8.1 — Correção Raiz: sessionEnd Falsos (2026-03-10)

### 13.1 Problema Identificado

Após v8.0, SESSIONs continuavam "encerrando" conforme relato do usuário. Investigação do
`audit.jsonl` revelou:

- Dois eventos `sessionEnd` com `reason: "authorized_close"` para o session_id `dcf579af`
- Timestamps em formato epoch (`1773139323000`) — gerados pelo próprio `session-end.sh`
- A sessão **continuou ativa** no VS Code após esses eventos (novos `preToolUse` chegavam com mesmo
  session_id)
- `session-context.json` com `source: "auto_recovery"` e `close_key_validated: false`

### 13.2 Causa Raiz

**O fluxo defeituoso:**

```
post-tool-use.sh detecta KEY → chama session-close.sh
  → session-close.sh seta close_key_validated=true
  → session-close.sh chama session-end.sh ← BUG: gera sessionEnd antes do VS Code fechar!
    → session-end.sh loga sessionEnd + sessionEnd_compliance + sessionEnd_no_key
      (close_key_validated ainda false por race condition com sponge)
```

Como `session-close.sh` chamava `session-end.sh` **antes do VS Code encerrar a sessão**, foram
gerados:

1. Eventos `sessionEnd` falsos (sessão ainda ativa no VS Code)
2. `session-end.sh` sobrescrevia `ended_at` no contexto (sessão parecia encerrada)
3. Quando o hook `sessionEnd` nativo do VS Code disparava depois, gerava um segundo conjunto de
   eventos

**Race condition adicional:** `session-close.sh` setava `close_key_validated=true` mas
`session-end.sh` lia o arquivo em paralelo (via sponge) e frequentemente lia antes da escrita
concluir → resultado: `sessionEnd_no_key` mesmo com KEY validada.

**Auto-recovery:** Quando a nova conversa iniciava com o mesmo session_id (VS Code mantém
session_id), o CTX estava marcado com `ended_at` → `pre-tool-use.sh` detectava CTX "encerrado" ou
vazio → criava `auto_recovery` com `close_key_validated: false` → perdendo a informação de que a KEY
havia sido validada.

### 13.3 Correkções v8.1

#### Fix 1: session-close.sh não chama session-end.sh (cirúrgico)

**Antes (con bug):**

```bash
# Chama session-end.sh para gerar relatório completo e logar sessionEnd
SESSION_END_SCRIPT="$SCRIPTS_DIR/session-end.sh"
if [ -f "$SESSION_END_SCRIPT" ]; then
  echo '{"reason":"authorized_close"}' | bash "$SESSION_END_SCRIPT" ...
fi
```

**Depois (v8.1):**

```bash
# v8.1: NÃO chama session-end.sh. O hook nativo sessionEnd do VS Code é o único
# responsável por disparar session-end.sh. session-close.sh apenas: valida KEY,
# seta close_key_validated=true, loga sessionCloseAuthorized, cria o flag.
# Quando o VS Code encerrar a sessão de fato, o hook sessionEnd chamará
# session-end.sh com close_key_validated=true já setado.
```

#### Fix 2: auto_recovery herda close_key_validated do flag de autorização

**Antes (com bug):**

```bash
# auto_recovery sempre criava com close_key_validated: false
close_key_validated: false,
```

**Depois (v8.1):**

```bash
# Herda do SESSION_CLOSE_AUTHORIZED.flag se session_id corresponder
_RECOVERY_KEY_VALIDATED="false"
_AUTH_FLAG="$STATE_DIR/SESSION_CLOSE_AUTHORIZED.flag"
if [ -f "$_AUTH_FLAG" ]; then
  _FLAG_SID="$(jq -r '.session_id // ""' "$_AUTH_FLAG")"
  if [ "$_FLAG_SID" = "$SESSION_ID" ]; then
    _RECOVERY_KEY_VALIDATED="true"
  fi
fi
# Usa _RECOVERY_KEY_VALIDATED no jq --argjson
close_key_validated: $key_validated,
```

### 13.4 Fluxo Correto após v8.1

```
Template F (askQuestions) → usuário digita KEY
  → post-tool-use.sh detecta KEY na resposta
  → seta session.close_key_validated=true no CTX
  → loga sessionClose_key_validated
  → chama session-close.sh automaticamente
    → session-close.sh valida KEY ✓
    → seta close_key_validated=true (redundante mas seguro)
    → loga sessionCloseAuthorized
    → cria SESSION_CLOSE_AUTHORIZED.flag
    → NÃO chama session-end.sh ← FIX 1
  → Sessão permanece ativa no VS Code ✓

Quando o usuário fechar o chat / VS Code encerrar a sessão:
  → Hook sessionEnd nativo do VS Code dispara session-end.sh
  → session-end.sh lê close_key_validated=true ✓
  → loga sessionEnd_authorized_with_key (não sessionEnd_no_key)
  → Relatório final gerado corretamente
```

### 13.5 Arquivos Modificados em v8.1

| Arquivo                                  | Modificação                                               |
| ---------------------------------------- | --------------------------------------------------------- |
| `.github/hooks/scripts/session-close.sh` | Removida chamada direta de `session-end.sh` (Fix 1)       |
| `.github/hooks/scripts/pre-tool-use.sh`  | auto_recovery herda `close_key_validated` do flag (Fix 2) |
| `.github/hooks/scripts/smoke-test.sh`    | Grupo 20: V81-1 a V81-6 (6 novos testes)                  |

### 13.6 Métricas de Sucesso v8.1

- [x] session-close.sh não chama session-end.sh (V81-1)
- [x] auto_recovery herda close_key_validated do flag (V81-4)
- [x] 6 novos testes V81-1 a V81-6 no smoke-test.sh
- [x] **168/168 PASS** (162 anteriores + 6 novos testes V81-)
- [x] Validação comportamental confirmada: zero sessionEnd falsos na audit.jsonl após o fix

---

## 14. v9.0 — Protocolo TODO Obrigatório (2026-03-11)

### 14.1 Diagnóstico

**Problema reportado**: Sessão encerrando abruptamente sem vscode_askQuestions ser chamado, mesmo
com `decision:block` ativo (v7.0). O `consecutive_unauthorized` chegou a 6.

**Root cause confirmado**: Três falhas simultâneas:

1. **Documentação contraditória** — AGENTS.md, hooks-protocol.instructions.md e
   copilot-instructions.md diziam "recomendado, não obrigatório" enquanto agent-stop.sh v7.0 já
   emitia `decision:block`. O agente lia a documentação e ignorava o enforcement.
2. **Sem rastreamento de manage_todo_list** — o sistema não sabia se o agente havia criado TODOs no
   início do turno, impossibilitando distinção entre "esqueceu completamente" vs "criou TODOs mas
   pulou o último".
3. **Mensagem de bloco genérica** — o `decision:block` emitia a mesma mensagem independente de o
   agente ter chamado `manage_todo_list` ou não, sem escalada diferente.

**Investigação adicional — SESSION_ID por prompt**:

- Confirmado: `userPromptSubmitted` hook NÃO recebe `session_id` no payload (campo sempre vazio).
- O script `log-prompt.sh` faz fallback para o `session-context.json` (valor persistido).
- Consequência: **um único SESSION_ID persiste por toda a janela de chat** — não há novo ID por
  prompt.
- `vscode_askQuestions` respostas → `postToolUse` (não `userPromptSubmitted`) → não geram novo
  session_id.
- Campo `session_id_in_payload` adicionado ao evento `userPromptSubmitted` no audit para
  observabilidade.

### 14.2 Correções Implementadas

**14.2.1 Documentação hardened (sem contradição)**

| Arquivo                          | Antes                                           | Depois                                               |
| -------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `AGENTS.md`                      | "recomendado, não obrigatório" / "sem bloqueio" | "OBRIGATÓRIO" / "decision:block ativo"               |
| `hooks-protocol.instructions.md` | "Não há decision:block"                         | Seção "PROTOCOLO TODO OBRIGATÓRIO (v9.0)" adicionada |
| `copilot-instructions.md`        | "TURNs encerram livremente"                     | "vscode_askQuestions OBRIGATÓRIO ao final"           |

**14.2.2 Rastreamento de manage_todo_list (post-tool-use.sh)**

```bash
elif [ "$TOOL_NAME" = "manage_todo_list" ]; then
    jq --arg result "$RESULT_TYPE" \
        '.last_tool.result = $result
         | .current_turn.todo_created = true' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
```

**14.2.3 Reset de todo_created no início de cada turno (log-prompt.sh)**

Adicionado `| .current_turn.todo_created = false` nos DOIS blocos jq de reset (sponge path e TMP
path).

Adicionado campo `session_id_in_payload` no evento `userPromptSubmitted`:

```json
{ "session_id_in_payload": false }
```

**14.2.4 Bloco escalado com distinção de violação (agent-stop.sh)**

```bash
_BLOCK_TODO_CREATED="$(jq -r '.current_turn.todo_created // false' "$CTX_FILE" 2> /dev/null || echo false)"
```

Dois cenários de bloqueio distintos:

- **DUPLA VIOLAÇÃO** (manage_todo_list NÃO chamado + vscode_askQuestions NÃO chamado):
  - Emite evento `agentStop_blocked_no_todo` adicional em audit.jsonl
  - systemMessage:
    `🚨 DUPLA VIOLAÇÃO (v9.0): (1) manage_todo_list NÃO chamado. (2) vscode_askQuestions NÃO chamado...`
- **VIOLAÇÃO SIMPLES** (manage_todo_list chamado, vscode_askQuestions NÃO chamado):
  - systemMessage:
    `🚨 TURN BLOQUEADO (v9.0): manage_todo_list foi chamado (✓) mas vscode_askQuestions NÃO foi chamado...`

### 14.3 Novos Testes — Grupo 21 (V90-1 a V90-9)

| Teste | Descrição                                                                         |
| ----- | --------------------------------------------------------------------------------- |
| V90-1 | post-tool-use.sh seta `todo_created=true` quando `manage_todo_list` é chamado     |
| V90-2 | log-prompt.sh reseta `todo_created=false` no início de cada turno                 |
| V90-3 | agent-stop.sh lê `_BLOCK_TODO_CREATED` do contexto                                |
| V90-4 | agent-stop.sh emite `agentStop_blocked_no_todo` quando `manage_todo_list` ausente |
| V90-5 | agent-stop.sh usa mensagem de DUPLA VIOLAÇÃO diferenciada                         |
| V90-6 | hooks-protocol.instructions.md contém seção "PROTOCOLO TODO OBRIGATÓRIO"          |
| V90-7 | AGENTS.md não contém linguagem "recomendado, não obrigatório"                     |
| V90-8 | log-prompt.sh inclui `session_id_in_payload` no evento `userPromptSubmitted`      |
| V90-9 | Três scripts centrais passam `shellcheck -S error` depois das mudanças            |

### 14.4 Arquivos Modificados em v9.0

| Arquivo                                               | Modificação                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `.github/hooks/scripts/agent-stop.sh`                 | Lê `todo_created`; dois cenários de bloco distintos; evento `agentStop_blocked_no_todo` |
| `.github/hooks/scripts/log-prompt.sh`                 | Reset `todo_created=false` no turn start; campo `session_id_in_payload` no audit        |
| `.github/hooks/scripts/post-tool-use.sh`              | Rastreia `manage_todo_list` → `todo_created=true`                                       |
| `.github/hooks/scripts/smoke-test.sh`                 | Grupo 21: V90-1 a V90-9                                                                 |
| `.github/AGENTS.md`                                   | TURN section hardened: "OBRIGATÓRIO", Protocolo TODO v9.0                               |
| `.github/instructions/hooks-protocol.instructions.md` | Seção "PROTOCOLO TODO OBRIGATÓRIO" adicionada no topo                                   |
| `.github/copilot-instructions.md`                     | TURN section hardened, linguagem contraditória removida                                 |

### 14.5 Métricas de Sucesso v9.0

- [x] Documentação sem contradições com enforcement (V90-6, V90-7)
- [x] manage_todo_list rastreado por turno (V90-1, V90-2)
- [x] Violação dupla distinguida de violação simples (V90-3, V90-4, V90-5)
- [x] session_id_in_payload em audit para observabilidade de sessão (V90-8)
- [x] Todos os scripts passam shellcheck -S error (V90-9)
- [x] **177/177 PASS** (168 anteriores + 9 novos testes V90-)

---

## 15. v9.0 — Investigação de Coerência TURN/SECTION/SESSION (2026-03-11)

### 15.1 Investigação: o que gera incremento de turn_count

**Resultado da análise de código** (`agent-stop.sh` + `log-prompt.sh`):

| Campo                        | Onde é incrementado | Quando                                                  |
| ---------------------------- | ------------------- | ------------------------------------------------------- |
| `session_stats.turn_count`   | `agent-stop.sh`     | Ao FINAL de cada turno (evento `agentStop`)             |
| `current_turn.number`        | `log-prompt.sh`     | No INÍCIO de cada turno como `turn_count + 1` (preview) |
| `current_turn.section_turn`  | `log-prompt.sh`     | No INÍCIO, como `current_section.local_turn + 1`        |
| `current_section.local_turn` | `log-prompt.sh`     | No INÍCIO de cada turno (incremento real da seção)      |

**Turno BLOQUEADO** (`decision:block`): `turn_count` NÃO é incrementado — `agent-stop.sh` sai antes
do bloco de incremento quando emite `decision:block`.

**Invariante confirmado**: SESSION_ACTIVE ⊃ ≥1 SECTION ⊃ ≥1 TURN. Se `current_section` for null no
agentStop, `agent-stop.sh` cria automaticamente a seção `"retomada"` antes de prosseguir.

### 15.2 Bugs Encontrados e Corrigidos

#### Bug 1 — Dupla incrementação de `consecutive_unauthorized`

**Causa raiz**: Quando `stop_hook_active=true` (invocação de re-entrada no bloco), TANTO a seção de
bloqueio (1ª invocação) QUANTO a seção de compliance (chamada em ambas as invocações) incrementavam
`consecutive_unauthorized`. Resultado: cada violação contava duplo.

**Correção** em `agent-stop.sh`:

```bash
# Só incrementa consecutive_unauthorized se NÃO for a invocação de re-entrada (stop_hook_active)
if [ "$STOP_HOOK_ACTIVE" != "true" ]; then
  jq ... | .compliance.consecutive_unauthorized += 1 ... | sponge "$CTX_FILE"
  touch "$AUTH_FLAG"
fi
```

**Impacto**: `consecutive_unauthorized` estava em 6 mas representa apenas 3 violações reais (cada
uma contada duas vezes).

#### Bug 2 — `todo_created` não resetado no fim do turno (agent-stop.sh)

**Causa raiz**: `agent-stop.sh` tem seu próprio bloco jq de reset do `current_turn` na linha ~665
(end-of-turn reset). Esse bloco é diferente do reset executado por `log-prompt.sh` no inicio do
próximo turno. O campo `todo_created` estava ausente do reset de `agent-stop.sh`, fazendo com que
permanecesse `true` entre o fim de um turno e o início do próximo.

**Correção**: Adicionado `| .current_turn.todo_created = false` ao bloco jq de reset de
`agent-stop.sh`.

#### Bug 3 — Watchdog reporta `active: false` para sessão ativa (falso negativo)

**Causa raiz**: O campo `session.ended_at` no contexto estava populado com `"2026-03-10T10:42:06Z"`
— valor residual de um falso `sessionEnd` executado por `session-close.sh→session-end.sh` antes do
fix v8.1. O watchdog usava simplesmente `[ -z "$ENDED_AT" ] || [ "$ENDED_AT" = "null" ]` para
determinar se a sessão estava ativa. Com `ended_at` não-nulo, reportava `active: false`, mesmo que a
sessão continuasse operando.

**Correção** em `watchdog.sh`:

```bash
_STALE_ENDED_AT_WARN=false
if [ -z "$ENDED_AT" ] || [ "$ENDED_AT" = "null" ]; then
  SESSION_ACTIVE=true
elif [ "$SESSION_SOURCE" = "auto_recovery" ]; then
  # auto_recovery + ended_at não-nulo = stale ended_at de fake sessionEnd pré-v8.1
  SESSION_ACTIVE=true
  _STALE_ENDED_AT_WARN=true
fi

# Emite aviso específico para diagnóstico
if [ "$_STALE_ENDED_AT_WARN" = "true" ]; then
  alert_warn "STALE_ENDED_AT" \
    "session.ended_at residual de sessionEnd falso pré-v8.1 (source=auto_recovery). Sessão ATIVA."
fi
```

**Ação adicional**: campo `ended_at` limpo diretamente do `session-context.json` via:

```bash
jq '.session.ended_at = null' session-context.json | sponge session-context.json
```

Após a limpeza, watchdog volta a reportar `active: true` sem emitir `STALE_ENDED_AT`.

### 15.3 Novos Testes — Grupo 21 ampliado (V90-10 a V90-12)

| Teste  | Descrição                                                                                   |
| ------ | ------------------------------------------------------------------------------------------- |
| V90-10 | agent-stop.sh usa guarda `STOP_HOOK_ACTIVE != true` para anti-duplo-incremento (Bug 1 fix)  |
| V90-11 | agent-stop.sh reseta `current_turn.todo_created=false` no reset de fim de turno (Bug 2 fix) |
| V90-12 | watchdog.sh detecta `auto_recovery` e emite alerta `STALE_ENDED_AT` (Bug 3 fix)             |

### 15.4 Arquivos Modificados em v9.0 (fase investigação)

| Arquivo                                    | Modificação                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `.github/hooks/scripts/agent-stop.sh`      | Bug 1: guarda anti-duplo-incremento; Bug 2: `todo_created=false` no reset de fim turno |
| `.github/hooks/scripts/watchdog.sh`        | Bug 3: `_STALE_ENDED_AT_WARN` + detecção `auto_recovery` + alert `STALE_ENDED_AT`      |
| `.github/hooks/scripts/smoke-test.sh`      | V90-10, V90-11, V90-12 adicionados ao Grupo 21                                         |
| `.github/hooks/state/session-context.json` | Campo `ended_at` limpo (era valor residual de fake sessionEnd pré-v8.1)                |

### 15.5 Métricas de Sucesso v9.0 (fase investigação)

- [x] Bug 1 corrigido: `consecutive_unauthorized` incrementa apenas 1x por violação (V90-10)
- [x] Bug 2 corrigido: `todo_created` resetado no fim do turno em `agent-stop.sh` (V90-11)
- [x] Bug 3 corrigido: watchdog detecta `auto_recovery` com `ended_at` não-nulo → `active: true` +
      alerta diagnóstico (V90-12)
- [x] `session-context.json` limpo (campo `ended_at` = null, watchdog sem `STALE_ENDED_AT`)
- [x] shellcheck -S error: zero erros em todos os scripts modificados
- [x] **180/180 PASS** (179 anteriores + V90-12)

---

## 16. v9.0 — Limpeza de Alertas Remanescentes do Watchdog (2026-03-11)

### 16.1 Alertas Investigados

Após as correções da seção 15, o watchdog apresentava 4 alertas residuais:

| Alerta                       | Status Antes                                                          | Status Depois                                                           | Ação                                                                 |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `SESSION_STALE` (critical)   | threshold 8h → sessão de 14h dispara                                  | Eliminado: threshold → 36h                                              | Fix: `STALE_HOURS` default                                           |
| `STALE_ID_MISMATCHES` (warn) | 395 eventos históricos capturados por `tail -50`                      | Eliminado: filtro por sessão atual + cutoff 6h + exclusão subagente     | Fix: jq com `--arg sid` + `_MISMATCH_CUTOFF`                         |
| `TURN_IDLE` (warn)           | `last_turn_ts` apenas em turnos autorizados → bloqueios não atualizam | Parcial: fix aplicado; auto-resolve ao fim do turno corrente            | Fix: `agent-stop.sh` bloco de bloqueio agora atualiza `last_turn_ts` |
| `CONSEC_UNAUTH` (warn)       | 6 violações consecutivas do período de bloqueios                      | Auto-resolve ao fim do turno corrente (reset por `AUTH_REQUESTED=true`) | Nenhuma — comportamento correto                                      |
| `AUTH_FLAG_EXISTS` (warn)    | Flag do período de bloqueios                                          | Auto-resolve ao fim do turno corrente                                   | Nenhuma — comportamento correto                                      |

### 16.2 Rodada de Investigação: STALE_ID_MISMATCHES

**Causa raiz confirmada**: O watchdog filtrava `event == "session_id_mismatch"` em `tail -50` do
audit.jsonl sem nenhum escopo de sessão ou janela temporal. Resultado: 50 dos 395 eventos históricos
pre-fix eram sempre capturados.

**Análise dos 395 eventos**: todos de antes de 2026-03-10T10:09:05 (15h atrás), gerados durante o
período de conflito de session_id que foi sanado pelo `session_id_healed` event em
2026-03-09T15:13:26Z.

**1 evento com timestamp null**: de `subagent-stop.sh` com `expected == SESSION_ID_ATUAL`. Esse
evento é de um subagente delegado e é comportamento ESPERADO (subagentes têm session_id diferente;
`subagent-stop.sh` bloqueia corretamente a escrita de estado).

**Correção aplicada**:

```bash
# Antes (amplo demais — captura tudo):
jq -r 'select(.event == "session_id_mismatch") | .timestamp' | tail -50 | wc -l

# Depois (escopado: sessão atual, últimas 6h, excluindo subagentes):
_MISMATCH_CUTOFF="$(date -u -d '6 hours ago' '+%Y-%m-%dT%H:%M:%SZ' ...)"
jq --arg sid "$SESSION_ID" --arg cutoff "$_MISMATCH_CUTOFF" -r \
  'select(.event == "session_id_mismatch"
        and .expected == $sid
        and (.source // "") != "subagent-stop.sh"
        and .timestamp != null
        and .timestamp > $cutoff) | .timestamp'
```

### 16.3 Rodada de Investigação: SESSION_STALE

**Causa raiz**: Threshold padrão de 8h é insuficiente para sessões longas de desenvolvimento. Uma
sessão ativa de 14h era erroneamente classificada como potencial estado órfão.

**Correção**: `STALE_HOURS` default alterado de `8` → `36`. Valor continua configurável via
`WATCHDOG_STALE_HOURS`.

### 16.4 Rodada de Investigação: TURN_IDLE

**Causa raiz**: `last_turn_ts` só era atualizado em turnos AUTORIZADOS (terminados com
`vscode_askQuestions`). Turnos bloqueados (exit 0 na seção de blocking) saíam sem atualizar o campo.
Em sessões com múltiplos bloqueios seguidos, `last_turn_ts` ficava com o valor do último turno
autorizado (23:26), fazendo TURN_IDLE disparar mesmo com a sessão ativa.

**Correção** em `agent-stop.sh` (bloco de bloqueio, antes do `exit 0`):

```bash
# Adicionado: | .last_turn_ts = $now
jq --argjson c "$_NEW_CONSEC" --arg now "$NOW_ISO" \
  '.compliance.consecutive_unauthorized = $c | .compliance.last_turn_authorized = false | .last_turn_ts = $now' \
  "$CTX_FILE" > "$CTX_FILE.tmp" && mv "$CTX_FILE.tmp" "$CTX_FILE" || true
```

### 16.5 Novos Testes — Grupo 21 ampliado (V90-13 a V90-15)

| Teste  | Descrição                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------- |
| V90-13 | watchdog.sh SESSION_STALE threshold ≥ 24h (valor padrão: 36h)                                         |
| V90-14 | watchdog.sh filtra STALE_ID_MISMATCHES por sessão atual, cutoff 6h, sem ruído de subagente            |
| V90-15 | agent-stop.sh atualiza `last_turn_ts` tanto em bloqueios quanto em turnos normais (TURN_IDLE preciso) |

### 16.6 Arquivos Modificados em v9.0 (seção limpeza de alertas)

| Arquivo                               | Modificação                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `.github/hooks/scripts/watchdog.sh`   | STALE_HOURS: 8→36; STALE_ID_MISMATCHES: filtro session_id + cutoff 6h + exclusão subagent |
| `.github/hooks/scripts/agent-stop.sh` | `last_turn_ts` atualizado no bloco de bloqueio (antes do `exit 0`)                        |
| `.github/hooks/scripts/smoke-test.sh` | V90-13, V90-14, V90-15 adicionados ao Grupo 21                                            |

### 16.7 Métricas de Sucesso v9.0 (seção limpeza)

- [x] `SESSION_STALE` eliminado: threshold 36h não dispara para sessões de trabalho longas (V90-13)
- [x] `STALE_ID_MISMATCHES` eliminado: filtro temporal+sessão+subagente elimina ruído histórico
      (V90-14)
- [x] `TURN_IDLE` corrigido: `last_turn_ts` agora atualiza em bloqueios, apenas turnos completamente
      inativos disparam (V90-15)
- [x] `CONSEC_UNAUTH` e `AUTH_FLAG_EXISTS`: confirmados como auto-corretos quando
      `vscode_askQuestions` é chamado
- [x] shellcheck -S error: zero erros em todos os scripts modificados
- [x] **183/183 PASS** (180 anteriores + V90-13, V90-14, V90-15)

---

## 17. v9.1 — Bugs de Fluxo Pós-Close (BUG-PC-01/02/03) (2026-03-11)

### 17.1 Contexto: Análise do Último Fim de Sessão

Análise do `audit.jsonl` revelou que o usuário enviou a `close_key` correta via
`vscode_askQuestions`, mas a sessão apresentou comportamento anômalo pós-close:

1. `sessionClose_key_validated` registrado **DUAS vezes** (em vez de uma)
2. `sessionCloseAuthorized` registrado **DUAS vezes**
3. Após o close, o próximo prompt chegou no mesmo processo Copilot sem nova detecção de sessão

### 17.2 Bugs Encontrados e Corrigidos

#### BUG-PC-01 — Post-Close Orphan Session (`log-prompt.sh`)

**Causa raiz**: Quando `session-close.sh` encerra a sessão, ele seta `ended_at` e
`end_reason=authorized_close` no contexto. O VS Code, porém, **não** dispara o hook `sessionStart`
automaticamente para o mesmo painel — o próximo prompt do usuário chega via `userPromptSubmitted`,
mas o `log-prompt.sh` não tinha lógica para detectar o estado pós-close e iniciar uma nova sessão
inline.

**Resultado**: O agente continuava operando no contexto "morto" — session_id antigo, close_key
antiga (já consumida), `ended_at` preenchido.

**Fix — RECONNECT-02** em `log-prompt.sh`:

- Detecta `ended_at != null` no contexto ao receber novo prompt
- Gera novo `session_id` (UUID via `/proc/sys/kernel/random/uuid`) e nova `close_key` (random 8-char
  hex)
- Limpa `ended_at`, `end_reason`, `close_key_validated`; seta `source = "inline_restart"`
- Loga evento `sessionStart_inline` no `audit.jsonl`
- Reseta contadores de turno e compliance
- Preserva `prev_session_id`, `prev_ended_at`, `prev_end_reason` para rastreabilidade

```bash
# Exemplo: contexto após fix executar
{
  "session": {
    "id": "66abca9d-8655-4060-84b7-a1a3079c476d",   ← novo UUID
    "source": "inline_restart",
    "close_key": "ENCERRAR-58D0F5A7",               ← nova chave
    "ended_at": null,                                ← limpo
    "end_reason": null,                              ← limpo
    "prev_session_id": "dcf579af-...",               ← rastreabilidade
    "prev_end_reason": "authorized_close"
  }
}
```

**Evidência de funcionamento** (STDERR do script durante a sessão real):

```
[log-prompt] Sessão anterior encerrada (2026-03-11T01:51:18Z). Nova sessão inline: 66abca9d-... | close_key: ENCERRAR-58D0F5A7
```

#### BUG-PC-02 — Watchdog false `STALE_ENDED_AT` (`watchdog.sh`)

**Causa raiz**: Após `sessionCloseAuthorized`, o contexto tem `source=auto_recovery` (oriundo da
inicialização) E `ended_at` preenchido (pelo `session-close.sh`). O watchdog tratava ANY combinação
`auto_recovery + ended_at != null` como estado órfão/stale, emitindo alerta falso-positivo
`STALE_ENDED_AT`.

**Fix**: O bloco de detecção `STALE_ENDED_AT` agora lê `end_reason` antes de tomar a decisão:

- **`end_reason = authorized_close` E `close_key_validated = true`**: close legítimo → **não** emite
  alerta; loga mensagem informativa de que sessão inline ocorrerá ao próximo prompt
- **`end_reason` vazio ou diferente**: stale real (pré-v8.1 fake sessionEnd) → emite alerta
  `STALE_ENDED_AT`

```bash
# Lógica do fix (watchdog.sh)
elif [ "$_CTX_KEY_VALIDATED" = "true" ] && [ "$_CTX_END_REASON" = "authorized_close" ]; then
    # Close LEGÍTIMO — inline_restart criará nova sessão no próximo prompt
    SESSION_ACTIVE=true
    _STALE_ENDED_AT_WARN=false
    # Loga mensagem informativa sem gerar alerta
else
    _STALE_ENDED_AT_WARN=true   # ← stale real
fi
```

#### BUG-PC-03 — Double `sessionCloseAuthorized` (`post-tool-use.sh`)

**Causa raiz**: O usuário enviou a `close_key` em duas chamadas separadas de `vscode_askQuestions`
(uma no Template A e depois novamente no Template F). O `post-tool-use.sh` não tinha guard de
idempotência — ao detectar a `close_key` na resposta, chamava `session-close.sh` cada vez,
resultando em:

- `sessionClose_key_validated` logado 2×
- `sessionCloseAuthorized` logado 2×
- `session-close.sh` executado 2×

**Fix**: Guard de idempotência antes de chamar `session-close.sh`:

```bash
# Guard de idempotência (post-tool-use.sh)
_ALREADY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" ...)"
if [ "$_ALREADY_VALIDATED" = "true" ]; then
  # close_key já processada anteriormente — skip silencioso, atualiza apenas metadados menores
  ...
else
  # Processar normalmente: setar close_key_validated=true, logar, chamar session-close.sh
  ...
fi
```

### 17.3 Novos Testes — Grupo 21 ampliado (V90-16 a V90-18)

| Teste  | Tipo      | Descrição                                                                                                                                                                            |
| ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V90-16 | Funcional | `log-prompt.sh` RECONNECT-02: `ended_at != null` em contexto → executa em sandbox isolado → verifica `source=inline_restart`, `ended_at=null`, evento `sessionStart_inline` no audit |
| V90-17 | Estático  | `watchdog.sh` BUG-PC-02: script contém `authorized_close` + `_CTX_END_REASON` no bloco STALE_ENDED_AT                                                                                |
| V90-18 | Estático  | `post-tool-use.sh` BUG-PC-03: script contém `_ALREADY_VALIDATED` + `close_key_validated // false` (guard de idempotência)                                                            |

**Detalhe técnico V90-16**: O teste usa isolamento de sandbox via cópia de scripts para diretório
temporário — `HOOK_DIR` resolve automaticamente para o sandbox via `dirname "${BASH_SOURCE[0]}"`.
Sem necessidade de env vars de override (`HOOKS_STATE_DIR` não é usado pelo `log-prompt.sh`).

### 17.4 Arquivos Modificados em v9.1

| Arquivo                                                | Modificação                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `.github/hooks/scripts/log-prompt.sh`                  | BUG-PC-01: bloco RECONNECT-02 — detecção de `ended_at != null` → sessão `inline_restart`  |
| `.github/hooks/scripts/watchdog.sh`                    | BUG-PC-02: guard `authorized_close` no STALE_ENDED_AT — distingue close legítimo de stale |
| `.github/hooks/scripts/post-tool-use.sh`               | BUG-PC-03: guard `_ALREADY_VALIDATED` — idempotência de `session-close.sh`                |
| `.github/hooks/scripts/smoke-test.sh`                  | V90-16, V90-17, V90-18 adicionados ao Grupo 21                                            |
| `DOCUMENTAÇÃO/HOOKS/RELATORIO-SESSION-HARDENING-v3.md` | Esta seção                                                                                |

### 17.5 Métricas de Sucesso v9.1

- [x] BUG-PC-01 corrigido: log-prompt.sh RECONNECT-02 detecta `ended_at != null` → `inline_restart`
      (V90-16)
- [x] BUG-PC-02 corrigido: watchdog.sh não emite falso `STALE_ENDED_AT` para
      `end_reason=authorized_close` (V90-17)
- [x] BUG-PC-03 corrigido: post-tool-use.sh `_ALREADY_VALIDATED` guard previne duplo
      `sessionCloseAuthorized` (V90-18)
- [x] Contexto real validado: `ended_at=null`, `source=inline_restart`,
      `close_key=ENCERRAR-58D0F5A7`
- [x] shellcheck -S error: zero erros em todos os 3 scripts modificados
- [x] **186/186 PASS** (183 anteriores + V90-16, V90-17, V90-18)
