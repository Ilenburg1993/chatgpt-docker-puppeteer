# Instruções para todos os agentes

**Propósito**: baseline curto e permanente para agentes de IA neste workspace. **Status**: Canônico.
**Última atualização**: 10 de março de 2026.

Este arquivo é lido automaticamente por agentes de IA (Copilot, Claude, ChatGPT, etc.) que interagem
com o workspace. Ele complementa `.github/copilot-instructions.md` e usa
`.github/instructions/project-canon.instructions.md` como baseline estável.

---

## Protocolo de encerramento por nível

> **Modelo v5.0 — TURN Autônomo.** Vigente desde 2026-03-10.

### O que se aplica — por nível

**TURN (turno)** — Autônomo, sem obrigação de `vscode_askQuestions`:

- TURNs encerram livremente. O agente **não** precisa de autorização para encerrar.
- `vscode_askQuestions` é **recomendado** como boa prática de comunicação, não obrigatório.
- Bons momentos para chamar: tarefa concluída → Template A; checkpoint a cada ~5 TURNs → Template D;
  proposta arquitetural → Template C; sessão ociosa → Template E.

**SECTION (seção temática)** — Autônoma, sem autorização do usuário:

- O agente abre e fecha seções com `start-section.sh "nome"` / `section-end.sh "motivo"`
- A mudança de contexto semântico é decisão do agente — sem necessidade de pedir permissão.

**SESSION (sessão)** — Autorização explícita **obrigatória** com close_key:

1. Invocar `vscode_askQuestions` com Template F
2. O usuário digita a chave `ENCERRAR-XXXXXXXX` no campo livre
3. Sem a chave → `SESSION_CLOSE_NO_KEY.flag` → sessão NÃO encerrada validamente

**Commit e/ou Push** — Protocolo obrigatório com Template G:

1. Antes de qualquer `git commit` e/ou `git push`, invocar `vscode_askQuestions` com Template G
2. O usuário orienta se deve: commitar+pushar, revisar com subagente, continuar melhorando, etc.
3. Executar apenas a ação autorizada pelo usuário

### Monitoramento automático (informativo)

O sistema registra chamadas de `vscode_askQuestions` para auditoria:

- `agent-stop.sh` detecta se `vscode_askQuestions` foi chamado no turno
- Sem chamada: loga `turnEnd_no_askQuestions` em `audit.jsonl` (informativo, **sem bloqueio**)
- Com chamada: loga `turnEnd_authorized`
- Nudge periódico via `systemMessage` a cada `HOOKS_TURN_NUDGE_INTERVAL` TURNs (padrão: 5)

---

## Regras universais

- Responder em **português brasileiro (pt-BR)** ao interagir com humanos ou ao escrever
  documentação.
- Presumir Node.js 24+ com ESM obrigatório (`import` / `export`).
- Tratar `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md` como a arquitetura oficial.
- Aplicar estas instruções junto com `.github/copilot-instructions.md` e os `*.instructions.md`
  relevantes.

## Mapa estável do repositório

| Diretório           | Papel                                                                       |
| ------------------- | --------------------------------------------------------------------------- |
| `src/`              | Runtime do produto — `src/agent/` são workers internos, ≠ `agents/` na raiz |
| `tests/`            | Testes, harness e quarentena em `legacy/`                                   |
| `scripts/`          | Automação operacional, auditoria e tooling interno                          |
| `DOCUMENTAÇÃO/`     | Documentação canônica (arquitetura, bugs, CI/CD, relatórios, operações)     |
| `.github/`          | Instruções permanentes, skills, workflows e agentes                         |
| `agents/`, `tools/` | Tooling auxiliar externo ao runtime                                         |

## Ferramentas CLI disponíveis (DevContainer)

## Code quality — JSDoc e tipagem

**Regra universal**: toda exportação pública relevante deve ter JSDoc robusto e tipagem explícita.

| Task                               | Skill                        | Detalhes                                                               |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Criar/revisar JSDoc                | `jsdoc-authoring`            | JSDoc curto, objetivo, com tipos completos (@param, @returns, @throws) |
| Adicionar tipagem TypeScript/JSDoc | `typing-node24-esm-tsserver` | Hardening de tipos para Node.js 24 + ESM (evita ambiguidades runtime)  |
| Verificar tipos                    | `npm run typecheck:node`     | Lint automático de tipos via tsserver                                  |

**Exemplo**:

```javascript
/**
 * Valida um payload de tarefa.
 *
 * @param {Object} payload - Payload a validar
 * @returns {Promise<boolean>} true se válido
 * @throws {ValidationError} se inválido
 */
export async function validateTask(payload) {
  /* ... */
}
```

**Use sempre `rg` em vez de `grep` e `fd` em vez de `find`.**

- `rg "padrão" src/` — busca de texto (ripgrep)
- `fd "\.js$" src/` — localização de arquivos (fd-find)
- `bat arquivo.js` — leitura com syntax highlighting
- `jq` / `yq` — processamento de JSON e YAML
- `gh` — GitHub CLI (PRs, issues, runs, releases)
- `actionlint` / `hadolint` / `shellcheck` — lint de workflows, Dockerfile e shell scripts
- `hyperfine` — benchmark de comandos
- `sqlite3` — banco de estado local

## Scripts npm essenciais

```
npm run lint             # ESLint
npm run format:check     # Prettier (dry-run)
npm run test:unit        # Testes unitários
npm run test:integration # Testes de integração
npm run typecheck:node   # TypeScript via tsserver
npm run audit:quick      # Auditoria rápida
npm run diagnose         # Diagnóstico do ambiente
npm run rag:health       # Saúde do RAG
npm run lsp:health       # Saúde do LSP
```

## Modo Arquiteto — Autonomia Máxima e Persistência de Sessão

O **Modo Arquiteto** é o comportamento padrão de toda sessão — com ou sem prompt explícito do
usuário. O agente é um colaborador ativo e autônomo, não um executor passivo.

---

### REGRA FUNDAMENTAL — Sessões NUNCA terminam por falta de instrução

> **O agente mantém a sessão ativa através do ciclo:**
> `Executar → Refletir → Registrar → Perguntar (via vscode_askQuestions) → Executar → ...`
>
> A única razão válida para parar de trabalhar é o usuário dizer explicitamente "parar", "stop" ou
> "encerrar sessão". **Tarefas concluídas não encerram a sessão — elas disparam perguntas.**
>
> **Lembre-se: "Perguntar" = chamar a ferramenta `vscode_askQuestions`. Texto plano não conta.**

---

### ⛔ Protocolo de encerramento (resumo — ver regra completa no topo deste arquivo)

> Invocar `vscode_askQuestions` ANTES de qualquer encerramento. **TEXTO PLANO NÃO CONTA.** Somente
> tool call real. O sistema monitora violações automaticamente — ver seção ⛔⛔⛔ no início do
> arquivo.

> **ENCERRAMENTO DE SESSION (extra-hardening)**: além do `vscode_askQuestions`, o usuário DEVE
> digitar a chave `ENCERRAR-XXXXXXXX` no campo livre do **Template F**. A chave está no
> `session-briefing.md` → seção `🔐 CHAVE DE ENCERRAMENTO DA SESSÃO`. **Use sempre Template F**
> (não Template A) ao encerrar a sessão.

---

### Protocolo de início de sessão (OBRIGATÓRIO — todo turno que inicia uma sessão)

1. **Ler** `.github/hooks/state/session-briefing.md` — gerado automaticamente pelo hook
   `sessionStart`
2. **Ler** `.github/hooks/state/pending-tasks.md` — backlog canônico de tarefas
3. **Checar** `turn_count` em `.github/hooks/state/session-context.json`
4. **Invocar** `vscode_askQuestions` com **Template E** (Session Kickoff) — ver abaixo

---

### Protocolo vscode_askQuestions — OBRIGATÓRIO nos seguintes gatilhos

O agente DEVE invocar `vscode_askQuestions` (com múltiplas perguntas ricas) em cada um destes
momentos. **Sem exceção.**

| Gatilho                                       | Template                 | Momento                      |
| --------------------------------------------- | ------------------------ | ---------------------------- |
| Sessão iniciada sem prompt explícito          | **E — Session Kickoff**  | Primeiro ato da sessão       |
| Qualquer tarefa concluída                     | **A — Next Step**        | Logo após marcar `- [x]`     |
| ≥ 3 bugs encontrados numa auditoria           | **B — Bug Discovery**    | Antes de corrigir            |
| Proposta de upgrade arquitetural identificada | **C — Upgrade Proposal** | Antes de executar            |
| `turn_count % 3 == 0` e `turn_count > 0`      | **D — Checkpoint**       | No início do turno           |
| Usuário pede para encerrar a sessão           | **F — Session Close**    | Antes de encerrar SESSION    |
| Antes de qualquer commit e/ou push            | **G — Commit/Push**      | Antes de `git commit`/`push` |

> **Nota de protocolo**: como primeiro ato de cada turno de trabalho, o agente deve chamar
> `bash .github/hooks/scripts/start-turn.sh "intenção"` para declarar sua intenção antes de
> invocar qualquer ferramenta. Isso gera o evento `turnStart_enriched` no audit.jsonl.

---

### Template E — Session Kickoff (sessão sem prompt)

```json
[
  {
    "id": "session_mode",
    "prompt": "Sessão iniciada. Tenho [N_ALTA] tarefas de alta prioridade, [N_MEDIA] de média e [N_BACKLOG] no backlog. [N_FINDINGS] findings pendentes. Como devo proceder?",
    "type": "selectOne",
    "options": [
      "Trabalhar autonomamente — executar tarefas por prioridade (alta → média → backlog)",
      "Auditoria profunda — escolher um módulo e auditar completamente",
      "Focar em bugs — ler findings pendentes e corrigir os críticos primeiro",
      "Proposta arquitetural — analisar o codebase e propor melhorias estruturais",
      "Me mostre o estado atual completo e proponha um plano detalhado para esta sessão",
      "Eu direi o que fazer — aguardar instrução"
    ]
  },
  {
    "id": "module_focus",
    "prompt": "Há algum módulo ou área que devo priorizar nesta sessão?",
    "type": "selectMany",
    "options": [
      "src/kernel/ — motor de execução de tarefas",
      "src/driver/ — automação de browser/Chrome",
      "src/infra/ — pool, queue, storage, locks",
      "src/server/ — API REST e dashboard realtime",
      "src/nerv/ — barramento de eventos (IPC/telemetria)",
      "src/agent/ — workers internos (missão, watchdog, controle)",
      "tests/ — cobertura, qualidade e testes de regressão",
      "DOCUMENTAÇÃO/ — arquitetura, bugs, operações",
      "Sem preferência — deixar o agente decidir"
    ]
  },
  {
    "id": "autonomy_level",
    "prompt": "Quantos ciclos autônomos posso executar antes do próximo checkpoint interativo?",
    "type": "selectOne",
    "options": [
      "1 ciclo — perguntar após cada tarefa concluída",
      "3 ciclos — checkpoint a cada 3 tarefas",
      "5 ciclos — checkpoint a cada 5 tarefas",
      "Modo livre — só interromper quando encontrar algo crítico ou ambíguo",
      "Modo máximo — executar indefinidamente, me notifique apenas de decisões irreversíveis"
    ]
  },
  {
    "id": "audit_depth",
    "prompt": "Qual profundidade de análise para esta sessão?",
    "type": "selectOne",
    "options": [
      "Superficial — lint + typecheck, correções cirúrgicas",
      "Normal — lint + typecheck + testes + JSDoc",
      "Profunda — tudo acima + busca de bugs latentes + análise semântica de lógica",
      "Máxima — auditoria exploratória irrestrita + propostas de upgrade + refactoring"
    ]
  }
]
```

---

### Template A — Next Step (pós-conclusão de tarefa)

```json
[
  {
    "id": "next_action",
    "prompt": "✅ Concluí: [DESCREVER_TAREFA_CONCLUÍDA]. [RESUMO_DO_QUE_FOI_FEITO]. O que fazer agora?",
    "type": "selectOne",
    "options": [
      "Próxima tarefa do backlog (automático — sem interrução)",
      "Auditoria profunda do módulo que acabei de tocar",
      "Expandir o escopo — corrigir TODOS os bugs relacionados que identifiquei",
      "Escrever testes para o código que modifiquei",
      "Gerar relatório completo das mudanças e propor próximos upgrades",
      "Propor refactoring arquitetural baseado no que observei",
      "Pausar — aguardar instrução do usuário"
    ]
  },
  {
    "id": "findings_action",
    "prompt": "Durante a tarefa, registrei [N] findings. O que fazer com eles?",
    "type": "selectMany",
    "options": [
      "Corrigir os críticos/high agora antes de prosseguir",
      "Adicionar todos ao backlog para sessão dedicada",
      "Gerar relatório de auditoria em DOCUMENTAÇÃO/AUDITORIAS/",
      "Ignorar por enquanto — focar na próxima tarefa principal"
    ]
  }
]
```

---

### Template B — Bug Discovery (≥ 3 bugs encontrados)

```json
[
  {
    "id": "bug_action",
    "prompt": "🔍 Encontrei [N] bugs em [MÓDULO]:\n[RESUMO_DOS_BUGS]. Como proceder?",
    "type": "selectMany",
    "options": [
      "Corrigir TODOS agora, nesta sessão",
      "Corrigir apenas os críticos/high priority agora",
      "Gerar relatório completo em DOCUMENTAÇÃO/AUDITORIAS/ e adicionar ao backlog",
      "Corrigir + escrever testes de regressão para cada bug",
      "Corrigir + propor refactoring para prevenir esta classe de bugs no futuro",
      "Documentar apenas — não modificar código agora"
    ]
  },
  {
    "id": "bug_report",
    "prompt": "Devo gerar um relatório formal de auditoria para este módulo?",
    "type": "selectOne",
    "options": [
      "Sim — gerar DOCUMENTAÇÃO/AUDITORIAS/audit-[YYYYMMDD]-[módulo].md",
      "Não — só registrar em findings.jsonl",
      "Sim — e adicionar tarefas derivadas ao pending-tasks.md automaticamente"
    ]
  }
]
```

---

### Template C — Upgrade Proposal (melhoria arquitetural identificada)

```json
[
  {
    "id": "upgrade_scope",
    "prompt": "💡 Identifiquei oportunidade de upgrade em [MÓDULO]: [DESCRIÇÃO_DA_PROPOSTA]. Impacto estimado: [N] arquivos afetados. Devo executar?",
    "type": "selectOne",
    "options": [
      "Sim — executar agora, sem interrupção",
      "Sim — mas em etapas, com checkpoint após cada fase",
      "Mostrar plano detalhado antes de decidir",
      "Adicionar ao backlog como tarefa de alta prioridade e continuar outra coisa",
      "Adicionar ao backlog de média prioridade",
      "Não executar — descartado"
    ]
  },
  {
    "id": "upgrade_tests",
    "prompt": "Se executar o upgrade, qual nível de teste incluo?",
    "type": "selectOne",
    "options": [
      "Testes existentes passando (mínimo)",
      "Testes existentes + testes unitários para o novo código",
      "Suite completa: unit + integration + typecheck + lint",
      "Suite completa + testes de performance (hyperfine)"
    ]
  }
]
```

---

### Template D — Checkpoint Periódico (turn_count % 3 == 0)

```json
[
  {
    "id": "checkpoint",
    "prompt": "📍 Checkpoint — executei [TURN_COUNT] turnos nesta sessão. Completei: [RESUMO_DO_PROGRESSO]. Devo continuar?",
    "type": "selectOne",
    "options": [
      "Continuar — próxima tarefa do backlog",
      "Continuar — mas mudar o foco para [módulo diferente]",
      "Fazer um commit agora e continuar",
      "Fazer um commit e encerrar a sessão",
      "Encerrar sem commit (mudanças serão preservadas)"
    ]
  }
]
```

---

### Template F — Session Close (quando usuário pede para encerrar a sessão)

> **USO OBRIGATÓRIO**: Sempre que o usuário mencionar encerrar, fechar, parar ou sair da sessão,
> invocar este template. Uma SESSION é um recurso premium (1 por dia) — o encerramento exige
> confirmação explícita com a chave dinâmica gerada no início da sessão.
>
> A chave está em:
> - `session-briefing.md` → seção `🔐 CHAVE DE ENCERRAMENTO DA SESSÃO`
> - `session-context.json` → campo `session.close_key`
>
> **Importante**: digitar a chave no campo livre é a ÚNICA forma de autorizar o encerramento.
> Selecionar "Confirmar" sem digitar a chave não valida — o sistema verifica a presença literal
> da string `ENCERRAR-XXXXXXXX` na resposta via `post-tool-use.sh`.

```json
[
  {
    "id": "session_close_key",
    "prompt": "🔐 Confirmação de encerramento de sessão\n\nEsta SESSION é um recurso premium — foi iniciada hoje e não pode ser reaberta facilmente. Para encerrar legitimamente, digite a chave exibida no session-briefing.md:\n\n  [INSERIR CLOSE_KEY AQUI — ex: ENCERRAR-7A3F2B1C]\n\nDigite a chave no campo abaixo (texto livre) ou escolha uma opção:",
    "allowFreeformInput": true,
    "options": [
      "Cancelar — quero continuar trabalhando",
      "Salvar estado e encerrar (sem digitar a chave — encerramento NÃO será validado)"
    ]
  }
]
```

---

### Template G — Commit/Push Pre-Authorization (antes de git commit e/ou push)

> **USO OBRIGATÓRIO**: invocar antes de qualquer `git commit` e/ou `git push`. Apresenta o estado
> das mudanças pendentes e oferece 5 rotas diferentes, incluindo revisão por subagente antes de
> commitar. O agente substitui os placeholders `[...]` com dados reais do contexto atual.
>
> **TURN/SECTION não requerem Template G** — apenas operações git (commit e push).
>
> **⚠️ OBRIGATÓRIO: o agente DEVE substituir todos os `[PLACEHOLDER]` com dados reais antes de
> invocar a ferramenta.** Placeholders crus na tela do usuário são considerados violação de protocolo.
> Use `git status --short | wc -l` para N_MODIFICADOS, `git diff --stat HEAD` para resumo, etc.

```json
[
  {
    "id": "commit_review",
    "prompt": "🔀 Pré-autorização de commit e/ou push\n\nArquivos modificados: [N_MODIFICADOS] | Novos: [N_NOVOS] | Deletados: [N_DELETADOS]\nQuality gates: lint=[STATUS] | typecheck=[STATUS] | testes=[STATUS]\n\nResumo das mudanças: [RESUMO_BREVE]\n\nComo devo prosseguir?",
    "type": "selectOne",
    "allowFreeformInput": true,
    "options": [
      "✅ Commitar + push agora (git add -A && git commit && git push)",
      "✅ Apenas push (código já commitado localmente, só precisa de push)",
      "🔍 Revisão de subagente → corrigir issues → commit + push",
      "🔍 Revisão de subagente → corrigir issues → continuar melhorando (commit depois)",
      "🚀 Prosseguir com mais melhorias e upgrades antes de commitar"
    ]
  },
  {
    "id": "commit_message_hint",
    "prompt": "Se for commitar: qual o escopo principal das mudanças? (campo livre para instrução adicional ao agente)",
    "allowFreeformInput": true,
    "options": [
      "feat: nova funcionalidade",
      "fix: correção de bug",
      "refactor: refatoração sem mudança de comportamento",
      "docs: atualização de documentação",
      "chore: manutenção, scripts, configuração",
      "Deixar o agente decidir com base nas mudanças"
    ]
  }
]
```

---

### Criação Autônoma de Tarefas

O agente DEVE criar novas tarefas quando identificar qualquer um destes gatilhos:

| Gatilho                                                       | Prioridade sugerida |
| ------------------------------------------------------------- | ------------------- |
| Bug confirmado (não apenas suspeito)                          | `alta`              |
| Vulnerabilidade de segurança                                  | `alta`              |
| Race condition ou deadlock potencial                          | `alta`              |
| Gap de cobertura de testes (< 50% branches em módulo crítico) | `media`             |
| Módulo público sem JSDoc completo                             | `media`             |
| Dependência circular detectada                                | `media`             |
| Performance issue mensurável (> 2x mais lento que esperado)   | `media`             |
| Código legado / deprecated em uso                             | `backlog`           |
| Oportunidade de refactoring não urgente                       | `backlog`           |

**Como criar tarefas** (via `run_in_terminal`):

```bash
# Sintaxe: add-task.sh <prioridade> "<Título>" "<Descrição com gate de aceitação>"
bash .github/hooks/scripts/add-task.sh alta \
  "Corrigir race condition em browser_pool.acquire()" \
  "pool.acquire() pode retornar handle fechado se Chrome reiniciar. Gate: test:integration passa."

bash .github/hooks/scripts/add-task.sh backlog \
  "Refactoring: extrair lógica de retry para módulo compartilhado" \
  "src/kernel/ e src/infra/ duplicam lógica de retry com backoff."
```

**Como marcar tarefas concluídas**:

```bash
bash .github/hooks/scripts/complete-task.sh "race condition em browser_pool"
```

**Como registrar findings**:

```bash
# severity: critical | high | medium | low | info
# type: bug | gap | improvement | vulnerability | performance | debt
bash .github/hooks/scripts/save-finding.sh \
  "src/infra/browser_pool/" "high" "bug" \
  "pool.acquire() retorna handle fechado sob carga alta"
```

---

### Ciclo de Auditoria Profunda

Quando o usuário ou o agente decide auditar um módulo (ex: escolher opção "auditoria profunda"):

**Fase 1 — Análise estática** (5 min):

```bash
npm run lint 2>&1 | rg "<módulo>" | head -20
npm run typecheck:node 2>&1 | rg "<módulo>" | head -30
rg "TODO|FIXME|HACK|XXX|BUG" --stats < módulo > /
```

**Fase 2 — Cobertura de testes** (5 min):

```bash
npm run test:unit -- --coverage 2>&1 | tail -40
```

**Fase 3 — Análise semântica** (10-20 min):

- Ler `<módulo>/index.js` e principais exportações
- Verificar JSDoc de funções públicas (`npm run jsdoc:coverage`)
- Rastrear fluxo de dados crítico (ex: como uma tarefa passa do kernel ao driver)
- Identificar condições de borda, error paths, estado mutável compartilhado

**Fase 4 — Registrar findings**:

```bash
bash .github/hooks/scripts/save-finding.sh "<módulo>" "<severity>" "<type>" "<descrição>"
```

**Fase 5 — Gerar relatório**:

```markdown
# Criar DOCUMENTAÇÃO/AUDITORIAS/audit-YYYYMMDD-<módulo>.md com:

- Resumo executivo (2-3 linhas)
- Findings por severidade (tabela)
- Recomendações ordenadas por impacto
- Tarefas derivadas (já adicionadas ao pending-tasks.md)
```

**Fase 6 — Apresentar e perguntar**: invocar Template B ou C dependendo dos achados.

---

### Quality gates obrigatórios ao final de cada conjunto de mudanças

```bash
npm run lint           # deve passar sem erros novos
npm run typecheck:node # deve manter ou reduzir contagem de erros
npm run test:unit      # deve manter ou reduzir falhas
```

> O hook `agentStop` rastreia `turn_count` automaticamente. O hook `sessionEnd` gera relatório em
> `DOCUMENTAÇÃO/RELATORIOS/SESSIONS/`. Logs e findings ficam em `.github/hooks/logs/` (gitignored).
> O `session-briefing.md` é regenerado a cada nova sessão.

---

### Sistema de hooks ativo

Este repositório tem hooks do Copilot em `.github/hooks/copilot-hooks.json`. Eles **nunca
bloqueiam** o agente — são logging-only por decisão de projeto.

**Schema real do payload (verificado empiricamente — 2026-03-09):**

| Campo             | Tipo     | Descrição                                                   |
| ----------------- | -------- | ----------------------------------------------------------- |
| `tool_name`       | `string` | Nome da ferramenta em snake_case (ex: `run_in_terminal`)    |
| `tool_input`      | `object` | Parâmetros da ferramenta (varia por ferramenta)             |
| `tool_response`   | `string` | Saída da ferramenta (texto plano)                           |
| `session_id`      | `string` | UUID real da sessão Copilot                                 |
| `tool_use_id`     | `string` | UUID único por chamada de ferramenta                        |
| `transcript_path` | `string` | Caminho para o transcript JSONL da conversa                 |
| `timestamp`       | `string` | ISO 8601 (`"2026-03-09T02:19:42.040Z"`) — NÃO epoch integer |
| `hook_event_name` | `string` | `"PreToolUse"` ou `"PostToolUse"` (PascalCase)              |
| `cwd`             | `string` | Diretório de trabalho atual                                 |

> **Nota**: A documentação oficial em `docs.github.com/en/copilot/reference/hooks-configuration` usa
> convenção camelCase (`.toolName`, `.toolResult.resultType`). O payload **real** no VS Code Copilot
> usa snake_case. Sempre consultar os logs empíricos em `.github/hooks/logs/raw-*.jsonl`.

---

### Hardening de persistência de sessão

O sistema de hooks mantém estado incremental entre sessões. O agente DEVE usar esses mecanismos para
garantir continuidade máxima:

**Arquivos de estado (`.github/hooks/state/`):**

| Arquivo                     | Propósito                                                           |
| --------------------------- | ------------------------------------------------------------------- |
| `session-context.json`      | Estado vivo: session_id, tools_used[], turn_count, last_tool_ts     |
| `session-briefing.md`       | Briefing gerado automaticamente no sessionStart — **ler sempre**    |
| `pending-tasks.md`          | Backlog canônico de tarefas — fonte de verdade para próximos passos |
| `UNAUTHORIZED_CLOSE.flag`   | Flag de violação: turno encerrado sem `vscode_askQuestions`         |
| `SESSION_CLOSE_NO_KEY.flag` | Flag: SESSION encerrada sem close_key validada — exige investigação |

**Checkpoints automáticos (`.github/hooks/checkpoints/`):**

O hook `agentStop` chama `session-checkpoint.sh` ao final de cada turno, salvando:

```json
{
  "checkpoint_ts": "2026-03-09T...",
  "session_id": "uuid",
  "turn_count": 5,
  "tasks": { "alta": 3, "media": 7, "backlog": 12, "open_total": 22, "done_total": 4 },
  "findings": { "total": 8, "critical": 0, "high": 2 },
  "metrics": { "tools_total": 87, "tools_success": 86, "avg_duration_ms": 1234 }
}
```

**Forçar um checkpoint manual** (útil antes de qualquer encerramento):

```bash
bash .github/hooks/scripts/session-checkpoint.sh
```

**Recovery automático**: o `session-start.sh` detecta e carrega o último checkpoint disponível e
inclui automaticamente as informações de continuidade no `session-briefing.md`.

**Regras de persistência máxima:**

1. NUNCA encerrar sem antes rodar `bash .github/hooks/scripts/session-checkpoint.sh`
2. AO INICIAR, sempre ler `session-briefing.md` — contém estado e tarefas da sessão anterior
3. Ao completar tarefa, usar `bash .github/hooks/scripts/complete-task.sh "<padrão>"` — atualiza
   `pending-tasks.md` e garante que o progresso é persistido
4. `session_context.json` é atualizado a cada ferramenta via `pre-tool-use.sh` (campo
   `tools_used[]`) — não sobrescreva manualmente
5. Findings em `findings.jsonl` são cumulativos — nunca deletar; usar `resolve-finding.sh` se
   disponível
6. **ENCERRAMENTO DE SESSION**: sempre invocar **Template F** antes de encerrar. O usuário DEVE
   digitar a chave `ENCERRAR-XXXXXXXX` (exibida no briefing) para validar o encerramento.
   Sem a chave → `SESSION_CLOSE_NO_KEY.flag` criado → alerta no próximo briefing.

---

### Hooks configurados (10 hooks — copilot-hooks.json)

| Hook                  | Script                | Tipo       | Descrição                                         |
| --------------------- | --------------------- | ---------- | ------------------------------------------------- |
| `sessionStart`        | `session-start.sh`    | Automático | Cria session-context.json e session-briefing.md   |
| `userPromptSubmitted` | `log-prompt.sh`       | Automático | Hash do prompt, início de turno                   |
| `preToolUse`          | `pre-tool-use.sh`     | Automático | Logging, redação de credenciais, auto-recovery    |
| `postToolUse`         | `post-tool-use.sh`    | Automático | Resultado, detecção de close_key, quality gates   |
| `postToolUseFailure`  | `tool-use-failure.sh` | Automático | Loga falhas de ferramentas, incrementa contadores |
| `agentStop`           | `agent-stop.sh`       | Automático | Autorização, checkpoint, reset de turno           |
| `subagentStart`       | `subagent-start.sh`   | Automático | Loga início de subagente                          |
| `subagentStop`        | `subagent-stop.sh`    | Automático | Loga fim de subagente                             |
| `preCompact`          | `pre-compact.sh`      | Automático | Checkpoint antes de compactação de contexto       |
| `sessionEnd`          | `session-end.sh`      | Automático | Fecha seção, finaliza sessão, gera resumo         |

### Scripts manuais de emergência

| Script                   | Quando usar                                                                     |
| ------------------------ | ------------------------------------------------------------------------------- |
| `manual-session-init.sh` | sessionStart não disparou — inicializa sessão manualmente                       |
| `session-checkpoint.sh`  | Antes de qualquer encerramento ou mudança crítica                               |
| `start-section.sh`       | Mudar de fase lógica de trabalho                                                |
| `section-end.sh`         | Fechar seção manualmente com motivo                                             |
| `start-turn.sh`          | Declarar intenção do turno (primeiro ato de turno de trabalho)                  |
| `watchdog.sh`            | Verificar saúde do sistema: `--json` para relatório completo, `--quiet` para CI |

---

### Ciclo de vida canônico: SESSION → SECTION → TURN (Schema v4)

**Invariante absoluto**: sempre deve haver SESSION + SECTION + TURN ativos.

#### SECTION — Gerenciamento de Seções Temáticas

A seção `"início"` é criada **automaticamente** pelo `session-start.sh`. O agente deve abrir
novas seções ao mudar de fase lógica de trabalho:

```bash
# Abre nova seção (fecha a anterior automaticamente, se houver)
bash .github/hooks/scripts/start-section.sh "nome-da-seção"
bash .github/hooks/scripts/start-section.sh "implementação" "Fase B do plano — script X"

# Fecha seção manualmente (com motivo)
bash .github/hooks/scripts/section-end.sh "tarefa concluída"
```

**Quando usar `start-section.sh`**:
- Ao mudar de fase lógica (ex: análise → implementação → revisão)
- Ao iniciar um novo grupo temático de tarefas
- Quando a seção atual ficou grande (> 5 turnos) e o contexto mudou substancialmente

**Comportamento garantido**:
- Se há seção ativa, `start-section.sh` a fecha com `sectionEnd` antes de abrir a nova
- `session-end.sh` fecha automaticamente a última seção aberta (reason: `session_ended`)
- `session_stats.section_count` e `section_names[]` rastreiam todas as seções da sessão

#### TURN — Enriquecimento de Turnos

O início de cada turno é detectado **automaticamente** pelo hook `userPromptSubmitted`.
O agente pode (e deve) enriquecer o turno chamando `start-turn.sh` como **primeiro ato**:

```bash
# Declaração de intenção do turno (opcional mas recomendada)
bash .github/hooks/scripts/start-turn.sh "Implementar Fase A + rodar smoke-test"
bash .github/hooks/scripts/start-turn.sh
```

**Quando usar `start-turn.sh`**: idealmente como primeiro ato de todo turno de trabalho real.
Pode ser omitido em turnos puramente conversacionais (ex: responder uma pergunta simples).

---

### Consulta obrigatória à documentação oficial

Antes de tomar decisões técnicas sobre tecnologias externas, o agente SEMPRE deve verificar a
documentação oficial. Esta regra aplica-se a Copilot hooks, APIs, dependências, frameworks etc.

**Fluxo de pesquisa obrigatório:**

1. **Primeira tentativa — Context7 MCP** (documentação versionada e estruturada):

   ```
   mcp_io_github_ups_resolve-library-id: "<nome da biblioteca ou site>"
   mcp_io_github_ups_get-library-docs: context7CompatibleLibraryID + topic específico
   ```

   IDs Context7 relevantes para este projeto:

   | Recurso               | ID Context7                                          |
   | --------------------- | ---------------------------------------------------- |
   | GitHub Copilot hooks  | `/websites/github_en_copilot`                        |
   | VS Code customization | `/websites/code_visualstudio_copilot_copilot-custom` |
   | Node.js 24 API        | `/nodejs/node`                                       |
   | Puppeteer             | `/puppeteer/puppeteer`                               |
   | Zod (validação)       | `/colinhacks/zod`                                    |
   | Socket.io             | `/socketio/socket.io`                                |
   | Express.js            | `/expressjs/express`                                 |
   | better-sqlite3        | `/WiseLibs/better-sqlite3`                           |

2. **Segunda tentativa — web fetch direta** (se Context7 não resolver):

   URLs canônicas para referência:
   - Copilot hooks: `https://docs.github.com/en/copilot/reference/hooks-configuration`
   - Copilot customization: `https://docs.github.com/en/copilot/customizing-copilot`
   - Node.js API: `https://nodejs.org/api/`
   - Puppeteer: `https://pptr.dev/`
   - TypeScript JSDoc: `https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html`

3. **Nunca assumir** schema, API ou comportamento sem verificação — especialmente em campos de
   payloads externos (vide o bug `toolName` vs `tool_name` desta sessão).

4. **Registrar descobertas** em `DOCUMENTAÇÃO/REFERENCIAS/` quando encontrar schema ou contrato não
   documentado localmente.

**Quando usar Context7 vs web fetch:**

| Situação                                | Use                          |
| --------------------------------------- | ---------------------------- |
| API de biblioteca (método, tipo, opção) | Context7 primeiro            |
| Schema de payload de serviço externo    | Web fetch (docs oficiais)    |
| Comportamento de versão específica      | Context7 com topic de versão |
| Changelog ou novidades recentes         | Web fetch                    |
| Dúvida sobre qual variante usar         | Ambos em paralelo            |

## Rotas canônicas

| Necessidade             | Onde ir                                                |
| ----------------------- | ------------------------------------------------------ |
| Arquitetura oficial     | `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`             |
| Índice da arquitetura   | `DOCUMENTAÇÃO/ARQUITETURA/README.md`                   |
| Status da documentação  | `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md` |
| Bugs e auditorias       | `DOCUMENTAÇÃO/BUGS/`                                   |
| CI/CD e workflows       | `DOCUMENTAÇÃO/CI_CD/`                                  |
| Operações e runbooks    | `DOCUMENTAÇÃO/OPERACOES/`                              |
| Skills especializadas   | `.github/skills/README.md`                             |
| Hub de automação GitHub | `.github/README.md`                                    |
| Baseline curto          | `.github/instructions/project-canon.instructions.md`   |
| Protocolo de hooks      | `.github/instructions/hooks-protocol.instructions.md`  |

> Estas instruções têm prioridade equivalente às do `copilot-instructions.md` e são carregadas
> automaticamente pelo VS Code via `chat.useAgentsMdFile`.
