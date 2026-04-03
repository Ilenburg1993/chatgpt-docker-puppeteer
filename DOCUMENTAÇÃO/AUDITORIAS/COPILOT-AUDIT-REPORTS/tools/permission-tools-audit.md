# Audit: src/copilot/tools/permission-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/permission-tools.js` **LOC**: 164
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 2 tools de controle de permissão: `permission_mode_get` e `permission_mode_set`. Usa DI via
`setPermissionAgent()`. Ambas têm `requiresApproval: false`. `permission_mode_set` pode alterar o
modo de segurança do agente (approve_all, audit_only, selective) sem aprovação do usuário.

**Score**: 7.0/10

---

## Achados

### P3 — permission_mode_set com requiresApproval: false

**Localização**: `permissionModeSetTool`.

```js
const permissionModeSetTool = buildTool('permission_mode_set', {
    requiresApproval: false,
    ...
});
```

LLM pode invocar `permission_mode_set` sem aprovação do usuário e alterar o modo de segurança de
`audit_only` para `approve_all`, efetivamente removendo todas as restrições de aprovação para
operações subsequentes.

**Impacto**: Alto em cenários de prompt injection ou uso malicioso. Um atacante que consiga injetar
instruções poderia mudar o modo para `approve_all` e então executar operações destrutivas sem
aprovação.

**Recomendação**: Definir `requiresApproval: true` para `permission_mode_set`. O custo de uma
confirmação extra é menor que o risco de escalonamento de privilégio.

---

### P4 — permission_mode_set: Sem Auditoria em audit.jsonl

**Localização**: Handler de `permissionModeSetTool`.

```js
log('INFO', `[permission_modes] Modo alterado: ${oldMode} → ${mode}`);
```

A mudança de modo é logada apenas no logger padrão, não em `audit.jsonl`. Dado que este modo
controla toda a política de aprovação do agente, a mudança deveria ser auditada formalmente.

**Recomendação**: Emitir evento `NERV.emit('audit:security_event', { ... })` ao alterar o modo.

---

### P4 — requireAgent() Lança Erro Não Tratado se Agent Não Injetado

**Localização**: `requireAgent()`.

```js
function requireAgent() {
  if (!_agent) throw new Error('[permission_tools] PermissionAgent não foi injetado...');
  return _agent;
}
```

A exceção será propagada pelo handler do tool como erro não controlado. Isso é diferente do padrão
`return { error: '...' }` usado em outros módulos.

**Impacto**: Baixo; `setPermissionAgent()` é chamado durante bootstrap.

---

## Positivos

- DI pattern via `setPermissionAgent()` — testável e sem import circular
- `permission_mode_get` com `requiresApproval: false` — leitura sem fricção, correto
- Validação Zod com enum `['approve_all', 'audit_only', 'selective']` — apenas valores válidos
  aceitos
- Log de mudança de modo com oldMode + newMode — rastreabilidade básica
