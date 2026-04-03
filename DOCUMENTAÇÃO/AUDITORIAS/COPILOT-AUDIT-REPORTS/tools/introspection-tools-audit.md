# Audit: src/copilot/tools/introspection-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/introspection-tools.js` **LOC**: 258
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 4 tools de introspecção: `list_tools`, `get_agent_info`, `get_telemetry` e `report_intent`.
Todas marcadas com `withSkipPermission()`. `CATEGORY_TOOL_MAP` é hardcoded e stale.
`setTelemetryStore()` é deprecated. `registerForIntrospection()` popula `_registeredTools` para
`list_tools`. `get_agent_info` usa `createRequire` para ler o `package.json` do SDK.

**Score**: 7.5/10

---

## Achados

### P4 — CATEGORY_TOOL_MAP Desatualizado

**Localização**: `CATEGORY_TOOL_MAP`, linhas iniciais do arquivo.

```js
const CATEGORY_TOOL_MAP = {
    file: ['read_file_content', 'list_directory', 'search_in_files', ...],
    git: ['git_status', 'git_diff', ...],
    // ... hub_*, todo_*, session_rpc_* NÃO PRESENTES
};
```

Novos modules (hub*\*, todo*_, session*rpc*_, permission\_\*) não estão no mapa. `list_tools` com
`category: 'todo'` retornaria lista vazia.

**Impacto**: Médio — funcionalidade de categorização por `list_tools` está quebrada para metade das
tools.

**Recomendação**: Derivar `CATEGORY_TOOL_MAP` automaticamente de `_registeredTools` usando o prefixo
do tool name. O comentário `// TODO:` já documenta esse plano.

---

### P4 — setTelemetryStore Exported Como Deprecated No-Op Mas Ainda Importado

**Localização**: Final do arquivo.

```js
/** @deprecated Migrated to defaultMetrics. Use get_telemetry to access metrics. */
export function setTelemetryStore(_store) {
  log('WARN', '[introspection] setTelemetryStore() is a no-op');
}
```

Esta função é exportada e re-exportada em `index.js`. Callers externos que a chamam recebem apenas
warning no log. O export deveria ser removido após ciclo de deprecação.

**Impacto**: Baixo; no-op seguro. Mas polui a API pública do módulo.

---

### P5 — list_tools: Retorno Vazio (Sem Erro) para Categoria Inválida

**Localização**: `listToolsTool`, bloco de filtro.

```js
if (category) {
  const allowed = CATEGORY_TOOL_MAP[category] ?? [];
  tools = tools.filter((t) => allowed.includes(t.name));
}
```

Se `category` não estiver em `CATEGORY_TOOL_MAP` (ex: `'todo'`), `allowed = []` e `list_tools`
retorna array vazio. Nenhuma mensagem de erro indica que a categoria é inválida ou desconhecida.

**Recomendação**: Se `category` foi fornecida mas não está no mapa e `_registeredTools` também não
tem matches, retornar `{ warning: 'unknown category' }` ao invés de lista vazia.

---

## Positivos

- `registerForIntrospection()` permite que módulos registrem suas tools dinamicamente
- `report_intent` logs com `risk: 'low'/'medium'/'high'` — bom rastreamento de intent
- `get_agent_info` usa `createRequire(import.meta.url)` para ler package.json do SDK — técnica
  correta em ESM
- `_registeredTools` é somente-módulo (não exportado diretamente) — encapsulamento correto
- `get_telemetry` usa `defaultMetrics` do core — fonte única de verdade para métricas
