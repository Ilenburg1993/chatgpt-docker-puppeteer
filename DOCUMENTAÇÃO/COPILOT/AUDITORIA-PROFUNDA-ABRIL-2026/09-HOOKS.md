# 09-HOOKS — Auditoria do Módulo `hooks/`

**Auditoria Profunda de `src/copilot`** · Abril 2026
**Módulo**: `src/copilot/hooks/`
**Documentado em**: 2026-04-18

---

## 1. Mapa do Módulo

```
hooks/
├── error-handler.js        (createErrorHandler, createCircuitBreakerHandler — auditado em 03-SDK)
├── permission-handler.js   (createPermissionHandler — approve/deny tools)
├── prompt-transformer.js   (createPromptTransformer — sanitização PII, truncamento)
├── registry.js             (HookRegistry — schemas de hooks)
├── logger.js               (log wrapper para hooks)
├── types.js                (typedefs de input/output de hooks)
├── presets/
│   ├── production.js       (createProductionHooks — preset completo)
│   ├── development.js      (preset relaxado para dev)
│   └── profiles.js         (seleção de preset por env)
└── index.js                (barrel)
```

---

## 2. Arquivo: `presets/production.js`

### Preset de Produção

```js
createProductionHooks({
    toolAllowList: ['read_file', 'list_dir'],  // allowlist obrigatória
    toolDenyList: [...],                       // denylist prevalece
    piiPatterns: [...],                        // redação de PII
    maxPromptLength: 50000,                    // truncamento
    circuitBreakerMaxRetries: 3,
    circuitBreakerResetMs: 60000,
    auditSink: (entry) => log(...),
})
```

**Positivo**: Preset bem estruturado com todos os hooks cobertos:
- `onPreToolUse`: allowlist + interceptor + audit
- `onPostToolUse`: enriquecedor de contexto
- `onUserPromptSubmitted`: sanitização PII + truncamento
- `onSessionStart`: additionalContext com hostname, node version, modelo
- `onSessionEnd`: métricas no audit trail
- `onErrorOccurred`: circuit-breaker com notificação

### Achados

| ID               | Sev | Descrição                                                                                                                                                                                                           |
| ---------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-HOOKS-01** | P2  | `toolAllowList` vazio (valor padrão) = allow all. Sem allowlist configurada em produção, a proteção de `onPreToolUse` é efetivamente desativada. Não há warning/log de que o sistema está em modo permissivo total. |
| **GAP-HOOKS-02** | P3  | `piiPatterns` default é array vazio — sem redação de PII por padrão. Em produção sem configuração explícita, prompts com tokens, passwords ou dados pessoais são logados inteiros.                                  |
| **GAP-HOOKS-03** | P3  | `auditSink` default usava stream operacional (`console`/logger) — auditoria e operação ficavam misturadas. **Mitigado em 2026-04-17** com fallback estruturado em `defaultAuditLog`.                                |

> **Status de execução (2026-04-17): `GAP-HOOKS-01`, `GAP-HOOKS-02` e `GAP-HOOKS-03` mitigados.**
> O preset agora emite warnings explícitos para `toolAllowList=[]` e `piiPatterns=[]`. Além disso, tools sensíveis de shell passam por `ask` por padrão quando não estiverem explicitamente allowlisted.
> Nesta continuação, o sink padrão de auditoria do preset de produção também passou a registrar em `defaultAuditLog`,
> separando a trilha de auditoria do log operacional padrão. O motor de `onErrorOccurred` também foi unificado entre
> factory, lifecycle e presets via handlers canônicos.

---

## 3. Arquivo: `permission-handler.js`

### Modos de Permissão

```
approve_all   → aprova todas as tools automaticamente
audit_only    → aprova tudo mas loga cada decisão
selective     → whitelist/blacklist/callback customizado
```

| ID               | Sev | Descrição                                                                                                                                                                                                                                                                                                      |
| ---------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-HOOKS-04** | P2  | Modo `approve_all` (default quando `AlwaysAliveAgent` é criado sem opções) aprova automaticamente **qualquer** tool call, incluindo tools destrutivas (`delete_file`, `execute_command`). Sem lista de tools sempre-bloqueadas, um adversário com controle do prompt pode induzir execução de tools perigosas. |

> **Status de execução (2026-04-17): mitigado em profundidade no preset de produção.**
> `createProductionHooks()` agora aplica duas barreiras:
>
> - `ask` por padrão para tools sensíveis de shell quando não houver allowlist explícita;
> - `deny` permanente para assinaturas de comando nitidamente destrutivas (`rm -rf`, `mkfs`, `dd if=`, `curl|sh`, fork bomb, `shutdown`, `reboot`).

---

## 4. Arquivo: `prompt-transformer.js`

| ID               | Sev | Descrição                                                                                                                                                                              |
| ---------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-HOOKS-05** | P3  | `createPromptTransformer` recebe `piiPatterns: RegExp[]`. Sem configuração, nenhuma redação ocorre. Prompts completos (incluindo contexto de arquivos injetados) passam sem filtragem. |

---

## 5. Arquivo: `registry.js`

**HookRegistry**: estrutura de documentação e validação dos 6 hooks do SDK.

**Positivo**: `validate(name, input)` retorna mensagem de erro descritiva se input inválido.
**Positivo**: `isRegistered(name)` usado em `buildSessionHooks()` para verificar cobertura.

---

## 6. Resumo de Achados do Módulo Hooks

| ID           | Severidade | Arquivo                                           | Descrição                                                                                                                                      |
| ------------ | ---------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-HOOKS-01 | P2         | `presets/production.js`                           | `toolAllowList=[]` = allow all sem aviso — **mitigado em 2026-04-17 com warnings explícitos**                                                  |
| GAP-HOOKS-04 | P2         | `permission-handler.js` + `presets/production.js` | Modo `approve_all` sem lista de tools sempre-bloqueadas — **mitigado em 2026-04-17 com guard `ask` + deny permanente por padrões destrutivos** |
| GAP-HOOK-01  | P3         | `error-handler.js`                                | Shared state em closures cross-session — **mitigado em 2026-04-17 com escopo por `sessionId + errorContext`**                                  |
| GAP-HOOKS-02 | P3         | `presets/production.js`                           | `piiPatterns=[]` por padrão — sem redação de PII                                                                                               |
| GAP-HOOKS-03 | P3         | `presets/production.js`                           | Audit log misturado com operational log — **mitigado em 2026-04-17 com fallback estruturado em `defaultAuditLog`**                             |
| GAP-HOOKS-05 | P3         | `prompt-transformer.js`                           | Sem configuração de PII, prompts passam inteiros                                                                                               |

### Severidade Geral do Módulo: **P2 (Médio)**

Os gaps de segurança (P2) seguem relevantes como desenho global do subsistema, mas o código atual já endurece de forma material o preset de produção, separa melhor auditoria de operação e melhora a sinalização operacional.

---

*Próximo: [10-ISSUES-CONSOLIDATED.md](./10-ISSUES-CONSOLIDATED.md)*
