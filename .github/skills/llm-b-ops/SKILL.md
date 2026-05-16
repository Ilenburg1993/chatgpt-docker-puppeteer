---
name: llm-b-ops
description: >-
  Guia operacional canônico para LLM-B: session init obrigatória, hierarquia de search, quality
  gates para src/copilot, padrões de leitura paralela e catálogo de anti-padrões. Use ao iniciar
  uma sessão, antes de executar quality gates, ao buscar arquivos/símbolos, ou ao identificar
  lentidão de trabalho.
user-invocable: true
---

# LLM-B Ops — Guia Operacional de Eficiência

## 1. Session Init (OBRIGATÓRIO ao iniciar qualquer turno)

Execute estas **duas chamadas em paralelo** no primeiro turno da sessão:

```js
// Chamar juntas, não sequencialmente:
workspace_index_build({ directory: 'src/copilot' })   // ~9s, indexa ~928 arquivos
workspace_scope_declare({
  sessionId: 'copilot-primary',
  directory:  'src/copilot',
  awaitReady: true,
  parseSymbols: true,
})
```

**Por quê é crítico:** sem isso, cada `search_in_files` faz full-scan do FS. Com o índice, buscas
retornam em <50ms via FTS5 SQLite. O warm-up de escopo aquece o cache para leituras subsequentes.

**Regra de reativação:** se a sessão estiver ativa há mais de 30 minutos sem init, declare o escopo
novamente antes de buscas em massa.

---

## 2. Hierarquia Canônica de Search (velocidade decrescente)

| Nível | Tool | Quando usar |
|-------|------|-------------|
| **1 (mais rápido)** | `workspace_index_search(query)` | Busca full-text em qualquer conteúdo |
| **2** | `workspace_scope_find_symbol(sessionId, symbol)` | Símbolo em escopo ativo |
| **3** | `workspace_index_find_symbol(symbol)` | Símbolo em todo o workspace |
| **4** | `search_in_files(pattern, path, isRegex)` | Regex complexo, padrões fora do índice |
| **5 (mais lento)** | `exec_command('rg ...')` | Quando nenhuma tool semântica servir |

**Regra de ouro:** nunca pule do nível 1 para o 5 sem tentar os níveis intermediários.

### Exemplos práticos

```js
// ✅ Rápido: busca textual via FTS5
workspace_index_search({ query: 'createSession inject' })

// ✅ Símbolo em escopo
workspace_scope_find_symbol({ sessionId: 'copilot-primary', symbol: 'RuntimeBoot' })

// ✅ Regex quando necessário
search_in_files({
  pattern: 'export.*function.*[Ss]earch',
  path: 'src/copilot/tools',
  isRegex: true,
  contextLines: 0,   // use 0 para buscas de símbolo (evita output verboso)
  caseSensitive: false,
})

// ❌ Nunca: exec_command para grep quando há tool melhor
exec_command('grep -r "createSession" src/copilot')
```

---

## 3. Padrões de Leitura Eficiente

### 3.1 Leitura paralela obrigatória

Nunca leia arquivos sequencialmente quando os conteúdos são independentes:

```js
// ✅ Uma resposta, 3 arquivos em paralelo:
[
  read_file_content({ path: 'src/copilot/tools/search/text-search-tools.js' }),
  read_file_content({ path: 'src/copilot/infra/io/search.js' }),
  read_file_content({ path: 'src/copilot/tools/search/registry.js' }),
]

// ❌ Nunca 3 respostas separadas para 3 arquivos independentes
```

### 3.2 Leitura cirúrgica de arquivos grandes

Use `startLine`/`endLine` para arquivos >200 linhas quando o contexto é conhecido:

```js
// Ler apenas a section relevante de package.json (8000+ linhas)
read_file_content({
  path: 'package.json',
  startLine: 360,
  endLine: 430,
  maxLines: 70,
})
```

### 3.3 Descoberta de arquivos focada

Para listar arquivos em diretórios grandes, prefira busca textual sobre `list_directory`:

```js
// ✅ Rápido: busca por pattern
workspace_index_search({ query: 'watchdog timer stall' })

// ✅ find focado por pattern de nome
exec_command('find tests/unit/copilot -name "*dialog*" -maxdepth 1')

// ❌ list_directory em dir com 200+ arquivos → output 28KB
list_directory({ path: 'tests/unit/copilot', recursive: false })
```

---

## 4. Quality Gates para src/copilot

### 4.1 One-liner canônico

```bash
npm run validate:copilot
```

Equivale a: `lint:copilot && typecheck:node && test:copilot:unit` (com cache em todos os estágios).

### 4.2 Scripts individuais

| Propósito | Script | Escopo |
|-----------|--------|--------|
| Lint copilot | `npm run lint:copilot` | `src/copilot` + `tests/unit/copilot` |
| Lint + autofix | `npm run lint:copilot:fix` | idem, com `--fix` |
| TypeScript strict | `npm run typecheck:node` | Todo projeto (tsconfig.node.json) |
| Tests copilot | `npm run test:copilot:unit` | `tests/unit/copilot/**/*.spec.js` |
| Tests raw (debug) | `npm run test:copilot:raw` | idem, full vitest output |
| Todos os gates | `npm run validate:copilot` | **use este por padrão** |

### 4.3 Quando rodar cada gate

- **Antes de commit/push:** `validate:copilot`
- **Ciclo de desenvolvimento rápido:** só `test:copilot:unit` (mais rápido)
- **Após editar tipos JSDoc:** `typecheck:node`
- **Após reformatar código:** `lint:copilot`

### 4.4 ⚠️ Anti-padrão crítico de testes

```bash
# ❌ NUNCA — 520 arquivos de todo o projeto, output 904KB
npm run test:unit

# ✅ SEMPRE — 213 arquivos copilot, output estruturado
npm run test:copilot:unit
```

---

## 5. Catálogo de Anti-Padrões (7 confirmados)

| # | Anti-padrão | Impacto | Correção |
|---|-------------|---------|----------|
| 1 | `npm run test:unit` em vez de `test:copilot:unit` | Output 4x maior, 2x mais lento | Sempre usar `test:copilot:unit` |
| 2 | Leituras de arquivo sequenciais | 3x mais turn tokens, latência acumulada | Batch em uma resposta |
| 3 | `list_directory` em dirs com 100+ entradas | Output 28KB+ irrelevante | `find` focado ou `workspace_index_search` |
| 4 | `exec_command grep` quando há tool semântica | Ignora FTS5, mais lento | Níveis 1-4 da hierarquia de search |
| 5 | Sem session init (index + scope) | Full-scan FS a cada busca | Init obrigatória no turno 1 |
| 6 | `contextLines: 2` em buscas de símbolo | 3x mais output sem valor | `contextLines: 0` para symbol search |
| 7 | Ler `package.json` inteiro para achar um script | Output 8000+ linhas | `read_file_content` com `startLine/endLine` |

---

## 6. Mapa de Módulos Críticos (src/copilot)

| Módulo | Caminho | Responsabilidade |
|--------|---------|------------------|
| Tools search | `tools/search/` | `search_in_files`, `workspace_symbol_search`, `find_symbol_usages` |
| Infra IO | `infra/io/` | Wrappers ripgrep, FS, cache de IO |
| Infra IO public | `infra/public/io.js` | Façade pública de I/O (barrel) |
| Boot | `boot/` | `runtime-bootstrap.js` → `runtime-wiring.js` |
| Terminal | `terminal/` | `runtime-root.js`, gateways de projeção |
| Config | `config/` | `env.js`, `system-prompt.js` |
| Session | `agent/session/` | lifecycle de sessão SDK |
| Inject | `channel/inject.js` | Canal de comunicação LLM-A → LLM-B |
| Observability | `observability/` | métricas, health, audit |
| Hooks | `hooks/` | pre-tool-use, post-tool-use, stop |

### Como achar o owner de um símbolo

```js
// 1. Busca textual no índice
workspace_index_search({ query: 'export createSession' })

// 2. Busca de declaração
workspace_symbol_search({
  name: 'createSession',
  kind: 'function',
  path: 'src/copilot',
  caseSensitive: false,
})

// 3. Encontrar usages
find_symbol_usages({
  symbol: 'createSession',
  path: 'src/copilot',
  includePattern: '*.{js,mjs}',
  wholeWord: true,
  caseSensitive: true,
})
```

### Como achar o teste de um módulo

```bash
# Naming convention: src/copilot/X/Y.js → tests/unit/copilot/X/Y.spec.js
find tests/unit/copilot -name "*<module-name>*"
```

---

## 7. Diagnóstico Rápido

```bash
# Estado do workspace index
workspace_index_status()

# Escopos ativos
workspace_scope_list({ includeStats: true })

# Health do sistema
npm run diagnose

# Saúde do LSP
npm run lsp:health

# Saúde do RAG
npm run rag:health
```

---

## 8. Regras de Ouro (checklist de início de turno)

- [ ] Session init: `workspace_index_build` + `workspace_scope_declare` (em paralelo)
- [ ] Usar `validate:copilot` como quality gate padrão
- [ ] Nunca usar `test:unit` — sempre `test:copilot:unit`
- [ ] Ler arquivos independentes em paralelo (uma resposta, N tool calls)
- [ ] Buscas: FTS5 primeiro, regex depois
- [ ] `contextLines: 0` para symbol search, `contextLines: 2` para entender contexto lógico
- [ ] Para dirs grandes, usar `find -name` focado, não `list_directory`
