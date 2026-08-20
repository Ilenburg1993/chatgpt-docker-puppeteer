# Auditoria Arquitetural 2.1 — `src/copilot/tools` (Fase 2)

**Data:** 2026-05-10 **Escopo:** `src/copilot/tools/**` **Referência-base:**
`68-ROADMAP-REVOLUCAO-CONTINUA-ARQUITETURA-2.1.md` (adaptado ao subsistema tools)

---

## 1) Situação atual (AS-IS)

### 1.1 Achados principais

1. `tools/index.js` acumulava lógica de composição/cache (`getAllTools`, proxy `allTools`) além de
   exports.
2. `runtime-wiring.js` importava setters diretamente de submódulos (`tools/hub-tools.js`,
   `tools/permission-tools.js`), bypassando barrel.
3. `tools/bootstrap.js` já era o verdadeiro composition root de tools, mas dividia ownership com
   `index.js`.
4. Estado de user-input já convergido para `ToolSessionContext` (P2-1/P2-2), reduzindo singletons
   globais.

### 1.2 Diagnóstico arquitetural

- **Hotspot de ownership difuso:** composição de tools espalhada entre `index.js` e `bootstrap.js`.
- **Boundary leak:** imports diretos de submódulos fora do barrel público `#copilot/tools`.
- **Barrel purity quebrada:** `index.js` não estava aderente ao padrão 2.1 (barrel-only).

---

## 2) Situação ideal (TO-BE) — Arquitetura 2.1 adaptada para `tools`

### 2.1 Princípios

1. **Barrel puro:** todo arquivo `index.js` deve conter apenas re-exports.
2. **Ownership único de composição:** `tools/bootstrap.js` é o único dono de montagem/caching flat
   de tools.
3. **Boundary explícita:** consumers externos usam `#copilot/tools`, sem importar subarquivos de
   domínio.
4. **Estado por sessão:** fluxos vivos de input/sse usam `ToolSessionContext` injetado no runtime.
5. **Compatibilidade progressiva:** APIs antigas (`getAllTools`, `allTools`) permanecem, mas
   delegadas ao owner canônico.

### 2.2 Shape alvo mínimo

- `tools/index.js` = barrel-only.
- `tools/bootstrap.js` = composition root (registro, merge de categorias, ferramentas flat para
  diagnóstico).
- `runtime-wiring.js` = integra via barrel, sem bypass de módulo.
- `sdk/session/user-input.js` + `tools/hook-tools.js` = contexto unificado por sessão.

---

## 3) Roadmap completo da Fase 2 (tools) — Arquitetura 2.1

## F2-T1 — Barrel purity + ownership de composição

- Converter `tools/index.js` para barrel-only.
- Mover/centralizar `getAllTools`/`allTools` no owner canônico (`tools/bootstrap.js`).
- Garantir compatibilidade para consumers atuais.

## F2-T2 — Boundary hardening de runtime wiring

- Eliminar imports diretos `runtime-wiring -> tools/*` (submódulos).
- Consumir setters via `#copilot/tools`.

## F2-T3 — Estado por sessão unificado (user-input)

- Concluir convergência de pending structured input para `ToolSessionContext`.
- Garantir injeção única no bootstrap para SDK + hook-tools.

## F2-T4 — Normalização de domínios internos de tools

- Preparar extração física por domínio (`session/`, `introspection/`, `infra/`) sem quebra de API.
- Manter `index.js` e sub-`index.js` como barrels apenas.

## F2-T5 — Guardrails de arquitetura

- Reforçar regras de lint para impedir regressão (barrel purity + anti-bypass).
- Evoluir checks no CI para garantir fronteiras.

---

## 4) Execução já concluída nesta rodada

- **F2-T1 (parcial, núcleo concluído):**
  - `tools/index.js` convertido para **barrel-only**.
  - `getAllTools`/`allTools` migrados para `tools/bootstrap.js` (compat preservada).
- **F2-T4 (expansão concluída):**
  - `tools/_infra/` renomeado fisicamente para `tools/infra/` sem wrappers legados.
  - `file/index.js`, `todo/index.js`, `git/index.js` e `shell/index.js` convertidos para barrels
    puros.
  - Lógica concreta extraída para `file/file-tools.js`, `todo/todo-tools.js`, `git/git-tools.js` e
    `shell/shell-tools.js`.
- **F2-T2 (concluído):**
  - `runtime-wiring.js` migrou de imports diretos para `#copilot/tools`.
- **F2-T3 (concluído em lotes anteriores):**
  - `ToolSessionContext` unificado entre `user-input.js` e `hook-tools.js` via runtime wiring.

---

## 5) Próximos passos imediatos

1. Executar F2-T4 (organização física por subdomínio sem alterar API pública).
2. Executar F2-T5 (enforcement automatizado contra regressão de barrel/boundary).
3. Registrar cada lote no arquivo de execução incremental.

---

## 6) Fonte oficial de rastreio (não perder o fio)

- **Execução incremental (SSOT operacional):**
  - `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-10-EXECUCAO-REBUILD-TOOLS.md`
- **Roadmap canônico original de tools:**
  - `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/2026-05-10-ROADMAP-REBUILD-TOOLS-CANONICO.md`
- **Adaptação 2.1 geral:**
  - `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/68-ROADMAP-REVOLUCAO-CONTINUA-ARQUITETURA-2.1.md`
