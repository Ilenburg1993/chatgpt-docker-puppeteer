# Análise Completa do Sistema de Hooks — v1

> **Data**: 2026-03-09 **Branch**: `main` (HEAD: `b4847def`) **Escopo**: Sistema completo de
> SESSION/SECTION/TURN, 24 scripts, 8 hooks configurados **Status**: Diagnóstico + Plano de Evolução

---

## 1. Objetivo Final do Sistema

### Visão

O sistema SESSION/SECTION/TURN é a **espinha dorsal de observabilidade e governança** do agente
Copilot neste repositório. Seu objetivo final é:

1. **Rastreabilidade total**: Toda ação do agente (ferramenta, decisão, output) é registrada com
   contexto hierárquico (SESSION → SECTION → TURN), permitindo auditoria completa.

2. **Controle de autorização**: O agente NÃO pode encerrar um turno sem chamar `vscode_askQuestions`
   (detecção automática + `decision:block`), nem encerrar uma sessão sem a chave `ENCERRAR-XXXXXXXX`
   (validação em `post-tool-use.sh` + `session-end.sh`).

3. **Governança contínua**: Métricas de compliance, qualidade e performance acumulam ao longo de
   turnos e sessões. Violações geram flags (`UNAUTHORIZED_CLOSE.flag`, `SESSION_CLOSE_NO_KEY.flag`)
   que alertam na próxima sessão.

4. **Isolamento de estado**: Cada sessão tem um `session_id` único. Guards em todos os hooks-chave
   impedem que dados de testes ou sessões anteriores contaminem a sessão ativa.

5. **Ciclo de vida previsível**: SESSION começa com `session-start.sh` (automático), subdivide-se em
   SECTIONs (manuais via agente), cada SECTION contém TURNs (automáticos via prompt/stop), e SESSION
   encerra com `session-end.sh` (automático) após validação de chave.

### Invariante Canônico

> Sempre deve haver SESSION + SECTION + TURN ativos simultaneamente.

```
SESSION (1 por Copilot Chat)
  └── SECTION (≥1, fase lógica)
       └── TURN (≥1, ciclo prompt → resposta)
```

---

## 2. Inventário Atual

### 2.1. Hooks Configurados (`copilot-hooks.json`)

| #   | Hook                  | Script              | Timeout | Frequência Observada | Status      |
| --- | --------------------- | ------------------- | ------- | -------------------- | ----------- |
| 1   | `sessionStart`        | `session-start.sh`  | 60s     | **0x esta sessão**   | ⚠️ FALHO     |
| 2   | `userPromptSubmitted` | `log-prompt.sh`     | 10s     | ~4x/sessão (raro)    | ✅ Funcional |
| 3   | `preToolUse`          | `pre-tool-use.sh`   | 15s     | ~1000x/sessão        | ✅ Funcional |
| 4   | `postToolUse`         | `post-tool-use.sh`  | 15s     | ~1000x/sessão        | ✅ Funcional |
| 5   | `agentStop`           | `agent-stop.sh`     | 30s     | ~1x/turno            | ✅ Funcional |
| 6   | `subagentStop`        | `subagent-stop.sh`  | 15s     | Raro                 | ✅ Funcional |
| 7   | `errorOccurred`       | `error-occurred.sh` | 15s     | **0x total**         | ❌ INERTE    |
| 8   | `sessionEnd`          | `session-end.sh`    | 30s     | ~1-3x                | ✅ Funcional |

### 2.2. Scripts (24 total, 4674 linhas)

#### Automáticos (disparados pelo Copilot via hooks)

| Script              | Linha | Trigger               | Função Principal                                          |
| ------------------- | ----- | --------------------- | --------------------------------------------------------- |
| `session-start.sh`  | 578   | `sessionStart` hook   | Cria estado completo, briefing, close_key, seção "início" |
| `log-prompt.sh`     | 125   | `userPromptSubmitted` | Hash do prompt, reset de turno, log turnStart             |
| `pre-tool-use.sh`   | 133   | `preToolUse` hook     | Redação de credenciais, métricas, auth_requested          |
| `post-tool-use.sh`  | 213   | `postToolUse` hook    | Resultado, close_key checking, quality gates              |
| `agent-stop.sh`     | 272   | `agentStop` hook      | 3-layer auth, decision:block, compliance                  |
| `subagent-stop.sh`  | 90    | `subagentStop` hook   | Log de subagente, contadores                              |
| `error-occurred.sh` | 89    | `errorOccurred` hook  | Log de erros (NUNCA DISPARA)                              |
| `session-end.sh`    | 312   | `sessionEnd` hook     | Close key validation, rotação, relatório                  |

#### Manuais (chamados pelo agente ou operador)

| Script                        | Linha | Quando Chamar                                                          |
| ----------------------------- | ----- | ---------------------------------------------------------------------- |
| `start-turn.sh`               | 72    | Primeiro ato de cada turno (intent enrichment)                         |
| `start-section.sh`            | 170   | Ao mudar fase lógica de trabalho                                       |
| `section-end.sh`              | 192   | Ao encerrar seção explicitamente (normalmente auto pelo start-section) |
| `session-checkpoint.sh`       | ~50   | Periodicamente (auto pelo agent-stop a cada 5 turnos)                  |
| `add-task.sh`                 | ~40   | Ao criar tarefa                                                        |
| `complete-task.sh`            | ~40   | Ao completar tarefa                                                    |
| `save-finding.sh`             | ~50   | Ao registrar achado de auditoria                                       |
| `resolve-finding.sh`          | ~40   | Ao resolver achado                                                     |
| `reset-auth-violation.sh`     | ~30   | Reset manual do UNAUTHORIZED_CLOSE.flag                                |
| `sync-tasks-to-docs.sh`       | ~80   | Auto pelo agent-stop a cada 5 turnos, ou manual                        |
| `generate-daily-report.sh`    | ~60   | Geração de relatório diário                                            |
| `generate-session-summary.sh` | ~50   | Auto pelo session-end.sh                                               |
| `analytics.sh`                | ~80   | Análise manual de métricas                                             |
| `export-metrics.sh`           | ~60   | Exportação de métricas                                                 |
| `install-git-hooks.sh`        | ~30   | Setup único                                                            |
| `smoke-test.sh`               | 309   | Validação manual do sistema                                            |

### 2.3. Estado Atual (`.github/hooks/state/`)

| Arquivo                   | Tamanho     | Status                              |
| ------------------------- | ----------- | ----------------------------------- |
| `session-context.json`    | **0 bytes** | 🔴 **VAZIO — Sem sessão ativa**      |
| `session-briefing.md`     | 4.570 B     | De sessão anterior (06:22:22Z)      |
| `pending-tasks.md`        | 10.779 B    | Tarefas pendentes acumuladas        |
| `UNAUTHORIZED_CLOSE.flag` | 187 B       | ⚠️ Violação de sessão anterior ativa |

### 2.4. Logs (`.github/hooks/logs/`)

| Arquivo              | Tamanho | Eventos                           |
| -------------------- | ------- | --------------------------------- |
| `audit.jsonl`        | 1.79 MB | 2564 eventos p/ sessão `a0be08af` |
| `tool-metrics.jsonl` | 159 KB  | Métricas de performance           |
| `errors.jsonl`       | 158 B   | Mínimo                            |
| `findings.jsonl`     | 3 KB    | Achados de auditoria              |

---

## 3. Descobertas Críticas

### 🔴 D1 — `sessionStart` hook NÃO disparou para a sessão atual

**Evidência**:

- Sessão `a0be08af-7a26-42d8-b8a5-3c43206494c7` tem 2564 eventos no `audit.jsonl`
- Primeiro evento: `preToolUse` em `2026-03-09T02:22:14Z` (NÃO `sessionStart`)
- `rg '"sessionStart"' audit.jsonl | rg "a0be08af"` → **VAZIO** (0 resultados)
- Os únicos `sessionStart` recentes são de testes: `sess_2026030910000`, `test-sess-001`

**Consequência**:

- `session-context.json` está vazio (0 bytes) → nenhum estado de sessão rastreado
- Todos os `session_id guards` são ineficazes (CTX_ACTIVE_SID vazio = guard não bloqueia)
- Métricas de turno, seção, compliance e ferramentas não acumulam
- `agent-stop.sh` funciona parcialmente (fallback para scan direto do audit.jsonl)
- `decision:block` FUNCIONA (lê audit.jsonl diretamente, não depende do contexto)

**Causa raiz provável**: O `sessionStart` é o primeiro evento de uma sessão Copilot. Se o hook falha
ou o evento não é emitido, não há como recuperar. Possibilidades:

1. A extensão Copilot não emitiu o evento `sessionStart` ao reopening do Codespace
2. O `session-start.sh` executou mas crashou (improvável — o briefing existe mas de hora diferente)
3. O Codespace reusou a sessão `a0be08af` sem emitir novo `sessionStart`

### 🔴 D2 — Guards de session_id ineficazes com contexto vazio

**Mecanismo**: Todos os 6 hooks com guard fazem:

```bash
CTX_ACTIVE_SID=$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null)
if [ -n "$CTX_ACTIVE_SID" ] && [ "$INCOMING_SID" != "$CTX_ACTIVE_SID" ]; then
  # BLOQUEIA — session_id não bate
fi
```

**Bug**: Quando `session-context.json` é vazio (0 bytes), `jq` retorna erro, `CTX_ACTIVE_SID` fica
vazio, e o guard `[ -n "$CTX_ACTIVE_SID" ]` é falso → **guard nunca bloqueia nada**.

Isso significa que QUALQUER session_id passa, inclusive de testes. O sistema perde isolamento.

### 🔴 D3 — `section-end.sh` contém código duplicado

**Evidência**: Arquivo tem 192 linhas com 4 `exit 0` (linhas 48, 106, 192, e uma em 136). O script
está duplicado internamente — linhas 107-192 são uma cópia legada sem o campo `section_number`
(schema legado v4). A segunda cópia é dead code após `exit 0` na linha 106, mas:

- Infla o arquivo para o dobro do necessário
- Indica erro de copy-paste durante desenvolvimento
- Confunde manutenção futura

### 🟡 D4 — Hook `errorOccurred` nunca dispara

**Evidência**: Zero ocorrências de `errorOccurred` no `audit.jsonl` em toda a história. O evento SDK
provável é `PostToolUseFailure` (nome no array `Mti` da extensão), não `errorOccurred`. O mapeamento
CLI camelCase→PascalCase pode não estar cobrindo este evento.

**Impacto**: O script `error-occurred.sh` (89 linhas) é código inerte. Erros de ferramentas não são
rastreados via este hook.

### 🟡 D5 — `userPromptSubmitted` é raro e não-confiável para detecção de turno

**Evidência**: ~4 eventos por sessão inteira (de ~2564 totais). O evento `userPromptSubmitted` só
dispara quando o usuário digita diretamente no chat, NÃO quando responde a `vscode_askQuestions`.

**Impacto**: O `log-prompt.sh` que reseta o estado do turno (`current_turn.*`) é chamado raramente.
A maioria dos turnos começa sem reset de estado.

### 🟢 D6 — `chat.useClaudeHooks` está configurado

**Evidência**: `rg -i "hooks" .vscode/settings.json` → linha 824: `"chat.useClaudeHooks": true`

Descoberta anterior indicava ausência — foi um falso positivo. A configuração ESTÁ presente.

### 🟢 D7 — `decision:block` funciona mesmo sem session-context

O mecanismo `decision:block` em `agent-stop.sh` lê `audit.jsonl` diretamente para detectar
`vscode_askQuestions`, não dependendo do `session-context.json`. Portanto, a proteção de autorização
de turno FUNCIONA mesmo na situação degradada atual.

---

## 4. Classificação: Automático vs Manual — Quando Chamar

### 4.1. Ciclo de Vida Ideal (quando tudo funciona)

```
[COPILOT EXTENSION]                    [AGENT (IA)]                    [HOOK SCRIPTS]
       │                                    │                                │
       ├── sessionStart ──────────────────►  session-start.sh               │
       │                                    │  (cria contexto, briefing)     │
       │                                    ├── Lê briefing ──────────────►  │
       │                                    ├── Template E (Kickoff) ──────► [USUÁRIO]
       │                                    │                                │
       ├── userPromptSubmitted ───────────► log-prompt.sh                    │
       │                                    │  (reset turno, hash prompt)    │
       │                                    ├── start-turn.sh "intent" ────► (MANUAL)
       │                                    ├── start-section.sh "tema" ───► (MANUAL, primeira vez)
       │                                    │                                │
       │  ┌─ [LOOP DE TRABALHO] ──────────────────────────────────────────┐  │
       │  │  preToolUse ──────────────────► pre-tool-use.sh               │  │
       │  │  [executa ferramenta]                                         │  │
       │  │  postToolUse ─────────────────► post-tool-use.sh              │  │
       │  └───────────────────────────────────────────────────────────────┘  │
       │                                    │                                │
       │                                    ├── vscode_askQuestions ────────► [USUÁRIO]
       │                                    │  (auth do turno)               │
       ├── agentStop ─────────────────────► agent-stop.sh                    │
       │                                    │  (decision:block se não auth)  │
       │                                    │                                │
       │  [... próximos turnos ...]                                          │
       │                                    │                                │
       │                                    ├── Template F (Close) ─────────► [USUÁRIO]
       │                                    │  (close_key ENCERRAR-XXXXXXXX) │
       ├── sessionEnd ────────────────────► session-end.sh                   │
       │                                    │  (valida chave, relatório)     │
       └────────────────────────────────────┘                                │
```

### 4.2. O que o agente DEVE fazer manualmente em cada turno

| Momento               | Ação                  | Script/Ferramenta                       |
| --------------------- | --------------------- | --------------------------------------- |
| **Início de turno**   | Declarar intenção     | `start-turn.sh "descrição da intenção"` |
| **Mudança de fase**   | Abrir nova seção      | `start-section.sh "nome da seção"`      |
| **Antes de encerrar** | Solicitar autorização | `vscode_askQuestions` (tool call REAL)  |
| **Primeira sessão**   | Ler briefing          | `read_file session-briefing.md`         |
| **Primeira sessão**   | Kickoff               | `vscode_askQuestions` com Template E    |
| **Encerrar sessão**   | Close key             | `vscode_askQuestions` com Template F    |

### 4.3. O que é AUTOMÁTICO (não precisa de intervenção)

| O quê                   | Quando                   | Script                                           |
| ----------------------- | ------------------------ | ------------------------------------------------ |
| Criação de estado       | Início de sessão Copilot | `session-start.sh`                               |
| Registro de prompts     | Prompt do usuário        | `log-prompt.sh`                                  |
| Rastreio de ferramentas | Cada tool call           | `pre-tool-use.sh` + `post-tool-use.sh`           |
| Detecção de autorização | Fim de turno             | `agent-stop.sh`                                  |
| Checkpoints             | A cada 5 turnos          | `session-checkpoint.sh` (via agent-stop)         |
| Sincronização de tasks  | A cada 5 turnos          | `sync-tasks-to-docs.sh` (via agent-stop)         |
| Relatório final         | Fim de sessão            | `session-end.sh` + `generate-session-summary.sh` |
| Rotação de logs         | Fim de sessão            | `session-end.sh` (mantém 5000 linhas)            |

---

## 5. Plano de Correções, Aprimoramentos e Upgrades

### Fase 0: Correções Imediatas (Cirúrgicas) — ✅ IMPLEMENTADA (commit 4ceb3a52)

#### F0.1 — Corrigir `section-end.sh` duplicado ✅

- **Ação**: Remover linhas 107-192 (dead code legado)
- **Risco**: Zero (code unreachable após `exit 0` na linha 106)
- **Tempo**: Imediato

#### F0.2 — Criar mecanismo de auto-recovery para session-context vazio ✅

- **Problema**: Se `sessionStart` não disparar, o sistema inteiro fica degradado
- **Ação**: Em `pre-tool-use.sh` (primeiro hook a disparar), adicionar:
  ```bash
  if [ ! -s "$CTX_FILE" ]; then
    # session-context.json vazio ou inexistente — SESSION degraded
    # Cria contexto mínimo de recovery com o session_id do evento atual
    echo "[recovery] session-context.json vazio — criando estado mínimo" >&2
    jq -n --arg sid "$SESSION_ID" --arg now "$NOW_ISO" '{
          session: { id: $sid, started_at: $now, mode: "recovery", ended_at: null },
          session_stats: { turn_count: 0, tools_total: 0, ... },
          current_turn: { ... },
          current_section: { name: "recovery", started_at: $now, ... },
          last_tool: {},
          compliance: { authorized_turns: 0, unauthorized_turns: 0, ... }
      }' | sponge "$CTX_FILE"
  fi
  ```
- **Benefício**: Sistema se auto-recupera em vez de rodar degradado indefinidamente
- **Risco**: Baixo — o contexto de recovery é menos rico que o de session-start.sh, mas funcional

#### F0.3 — Fortalecer session_id guard para contexto vazio ✅

- **Problema**: Guard não bloqueia quando `CTX_ACTIVE_SID` está vazio
- **Ação**: Em todos os 6 scripts com guard, adicionar:
  ```bash
  if [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (sem sessão)" >&2
    # Permitir execução mas logar o estado degradado
  fi
  ```
- **Risco**: Baixo — é apenas log, não bloqueia funcionalidade

### Fase 1: Aprimoramentos Funcionais — ✅ IMPLEMENTADA (commit 4ceb3a52)

#### F1.1 — Remover ou remapear hook `errorOccurred` ✅

- **Implementado**: Removido de `copilot-hooks.json`. Adicionados 3 novos hooks:
  - `postToolUseFailure` → `tool-use-failure.sh`
  - `subagentStart` → `subagent-start.sh`
  - `preCompact` → `pre-compact.sh`

#### F1.2 — Compensar raridade do `userPromptSubmitted` ✅

- **Implementado**: agent-stop.sh agora reseta `current_turn` completamente para o próximo turno

#### F1.3 — Adicionar hooks não-configurados de alto valor ✅

- **Implementado**: SubagentStart, PostToolUseFailure e PreCompact adicionados ao copilot-hooks.json
  Hooks SDK disponíveis mas não configurados:

| Hook SDK             | Valor | Justificativa                                                    |
| -------------------- | ----- | ---------------------------------------------------------------- |
| `SubagentStart`      | Alto  | Complementa `subagentStop` — rastreia início E fim de subagentes |
| `PostToolUseFailure` | Alto  | Substitui `errorOccurred` — rastreia falhas de ferramentas       |
| `PreCompact`         | Médio | Detecta quando o contexto vai ser compactado (perda de memória)  |
| `Notification`       | Baixo | Notificações do sistema (informativo)                            |

#### F1.4 — Script de inicialização manual de sessão ✅

- **Implementado**: `manual-session-init.sh` criado com auto-detecção de session_id
- **Situação**: Quando `sessionStart` não dispara, o operador precisa de um caminho
- **Ação**: Criar `manual-session-init.sh` que:
  1. Verifica se `session-context.json` está vazio
  2. Lê o `session_id` do evento mais recente no audit.jsonl
  3. Executa a lógica de `session-start.sh` com esse ID
  4. Marca a sessão como `mode: "manual_recovery"`

### Fase 2: Hardening e Robustez

#### F2.1 — Timeout de sessão com watchdog

- Adicionar detecção de sessão órfã (sessão sem `sessionEnd` por >4h)
- Em `pre-tool-use.sh`: se `session.started_at` > 4h atrás e sem atividade recente → log warning
- Evita acumulação infinita de métricas em sessões abandonadas

#### F2.2 — Dashboard de compliance em tempo real

- `compliance.sh` (novo script) que gera relatório rápido:
  ```
  Sessão: a0be08af | Modo: normal | Uptime: 7h12m
  Turnos: 15 (14 autorizados, 1 não-autorizado)
  Seções: 3 (atual: "análise-hooks")
  Ferramentas: 2564 total (15 falhas, 0.6%)
  Quality Gates: lint ✅ | format ✅ | test ?.
  ```

#### F2.3 — Smoke-test que não contamina estado

- **Bug atual**: smoke-test pode interferir com sessão real se não isolar corretamente
- **Ação**: Verificar que o sandbox do smoke-test é 100% estanque:
  - `session-context.json` real nunca é tocado
  - `audit.jsonl` recebe eventos de teste (inevitável mas aceitável com session_id guard)
  - Adicionar flag `"source": "smoke-test"` em eventos de teste para filtragem

### Fase 3: Evolução Arquitetural

#### F3.1 — Schema v5: Recovery e Self-Healing

- Adicionar campo `session.mode` com valores: `normal`, `recovery`, `manual_recovery`, `degraded`
- Adicionar campo `session.recovery_attempted_at` para rastreio
- Adicionar campo `session.health_status`: `healthy`, `degraded`, `critical`

#### F3.2 — Migração de eventos para formato estruturado

- Atualmente: text logging no stderr + JSONL no audit
- Evolução: todos os outputs de hook em JSON (stdout para o Copilot, audit para persistência)
- Permite que o Copilot consuma informações estruturadas dos hooks

#### F3.3 — Hook configuration generator

- Script que gera `copilot-hooks.json` a partir de metadados dos scripts
- Cada script declara no cabeçalho: hook esperado, timeout, dependências
- Garante que `copilot-hooks.json` e os scripts estejam sempre sincronizados

---

## 6. Diagnóstico da Sessão Atual e Recomendação

### Situação

- **Sessão Copilot ativa**: `a0be08af-7a26-42d8-b8a5-3c43206494c7`
- **Eventos acumulados**: 2564 (todos `preToolUse`/`postToolUse`/`agentStop`/`sessionEnd`)
- **`sessionStart` disparou**: **NÃO** (zero eventos `sessionStart` para este ID)
- **`session-context.json`**: **VAZIO** (0 bytes)
- **`decision:block`**: FUNCIONAL (não depende do contexto)
- **Métricas de turno/seção/compliance**: **NÃO RASTREADAS** (sem contexto)
- **session_id guards**: **INEFICAZES** (CTX_ACTIVE_SID vazio)

### Recomendação: Iniciar sessão manualmente

**SIM, deve-se iniciar manualmente.** A sessão está em modo degradado desde `02:22:14Z` (~7 horas).
O `decision:block` garante segurança mínima, mas sem estado, todo o rastreio de métricas, compliance
e seções está perdido.

**Procedimento recomendado**:

```bash
# Opção 1: Executar session-start.sh com o session_id real
echo '{"session_id":"a0be08af-7a26-42d8-b8a5-3c43206494c7"}' \
  | bash .github/hooks/scripts/session-start.sh

# Opção 2: Implementar F0.2 (auto-recovery) primeiro, depois deixar o próximo
# preToolUse criar o contexto automaticamente
```

**Recomendação**: Implementar **F0.2 (auto-recovery)** primeiro, pois resolve o problema
estruturalmente. Depois, o sistema se auto-recupera na próxima invocação de hook. Isso é preferível
a um one-shot manual que não previne recorrência.

---

## 7. Priorização do Plano

### Urgência Imediata (hoje)

| #   | Item | Descrição                           | Dependência |
| --- | ---- | ----------------------------------- | ----------- |
| 1   | F0.1 | Corrigir section-end.sh duplicado   | Nenhuma     |
| 2   | F0.2 | Auto-recovery em pre-tool-use.sh    | Nenhuma     |
| 3   | F0.3 | Log de guard degradado              | Nenhuma     |
| 4   | —    | Iniciar sessão (manual ou via F0.2) | F0.2        |

### Curto Prazo (próximas 2-3 sessões)

| #   | Item | Descrição                                          | Dependência |
| --- | ---- | -------------------------------------------------- | ----------- |
| 5   | F1.1 | Remover/remapear errorOccurred                     | Nenhuma     |
| 6   | F1.2 | Reset de turno no agent-stop                       | Nenhuma     |
| 7   | F1.3 | Adicionar hooks SubagentStart + PostToolUseFailure | Nenhuma     |
| 8   | F1.4 | Script manual-session-init.sh                      | F0.2        |

### Médio Prazo (próximas 5-10 sessões)

| #   | Item | Descrição               | Dependência |
| --- | ---- | ----------------------- | ----------- |
| 9   | F2.1 | Watchdog de sessão órfã | F0.2        |
| 10  | F2.2 | Dashboard de compliance | F1.2        |
| 11  | F2.3 | Smoke-test estanque     | Nenhuma     |

### Longo Prazo (backlog)

| #   | Item | Descrição                   | Dependência |
| --- | ---- | --------------------------- | ----------- |
| 12  | F3.1 | Schema v5 (recovery fields) | F0.2, F1.4  |
| 13  | F3.2 | Outputs JSON estruturados   | F3.1        |
| 14  | F3.3 | Hook config generator       | Nenhuma     |

---

## 8. Protocolo Operacional Resumido

### Para o Agente de IA

```
1. INÍCIO DE SESSÃO
   └── Ler session-briefing.md
   └── Verificar session-context.json (está populado? tem sessão ativa?)
   └── Se vazio → aguardar auto-recovery (F0.2) ou alertar operador
   └── Invocar vscode_askQuestions com Template E (Session Kickoff)

2. INÍCIO DE TURNO
   └── Chamar: bash .github/hooks/scripts/start-turn.sh "intenção do turno"

3. MUDANÇA DE FASE
   └── Chamar: bash .github/hooks/scripts/start-section.sh "nome da seção"

4. DURANTE O TRABALHO
   └── [AUTOMÁTICO] preToolUse + postToolUse rastreiam cada ferramenta
   └── O agente apenas trabalha normalmente

5. FIM DE TURNO
   └── OBRIGATÓRIO: Invocar vscode_askQuestions (tool call REAL, não texto)
   └── [AUTOMÁTICO] agent-stop.sh detecta autorização
   └── [AUTOMÁTICO] decision:block impede encerramento não-autorizado

6. FIM DE SESSÃO
   └── Invocar vscode_askQuestions com Template F (Session Close)
   └── Fornecer chave ENCERRAR-XXXXXXXX
   └── [AUTOMÁTICO] session-end.sh valida e gera relatório
```

### Para o Operador Humano

```
1. Se session-context.json vazio → hooks estão em modo degradado
   └── Após F0.2: auto-recovery resolve sozinho
   └── Antes de F0.2: executar manual-session-init.sh ou reiniciar Copilot Chat

2. Se UNAUTHORIZED_CLOSE.flag existe → houve violação em sessão anterior
   └── Revisar o que aconteceu no audit.jsonl
   └── Executar: bash .github/hooks/scripts/reset-auth-violation.sh

3. Se SESSION_CLOSE_NO_KEY.flag existe → sessão encerrou sem chave
   └── Não é crítico, mas indica workflow não-ideal
   └── Verificar se o agente está usando Template F

4. Para validar o sistema:
   └── bash .github/hooks/scripts/smoke-test.sh
   └── Esperar 60/60+ checks passando
```

---

## Apêndice A: Mapa de session_id Guards

| Script              | Guard?                   | Comportamento com CTX vazio                             |
| ------------------- | ------------------------ | ------------------------------------------------------- |
| `session-start.sh`  | Não (cria o contexto)    | N/A                                                     |
| `log-prompt.sh`     | SIM                      | Guard ineficaz (permite tudo)                           |
| `pre-tool-use.sh`   | SIM                      | Guard ineficaz → ideal para recovery                    |
| `post-tool-use.sh`  | SIM                      | Guard ineficaz (permite tudo)                           |
| `agent-stop.sh`     | SIM                      | Guard ineficaz, decision:block funciona via audit.jsonl |
| `subagent-stop.sh`  | SIM                      | Guard ineficaz (permite tudo)                           |
| `error-occurred.sh` | SIM                      | Nunca dispara de qualquer forma                         |
| `session-end.sh`    | Não (encerra o contexto) | N/A                                                     |

## Apêndice B: Eventos SDK Não-Configurados

Eventos disponíveis na extensão Copilot (array `Mti`) que NÃO temos hooks:

| Evento SDK           | Configurado?  | Recomendação                     |
| -------------------- | ------------- | -------------------------------- |
| `PreToolUse`         | ✅             | —                                |
| `PostToolUse`        | ✅             | —                                |
| `PostToolUseFailure` | ✅             | **Adicionado** (commit 4ceb3a52) |
| `Notification`       | ❌             | Opcional (baixo valor)           |
| `UserPromptSubmit`   | ✅             | —                                |
| `SessionStart`       | ✅             | —                                |
| `SessionEnd`         | ✅             | —                                |
| `Stop`               | ✅ (agentStop) | —                                |
| `SubagentStart`      | ✅             | **Adicionado** (commit 4ceb3a52) |
| `SubagentStop`       | ✅             | —                                |
| `PreCompact`         | ✅             | **Adicionado** (commit 4ceb3a52) |
| `PermissionRequest`  | ❌             | Opcional                         |
| `Setup`              | ❌             | Opcional (one-time)              |
| `TeammateIdle`       | ❌             | N/A (multi-agent)                |
| `TaskCompleted`      | ❌             | Interessante para rastreio       |
| `ConfigChange`       | ❌             | Baixo valor                      |
| `WorktreeCreate`     | ❌             | Baixo valor                      |
| `WorktreeRemove`     | ❌             | Baixo valor                      |

---

_Documento gerado em 2026-03-09. Atualizado em 2026-03-10 após implementação das Fases 0 e 1 (commit
4ceb3a52)._
