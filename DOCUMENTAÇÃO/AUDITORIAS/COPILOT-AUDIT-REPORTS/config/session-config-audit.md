# session-config.js — Auditoria

**Módulo**: `src/copilot/config/` **Arquivo**: `session-config.js` **LOC**: 185 | **Score**: 9.5/10

## Responsabilidade

Factories de `SessionConfig` para o GitHub Copilot SDK. Define 4 perfis pré-configurados:

| Factory                  | Permissão        | Streaming | InfiniteSessions |
| ------------------------ | ---------------- | --------- | ---------------- |
| `buildAlwaysAliveConfig` | `approveAll`     | ✅        | ✅               |
| `buildReadOnlyConfig`    | `auditOnly`      | ✅        | ✅               |
| `buildFullAccessConfig`  | `safePermission` | ✅        | ✅               |
| `buildDiagnosticConfig`  | `approveAll`     | ❌        | ❌               |

## Achados

Nenhum achado crítico. Arquivo bem estruturado.

## Destaques Positivos

- `DEFAULT_EXCLUDED_TOOLS` exportado — permite módulos externos (ex. `mcp-servers.js`) validar
  conflitos de configuração
- Perfil `buildDiagnosticConfig` tem `streaming: false` para baixo custo — boa prática para
  diagnósticos
- JSDoc robusto: todos os `@param` tipados, `@returns {SessionConfig}` explícito
- `BASE_CONFIG` compartilhado evita duplicação de `streaming + infiniteSessions`
- `onUserInputRequest` opcional com `undefined` check antes de spread — sem propriedade undefined no
  objeto

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
