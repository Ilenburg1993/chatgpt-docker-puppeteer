# Auditoria — `state.js`

**Módulo**: `src/copilot/terminal/state.js` **LOC**: 143 **Data**: 2026-06-10 **Auditor**: Copilot
Full-Audit MF-II

---

## 1. Propósito

Módulo de estado compartilhado do Terminal LLM-B (padrão de injeção via módulo singleton ESM). Expõe
getters/setters reativos com `stateEmitter` para `hubSessionId` e `busy`, além de gestão de fila de
attachments e Sets de clientes SSE.

---

## 2. Estado centralizado

| Variável           | Tipo                  | Exposição                                                       | Reativa?  |
| ------------------ | --------------------- | --------------------------------------------------------------- | --------- |
| `_hubSessionId`    | `string\|null`        | `getHubSessionId` / `setHubSessionId`                           | ✅ evento |
| `_busy`            | `boolean`             | `getBusy` / `setBusy`                                           | ✅ evento |
| `_rl`              | `readline.Interface`  | `getRl` / `setRl`                                               | ❌        |
| `_attachmentQueue` | `string[]`            | `getAttachmentQueue` / `addAttachment` / `clearAttachmentQueue` | ❌        |
| `_planMode`        | `boolean`             | `getPlanMode` / `setPlanMode`                                   | ❌        |
| `_sseClients`      | `Set<ServerResponse>` | `getSseClients` / `getSseCriticalClients`                       | ❌        |

---

## 3. Achados

### FINDING-P5-1 — `_attachmentQueue` sem limite de tamanho **[FIXED]**

**Severidade**: P5 — Baixo **→ CORRIGIDO**

**Fix aplicado**: `MAX_ATTACHMENT_QUEUE` (configurável via env `TERMINAL_MAX_ATTACHMENTS`, default
50). `addAttachment()` lança `Error` quando a fila atinge o limite, impedindo crescimento
indefinido. **Localização**: `addAttachment()` linhas ~105-112

```js
export function addAttachment(filePath) {
  if (!_attachmentQueue.includes(filePath)) {
    _attachmentQueue.push(filePath);
  }
}
```

Nenhum limite superior no tamanho da fila. O usuário poderia adicionar centenas de arquivos via
`@path` ou comandos `/attach` e todos seriam tentados no próximo `sendTurn`, potencialmente
excedendo `MAX_EMBED_BYTES` (que é verificado em `embedMultiple` — os excedentes são ignorados). O
limite real é o de `embedMultiple`, mas a fila pode crescer indefinidamente na memória.

**Proposta**: limitar a 50 entradas com aviso:

```js
if (_attachmentQueue.length >= 50) {
  return false; // caller pode logar aviso
}
```

---

### FINDING-P5-2 — `setMaxListeners(20)` hardcoded **[FIXED]**

**Severidade**: P5 — Cosmético **→ CORRIGIDO**

**Fix aplicado**: Configurável via env `TERMINAL_MAX_LISTENERS` (default 25). Valor calculado em vez
de hardcoded. **Localização**: `stateEmitter.setMaxListeners(20)` linhas ~15-18

O limite de 20 listeners é hardcoded. Se novos módulos adicionarem listeners a `stateEmitter`, o
warning de `MaxListenersExceededWarning` pode aparecer sem causa óbvia. Uma documentação indicando o
design máximo seria útil.

---

## 4. Pontos positivos

- **Defensive copy** em `getAttachmentQueue()` (spread `[..._attachmentQueue]`) — previne
  modificação externa do array interno.
- Deduplicação via `includes()` em `addAttachment` — previne duplicatas sem estrutura extra.
- Emissão de eventos `hubSessionId:changed` e `busy:changed` — componentes podem reagir a mudanças
  de estado sem polling.
- `clearAttachmentQueue()` explícito — sem side effects após uso.
- Design de módulo singleton ESM: zero configs, estado é global ao processo mas isolado entre testes
  de módulos diferentes via reimport.
- `stateEmitter` com nome descritivo exportado — claro para quem consome.

---

## 5. Score

| Dimensão           | Nota       |
| ------------------ | ---------- |
| Correção lógica    | 9.5/10     |
| Reatividade        | 8.5/10     |
| Limites defensivos | 9/10       |
| **Global**         | **9.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
