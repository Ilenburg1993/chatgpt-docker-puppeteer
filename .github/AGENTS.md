# Instruções para todos os agentes

**Propósito**: baseline curto e permanente para agentes de IA neste workspace. **Status**: Canônico.
**Última atualização**: 1 de março de 2026.

Este arquivo é lido automaticamente por agentes de IA (Copilot, Claude, ChatGPT, etc.) que interagem
com o workspace. Ele complementa `.github/copilot-instructions.md` e usa
`.github/instructions/project-canon.instructions.md` como baseline estável.

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
> `Executar → Refletir → Registrar → Perguntar → Executar → ...`
>
> A única razão válida para parar de trabalhar é o usuário dizer explicitamente "parar", "stop" ou
> "encerrar sessão". **Tarefas concluídas não encerram a sessão — elas disparam perguntas.**

---

### ⛔ PROTOCOLO DE ENCERRAMENTO — NUNCA encerre sem autorização explícita

> **REGRA ABSOLUTA**: O agente JAMAIS pode encerrar uma seção, bloco de trabalho, ou a sessão
> inteira sem que o usuário diga explicitamente que pode encerrar.
>
> **Ações proibidas sem autorização expressa:**
>
> - Concluir um bloco de trabalho e não perguntar ao usuário o que fazer a seguir
> - Fazer commit sem perguntar ao usuário antes
> - Fechar/finalizar uma seção sem checkpoint via `vscode_askQuestions`
> - Dizer "pronto" sem oferecer próximos passos e perguntar pela autorização
>
> **Procedimento obrigatório antes de qualquer encerramento:**
>
> 1. Invocar `vscode_askQuestions` com Template A ou C (ver abaixo)
> 2. Aguardar resposta do usuário
> 3. Só encerrar, commitar ou pausar se o usuário autorizar explicitamente

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
