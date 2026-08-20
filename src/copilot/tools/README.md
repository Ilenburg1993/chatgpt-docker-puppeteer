# `src/copilot/tools/`

**Propósito**: superfície canônica de tools do runtime Copilot (definição, composição, introspecção
e estado mínimo compartilhado). **Status documental**: Canônico ativo. **Público**: mantenedores de
`agent/`, `terminal/`, `server/` e integrações SDK/MCP. **Última atualização**: 10 de maio de 2026.

---

## O que esta pasta contém

- definição das tools por domínio (`code`, `file`, `git`, `hook`, `hub`, `permission`, `session`,
  `shell`, `task`, `todo`, `web`);
- composition root de registro (`bootstrap.js`);
- barrel público único (`index.js`) para consumo externo de `tools`;
- fundação interna (`infra/`) com factory, logging e métricas de tools;
- inventário executável da pasta (`module-map.js`) para auditoria e governança arquitetural.

## O que não deve ficar aqui

- regra de domínio de negócio de alto nível que pertença a `core/` ou `agent/`;
- wiring externo fora da superfície pública do subsistema;
- imports externos diretos para submódulos internos de `tools/` (ex.: `tools/infra/*`,
  `tools/*/index.js`) vindos de fora de `tools/`.

---

## Subdomínios atuais

| Caminho          | Responsabilidade                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `index.js`       | Barrel público canônico do subsistema `tools/` (único hub de contato externo).                 |
| `bootstrap.js`   | Composition root: agrega categorias, registra no registry SDK, instrumenta e aplica contratos. |
| `module-map.js`  | Inventário executável (layout, papéis, risco e scorecard) da pasta `tools/`.                   |
| `infra/`         | Fundação interna de tools (`tool-factory`, logger e proxy de métricas).                        |
| `code/`          | Tools de qualidade de código (lint, testes, typecheck).                                        |
| `file/`          | Tools de filesystem (leitura, escrita, index e escopo).                                        |
| `git/`           | Tools de operações Git.                                                                        |
| `hook/`          | Bridge de hooks e user input estruturado (`request_user_input`, audit tail, pending queue).    |
| `hub/`           | Tools de conversa com o Conversation Hub.                                                      |
| `introspection/` | Tools/contratos de introspecção e verificação de metadados de registry.                        |
| `permission/`    | Tools de controle de modo de aprovação em runtime.                                             |
| `session/`       | Tools de sessão e RPC experimental/canônico.                                                   |
| `shell/`         | Tools de execução shell sandboxada e políticas de timeout/rate.                                |
| `task/`          | Tools de consulta de tarefas e artefatos de execução.                                          |
| `todo/`          | Tools e store de TODOs (read/write/bulk/query).                                                |
| `web/`           | Tools de acesso web com proteção SSRF e telemetria de I/O.                                     |

---

## Fronteiras arquiteturais (2.0/2.1)

1. **Hub externo único de `tools/`:** `#copilot/tools` (barrel raiz de `tools/index.js`).
2. **Consumidores fora de `src/copilot/tools/**`:** devem importar apenas do barrel raiz.
3. **Módulos internos de `src/copilot/tools/**`:** não podem importar `#copilot/tools`; devem usar
   `tools/infra/*` ou barrels internos do próprio domínio.
4. **Sub-barrels de `tools/**`:** não podem se comunicar com módulos fora de `src/copilot/tools/**`;
   são internos ao subsistema.
5. **`index.js` em `tools/**` é barrel-only:** sem lógica local, sem estado local, sem imports
   não-barrel.

### Enforcement automatizado

- **F25 (ESLint):** força `src/copilot/tools/**/index.js` a permanecer barrel-only.
- **F26 (ESLint):** bloqueia imports relativos externos para submódulos internos de `tools/`.

---

## Entradas principais

- [`./index.js`](./index.js) — API pública canônica de `tools`.
- [`./bootstrap.js`](./bootstrap.js) — composição e registro de todas as tools.
- [`./module-map.js`](./module-map.js) — mapa executável da pasta.
- [`./infra/tool-factory.js`](./infra/tool-factory.js) — factory canônica de definição/normalização
  de tools.

---

## Regras de manutenção

- novas categorias de tools devem nascer em subdiretório próprio com `index.js` barrel-only;
- qualquer novo ponto público deve ser explicitamente reexportado por `tools/index.js`;
- alterações de fronteira devem vir acompanhadas de atualização de lint rules/guardrails;
- evitar bypass do composition root (`bootstrap.js`) para wiring de registro.

---

## Links relacionados

- [`src/copilot/agent/`](../agent/)
- [`src/copilot/terminal/`](../terminal/)
- [`src/copilot/sdk/`](../sdk/)
- [`src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-10-ROADMAP-REBUILD-TOOLS-CANONICO.md`](../../DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-10-ROADMAP-REBUILD-TOOLS-CANONICO.md)
