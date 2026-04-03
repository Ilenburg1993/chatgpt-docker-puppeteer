# Audit: src/copilot/tools/tool-factory.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/tool-factory.js` **LOC**: 161 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece `buildTool()` e `withSkipPermission()`. `buildTool()` envolve `defineTool()` do SDK com
logging automático de invocação + timing. `normalizeParameters()` detecta Zod v3/v4 por duck typing
e converte para JSON Schema via `zodToJsonSchema`. `withSkipPermission()` usa `Object.assign` para
adicionar `skipPermission: true` a uma tool existente.

**Score**: 8.0/10

---

## Achados

### P4 — normalizeParameters: Duck-Typing Frágil para Detecção de Versão Zod

**Localização**: `normalizeParameters()`.

```js
if (params && typeof params === 'object') {
    if ('_def' in params) return zodToJsonSchema(params, { ... }); // Zod v3
    if ('_zod' in params) return zodToJsonSchema(params, { ... }); // Zod v4
}
```

Verifica presença de `_def` ou `_zod` para distinguir versões Zod. Um objeto não-Zod com propriedade
`_def` seria incorretamente passado para `zodToJsonSchema`, levando a output malformado ou exceção
(capturada pelo try/catch que retorna `undefined`).

**Impacto**: Baixo em prática — `_def` e `_zod` são propriedades internas Zod muito específicas.

---

### P4 — normalizeParameters: Retorna undefined em Caso de Falha Silenciosa

**Localização**: `normalizeParameters()`, catch block.

```js
} catch (err) {
    log('WARN', `[tool-factory] zodToJsonSchema failed for params: ${err.message}`);
    return undefined;
}
```

Se `zodToJsonSchema` falha, a tool é criada sem schema de parâmetros. O SDK pode aceitar qualquer
DTO, eliminando validação de entrada.

**Impacto**: Médio — tool sem schema de parâmetros aceita input não validado.

**Recomendação**: Considerar lançar erro durante `buildTool()` ao invés de criar tool sem schema.

---

### P4 — buildTool: Tools Criadas com defineTool Direto Não São Logadas

**Localização**: Padrão de logging em `buildTool()`.

```js
const wrappedHandler = async (args) => {
    log('DEBUG', `[tool-factory] Invocando tool '${name}'...`);
    ...
};
```

Apenas tools criadas com `buildTool()` têm esse logging. `session-rpc-tools.js` usa `defineTool`
direto, perdendo observabilidade. Inconsistência no sistema.

---

## Positivos

- `buildTool()` mede tempo de execução e logga duração — observabilidade automática
- `withSkipPermission()` é uma função pura simples (`Object.assign`) — sem side-effects
- Interface clara: `{ name, description, parameters, requiresApproval, handler }` → Tool
- Logging em DEBUG (não INFO) — não polui logs de produção
- `requiresApproval: true` como default — postura de segurança conservadora
