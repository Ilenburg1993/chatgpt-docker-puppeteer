# 14 — types/ — Módulo Consolidado

**Módulo**: `src/copilot/types/` **Arquivos**: 3 | **LOC total**: 515 **Score**: 8.7/10 **Data**:
2026-06

## Visão Geral

Tipos e protocolo de comunicação LLM-A ↔ LLM-B. Dois sub-módulos:

| Arquivo                 | Propósito                            | Runtime                 |
| ----------------------- | ------------------------------------ | ----------------------- |
| `index.js`              | Barrel re-export                     | Zero logic              |
| `sdk.js`                | 15 typedefs do `@github/copilot-sdk` | Zero (puro JSDoc)       |
| `structured-message.js` | Protocolo StructuredMessage Sprint A | Zod + runtime functions |

## Mapa Funcional — structured-message.js

| Exportação                        | Tipo         | Propósito                                                                  |
| --------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `RESPONSE_TYPES`                  | `const enum` | 6 tipos de resposta: diagnostic, plan, code, question, confirmation, error |
| `PRIORITY_LEVELS`                 | `const enum` | 4 prioridades: low, medium, high, critical                                 |
| `StructuredMessageSchema`         | `ZodSchema`  | Schema `.strict()` para requests                                           |
| `buildStructuredRequest(input)`   | `Function`   | Cria request LLM-A → LLM-B com auto-generated IDs                          |
| `buildStructuredResponse(input)`  | `Function`   | Cria response LLM-B → LLM-A                                                |
| `serializeStructuredMessage(msg)` | `Function`   | Serializa com instrução de protocolo                                       |
| `parseStructuredResponse(raw)`    | `Function`   | Parser graceful com 4 estratégias                                          |
| `isStructuredMessage(value)`      | `Function`   | Type guard sem exceção                                                     |

## Achados por Severidade

### P4 (2)

| ID          | Arquivo               | Título                                                                                          |
| ----------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| TYPES-P4-01 | structured-message.js | Parser Estratégia 4 (greedy `{...}`) pode extrair JSON parcial de múltiplos objetos **[FIXED]** |
| TYPES-P4-02 | structured-message.js | `serializeStructuredMessage` injeta instrução de protocolo como texto simples — frágil          |

**TYPES-P4-01**: `raw.indexOf('{')` / `raw.lastIndexOf('}')` pode capturar texto entre dois objetos
JSON distintos, produzindo JSON inválido que `_tryParseJson` recusa — mas pode não alcançar o objeto
correto. Impacto prático: baixo (respostas LLM-B com múltiplos objetos JSON inline são raras).

**TYPES-P4-02**: A instrução `STRUCTURED_PROTOCOL_V1: Leia a mensagem...` é texto concatenado. Se
LLM-B mudar comportamento ou modelo, a instrução pode ser ignorada e `parseStructuredResponse`
retorna `null`. O sistema tolera via `chatStructured.parseError`, mas não há handshake de
confirmação.

### P5 (2)

| ID          | Arquivo               | Título                                                                           |
| ----------- | --------------------- | -------------------------------------------------------------------------------- |
| TYPES-P5-01 | structured-message.js | `buildStructuredRequest` gera UUIDs não-determinísticos — dificilidade em testes |
| TYPES-P5-02 | sdk.js                | Não re-exportado via `types/index.js` — acesso inconsistente pelo barrel         |

## Score por Arquivo

| Arquivo               | LOC     | Score      | P4    | P5    |
| --------------------- | ------- | ---------- | ----- | ----- |
| index.js              | 23      | 9.5/10     | 0     | 0     |
| sdk.js                | 112     | 9.5/10     | 0     | 1     |
| structured-message.js | 380     | 8.7/10     | 2     | 1     |
| **TOTAL**             | **515** | **8.7/10** | **2** | **2** |

## Padrões Notáveis

### Dois schemas Zod com semânticas opostas (intencionais)

- `StructuredMessageSchema` (`.strict()`) — requests: rejeita campos extras → garante protocolo fiel
- `StructuredMessageResponseSchema` (`.passthrough()`) — responses LLM-B: tolera extensões futuras

### Parser multi-estratégia graceful

4 estratégias em ordem crescente de permissividade:

1. JSON puro no texto
2. Bloco ` ```json ... ``` `
3. Bloco ` ``` ... ``` ` (sem linguagem)
4. Greedy `{...}` (fallback)

Retorna `null` sem exceção se nenhuma estratégia funcionar — LLM-B pode responder texto puro.

### Auto-geração de IDs em `buildStructuredRequest`

- `traceId`: rastreamento agregado nos logs (MELHORIA-12)
- `correlationId`: match exato request/response (UPG-03), validado como UUID por Zod (UPG-PROP-11)
- `timestamp`: carimbo temporal Unix ms (UPG-03)

## Referências

| Arquivo                     | Path                                                         |
| --------------------------- | ------------------------------------------------------------ |
| index.js                    | [index-audit.md](./index-audit.md)                           |
| sdk.js                      | [sdk-audit.md](./sdk-audit.md)                               |
| structured-message.js       | [structured-message-audit.md](./structured-message-audit.md) |
| Módulo anterior (F17 core/) | [../core/13-core.md](../core/13-core.md)                     |

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II — F18 types/._
