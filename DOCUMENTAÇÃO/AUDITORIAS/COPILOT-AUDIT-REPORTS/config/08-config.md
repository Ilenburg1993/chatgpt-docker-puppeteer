# Módulo config/ — Relatório Consolidado

**Escopo**: `src/copilot/config/` **Fase**: F12 — COPILOT-FULL-AUDIT MF-II **Data**: 2026-06-10
**Arquivos auditados**: 9 | **LOC total**: 1540

---

## 1. Visão Geral do Módulo

O módulo `config/` centraliza toda a configuração do sistema Copilot: perfis de sessão SDK, system
prompts, servidores MCP, agentes customizados, arquivos de contexto pinned e registry de tools.

| Arquivo                  | LOC | Responsabilidade                                        |
| ------------------------ | --- | ------------------------------------------------------- |
| `index.js`               | 45  | Barrel principal                                        |
| `session-config.js`      | 185 | Factories de SessionConfig (4 perfis)                   |
| `system-prompt.js`       | 229 | Constantes de identidade + builders SystemMessageConfig |
| `mcp-servers.js`         | 128 | Mapa MCP_SERVERS + buildMcpConfig                       |
| `custom-agents.js`       | 325 | BUILTIN_AGENTS (REPL) + SDK_AGENTS (6 sub-agentes)      |
| `pinned-files-loader.js` | 261 | PinnedFilesLoader: watch + debounce + buildContext      |
| `tools/index.js`         | 11  | Barrel tools/                                           |
| `tools/registry.js`      | 257 | Custom tools declarativas + BUILTIN_HANDLER_MAP         |
| `tools/state.js`         | 99  | Allow/denylist de ferramentas + persistência            |

---

## 2. Achados Consolidados

### Índice de Severidade

| ID     | Arquivo                  | Severidade | Título curto                                                            |
| ------ | ------------------------ | ---------- | ----------------------------------------------------------------------- |
| C12-02 | `tools/registry.js`      | **P4**     | `env_read` expõe qualquer process.env ao modelo                         |
| C12-03 | `system-prompt.js`       | **P4**     | `mode:'customize'` sem fallback para SDK < v0.2 **[FIXED]**             |
| C12-04 | `tools/registry.js`      | **P4**     | `persistCustomTools` write não-atômico — corrupção em crash **[FIXED]** |
| C12-01 | `mcp-servers.js`         | P5         | Token GITHUB_TOKEN frozen em module init                                |
| C12-05 | `pinned-files-loader.js` | P5         | Watcher Linux não monitora subdirs de profundidade > 1                  |
| C12-06 | `tools/registry.js`      | P5         | `loadCustomTools()` side-effect síncrono de import                      |
| C12-07 | `custom-agents.js`       | P5         | `DISABLED_AGENTS` Set module-level não resetado entre testes            |
| C12-08 | `tools/state.js`         | P5         | `persistToolsConfig` write não-atômico                                  |

**Total**: 3×P4 + 5×P5 = 8 achados

---

## 3. Achados Detalhados (P4)

### C12-02 — `env_read` expõe processo.env ao modelo (Segurança)

**Risco**: handler pré-autorizado `env_read` em `BUILTIN_HANDLER_MAP` permite ao modelo ler qualquer
variável de ambiente (`GITHUB_TOKEN`, `JWT_SECRET`, etc.) se uma custom tool usar
`handlerId: 'env_read'`.

**Correção**: restringir `env_read` a um allowlist de chaves seguras.

---

### C12-03 — `mode:'customize'` sem fallback de versão SDK

`buildGuidelinesAppendMessage` e `buildHookContextAppendMessage` emitem objetos com
`mode:'customize'` que exige SDK v0.2.0. O módulo importa `SYSTEM_PROMPT_SECTIONS` do SDK, mas não
há verificação em runtime de suporte ao modo.

**Correção**: verificar se `SDK_SECTIONS` retorna sections antes de usar `mode:'customize'`;
fallback para `mode:'append'` se ausente.

---

### C12-04 — Write não-atômico em `custom-tools.json`

`writeFileSync` direto sobre o arquivo final. Crash durante write → JSON incompleto → próximo boot
perde toda configuração silenciosamente.

**Correção**: write em arquivo temporário + `fs.renameSync` (atômico no mesmo filesystem).

---

## 4. Destaques Positivos do Módulo

| Destaque                                             | Arquivo                  | Impacto                               |
| ---------------------------------------------------- | ------------------------ | ------------------------------------- |
| 4 perfis de sessão com DI clara                      | `session-config.js`      | Sem duplicação de BASE_CONFIG         |
| LAST_INSTRUCTIONS injeta protocolo de hooks no LLM-B | `system-prompt.js`       | Garante compliance de TURN            |
| Token guard em buildMcpConfig (runtime check)        | `mcp-servers.js`         | Previne MCP com auth vazia            |
| 6 SDK agents com tool sets mínimos                   | `custom-agents.js`       | Least-privilege por agente            |
| `git-ops` inclui report_intent                       | `custom-agents.js`       | Auditoria antes de commits            |
| BUG-CRIT-07 fix: fs.watch Linux compat               | `pinned-files-loader.js` | Funciona corretamente no DevContainer |
| handlerId whitelist (sem eval)                       | `tools/registry.js`      | Previne execução de código arbitrário |
| `_resetRegistry()` para isolamento de testes         | `tools/registry.js`      | Boa prática de testabilidade          |
| `getToolsConfig()` retorna cópia defensiva           | `tools/state.js`         | Sem mutação acidental do estado       |

---

## 5. Scores por Arquivo

| Arquivo                  | Score      |
| ------------------------ | ---------- |
| `index.js`               | 10.0/10    |
| `session-config.js`      | 9.5/10     |
| `system-prompt.js`       | 8.5/10     |
| `mcp-servers.js`         | 8.5/10     |
| `custom-agents.js`       | 9.0/10     |
| `pinned-files-loader.js` | 8.5/10     |
| `tools/index.js`         | 10.0/10    |
| `tools/registry.js`      | 7.5/10     |
| `tools/state.js`         | 8.5/10     |
| **Módulo config/**       | **8.9/10** |

---

## 6. Referências

- [index-audit.md](./index-audit.md)
- [session-config-audit.md](./session-config-audit.md)
- [system-prompt-audit.md](./system-prompt-audit.md)
- [mcp-servers-audit.md](./mcp-servers-audit.md)
- [custom-agents-audit.md](./custom-agents-audit.md)
- [pinned-files-loader-audit.md](./pinned-files-loader-audit.md)
- [tools-index-audit.md](./tools-index-audit.md)
- [tools-registry-audit.md](./tools-registry-audit.md)
- [tools-state-audit.md](./tools-state-audit.md)

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
