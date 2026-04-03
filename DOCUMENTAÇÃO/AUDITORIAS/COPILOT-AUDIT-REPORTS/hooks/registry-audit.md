# Auditoria: hooks/registry.js

**ID de rastreamento**: F06-09 **Arquivo**: `src/copilot/hooks/registry.js` **LOC**: 172 **Módulo**:
hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                       |
| ----------- | ------------------------------------------- |
| Caminho     | `src/copilot/hooks/registry.js`             |
| Módulo pai  | `#copilot/hooks`                            |
| Exportações | `HookRegistry` (class), `SDK_HOOKS` (const) |
| Importações | logger                                      |

---

## 2. Contexto no Módulo

Registro canônico dos hooks conhecidos pelo sistema. `SDK_HOOKS` é uma instância pré-populada com 8
schemas (6 do SDK + `onPermissionRequest` + `onUserInputRequest`). `HookRegistry` é uma classe com
API de registro dinâmico, validação de schemas e serialização.

---

## 3. Análise Estrutural

### 3.1 SDK_HOOKS como singleton

```js
export const SDK_HOOKS = new HookRegistry();
// pre-populated with 8 hooks
```

Singleton module-level. Mutável — qualquer consumidor pode chamar `SDK_HOOKS.register(...)` e
adicionar schemas globalmente. Não há mecanismo de freeze/seal. **P4 issue**.

### 3.2 Inconsistência types vs registry

`SDK_HOOKS` inclui `onPermissionRequest` e `onUserInputRequest`, mas o typedef `SessionHooks` em
`types.js` **não** inclui esses dois. Consumidores de `HookRegistry.list()` podem encontrar hooks
que não pertencem ao `SessionHooks` — confusão na API. **GAP-REG-001**.

### 3.3 validate() não verifica tipos

```js
validate(hookName, input) {
    const schema = this.get(hookName);
    if (!schema) throw new Error(`Hook '${hookName}' not registered`);
    for (const field of schema.inputFields ?? []) {
        if (!(field in input)) throw new Error(`Missing field: ${field}`);
    }
}
```

Verifica apenas presença de campos, não tipos. Útil para development mas não para produção onde
tipos podem divergir silenciosamente.

---

## 4. Issues Encontrados

| ID           | Tipo | Sev | Descrição                                          |
| ------------ | ---- | --- | -------------------------------------------------- |
| GAP-REG-001  | GAP  | P3  | SDK_HOOKS inclui hooks não no SessionHooks typedef |
| ARCH-REG-001 | ARCH | P4  | SDK_HOOKS é singleton mutável — sem freeze/seal    |
| UPG-REG-001  | UPG  | P4  | validate() não verifica tipos dos campos           |

---

## 5. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                          |
| ---------------- | ------- | -------------------------------------- |
| Corretude        | 8.0     | Validação rasa, inconsistência typedef |
| Segurança        | 8.5     | Singleton mutável (grau baixo)         |
| Arquitetura      | 8.0     | Inconsistência entre registry e tipos  |
| Manutenibilidade | 8.5     | Código limpo                           |
| Performance      | 9.5     | Map() eficiente                        |
| Testabilidade    | 8.0     | Singleton dificulta teste isolado      |
| **Média**        | **8.4** |                                        |
