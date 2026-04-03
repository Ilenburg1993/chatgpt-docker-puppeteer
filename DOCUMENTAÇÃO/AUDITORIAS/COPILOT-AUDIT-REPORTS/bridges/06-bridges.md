# Módulo bridges/ — Relatório Consolidado

**Escopo**: `src/copilot/bridges/` **Fase**: F10 — COPILOT-FULL-AUDIT MF-II **Data**: 2026-06-10
**Arquivos auditados**: 5 | **LOC total**: 1274

---

## 1. Visão Geral do Módulo

O módulo `bridges/` conecta o ecossistema copilot a sistemas externos e internos:

| Arquivo              | LOC | Responsabilidade                                       |
| -------------------- | --- | ------------------------------------------------------ |
| `alias-store.js`     | 200 | Aliases do REPL — builtin + custom, persistência JSON  |
| `gh-bridge.js`       | 42  | Barrel compat → `./gh/index.js`                        |
| `git-bridge.js`      | 402 | CLI `git` via `execFile` — status/log/diff/commit/push |
| `mcp-tool-bridge.js` | 344 | MCP JSON-RPC → Copilot SDK tools com Zod schema        |
| `nerv-bridge.js`     | 286 | AlwaysAliveAgent events → NERV bus (DI via `mount`)    |

---

## 2. Achados Consolidados

### Índice de Severidade

| ID     | Arquivo              | Severidade | Título curto                                      |
| ------ | -------------------- | ---------- | ------------------------------------------------- |
| B10-01 | `mcp-tool-bridge.js` | **P4**     | `allOf` no Zod schema descarta schemas extras     |
| B10-02 | `mcp-tool-bridge.js` | **P4**     | `PORT` genérico para `MCP_BASE`                   |
| B10-03 | `nerv-bridge.js`     | **P4**     | Race unmount/mount deixa `once('ready')` pendente |
| B10-04 | `alias-store.js`     | P5         | `saveCustomAliases` silencia erros de escrita     |
| B10-05 | `git-bridge.js`      | P5         | Hash extraction via regex em `gitCommit`          |
| B10-06 | `git-bridge.js`      | P5         | `gitPush` sem sanitização de `remote`/`branch`    |
| B10-07 | `git-bridge.js`      | P5         | `formatLog` trunca subject sem `...`              |
| B10-08 | `mcp-tool-bridge.js` | P5         | Circuit breaker sem estado half-open              |
| B10-09 | `mcp-tool-bridge.js` | P5         | `rpcCall` não retenta EPIPE/EHOSTUNREACH          |
| B10-10 | `nerv-bridge.js`     | P5         | `EVENT_MAP` 50 eventos, muitos nunca emitidos     |

**Total**: 3×P4 + 7×P5 = 10 achados

---

## 3. Achados Detalhados (P4)

### B10-01 — `buildZodSchema allOf` descarta schemas extras

```js
// mcp-tool-bridge.js — atual
case 'allOf': {
    const first = inputSchema.allOf[0];
    return first ? buildZodSchema(first, ...) : z.unknown();
}
```

Para ferramentas MCP que usam `allOf` para composição de schemas (ex: `allOf: [Base, Extension]`),
apenas `Base` é convertido. Ferramenta aceita payloads inválidos com silêncio.

**Correção**: merge recursivo dos `properties` de todos os schemas `allOf`.

---

### B10-02 — `PORT` genérico para MCP_BASE

`const PORT = process.env['PORT'] ?? '3008'` conflita com o PORT de plataformas cloud (Railway,
Heroku) que injetam o port exposto do serviço. Usar `MCP_PORT` dedicado:

```js
const PORT = process.env['MCP_PORT'] ?? process.env['PORT'] ?? '3008';
```

---

### B10-03 — Race `_onAgentBeforeStop` + `once('ready')` após unmount/mount rápido

Cenário: `before-stop` → `once('ready')` registrado → `unmount()` → `mount()` → `ready` dispara →
`_attachListeners()` executado DUAS vezes + dois handlers `before-stop`.

**Correção**: armazenar a referência do handler `ready` e remover via `off` no `unmount()`.

---

## 4. Destaques Positivos do Módulo

| Destaque                                             | Arquivo              | Impacto                    |
| ---------------------------------------------------- | -------------------- | -------------------------- |
| `execFile` (não `exec`) em todos os comandos git     | `git-bridge.js`      | Shell injection impossível |
| Circuit breaker (UPG-02) + boot backoff (BUG-MED-09) | `mcp-tool-bridge.js` | Alta resiliência MCP       |
| Retry com exp backoff + jitter (MELHORIA-11)         | `mcp-tool-bridge.js` | Anti-thundering-herd       |
| Cycle detection em alias resolve + setAlias          | `alias-store.js`     | BUG-LEVE-06 corrigido      |
| `safeEmit` no-throw em `nerv-bridge.js`              | `nerv-bridge.js`     | NERV failure não propaga   |
| DI via `mount(nerv)`                                 | `nerv-bridge.js`     | Testabilidade máxima       |
| `_beforeStopRegistered` flag (BUG-MOD-12)            | `nerv-bridge.js`     | Evita duplos em remount    |
| Separadores `\x1f` no parsing git                    | `git-bridge.js`      | Imune a spaces no subject  |

---

## 5. Scores por Arquivo

| Arquivo              | Score      |
| -------------------- | ---------- |
| `alias-store.js`     | 8.5/10     |
| `gh-bridge.js`       | 10.0/10    |
| `git-bridge.js`      | 9.0/10     |
| `mcp-tool-bridge.js` | 8.0/10     |
| `nerv-bridge.js`     | 9.0/10     |
| **Módulo bridges/**  | **8.9/10** |

---

## 6. Referências

- [alias-store-audit.md](./alias-store-audit.md)
- [gh-bridge-audit.md](./gh-bridge-audit.md)
- [git-bridge-audit.md](./git-bridge-audit.md)
- [mcp-tool-bridge-audit.md](./mcp-tool-bridge-audit.md)
- [nerv-bridge-audit.md](./nerv-bridge-audit.md)

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
