# Auditoria Individual — `agent/tool-audit-logger.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-20).

---

## 1. Identificação

| Campo       | Valor                                    |
| ----------- | ---------------------------------------- |
| **Arquivo** | `src/copilot/agent/tool-audit-logger.js` |
| **Módulo**  | `agent/`                                 |
| **LOC**     | 190                                      |
| **Fase**    | F05-20                                   |

---

## 2. Propósito e Responsabilidade

Logging de auditoria de permissões de ferramentas SDK. Três responsabilidades:

1. `isHighRiskTool()` — classifica ferramentas de alto risco
2. `logToolAudit()` — JSONL fire-and-forget com rotação (10MB)
3. `buildAuditingPermissionHandler()` — wrapper de PermissionHandler com audit logging

---

## 3. API Pública (Exports)

| Export                           | Tipo     | Descrição curta                        |
| -------------------------------- | -------- | -------------------------------------- |
| `isHighRiskTool`                 | function | Classifica ferramenta como alto risco  |
| `logToolAudit`                   | function | Registra decisão no JSONL de auditoria |
| `buildAuditingPermissionHandler` | function | Wrapper de PermissionHandler com audit |

---

## 4. Dependências (Imports)

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/hooks/bus`            | ❌ bypass   | hooks/         |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |
| `@github/copilot-sdk`           | ❌ SDK dir  | SDK externo    |
| `node:fs/promises`              | — stdlib    |                |
| `node:path`                     | — stdlib    |                |

- **Barrel bypasses**: 2 (hooks/bus, logger)
- **SDK direto**: ✅ `approveAll` — usado como fallback em handler

---

## 5. Estado Interno

| Variável          | Tipo        | Mutable? | TTL/Cleanup?      |
| ----------------- | ----------- | -------- | ----------------- |
| `_logBytes`       | number      | Sim      | Reset on rotation |
| `HIGH_RISK_TOOLS` | ReadonlySet | Não      | Env-configurable  |

---

## 6. Achados (Questões Formais)

### BUG-AGENT-010 — `logToolAudit` async IIFE swallows all errors silently

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/tool-audit-logger.js`#L123-L141
- **Descrição**: O `catch {}` vazio na IIFE async dentro de `logToolAudit` silencia todas as falhas
  de I/O, incluindo cenários como permissão negada no diretório de logs. Em produção PM2, isso pode
  resultar em perda total de audit logs sem nenhum sinal visível.
- **Proposta**: Logar com `log('DEBUG', ...)` no catch para rastreabilidade (sem impactar fluxo).

### ARCH-AGENT-009 — `buildAuditingPermissionHandler` importa `approveAll` diretamente do SDK

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/tool-audit-logger.js`#L23
- **Descrição**: Import direto de `@github/copilot-sdk` para `approveAll` — usado como fallback
  quando `baseHandler` lança exceção. Necessário para o fallback pattern, mas pode ser injetado como
  parâmetro para desacoplar do SDK.
- **Proposta**: Receber `fallbackHandler` como parâmetro opcional.

### GAP-AGENT-013 — `buildAuditingPermissionHandler` extrai `toolName` com fallback para `request.tool`

- **Severidade**: P5
- **Arquivo**: `src/copilot/agent/tool-audit-logger.js`#L159-L161
- **Descrição**: O handler tenta `request.toolName` e depois `request.tool`. A shape oficial do SDK
  usa `toolName`. O fallback para `tool` é defensivo mas pode mascarar mudanças de API.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                |
| ------------------- | ------------ | -------------------------------------------- |
| Contratos (tipos)   | 8            | JSDoc completo; request type casting         |
| Error handling      | 7            | Silent catch ❌; fallback to approveAll ✅   |
| Segurança           | 8            | Audit logging ✅; SSRF no webhook coberto    |
| Performance         | 8            | Fire-and-forget ✅; \_logBytes cache ✅      |
| Testabilidade       | 7            | Module-level state (\_logBytes); needs reset |
| Manutenibilidade    | 8            | 190 LOC, 3 funções claras                    |
| **Média ponderada** | **7.8**      | **(8×2 + 8×2 + 7+8+7+8) / 8 ≈ 7.8**          |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (audit infrastructure)
- **Padrão**: Decorator Pattern — wraps PermissionHandler com audit logging
- **Conformidade AS-IS→TO-BE**:
  - ✅ Rotação de log (G2-PERF-03)
  - ✅ SSRF protection delegada ao WebhookManager
  - ✅ HookBus integration (O.2 Fase P)
  - ❌ 2 barrel bypasses; 1 SDK direto
  - ❌ Silent catch em logToolAudit
