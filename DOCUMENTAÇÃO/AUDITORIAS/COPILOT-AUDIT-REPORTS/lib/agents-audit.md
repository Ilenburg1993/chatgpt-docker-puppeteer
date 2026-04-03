# agents.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `agents.js` **LOC**: 173 | **Score**: 9.0/10

## Responsabilidade

Factories de `CustomAgentConfig` para o SDK. Define `READ_ONLY_TOOLS`, e os builders: `createAgent`,
`createReadOnlyAgent`, `createFullAccessAgent`, `createAnalystAgent`, `buildAgentList`,
`isValidAgentName`, `filterInferableAgents`.

## Achados

### C13-A01 — P5

**`READ_ONLY_TOOLS` hardcoded — drift potencial**

```js
const READ_ONLY_TOOLS = [
  'read_file',
  'list_directory',
  'grep_search',
  'file_search',
  'semantic_search',
  'get_errors',
];
```

Se o SDK alterar o nome dos tools built-in, essa lista fica stale sem aviso em runtime.

### C13-A02 — P5

**`createFullAccessAgent` usa `tools: null`**

O comportamento de `null` como "todos os tools" depende de interpretação do SDK sem documentação
explícita. Caso o SDK mude a semântica, agentes de acesso total passam a receber zero tools.

## Destaques Positivos

- `isValidAgentName` regex rigorosa: `/^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/`
- `createAgent` valida `name` e `prompt` antes de construir o objeto
- `filterInferableAgents` usa `!== false` (não `=== true`) — default-on correto para infer

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
