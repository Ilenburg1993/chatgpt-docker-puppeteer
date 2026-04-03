# Auditoria Individual — `agent/agent-contract.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit. Plano:
> `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## 1. Identificação

| Campo               | Valor                                 |
| ------------------- | ------------------------------------- |
| **Arquivo**         | `src/copilot/agent/agent-contract.js` |
| **Módulo**          | `agent/`                              |
| **LOC**             | 69                                    |
| **Fase**            | F05-01                                |
| **Data de leitura** | 2026-07-05                            |
| **Releitura?**      | Sim (MF-I + MF-II)                    |

---

## 2. Propósito e Responsabilidade

Arquivo de declarações de tipos (type-only module). Define `IAlwaysAliveAgent` — a interface pública
canônica do agente always-alive. Centraliza o contrato para que alterações na API do agente reflitam
em todos os consumers sem acoplamento à implementação concreta. Não contém código executável, apenas
JSDoc typedefs e `export {}`.

---

## 3. API Pública (Exports)

| Export              | Tipo     | Descrição curta                                |
| ------------------- | -------- | ---------------------------------------------- |
| `IAlwaysAliveAgent` | @typedef | Interface pública canônica do AlwaysAliveAgent |

**Total de exports**: 1 (typedef) **Exports consumidos externamente**: 2 arquivos
(`api/bridge-control.js` via import direto, `agent/index.js` via re-export) **Exports possivelmente
dead**: nenhum

---

## 4. Dependências (Imports)

### 4.1 Imports internos

Nenhum. Arquivo é leaf node puro — zero imports.

### 4.2 Imports externos

Nenhum.

### 4.3 Diagnóstico de imports

- **Barrel bypasses**: 0
- **SDK direto**: Não
- **Violação de camada**: Não — Layer 5 (Orchestration), sem dependências
- **Circular potencial**: Não

---

## 5. Estado Interno

### 5.1 Variáveis de módulo

Nenhuma. Arquivo type-only.

### 5.2 Singletons

Nenhum.

### 5.3 Timers e Listeners

Nenhum.

---

## 6. Análise de Contratos

### 6.1 Contratos de entrada

N/A — arquivo de tipos. Porém, a **definição dos contratos** merece análise:

| Método no typedef   | Param              | Tipo esperado                                  | Validação?    | Default seguro? |
| ------------------- | ------------------ | ---------------------------------------------- | ------------- | --------------- |
| `sendMessage`       | `message`          | `string`                                       | N/A (typedef) | N/A             |
| `sendMessage`       | `opts`             | `{timeoutMs?, attachments?, signal?, taskId?}` | N/A           | N/A             |
| `sendMessage`       | `opts.attachments` | `any`                                          | ⚠️ loose      | N/A             |
| `stop`              | `opts`             | `{shutdownTimeoutMs?}`                         | N/A           | N/A             |
| `stopDialogLoop`    | `opts`             | `{authorized?, reason?, shutdownTimeoutMs?}`   | N/A           | N/A             |
| `setPermissionMode` | `mode`             | union literal                                  | ✅ tipado     | N/A             |

### 6.2 Contratos de saída

| Método                  | Return type               | Nullable?    | Error propagation |
| ----------------------- | ------------------------- | ------------ | ----------------- |
| `getStatusSnapshot`     | `Record<string, unknown>` | Não          | N/A               |
| `start`                 | `Promise<void>`           | Não          | throws            |
| `stop`                  | `Promise<void>`           | Não          | throws            |
| `sendMessage`           | `Promise<unknown>`        | ⚠️ `unknown` | throws            |
| `answerPendingQuestion` | `boolean`                 | Não          | N/A               |
| `listenerDiagnostics`   | `Record<string, number>`  | Não          | N/A               |

### 6.3 JSDoc completeness

| Critério                       | Status                                              |
| ------------------------------ | --------------------------------------------------- |
| Todos os exports têm JSDoc?    | ✅                                                  |
| @param com tipo explícito?     | ✅ (via @property)                                  |
| @returns com tipo explícito?   | ✅ (via arrow types)                                |
| @throws documentado?           | ❌ — nenhum método documenta throws                 |
| @example em funções complexas? | ❌ — sem exemplos (mas há exemplo de uso no header) |
| Typedefs completos e corretos? | ⚠️ parcial (ver achados)                            |

---

## 7. Error Handling

N/A — arquivo de tipos, sem código executável.

---

## 8. Segurança

| Vetor               | Aplicável? | Mitigado? | Detalhes              |
| ------------------- | ---------- | --------- | --------------------- |
| Injection (SQL/cmd) | ❌         | N/A       | Sem código executável |
| Path traversal      | ❌         | N/A       |                       |
| SSRF                | ❌         | N/A       |                       |
| Secrets exposure    | ❌         | N/A       |                       |
| Prompt injection    | ❌         | N/A       |                       |
| Auth bypass         | ❌         | N/A       |                       |

---

## 9. Concorrência e Race Conditions

N/A — arquivo de tipos.

---

## 10. Performance

N/A — nenhum código executável.

---

## 11. Achados (Questões Formais)

### GAP-AGENT-001 — sendMessage retorna `Promise<unknown>` (tipo loose)

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/agent-contract.js`#L37-L40
- **Descrição**: `sendMessage` é definido como retornando `Promise<unknown>`. Isso força todo
  consumer a fazer type narrowing manual. O tipo real retornado pela implementação deveria ser
  tipado explicitamente (provavelmente `Promise<string>` ou `Promise<{response: string, ...}>`).
- **Cenário de manifestação**: Qualquer consumer que chame `sendMessage` não tem informação de tipo
  no retorno, dificultando type-safety.
- **Proposta de correção**: Trocar `Promise<unknown>` por `Promise<string>` ou um typedef dedicado
  `SendMessageResult`.
- **Impacto se não corrigido**: Type unsafety propagada para todos os consumers do agente.

### GAP-AGENT-002 — attachments tipado como `any`

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/agent-contract.js`#L38
- **Descrição**: O campo `attachments` no opts de `sendMessage` é tipado como `any`. Deveria ter um
  typedef específico (e.g., `Array<{type: string, data: Buffer | string}>`).
- **Cenário de manifestação**: Qualquer valor pode ser passado como attachment sem validação de
  tipo.
- **Proposta de correção**: Definir `@typedef SendMessageAttachment` e usar no contrato.
- **Impacto se não corrigido**: Acoplamento loose — callers podem enviar dados inválidos.

### GAP-AGENT-003 — Propriedades opcionais com `| undefined` implícito

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/agent-contract.js`#L53-L63
- **Descrição**: `getPermissionMode`, `setPermissionMode` e `setMaxListeners` são opcionais via
  `| undefined`. Isso é correto na semântica (feature opcional), mas callers precisam fazer
  null-check antes de chamar. Considerando `exactOptionalPropertyTypes: true` no tsconfig, isso é
  consistente.
- **Cenário de manifestação**: Nenhum bug real — apenas nota de design.
- **Proposta de correção**: Nenhuma necessária — design intencional.

---

## 12. Upgrades Propostos

### UPG-AGENT-001 — Adicionar `@throws` documentation ao contrato

- **Prioridade**: P3
- **Motivação**: Métodos como `start`, `stop`, `sendMessage`, `stopDialogLoop` são async e podem
  rejeitar. Documentar os tipos de erro no contrato permitiria que consumers façam error handling
  mais preciso.
- **Implementação proposta**: Adicionar `@throws {Error}` (ou tipo específico) a cada método async.
- **Trade-offs**: Mais documentação para manter; ganho em clareza da API.
- **Complexidade estimada**: Baixa

### UPG-AGENT-002 — Extrair `SendMessageOpts` e `StopDialogLoopOpts` como typedefs

- **Prioridade**: P3
- **Motivação**: Os objetos de opções inline (`opts?: { timeoutMs?: number; ... }`) são complexos e
  repetitivos. Extrair para typedefs nomeados melhora reuso e documentação.
- **Implementação proposta**: Criar `@typedef SendMessageOpts`, `@typedef StopDialogLoopOpts`,
  `@typedef SetPermissionModeOpts`.
- **Trade-offs**: Mais indireção; ganho em reuso.
- **Complexidade estimada**: Baixa

---

## 13. Cobertura de Testes

| Critério                      | Status                      |
| ----------------------------- | --------------------------- |
| Existe spec dedicado?         | ❌                          |
| Arquivo do spec               | N/A                         |
| Cenários cobertos             | N/A (type-only, sem lógica) |
| Cenários edge NÃO cobertos    | N/A                         |
| Cenários de erro NÃO cobertos | N/A                         |

> Nota: Por ser type-only, não requer testes unitários. A validação do contrato é feita
> indiretamente via TypeScript/tsserver (type checking) e pelos testes dos consumers.

---

## 14. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                  |
| ------------------- | ------------ | ---------------------------------------------- |
| Contratos (tipos)   | 7            | Sólido mas `unknown` e `any` em 2 pontos       |
| Error handling      | 10           | N/A — sem código executável (nota máxima)      |
| Segurança           | 10           | N/A — sem superfície de ataque                 |
| Performance         | 10           | N/A — zero runtime                             |
| Testabilidade       | 9            | Type-only, verificado por tsserver             |
| Manutenibilidade    | 8            | Bem documentado, centralizado, mas opts inline |
| **Média ponderada** | **8.9**      | **(7×2 + 10×2 + 10+10+9+8) / 8 = 71/8 = 8.9**  |

---

## 15. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration
- **Direção de dependência**: Leaf node (zero imports). Consumido por agent/index.js (re-export) e
  api/bridge-control.js (import direto).
- **Conformidade AS-IS→TO-BE**: ✅ Alinhado. O padrão de interface-contract separado da
  implementação é exatamente o que a visão TO-BE recomenda.
- **Import direto de `api/bridge-control.js`**: Viola o barrel pattern (deveria importar via
  `#copilot/agent`). Baixa severidade pois o barrel re-exporta o mesmo typedef.
