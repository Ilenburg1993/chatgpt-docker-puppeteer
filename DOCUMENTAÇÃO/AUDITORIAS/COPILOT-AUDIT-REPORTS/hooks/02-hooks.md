# Auditoria Consolidada: Módulo hooks/

**ID de rastreamento**: F06-CONSOLIDADO **Módulo**: `src/copilot/hooks/` **LOC total**: 3.334
**Arquivos**: 18 (13 diretos + 5 em presets/) **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full
Audit

---

## 1. Visão Geral do Módulo

O módulo `hooks/` é a camada de interceptação comportamental do SDK Copilot. Implementa os 6 pontos
de extensão do SDK (`onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`, `onSessionStart`,
`onSessionEnd`, `onErrorOccurred`) além dos dois handlers adicionais (`onPermissionRequest`,
`onUserInputRequest`). Oferece 5 presets prontos (minimal, interactive, safe, production, deny-all),
um sistema de composição de handlers, registro de schemas e bus de eventos.

---

## 2. Inventário de Arquivos

| Arquivo                | LOC       | Nota   | Gap implementado                               |
| ---------------------- | --------- | ------ | ---------------------------------------------- |
| audit.js               | 156       | F06-01 | auditoria com ring buffer                      |
| bus.js                 | 189       | F06-02 | HookBus (pub/sub interno)                      |
| composer.js            | 147       | F06-03 | composição de handlers                         |
| error-handler.js       | 201       | F06-04 | circuit breaker, retry                         |
| factory.js             | 371       | F06-05 | factory principal hooks                        |
| index.js               | 87        | F06-06 | barrel canônico                                |
| permission-handler.js  | 195       | F06-07 | onPermissionRequest                            |
| prompt-transformer.js  | 145       | F06-08 | Gap 1: modifiedPrompt                          |
| registry.js            | 172       | F06-09 | HookRegistry + SDK_HOOKS                       |
| session-lifecycle.js   | 132       | F06-10 | Gap 4: additionalContext sessionStart          |
| tool-interceptor.js    | 228       | F06-11 | Gap 2/3: modifiedArgs + additionalContext post |
| types.js               | 306       | F06-12 | tipos puros JSDoc                              |
| user-input.js          | 170       | F06-13 | Gap 5: onUserInputRequest                      |
| presets/deny-all.js    | 77        | F06-14 | preset deny-all                                |
| presets/interactive.js | 108       | F06-15 | preset interativo                              |
| presets/minimal.js     | 62        | F06-16 | preset mínimo                                  |
| presets/production.js  | 301       | F06-17 | preset produção                                |
| presets/safe.js        | 118       | F06-18 | preset seguro                                  |
| **Total**              | **3.334** |        |                                                |

---

## 3. Mapa de Responsabilidades

```
hooks/
├── types.js            ← contratos de dados (zero lógica)
├── registry.js         ← catálogo de schemas de hook
├── bus.js              ← pub/sub interno (telemetria)
├── audit.js            ← ring buffer de auditoria
├── error-handler.js    ← circuit breaker, retry, skip
├── permission-handler.js ← wraps SDK approveAll/deny
├── prompt-transformer.js ← Gap 1: modifiedPrompt
├── tool-interceptor.js ← Gap 2/3: modifiedArgs + additionalContext
├── user-input.js       ← Gap 5: onUserInputRequest
├── session-lifecycle.js ← Gap 4: additionalContext sessionStart
├── composer.js         ← composeHooks() + middlewares
├── factory.js          ← createHooks() — ponto de entrada principal
├── index.js            ← barrel
└── presets/
    ├── minimal.js      ← dev: allow all
    ├── interactive.js  ← supervised: ask all
    ├── safe.js         ← default: ask writes, deny destructive
    ├── production.js   ← prod: full audit + circuit breaker
    └── deny-all.js     ← lockdown: deny all tools
```

---

## 4. Gaps do SDK: Status de Implementação

| Gap | Capacidade SDK          | Arquivo               | Status |
| --- | ----------------------- | --------------------- | ------ |
| G1  | modifiedPrompt          | prompt-transformer.js | ✅ OK  |
| G2  | modifiedArgs            | tool-interceptor.js   | ✅ OK  |
| G3  | additionalContext post  | tool-interceptor.js   | ✅ OK  |
| G4  | additionalContext start | session-lifecycle.js  | ✅ OK  |
| G5  | onUserInputRequest      | user-input.js         | ✅ OK  |

Todos os 5 gaps de capabilities identificados na MF-I estão implementados neste módulo.

---

## 5. Issues Consolidados

### 🔴 Críticos (P2)

| ID           | Arquivo             | Descrição                                                                                                                                                                          |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-TI-001   | tool-interceptor.js | **Timer inoperante**: `createTimingEnricherHook` nunca popula o Map de timings — feature de timing completamente não funcional                                                     |
| BUG-DA-001   | presets/deny-all.js | **Deny-all que aprova tudo**: `onPermissionRequest` usa `createPermissionHandler({ allowAll: false, denyTools: [] })` que na prática aprova todas as tools pela lógica de fallback |
| BUG-HOOK-001 | factory.js          | **askHandler dead code**: condição no `buildPreToolUseHandler` nunca é alcançada porque `resolveToolDecision` já retornou antes                                                    |

### 🟡 Importantes (P3)

| ID            | Arquivo                | Descrição                                                      |
| ------------- | ---------------------- | -------------------------------------------------------------- |
| BUG-TI-002    | tool-interceptor.js    | timings Map seria unbounded se o BUG-TI-001 fosse corrigido    |
| BUG-UI-001    | user-input.js          | Queue em createQueuedInputHandler sem limite de tamanho        |
| BUG-UI-002    | user-input.js          | Fila vazia retorna `''` silenciosamente                        |
| BUG-PERM-001  | permission-handler.js  | `allowAll: true` ignora denyTools/denyPatterns silenciosamente |
| GAP-REG-001   | registry.js            | SDK_HOOKS inclui hooks não no SessionHooks typedef             |
| GAP-TYPES-001 | types.js               | SessionHooks não inclui onPermissionRequest/onUserInputRequest |
| GAP-DA-001    | presets/deny-all.js    | `exceptTools` não aplicado em onPermissionRequest              |
| GAP-INTER-001 | presets/interactive.js | onPermissionRequest inconsistente com modo interativo          |
| GAP-SAFE-001  | presets/safe.js        | onPermissionRequest inconsistente com estratégia safe          |
| SEC-HOOK-001  | factory.js             | onPermissionAsk callback é dead code de segurança              |
| SEC-PT-001    | prompt-transformer.js  | SENSITIVE_PATTERN não detecta JWT, AWS keys, tokens GitHub     |
| UPG-SL-001    | session-lifecycle.js   | `process.env['COPILOT_FALLBACK_MODEL']` hardcoded              |
| ARCH-HOOK-002 | index.js               | Barrel hooks/ importa diretamente de observability/            |

### 🔵 Melhorias (P4)

| ID           | Arquivo               | Descrição                                    |
| ------------ | --------------------- | -------------------------------------------- |
| ARCH-REG-001 | registry.js           | SDK_HOOKS singleton mutável sem freeze       |
| ARCH-SL-001  | session-lifecycle.js  | Singletons defaultMetrics/defaultAuditLog    |
| UPG-PROD-001 | presets/production.js | auditSink falha silenciosamente              |
| UPG-PROD-002 | presets/production.js | Threshold 50k hardcoded                      |
| UPG-SAFE-001 | presets/safe.js       | DENY_TOOLS com nomes provavelmente fictícios |
| UPG-MIN-001  | presets/minimal.js    | JSDoc example instancia preset duas vezes    |
| GAP-HOOK-001 | factory.js            | modifiedArgs ausente em createHooks          |

---

## 6. Padrão Sistêmico: Inconsistência hooks + onPermissionRequest

O achado mais importante do módulo é **sistêmico** e afeta **3 de 5 presets**:

```
deny-all:    onPreToolUse → deny  |  onPermissionRequest → APPROVE (BUG) ❌
interactive: onPreToolUse → ask   |  onPermissionRequest → APPROVE ALL ❌
safe:        onPreToolUse → ask/deny | onPermissionRequest → APPROVE ALL ❌
minimal:     onPreToolUse → allow |  onPermissionRequest → allow ✅
production:  onPreToolUse → allow/deny/ask | onPermissionRequest → restrito ✅
```

A causa raiz é que `factory.js` retorna `{ hooks, onPermissionRequest }` mas os presets configuram
independentemente, sem garantir consistência entre os dois. Um consumidor que use **apenas**
`onPermissionRequest` em presets `deny-all`, `interactive` ou `safe` recebe comportamento oposto ao
esperado.

**Proposta de correção sistêmica**: Criar uma função helper `derivePermissionConfig(presetConfig)`
que derive automaticamente a config de `onPermissionRequest` a partir da config de
tool-classification do preset, garantindo consistência.

---

## 7. Pontuações por Arquivo

| Arquivo                | Score | Avaliação                         |
| ---------------------- | ----- | --------------------------------- |
| audit.js               | 8.4   | Sólido, ring buffer bem projetado |
| bus.js                 | 8.7   | Design limpo                      |
| composer.js            | 8.9   | Compose funcional                 |
| error-handler.js       | 8.6   | Circuit breaker correto           |
| factory.js             | 8.1   | Bugs de design no askHandler      |
| index.js               | 9.2   | Barrel completo                   |
| permission-handler.js  | 8.4   | allowAll bypassa deny configs     |
| prompt-transformer.js  | 8.7   | Padrão PII incompleto             |
| registry.js            | 8.4   | Singleton mutável                 |
| session-lifecycle.js   | 8.3   | process.env direto                |
| tool-interceptor.js    | 7.3   | Timer inoperante (P2)             |
| types.js               | 9.4   | Tipos abrangentes                 |
| user-input.js          | 8.1   | Queue unbounded                   |
| presets/deny-all.js    | 6.8   | onPermissionRequest oposto!       |
| presets/interactive.js | 8.6   | Inconsistência permission         |
| presets/minimal.js     | 9.6   | Mais simples e correto            |
| presets/production.js  | 8.8   | Mais completo e correto           |
| presets/safe.js        | 8.6   | Inconsistência permission         |

### Score médio do módulo: **8.5 / 10**

---

## 8. Recomendações Prioritárias

### P2 — Corrigir imediatamente

1. **[BUG-TI-001]** Adicionar `onPreToolUse` ao `createTimingEnricherHook` que popula o Map antes do
   `onPostToolUse` consumir o timing.

2. **[BUG-DA-001]** Reescrever `onPermissionRequest` de `createDenyAllPreset` para negar via
   `allowTools: exceptTools` em vez de `denyTools: []`.

3. **[BUG-HOOK-001]** Remover branch do `askHandler` em `buildPreToolUseHandler` ou corrigir a
   lógica para retornar `{ permissionDecision: 'ask' }` nativamente.

### P3 — A cada sprint

4. **[Sistêmico]** Criar `derivePermissionConfig()` que sincronize a config de `onPermissionRequest`
   com a classificação de tools dos presets.

5. **[SEC-PT-001]** Expandir `SENSITIVE_PATTERN` para cobrir JWT, AWS keys e tokens GitHub.

6. **[UPG-SL-001]** Injetar fallback model via DI no contexto de `createSessionHooks`.

---

## 9. Dependências Cross-Module

| De                          | Para                                          | Tipo             |
| --------------------------- | --------------------------------------------- | ---------------- |
| hooks/index.js              | observability/hooks-audit-preset.js           | re-export (ARCH) |
| hooks/session-lifecycle.js  | observability/logger, metrics, auditLog       | direto           |
| hooks/presets/\*.js         | hooks/permission-handler.js                   | local ✅         |
| hooks/presets/production.js | hooks/error-handler.js, prompt-transformer.js | local ✅         |

---

## 10. Visão AS-IS → TO-BE

### AS-IS

```
Presets configuram onPreToolUse e onPermissionRequest independentemente.
Resultado: 3/5 presets têm comportamento inconsistente entre os dois handlers.
Timer de performance não funciona.
Queue sem limite.
Dense.
```

### TO-BE

```
Factory ou helper comum deriva onPermissionRequest da mesma config de tool-classification.
createTimingEnricherHook retorna ambos onPreToolUse + onPostToolUse em tandem.
createQueuedInputHandler aceita maxSize.
SENSITIVE_PATTERN expandido.
Todos presets consistentes e auditados na CI.
```

---

_Relatório gerado como parte da MF-II do Copilot Full Audit. Próximo módulo: F07 — tools/ (23
arquivos, 5.716 LOC)._
