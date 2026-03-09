# Instruções para todos os agentes

**Propósito**: baseline curto e permanente para agentes de IA neste workspace. **Status**: Canônico.
**Última atualização**: 10 de março de 2026.

Este arquivo é lido automaticamente por agentes de IA (Copilot, Claude, ChatGPT, etc.) que interagem
com o workspace. Ele complementa `.github/copilot-instructions.md` e usa
`.github/instructions/project-canon.instructions.md` como baseline estável.

---

## ⛔⛔⛔ REGRA ABSOLUTA — ENCERRAMENTO SEM AUTORIZAÇÃO É PROIBIDO ⛔⛔⛔

> **Esta é a regra mais importante deste arquivo. Aplica-se SEMPRE, sem exceção.**

### O que é obrigatório

**ANTES de encerrar qualquer turno, bloco de trabalho ou sessão, o agente DEVE:**

1. Invocar a ferramenta `vscode_askQuestions` com Template A ou E (ver seção abaixo)
2. Aguardar a resposta do usuário
3. Só prosseguir, commitar ou encerrar após autorização **explícita**

### O que NÃO conta como autorização — exemplos de VIOLAÇÃO

| ❌ VIOLAÇÃO — isso NÃO é autorização              | ✅ CORRETO — único método válido               |
| ------------------------------------------------ | --------------------------------------------- |
| Escrever "O que deseja fazer a seguir?" no texto | Chamar a **ferramenta** `vscode_askQuestions` |
| Terminar a resposta com uma pergunta             | Tool call real, não texto de pergunta         |
| Dizer "Posso continuar?" como texto do chat      | A ferramenta DEVE aparecer como tool call     |
| Resumir o trabalho e encerrar sem perguntar      | Aguardar resposta antes de qualquer ação      |

> **TEXTO PLANO NÃO EQUIVALE A AUTORIZAÇÃO.** Somente o **tool call real** de `vscode_askQuestions`
> conta. Escrever uma pergunta na resposta é uma violação do protocolo.

### Monitoramento automático

O sistema rastreia violações automaticamente:

- `agent-stop.sh` detecta se `vscode_askQuestions` foi chamado no turno
- Se NÃO foi chamado → grava `.github/hooks/state/UNAUTHORIZED_CLOSE.flag`
- A próxima sessão exibe `⛔ ALERTA DE VIOLAÇÃO` no topo do session-briefing.md
- Violações são registradas em `.github/hooks/logs/audit.jsonl` como `turnEnd_UNAUTHORIZED`

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

| Gatilho                                       | Template                 | Momento                  |
| --------------------------------------------- | ------------------------ | ------------------------ |
| Sessão iniciada sem prompt explícito          | **E — Session Kickoff**  | Primeiro ato da sessão   |
| Qualquer tarefa concluída                     | **A — Next Step**        | Logo após marcar `- [x]` |
| ≥ 3 bugs encontrados numa auditoria           | **B — Bug Discovery**    | Antes de corrigir        |
| Proposta de upgrade arquitetural identificada | **C — Upgrade Proposal** | Antes de executar        |
| `turn_count % 3 == 0` e `turn_count > 0`      | **D — Checkpoint**       | No início do turno       |

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

| Arquivo                | Propósito                                                           |
| ---------------------- | ------------------------------------------------------------------- |
| `session-context.json` | Estado vivo: session_id, tools_used[], turn_count, last_tool_ts     |
| `session-briefing.md`  | Briefing gerado automaticamente no sessionStart — **ler sempre**    |
| `pending-tasks.md`     | Backlog canônico de tarefas — fonte de verdade para próximos passos |

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

> Estas instruções têm prioridade equivalente às do `copilot-instructions.md` e são carregadas
> automaticamente pelo VS Code via `chat.useAgentsMdFile`.
