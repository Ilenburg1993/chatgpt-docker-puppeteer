# Auditoria Individual — `agent/tools-bootstrap.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-21).

---

## 1. Identificação

| Campo       | Valor                                  |
| ----------- | -------------------------------------- |
| **Arquivo** | `src/copilot/agent/tools-bootstrap.js` |
| **Módulo**  | `agent/`                               |
| **LOC**     | 127                                    |
| **Fase**    | F05-21                                 |

---

## 2. Propósito e Responsabilidade

Bootstrap de ferramentas do agente. Registra 15 categorias de tools no ToolRegistry, detecta
colisões de nome, registra tools MCP dinâmicas e custom tools declarativas, expõe registry para
introspection tools, loga summary por categoria.

---

## 3. API Pública (Exports)

| Export               | Tipo      | Descrição curta                            |
| -------------------- | --------- | ------------------------------------------ |
| `bootstrapTools`     | function  | Registra todas tools e retorna array final |
| `configureHookTools` | re-export | Configura tools de hook                    |
| `setHub`             | re-export | Injeta hub nas tools                       |
| `setPermissionAgent` | re-export | Injeta agent de permissão                  |
| `setSessionRpc`      | re-export | Injeta session RPC handler                 |

---

## 4. Dependências (Imports)

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |
| `../config/tools/registry.js`   | ❌ bypass   | config/tools/  |
| `../lib/tools-registry.js`      | ❌ bypass   | lib/           |
| `../tools/index.js`             | ✅ barrel   | tools/         |

- **Barrel bypasses**: 3 (logger, config/tools/registry, lib/tools-registry)
- **SDK direto**: Não

---

## 5. Estado Interno

Nenhum estado mutável. `TOOL_GROUPS` é local à função.

---

## 6. Achados (Questões Formais)

### GAP-AGENT-014 — Duplicates detection loga WARN mas não impede uso de tools com nomes conflitantes

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/tools-bootstrap.js`#L108-L112
- **Descrição**: Se duas tools têm o mesmo nome (ex.: uma custom tool e uma estática), ambas são
  registradas e o array final contém duplicatas. O SDK trata isso como "última ganha", mas o
  comportamento não é documentado e pode mudar.
- **Proposta**: Filtrar duplicatas mantendo a última (custom > mcp > static) e logar resolução.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                         |
| ------------------- | ------------ | ------------------------------------- |
| Contratos (tipos)   | 8            | JSDoc ✅; TOOL_GROUPS type é `any[]`  |
| Error handling      | 7            | Sem proteção em buildCustomTools()    |
| Segurança           | 9            | Tools estaticamente definidas         |
| Performance         | 9            | Uma única iteração; Map para contagem |
| Testabilidade       | 8            | DI via registry parâmetro             |
| Manutenibilidade    | 9            | 127 LOC, single-purpose               |
| **Média ponderada** | **8.5**      | **(8×2 + 9×2 + 7+9+8+9) / 8 ≈ 8.5**   |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (tools lifecycle)
- **Padrão**: Registry Pattern — centraliza bootstrap de ferramentas
- **Conformidade AS-IS→TO-BE**:
  - ✅ G1-ARCH-07: TOOL_GROUPS local, iteração única
  - ✅ G2-DX-18: log de summary com contagem por categoria
  - ❌ 3 barrel bypasses
