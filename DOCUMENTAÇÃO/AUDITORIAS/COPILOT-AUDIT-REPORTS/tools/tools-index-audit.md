# Audit: src/copilot/tools/index.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/index.js` **LOC**: 73 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Barrel principal do módulo tools. Assembla `allTools` combinando arrays de todos os 12 sub-módulos.
Re-exporta `buildTool`, `withSkipPermission`, `setTelemetryStore` (deprecated) e helpers de DI dos
sub-módulos. Ordem dos tools em `allTools` é determinística.

**Score**: 8.0/10

---

## Achados

### P4 — Re-export de setTelemetryStore (Deprecated No-Op)

**Localização**: Linha de export.

```js
export { setTelemetryStore } from './introspection-tools.js';
```

`setTelemetryStore` é uma função no-op marcada como `@deprecated`. Sua re-exportação mantém callers
externos que ainda a invocem funcionando silenciosamente (com log WARN), mas polui a API pública do
módulo.

**Recomendação**: Remover após garantir que nenhum caller externo usa este export.

---

### P5 — Ordem de allTools Não Documentada

**Localização**: Composição de `allTools`.

```js
export const allTools = [
  ...taskTools,
  ...codeTools,
  ...gitTools,
  ...sessionTools,
  ...sessionRpcTools,
  ...hookTools,
  ...hubTools,
  ...introspectionTools,
  ...fileTools,
  ...shellTools,
  ...webTools,
  ...todoTools,
  ...permissionTools,
];
```

A ordem é determinística mas não documentada. Se o SDK usa a posição do tool para resolver colisões
de nome, a ordem importa. Nenhum comentário explica a lógica de ordenação.

**Impacto**: Muito baixo; tools têm nomes únicos.

---

## Positivos

- `allTools` como array flat — consumer pode iterar uniformemente
- Todos os exports de DI centralizados aqui — callers do módulo só precisam importar de um lugar
- Separação clara entre tools (arrays) e factory (buildTool, withSkipPermission)
