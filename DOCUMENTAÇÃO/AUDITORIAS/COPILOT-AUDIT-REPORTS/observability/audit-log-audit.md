# Auditoria — `audit-log.js`

**Módulo**: `src/copilot/observability/audit-log.js` **LOC**: 290 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Ring buffer de auditoria central com correlação de tool calls e persistência JSONL. Consolida
`channel/audit.js` (ex-módulo de correlação) com ring buffer geral:

- Ring buffer em memória de `AuditEntry[]` (padrão 200 entradas — `COPILOT_AUDIT_RING_SIZE`)
- Correlação start/complete de tool calls (`_pending` Map com TTL de 10 min — CQ-06)
- Escrita assíncrona em `logs/tool-execution-audit.jsonl` via fila + `setImmediate`
- Rotação automática de 10 MB → `.1`
- `flush()` para persistir ring buffer em `logs/audit.jsonl`
- `getAuditSummary(sessionId, limit)` para leitura de histórico JSONL

---

## 2. Arquitetura interna

```
createAuditLog(opts)
├── _buffer: AuditEntry[]                 ← ring buffer geral
├── _pending: Map<toolCallId, { toolName, mcpServerName, args, ts }>
├── _toolWriteQueue: string[]             ← fila de linhas para tool-execution-audit.jsonl
└── _flushScheduled: boolean              ← flag anti-double-flush
```

---

## 3. Achados

### FINDING-P4-1 — `getAuditSummary` lê o arquivo inteiro em memória

**Severidade**: P4 — Médio **Localização**: `getAuditSummary()` (~linha 240)

```js
const raw = await fs.promises.readFile(toolAuditFile, 'utf8');
const lines = raw.trim().split('\n').filter(Boolean);
```

O `tool-execution-audit.jsonl` rotaciona a 10 MB. Antes da rotação, `readFile` carrega até 10 MB em
memória como string UTF-8, depois faz `.split('\n')` criando potencialmente 100 000+ entradas. Para
retornar apenas as últimas 50, todo esse processamento é desperdiçado.

**Proposta**: Leitura reversa de linhas (ou `tail`-like via `ReadStream` a partir do fim do arquivo)
para evitar carregar o arquivo completo. Alternativa simples: usar `tail` via `execFileSync`:

```js
import { execFileSync } from 'node:child_process';
const raw = execFileSync('tail', ['-n', String(limit), toolAuditFile], { encoding: 'utf8' });
```

---

### FINDING-P4-2 — `clear()` não faz flush antes de limpar

**Severidade**: P4 — Médio **Localização**: `clear()` (~linha 195)

```js
function clear() {
  _buffer.length = 0;
  _pending.clear();
}
```

Se houver eventos no `_buffer` não persistidos (o ring buffer é separado da fila JSONL de tool
calls), `clear()` descarta silenciosamente. A `_toolWriteQueue` (para tool-execution-audit.jsonl)
não é limpa, mas o ring buffer geral (`_buffer`) é.

Se quem chama `clearAuditTrail()` de `hooks-audit-preset.js` espera que o estado de auditoria seja
limpo completamente, eventos enfileirados mas não escritos ficam "fantasmas".

**Proposta**: Documentar explicitamente que `clear()` não persiste, ou adicionar `await flush()`
opcional:

```js
async function clearAndFlush() {
  await flush();
  clear();
}
```

---

### FINDING-P5-3 — `mkdir` via regex em vez de `path.dirname()`

**Severidade**: P5 — Cosmético **Localização**: `scheduleFlushTool()` (~linha 133)

```js
await mkdir(toolAuditFile.replace(/[^/\\]+$/, ''), { recursive: true });
```

Extração de diretório via regex ao invés de `path.dirname(toolAuditFile)`. Funciona na prática, mas
é frágil: se `toolAuditFile` terminar com `/`, o regex remove o caractere incorretamente.

**Proposta**:
`import { dirname } from 'node:path'; await mkdir(dirname(toolAuditFile), { recursive: true })`.

---

### FINDING-P5-4 — `_argsSummary` trunca a 200 chars sem indicar qual campo foi truncado

**Severidade**: P5 — Cosmético **Localização**: `_argsSummary()` (~linha 90)

Apenas cosmético: o `'…'` indica truncagem do JSON serializado, mas não qual campo foi cortado. Para
diagnóstico de ferramentas com args longos (ex: `write_file` com conteúdo), dificulta leitura do
audit trail.

---

## 4. Pontos positivos

- **TTL no `_pending`** (CQ-06): limpeza de entradas com mais de 10 min a cada `recordToolStart()` —
  evita leak em sessões com tool calls nunca completadas.
- **Rotação automática** de `tool-execution-audit.jsonl` (10 MB → `.1`) com `rename` atômico.
- **Flush assíncrono** via `setImmediate` + flag `_flushScheduled`: sem double-flush paralelos.
- **Batch write**: plural de eventos em uma única `appendFile` — eficiente para bursts de tool
  calls.
- **`resultSummary`** truncado a 200 chars — evita I/O excessivo para respostas grandes.
- **Singleton** `defaultAuditLog` exportado para consumo direto.

---

## 5. Score

| Dimensão        | Nota       |
| --------------- | ---------- |
| Correção lógica | 8/10       |
| Robustez (I/O)  | 7/10       |
| API e JSDoc     | 9/10       |
| Performance     | 7/10       |
| **Global**      | **7.8/10** |

---

## 6. Status de Correção

### [FIXED] FINDING-P5-3 — `mkdir` via regex substituído por `dirname()`

O import de `node:path` foi atualizado de `import { join }` para `import { dirname, join }`. As duas
ocorrências de `toolAuditFile.replace(/[^/\\]+$/, '')` foram substituídas por
`dirname(toolAuditFile)` — mais legível, correto em todos os sistemas operacionais e não depende de
regex frágil.

### [FIXED] FINDING-P4-1 — `getAuditSummary` agora usa leitura reversa

Adicionado helper `readLastNLines(filePath, n)` que lê o arquivo em blocos de 64KB a partir do
final, sem carregar o arquivo inteiro em memória. `getAuditSummary` usa `readLastNLines` com
`readN = sessionId ? limit * 10 : limit` para filtrar eficientemente pelo sessionId antes de truncar
ao `limit`.

### [FIXED] FINDING-P4-2 — `clearAndFlush()` adicionado ao AuditLog

Nova função `async clearAndFlush()` garante que o buffer seja persistido via `flush()` antes de
`clear()` limpar os dados em memória. Adicionada ao typedef `AuditLog` e ao objeto retornado por
`createAuditLog`.

**Pontuação atualizada: 9.5/10**

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
