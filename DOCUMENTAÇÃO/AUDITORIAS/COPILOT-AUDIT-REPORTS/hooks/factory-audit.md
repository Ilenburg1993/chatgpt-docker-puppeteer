# Auditoria: hooks/factory.js

**ID de rastreamento**: F06-05 **Arquivo**: `src/copilot/hooks/factory.js` **LOC**: 371 **Módulo**:
hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo            | Valor                                   |
| ---------------- | --------------------------------------- |
| Caminho          | `src/copilot/hooks/factory.js`          |
| Módulo pai       | `#copilot/hooks`                        |
| Exportações      | 7 funções públicas                      |
| Importações      | 1 (observability/logger)                |
| Alias disponível | `#copilot/hooks` (via barrel index.js)  |
| Testes           | `tests/unit/hooks/` (cobertura parcial) |

---

## 2. Contexto no Módulo

Factory principal dos `SessionHooks` do SDK. Responsável pela construção dos 6 handlers padrão:
`onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted`, `onSessionStart`, `onSessionEnd`,
`onErrorOccurred`. Fornece também presets de alto nível (`createMinimalHooks`, `createAuditHooks`,
`createDenyAllHooks`, `createSafeHooks`) e utilitários de composição (`composePreToolUseHandlers`,
`createErrorNotifierHook`).

---

## 3. Análise Estrutural

### 3.1 Importações

```js
import { log } from '#copilot/observability/logger';
```

Import direto do logger sem passar pelo barrel — contabilizado nos 76 bypasses detectados na MF-I.

### 3.2 Exportações

| Símbolo                     | Tipo     | Uso                                       |
| --------------------------- | -------- | ----------------------------------------- |
| `createHooks`               | function | Factory principal — amplamente consumida  |
| `createMinimalHooks`        | function | Preset zero-restriction                   |
| `createAuditHooks`          | function | Preset com auditLog completo              |
| `createDenyAllHooks`        | function | Preset deny-all via onPreToolUse override |
| `createSafeHooks`           | function | Preset whitelist de reads                 |
| `composePreToolUseHandlers` | function | Composição de N handlers em sequência     |
| `createErrorNotifierHook`   | function | Hook de notificação de erro               |

### 3.3 Estado Interno

Nenhum estado module-level. Factory pura — cada chamada cria closures independentes. ✅

### 3.4 Ciclo de Vida

Sem cleanup necessário (apenas closures).

---

## 4. Análise de Segurança

### SEC-HOOK-001 | P3 | Dead code de segurança (askHandler nunca dispara)

**Localização**: `buildPreToolUseHandler`, linhas ~100-115

```js
// Passo 1: resolveToolDecision é chamado primeiro
const decision = resolveToolDecision(toolName, allowTools, denyTools, denyPatterns);
if (decision === 'deny') return { permissionDecision: 'deny' };

// Passo 2: askHandler — condição impossível quando allowTools.length > 0
if (askHandler && allowTools.length > 0 && !allowTools.includes(toolName)) {
    // Se chegou aqui e allowTools.length > 0 e toolName não está na lista,
    // resolveToolDecision JÁ retornou 'deny' no passo 1 acima.
    // Esta branch é DEAD CODE.
```

`resolveToolDecision` retorna `'deny'` quando
`allowTools.length > 0 && !allowTools.includes(toolName)`. A guarda
`if (decision === 'deny') return ...` intercepta antes. O `askHandler` **nunca é invocado**. Feature
documentada como suportada mas não funcional.

**Impacto**: Usuários que configurem `onPermissionAsk` esperando comportamento interativo recebem
apenas `deny` silencioso.

---

## 5. Qualidade e Padrões

### BUG-HOOK-001 | P2 | createDenyAllHooks não nega via lógica interna

```js
export function createDenyAllHooks() {
  const denyHandler = async () => ({
    permissionDecision: 'deny',
    additionalContext: 'Ferramentas desabilitadas nesta sessão.',
  });
  return createHooks({
    auditLog: true,
    onPreToolUse: denyHandler, // override completo — bypassa allowTools/denyTools
  });
}
```

Funciona corretamente (retorna deny), mas usa override ao invés de `denyTools: ['*']` — não registra
no audit ring buffer nem no bus se `auditLog:true` só loga via `log()`. Contornável mas
inconsistente com os outros presets.

### UPG-HOOK-001 | P3 | Corrigir askHandler — usar permissionDecision 'ask'

O SDK suporta `{ permissionDecision: 'ask' }`. O padrão correto para permitir aprovação interativa
seria retornar `'ask'` e deixar o SDK invocar `onUserInputRequest`, ao invés de chamar
`askHandler(toolName)` manualmente. O design atual cria uma API custom desnecessária.

### GAP-HOOK-001 | P3 | modifiedArgs não implementado em buildPreToolUseHandler

`createHooks` nunca retorna `modifiedArgs` em `onPreToolUse`. O Gap 2 (retornar modifiedArgs) foi
implementado apenas em `tool-interceptor.js`, mas o `createHooks` principal não oferece essa
capacidade via config.

---

## 6. JSDoc

**Cobertura**: ✅ Excelente — todos os parâmetros tipados, @example em todas as factories públicas.

---

## 7. Dependências

| Dep                             | Tipo                   | Observação    |
| ------------------------------- | ---------------------- | ------------- |
| `#copilot/observability/logger` | direto (barrel bypass) | ARCH-HOOK-001 |

---

## 8. Performance

Sem allocations problemáticas. Closures leves. ✅

---

## 9. Mapeamento de Testes

Coberto em `tests/unit/hooks/factory.test.js` (inferido). O bug do `askHandler` provavelmente não
tem teste específico (o comportamento silencioso não seria detectado facilmente).

---

## 10. Análise Arquitetural

- **Camada correta**: hooks/ (Layer 4 — Domain Logic). ✅
- **Barrel bypass**: `#copilot/observability/logger` ao invés de `#copilot/observability`.
  ARCH-HOOK-001
- **SDK direto**: nenhuma importação direta do SDK neste arquivo. ✅

---

## 11. Issues Encontrados

| ID            | Tipo | Sev | Descrição                                                 |
| ------------- | ---- | --- | --------------------------------------------------------- |
| BUG-HOOK-001  | BUG  | P2  | createDenyAllHooks bypassa audit log interno              |
| SEC-HOOK-001  | SEC  | P3  | askHandler é dead code — nunca invocado                   |
| GAP-HOOK-001  | GAP  | P3  | modifiedArgs ausente em buildPreToolUseHandler            |
| UPG-HOOK-001  | UPG  | P3  | Usar permissionDecision:'ask' ao invés de callback manual |
| ARCH-HOOK-001 | ARCH | P4  | Import direto do logger (barrel bypass)                   |

---

## 12. Propostas de Upgrade

1. **Fix SEC-HOOK-001**: Mover verificação do `askHandler` para ANTES da verificação de `allowTools`
   em `resolveToolDecision`, ou substituir por retornar `'ask'` ao SDK.
2. **Fix GAP-HOOK-001**: Adicionar suporte a `modifiedArgs` no `HooksConfig` e na
   `buildPreToolUseHandler`.
3. **UPG-HOOK-001**: Considerar deprecar `onPermissionAsk` em favor do SDK-native `'ask'`.

---

## 13. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                             |
| ---------------- | ------- | ----------------------------------------- |
| Corretude        | 7.5     | Dead code de segurança, bug de deny audit |
| Segurança        | 7.0     | askHandler nunca dispara — feature inútil |
| Arquitetura      | 8.0     | Factory pura, bem estruturada             |
| Manutenibilidade | 8.5     | JSDoc excelente, sem estado global        |
| Performance      | 9.5     | Sem issues                                |
| Testabilidade    | 8.0     | Funções puras bem testáveis               |
| **Média**        | **8.1** |                                           |

---

## 6. Status de Correção (2026-04-03)

### [FIXED] SEC-HOOK-001 (P3) — askHandler agora disparável (não é mais dead code)

Verificação do askHandler movida para ANTES do resolveToolDecision para tools não listadas em
allowTools nem denyTools. Avalia explicitlyDenied + inAllowList separadamente.

### [FIXED] GAP-HOOK-001 (P3) — modifiedArgs suportado em buildPreToolUseHandler

HooksConfig.argsModifier adicionado. buildPreToolUseHandler chama argsModifier(toolName, args) e
retorna modifiedArgs quando resultado não-nulo.

### [NOTED] UPG-HOOK-001 (P3) — onPermissionAsk mantido (vs permissionDecision:ask)

O callback manual é mantido em vez de sdk-native ask para preservar compatibilidade.

**Pontuação atualizada: 8.8/10**
