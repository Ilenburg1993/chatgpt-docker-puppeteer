# types/structured-message.js — Auditoria

**Módulo**: `src/copilot/types/` **Arquivo**: `structured-message.js` **LOC**: 380 | **Score**:
8.7/10

## Responsabilidade

Protocolo StructuredMessage — Sprint A (Structured Dialog Protocol). Define a comunicação
estruturada LLM-A ↔ LLM-B com:

- Schema Zod (`StructuredMessageSchema`, `.strict()`)
- Schema de resposta (`StructuredMessageResponseSchema`, `.passthrough()`)
- Builders: `buildStructuredRequest`, `buildStructuredResponse`
- Serializer: `serializeStructuredMessage`
- Parser: `parseStructuredResponse` (4 estratégias, graceful fallback)
- Guard: `isStructuredMessage`

## Achados

### P4 — `parseStructuredResponse` Estratégia 4 (greedy `{...}`) pode extrair JSON parcial aninhado

**Localização**: `structured-message.js:336-345` — Estratégia 4 usa `raw.indexOf('{')` /
`raw.lastIndexOf('}')`

**Descrição**: A busca greedy do primeiro `{` e último `}` pode cruzar limites de objetos JSON
aninhados em texto misto. Exemplos problemáticos:

```
"Aqui está: {"ok": true} e depois disso {"context": "x", "intent": "y", "responseType": "diagnostic"}"
                                                                    ^--- greedy pega até aqui ---^
```

O candidato extraído seria `{"ok": true} e depois {"context":...}` — JSON inválido. `_tryParseJson`
recusa, mas a Estratégia 4 pode não alcançar o objeto correto se houver múltiplos objetos aninhados.

**Impacto prático**: baixo — a maioria das respostas não contém múltiplos objetos JSON no mesmo
bloco de texto. Mas em respostas de LLM-B que incluem código de exemplo com objetos, pode haver
falso negativo (retorna `null` quando deveria parsear).

**Sugestão**: Iterar por `matches` com regex global `/{[^]*?}/g` e tentar cada candidato em ordem,
ou usar a lib `jsonparse` para find + parse tolerante.

---

### P4 — `serializeStructuredMessage` injeta instrução de protocolo como texto simples

**Localização**: `structured-message.js:296-308`

**Descrição**:

```js
return [
  'STRUCTURED_PROTOCOL_V1:',
  'Leia a mensagem JSON abaixo e responda EXCLUSIVAMENTE com um JSON válido',
  ...json,
].join('\n');
```

A instrução `STRUCTURED_PROTOCOL_V1:` é inserida concatenada no início da mensagem. Se LLM-B muda de
modelo ou versão de sistema prompt, a instrução pode ser ignorada ou mal-interpretada, e
`parseStructuredResponse` retornará `null` (fallback para texto puro). O sistema tolera isso (via
`chatStructured` que seta `parseError`), mas é uma dependência frágil.

**Impacto**: Em prática, isso é intencional (graceful fallback documentado). P4 por design frágil —
não há mecanismo de validação de que LLM-B entendeu a instrução antes de processar.

---

### P5 — `buildStructuredRequest` gera 2 `crypto.randomUUID()` por chamada sem seed configurável

**Localização**: `structured-message.js:254-256`

**Descrição**: `traceId` e `correlationId` são sempre gerados com `crypto.randomUUID()` quando não
fornecidos. Em testes, isso torna os objetos não-determinísticos, dificultando snapshots e
assertions exatas.

**Sugestão**: Aceitar um `seed` opcional ou `uuidFactory` injetável para testes (para mocking).

---

### P5 — `StructuredMessageSchema` usa `.strict()` que rejeita campos extras de LLM-B requests

**Localização**: `structured-message.js:175` — `StructuredMessageSchema.strict()`

**Descrição**: `StructuredMessageSchema.parse(input)` em `buildStructuredRequest` usa `.strict()`,
que rejeita qualquer campo não declarado. Se o chamador incluir props extras no `input` (ex: via
spread de um objeto com propriedades adicionais), a validação lança `ZodError`.

**Mitigação atual**: `StructuredMessageResponseSchema` usa `.passthrough()` para respostas LLM-B — a
separação está documentada. P5 apenas como lembrete para callers de `buildStructuredRequest`.

---

## Destaques Positivos

- **UPG-PROP-03**: `.strict()` no schema de request — previne campos proprietários não declarados
- **F5.4 (ARCH-06)**: schema separado `.passthrough()` para responses de LLM-B — não rejeita
  extensões futuras
- **UPG-PROP-11**: `correlationId` validado como UUID via Zod — malformações detectadas na criação
- **UPG-03**: `timestamp` e `correlationId` auto-gerados em `buildStructuredRequest`
- **MELHORIA-12**: `traceId` auto-gerado se não fornecido
- Parser com 4 estratégias ordenadas por especificidade (JSON puro → `json → ` sem lang → greedy)
- `isStructuredMessage` como type guard via `safeParse` — sem exceção
- `StructuredMessageInput` como tipo composto (`Omit + Partial`) — API limpa para callers

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
