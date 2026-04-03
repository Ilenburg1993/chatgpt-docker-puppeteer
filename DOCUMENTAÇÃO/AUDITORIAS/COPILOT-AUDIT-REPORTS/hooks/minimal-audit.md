# Auditoria: hooks/presets/minimal.js

**ID de rastreamento**: F06-16 **Arquivo**: `src/copilot/hooks/presets/minimal.js` **LOC**: 62
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                  |
| ----------- | -------------------------------------- |
| Caminho     | `src/copilot/hooks/presets/minimal.js` |
| Módulo pai  | `#copilot/hooks/presets`               |
| Exportações | `createMinimalPreset`                  |
| Importações | `createPermissionHandler`, logger      |

---

## 2. Contexto no Módulo

Preset mais simples: permite tudo, loga eventos principais. Para ambientes de desenvolvimento sem
restrições. Zero lógica de segurança — adequado apenas para dev/test.

---

## 3. Análise Estrutural

### 3.1 JSDoc example com double instantiation

```js
/**
 * @example
 *   const session = await client.createSession({
 *     onPermissionRequest: createMinimalPreset().onPermissionRequest,
 *     hooks: createMinimalPreset().hooks,
 *   });
 */
```

Chama `createMinimalPreset()` **duas vezes** — cria duas instâncias separadas sem necessidade.
Usuário deveria `const preset = createMinimalPreset()` e reutilizar. **UPG-MIN-001** (doc bug).

### 3.2 onUserPromptSubmitted loga length do prompt

```js
async onUserPromptSubmitted(input) {
    log('DEBUG', `[preset/minimal] prompt (${input.prompt.length} chars)`);
    return {};
}
```

Adequado para dev. ✅

---

## 4. Issues Encontrados

| ID          | Tipo | Sev | Descrição                                                    |
| ----------- | ---- | --- | ------------------------------------------------------------ |
| UPG-MIN-001 | UPG  | P4  | JSDoc example instancia preset duas vezes desnecessariamente |

---

## 5. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                  |
| ---------------- | ------- | ------------------------------ |
| Corretude        | 9.5     | Lógica trivialmente correta    |
| Segurança        | N/A     | Intencionalmente sem segurança |
| Arquitetura      | 9.5     | Módulo mais simples possível   |
| Manutenibilidade | 9.0     | Bug no exemplo de doc          |
| Performance      | 10      | Sem issues                     |
| Testabilidade    | 10      | Trivialmente testável          |
| **Média**        | **9.6** |                                |
