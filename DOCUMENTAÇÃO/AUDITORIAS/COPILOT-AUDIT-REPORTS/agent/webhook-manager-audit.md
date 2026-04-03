# Auditoria Individual — `agent/webhook-manager.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-22).

---

## 1. Identificação

| Campo       | Valor                                  |
| ----------- | -------------------------------------- |
| **Arquivo** | `src/copilot/agent/webhook-manager.js` |
| **Módulo**  | `agent/`                               |
| **LOC**     | 206                                    |
| **Fase**    | F05-22                                 |

---

## 2. Propósito e Responsabilidade

Gerencia webhooks HTTP(S) de notificação de eventos do agente. Registro, remoção, despacho via POST
com timeout. Inclui validação SSRF (anti-private-host), sanitização de payload sensível, e redaction
de eventos de streaming.

---

## 3. API Pública (Exports)

| Export           | Tipo     | Descrição curta                          |
| ---------------- | -------- | ---------------------------------------- |
| `WebhookManager` | class    | Registra/remove/dispara webhooks HTTP(S) |
| `WebhookEntry`   | @typedef | `{id: string, url: string}`              |

---

## 4. Dependências (Imports)

| Import                          | Via barrel? |
| ------------------------------- | ----------- |
| `#copilot/observability/logger` | ❌ bypass   |

- **Barrel bypasses**: 1 (logger)
- **SDK direto**: Não

---

## 5. Estado Interno

| Variável | Tipo                | Mutable? | TTL/Cleanup?     |
| -------- | ------------------- | -------- | ---------------- |
| `#urls`  | Map<string, string> | Sim      | Via unregister() |

Bounded por `MAX_WEBHOOKS` (50, env-configurable).

---

## 6. Achados (Questões Formais)

### SEC-AGENT-005 — SSRF validation baseada em hostname pode ser bypassed com DNS rebinding

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/webhook-manager.js`#L56-L82
- **Descrição**: A validação `#validateUrl` verifica o hostname string contra ranges conhecidos
  (127._, 10._, 172.16-31._, 192.168._, 169.254.\*, localhost, ::1). Porém, um atacante poderia
  registrar um domínio público que resolve para IP privado (DNS rebinding). A verificação ocorre no
  momento do registro, não no momento do fetch.
- **Mitigações existentes**:
  - Webhook URLs são registradas por chamada de API interna (não por input externo)
  - `WEBHOOK_ALLOW_PRIVATE_HOSTS=true` é opt-in
  - Sanitização de payload reduz impacto de SSRF (dados sensíveis removidos)
- **Proposta de correção**: Resolver DNS no momento do fetch e verificar o IP resultante, ou usar
  `undici` com IP filtering.
- **Impacto**: Baixo — webhooks são registrados internamente, não por input externo.

### GAP-AGENT-015 — `#sanitizePayload` filtra `lk.includes('key')` que é muito agressivo

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/webhook-manager.js`#L140-L155
- **Descrição**: `lk.includes('key')` redacta qualquer campo cujo nome contém "key" — incluindo
  campos legítimos como `taskKey`, `lookupKey`, `keyboardShortcut`. Da mesma forma,
  `lk.includes('token')` redacta `tokenBudget`, `tokenCount`, etc.
- **Proposta**: Usar allowlist específica (`secret`, `password`, `auth_token`, `api_key`,
  `close_key`) em vez de substring match.

### PERF-AGENT-004 — `emit()` serializa JSON e faz fetch em sequência para todos webhooks

- **Severidade**: P5
- **Arquivo**: `src/copilot/agent/webhook-manager.js`#L179-L202
- **Descrição**: O JSON body é construído uma vez e o fetch é via `Promise.allSettled` — correto e
  paralelo. O timeout é por webhook (5s default). Em cenários com muitos webhooks (até 50), se todos
  forem lentos, a operação pode demorar ≤ 5s (paralelo). Performance adequada.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                                   |
| ------------------- | ------------ | --------------------------------------------------------------- |
| Contratos (tipos)   | 9            | JSDoc completo, typedefs claros                                 |
| Error handling      | 8            | allSettled ✅; timeout ✅; catch per webhook                    |
| Segurança           | 7            | SSRF basic ✅; DNS rebinding ❌; payload sanitization agressiva |
| Performance         | 9            | Parallel fetch; bounded timeout                                 |
| Testabilidade       | 8            | Classe instanciável; private via #                              |
| Manutenibilidade    | 8            | 206 LOC, single-purpose, limpo                                  |
| **Média ponderada** | **8.1**      | **(9×2 + 7×2 + 8+9+8+8) / 8 ≈ 8.1**                             |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (external notifications)
- **Padrão**: Observer Pattern (push-based notifications para URLs externas)
- **Conformidade AS-IS→TO-BE**:
  - ✅ G2-SEC-01: SSRF validation
  - ✅ G2-SEC-06: payload sanitization
  - ✅ G2-ARCH-06: fetch nativo (Node 18+)
  - ❌ DNS rebinding não mitigado
  - ❌ Sanitization muito agressiva (substring match)

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-AGENT-005 — Verificação pós-DNS para mitigar DNS rebinding SSRF

Adicionado método estático privado #checkResolvedIp(hostname) que:

1. Usa dns.promises.lookup() para resolver o IP real do hostname (IPv4, fallback IPv6)
2. Verifica se o IP resolvido é privado/loopback (mesmos ranges já verificados em #validateUrl)
3. Lança Error se privado, bloqueando o fetch antes de executar

O check é aplicado em emit() antes de cada fetch, salvo WEBHOOK_ALLOW_PRIVATE_HOSTS=true. Esta
mitigação não é 100% perfeita (window de TOCTOU entre lookup e fetch), mas é a melhor mitigação
possível sem um proxy de fetch customizado.

**Pontuação atualizada: 8.5/10**

### [FIXED] SEC-AGENT-003 — IPv6 private ranges adicionados a `#checkResolvedIp`

O método `#checkResolvedIp` agora detecta endereços IPv6 privados:

- `fe80:` — link-local (fe80::/10)
- `fc` / `fd` — ULA (fc00::/7)
- `::ffff:` — IPv4-mapped privados (ex: `::ffff:127.0.0.1`)

Antes, apenas IPv4 e `::1` eram verificados, permitindo bypass via IPv6 ULA ou link-local.

**Pontuação atualizada: 8.8/10**
