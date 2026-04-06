# PARTE 11C — Roadmap de Refatoração: Fases 1–4 (Higiene & Eliminação)

**Data**: 2026-07-21
**Pré-requisitos**: [11A](PARTE-11A-ANALISE-ARQUITETURAL-COMPLETA.md) (análise),
[11B](PARTE-11B-SITUACAO-IDEAL.md) (situação ideal).
**Escopo**: Limpeza de código morto, deprecated, diretórios vazios, re-exports obsoletos.

---

## Fase 1: Eliminação de Arquivos @deprecated

**Objetivo**: remover 6 arquivos marcados como @deprecated e redirecionar todos os importadores.

### F1.1 — Eliminar `lib/permissions.js`

1. Buscar todos os importadores de `lib/permissions` ou `#copilot/lib/permissions`
2. Redirecionar para `#copilot/hooks/permission` (hooks/permission-handler.js)
3. Remover `permissions.js`
4. Remover re-export do `lib/index.js`

### F1.2 — Eliminar `lib/hooks.js`

1. Buscar todos os importadores de `lib/hooks` ou `#copilot/lib/hooks`
2. Redirecionar para `#copilot/hooks/factory`
3. Remover `hooks.js`
4. Remover re-export do `lib/index.js`

### F1.3 — Eliminar `bridges/gh-bridge.js`

1. Buscar importadores de `bridges/gh-bridge`
2. Redirecionar para `bridges/gh/index.js`
3. Remover `gh-bridge.js`

### F1.4 — Eliminar `terminal/bootstrap.js`

1. Verificar se existe entry point em package.json ou ecosystem.config apontando para bootstrap.js
2. Atualizar referências para `terminal/index.js`
3. Remover `bootstrap.js`

### F1.5 — Eliminar `terminal/http-handlers.js`

1. Buscar importadores (route-table.js, server.js, commands)
2. Redirecionar para handlers-agent.js / handlers-dialog.js / handlers-system.js conforme uso
3. Remover `http-handlers.js`

### F1.6 — Eliminar `agent/events.js`

1. Buscar importadores de `agent/events.js`
2. Redirecionar para `core/agent-events.js` (R9 canônico)
3. Remover `agent/events.js`
4. Remover re-export do `agent/index.js`

### Validação F1

- `npm run lint` — 0 errors
- `npm run format:check` — 0 warnings novas
- `npm run typecheck:node` — passa
- Confirmar que nenhum import aponta para arquivo removido

---

## Fase 2: Limpeza de `core/constants.js` @deprecated Entries

### F2.1 — Auditar constants.js

1. Listar todas as constantes marcadas @deprecated em `core/constants.js`
2. Verificar quais ainda têm importadores
3. Para cada constante deprecated com 0 importadores: remover
4. Para constantes com importadores: redirecionar e depois remover

### F2.2 — Limpar re-exports obsoletos em `core/index.js`

1. Remover exports de constantes eliminadas
2. Garantir que barrel exporta apenas o necessário

### Validação F2

- lint + typecheck + format:check passa

---

## Fase 3: Eliminar Diretório Vazio

### F3.1 — Remover `logs/`

1. Confirmar que `logs/` não contém arquivos (pode ter .gitkeep)
2. Verificar se algum módulo cria arquivos neste diretório em runtime
3. Se não: remover `.gitkeep` (se existir) e o diretório
4. Se sim: documentar e manter

### Validação F3

- Confirmar ausência de referências a `src/copilot/logs/` no código

---

## Fase 4: Limpeza de @deprecated Inline

### F4.1 — Auditar @deprecated inline em código ativo

1. `grep -rn @deprecated src/copilot --include='*.js'` filtrando arquivos já eliminados em F1
2. Para cada ocorrência restante:
   - Se é em arquivo já limpo (F1): ignorar
   - Se é em método/função: avaliar se pode ser removido
   - Se é em JSDoc de tipo: avaliar impacto na tipagem

### F4.2 — Remover deprecated inline sem importadores

1. Listar métodos/funções @deprecated
2. Verificar uso
3. Remover os sem uso

### Validação F4

- lint + typecheck passa
- `grep @deprecated src/copilot --include='*.js' | wc -l` reduzido

---

## Tracking de Commits

| Fase | Tipo | Commit Message Template |
| --- | --- | --- |
| F1 | cleanup | `cleanup(copilot): F1.N — eliminar deprecated ARQUIVO` |
| F2 | cleanup | `cleanup(copilot): F2 — limpar constants.js deprecated entries` |
| F3 | cleanup | `cleanup(copilot): F3 — remover diretório vazio logs/` |
| F4 | cleanup | `cleanup(copilot): F4 — remover deprecated inline sem uso` |
