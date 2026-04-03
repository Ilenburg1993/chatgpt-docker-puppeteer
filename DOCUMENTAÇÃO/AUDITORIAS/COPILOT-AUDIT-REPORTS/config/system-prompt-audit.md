# system-prompt.js — Auditoria

**Módulo**: `src/copilot/config/` **Arquivo**: `system-prompt.js` **LOC**: 229 | **Score**: 8.5/10

## Responsabilidade

Constantes de identidade e builders de `SystemMessageConfig` para o LLM-B:

- Constantes: `AGENT_IDENTITY`, `AGENT_TONE`, `TOOL_EFFICIENCY`, `ENVIRONMENT_CONTEXT`,
  `CODE_CHANGE_RULES`, `AGENT_GUIDELINES`, `LAST_INSTRUCTIONS`
- Builders: `buildAppendSystemMessage`, `buildReplaceSystemMessage`, `buildGuidelinesAppendMessage`,
  `buildAlwaysAliveSystemMessage`, `buildHookContextAppendMessage`

## ACHADO C12-03 — P4

**`buildGuidelinesAppendMessage` usa `mode:'customize'` sem fallback para SDK < v0.2**

```js
// Problema: mode:'customize' com sections API depende do SDK v0.2.0
return { mode: 'customize', sections: { guidelines: { action: 'append', content } } };
```

O SDK v0.1.x não suporta `mode:'customize'`. Se a versão instalada for < v0.2.0,
`buildHookContextAppendMessage` propagará um objeto de configuração inválido ao SDK, causando falha
silenciosa ou erro em runtime. Não há fallback para `mode:'append'`.

**Correção recomendada**:

```js
export function buildGuidelinesAppendMessage(content) {
  // Fallback para 'append' se SDK não suportar 'customize'
  if (!SDK_SECTIONS || !SDK_SECTIONS['guidelines']) {
    return buildAppendSystemMessage(content);
  }
  return { mode: 'customize', sections: { guidelines: { action: 'append', content } } };
}
```

## Destaques Positivos

- `SYSTEM_PROMPT_SECTIONS` re-exportado do SDK — forward-compat com sections API v0.2.0
- `buildReplaceSystemMessage` documenta claramente o aviso sobre guardrails removidas
- Hierarquia de 3 modos (`append`, `replace`, `customize`) bem documentada
- `LAST_INSTRUCTIONS` injeta lembrete sobre protocolo de hooks diretamente no system prompt do LLM-B
- `buildAlwaysAliveSystemMessage` agrega todas as seções em uma única chamada

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
