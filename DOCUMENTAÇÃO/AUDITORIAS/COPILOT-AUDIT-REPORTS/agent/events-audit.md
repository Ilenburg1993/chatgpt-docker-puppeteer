# Auditoria Individual — `agent/events.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-09).

---

## 1. Identificação

| Campo       | Valor                         |
| ----------- | ----------------------------- |
| **Arquivo** | `src/copilot/agent/events.js` |
| **Módulo**  | `agent/`                      |
| **LOC**     | 115                           |
| **Fase**    | F05-09                        |

---

## 2. Propósito e Responsabilidade

Centraliza nomes de eventos emitidos pelo AlwaysAliveAgent via `as const` tuple. Define
`AGENT_EVENTS` (50+ eventos), `AgentEventName` union type, e `HIGH_FREQUENCY_EVENTS` Set para
filtragem de hot-path. Elimina strings literais espalhadas pelo codebase.

---

## 3. API Pública (Exports)

| Export                  | Tipo        | Descrição curta                        |
| ----------------------- | ----------- | -------------------------------------- |
| `AGENT_EVENTS`          | const tuple | Lista canônica de ~50 nomes de eventos |
| `AgentEventName`        | @typedef    | Union type derivado de AGENT_EVENTS    |
| `HIGH_FREQUENCY_EVENTS` | ReadonlySet | Set de eventos hot-path para filtragem |

**Consumidores**: bridges, wirer, observability, API routes, testes

---

## 4. Dependências (Imports)

Nenhum — módulo puramente declarativo.

---

## 5. Estado Interno

`HIGH_FREQUENCY_EVENTS` — `ReadonlySet` imutável no escopo do módulo. Seguro.

---

## 6. Achados (Questões Formais)

### GAP-AGENT-005 — `AGENT_EVENTS` inclui `'before-stop'` com hífen (convenção inconsistente)

- **Severidade**: P5
- **Arquivo**: `src/copilot/agent/events.js`#L51
- **Descrição**: Comentário no JSDoc diz "Hífens são reservados para `before-stop` (legado)". Todos
  os outros eventos usam underscore ou dot. Inconsistência de naming que pode confundir
  consumidores.
- **Proposta de correção**: Deprecar `before-stop` e emitir `before_stop` em paralelo, removendo
  `before-stop` em próximo major.
- **Impacto se não corrigido**: Puramente cosmético; nenhum bug funcional.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                    |
| ------------------- | ------------ | -------------------------------- |
| Contratos (tipos)   | 10           | `as const` + typedef union       |
| Error handling      | N/A          | Declarativo                      |
| Segurança           | 10           | Sem superfície                   |
| Performance         | 10           | Constantes; Set O(1)             |
| Testabilidade       | 10           | Importável diretamente           |
| Manutenibilidade    | 9            | Bem documentado; JSDoc extensivo |
| **Média ponderada** | **9.8**      | Exemplar para o repositório      |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (constants do agente)
- **Padrão**: Enum-as-const — padrão estabelecido no repo
- **Conformidade AS-IS→TO-BE**: ✅ Exemplar — centralização de magic strings
