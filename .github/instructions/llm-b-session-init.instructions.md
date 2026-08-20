---
name: 'LLM-B Session Init'
description: 'Protocolo obrigatório de inicialização de sessão para LLM-B operando no src/copilot'
applyTo: '**/*'
---

# LLM-B Session Init — Protocolo de Inicialização

**Propósito**: garantir que o índice semântico e o escopo de trabalho estejam aquecidos no turno 1
de qualquer sessão ou retomada, maximizando eficiência de search sem gastar tool calls extras ao
longo do ciclo.

**Status**: Canônico. **Última atualização**: 2026-05-16.

---

## Turno 1 — Ações obrigatórias (executar em paralelo)

Ao iniciar ou retomar uma sessão operando em `src/copilot`, execute imediatamente:

```js
// 1. Aquece o índice FTS5+símbolos do escopo primário
workspace_index_build({ directory: 'src/copilot', recursive: true });

// 2. Declara escopo de trabalho — pré-aquece cache e parser Babel
workspace_scope_declare({
  sessionId: 'copilot-primary',
  directory: 'src/copilot',
  awaitReady: false,
});
```

Essas duas chamadas podem ser feitas em paralelo e reduzem drasticamente latência de buscas
subsequentes (FTS5 index-first dispatch, hit de cache em `read_file_content` e symbol lookup direto
sem scan completo).

---

## Hierarquia canônica de search (ordem de prioridade)

Ao buscar símbolos, funções ou arquivos em `src/copilot`:

```
1. workspace_scope_find_symbol     — lookup no escopo Babel pré-parseado (O(1), sem I/O)
2. workspace_index_find_symbol     — FTS5 SQLite sobre tabela de símbolos (~ms)
3. workspace_symbol_search         — ripgrep com padrão regex sobre o FS (~10ms)
4. search_in_files                 — ripgrep/FTS texto livre (mais lento para símbolos)
```

Para busca de imports/dependências entre arquivos:

```
workspace_find_imports(source)     — query direta na tabela copilot_io_index_imports
```

**Nunca** use `search_in_files` para lookup de símbolos se `workspace_scope_find_symbol` ou
`workspace_index_find_symbol` puderem responder. Reserve `search_in_files` para padrões textuais
livres, regex ou busca multi-campo.

---

## Leitura de arquivos — boas práticas

- Prefira `read_file_content` com `startLine`/`endLine` para arquivos grandes (> 200 linhas).
- Para leitura de múltiplos arquivos independentes, chame em paralelo (único response turn).
- Use `workspace_scope_context` para obter uma visão rápida dos arquivos mais quentes do escopo sem
  precisar listar diretórios manualmente.

---

## Quality gates copilot

Antes de qualquer commit, executar:

```
npm run validate:copilot   # lint:copilot + typecheck:node + test:copilot:unit (com cache)
```

Scripts individuais (para validação focada durante desenvolvimento):

```
npm run lint:copilot        # ESLint apenas em src/copilot + tests/unit/copilot
npm run test:copilot:unit   # Vitest suite copilot (2746 testes)
npm run typecheck:node      # tsc strict para Node ESM
```

---

## Referências canônicas

- Arquitetura IO/index: `src/copilot/infra/io-index-sqlite.js` + `io-index-registry.js`
- Barrel público: `src/copilot/infra/public/indexing.js`
- Tools de índice: `src/copilot/tools/file/index-tools.js`
- Motor de search: `src/copilot/infra/io/search/text-search.js`
- Protocolo operacional: `.github/AGENTS.md`
