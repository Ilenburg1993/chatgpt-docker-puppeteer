# Auditoria — `logger.js`

**Módulo**: `src/copilot/observability/logger.js` **LOC**: 270 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Logger interno isolado para `src/copilot` — drop-in replacement de `#core/logger` sem dependência do
workspace pai. Features:

- Escreve em `src/copilot/logs/agent.log` (isolado do `ROOT/logs/`)
- Nível via `COPILOT_LOG_LEVEL` (independente de `LOG_LEVEL` global)
- Mesma API de `#core/logger`: `log`, `log.debug/info/warn/error/fatal`, `audit`, `metric`,
  `logMetric`
- Ring buffer dos últimos 1000 logs para consulta via `getRecentLogs()`
- Rotação automática por tamanho: 5 MB para log/metrics, 2 MB para audit
- Prefixo `[copilot]` no console para distinguir de logs do workspace

---

## 2. Arquitetura interna

| Componente                              | Papel                                                                 |
| --------------------------------------- | --------------------------------------------------------------------- |
| `LOG_DIR`                               | Env `COPILOT_LOG_DIR` ou `path.resolve(__dirname, '../logs')`         |
| `rotateFile(filePath, prefix, maxSize)` | `statSync` + `renameSync` sincrono se arquivo excede limite           |
| `cleanOldFiles(prefix)`                 | `readdirSync` + `statSync` por arquivo; remove > MAX_ARCHIVES backups |
| `_logRingBuffer[]`                      | 1000 últimas linhas para `getRecentLogs()`                            |
| `log(level, msg, taskId)`               | Chama `rotateFile()` + `appendFileSync()` em cada chamada             |
| `audit(action, details)`                | Chama `rotateFile()` + `appendFileSync()` para `audit.log`            |
| `metric(name, payload)`                 | Chama `rotateFile()` + `appendFileSync()` para `metrics.log`          |

---

## 3. Achados

### FINDING-P4-1 — `rotateFile()` usa I/O síncrono a cada chamada de `log()`

**Severidade**: P4 — Médio **Localização**: `log()` (~linha 165), `rotateFile()` (~linha 95)

A cada `log()`, `audit()` ou `metric()`, o código chama `rotateFile()` que:

1. `fs.existsSync(filePath)` — syscall síncrona
2. `fs.statSync(filePath)` — syscall síncrona
3. `fs.renameSync(...)` — syscall síncrona (só quando necessário)

Em cenário de debug intenso (centenas de logs/segundo), isso cria contention síncrono no event loop
para cada linha de log. O projeto usa `cat arquivo` vs `bat arquivo` no padrão — o own logger não
deveria ser um hotspot síncrono.

**Proposta A (simples)**: Cache do tamanho com invalidação a cada N chamadas ou a cada 1 segundo:

```js
let _logSizeCache = 0;
let _logSizeLastCheck = 0;
function rotateIfNeeded() {
  const now = Date.now();
  if (now - _logSizeLastCheck < 5000) return; // check a cada 5 seg
  _logSizeLastCheck = now;
  rotateFile(LOG_FILE, 'copilot_agent_', MAX_LOG_SIZE);
}
```

**Proposta B (ideal)**: Fila assíncrona análoga à do `event-collector.js` — batch `appendFile` em
vez de `appendFileSync` por linha.

---

### FINDING-P4-2 — `cleanOldFiles()` executa `readdirSync` + `statSync` por arquivo na inicialização

**Severidade**: P4 — Médio **Localização**: `cleanOldFiles()` chamada 3x no módulo load (~linha 255)

Na carga do módulo, `cleanOldFiles()` é chamada 3 vezes:

- `cleanOldFiles('copilot_agent_')`
- `cleanOldFiles('copilot_metrics_')`
- `cleanOldFiles('copilot_audit_')`

Cada chamada faz `readdirSync(LOG_DIR)` + `statSync` per arquivo para ordenar por `mtime`. Se o
diretório de logs tiver muitos arquivos (ex: 50+), isso bloqueia o event loop durante o import do
módulo.

**Proposta**: Executar `cleanOldFiles()` de forma assíncrona (fora do import síncrono):

```js
// No final do módulo, em vez de chamadas síncronas:
setImmediate(() => {
  cleanOldFiles('copilot_agent_');
  cleanOldFiles('copilot_metrics_');
  cleanOldFiles('copilot_audit_');
});
```

---

### FINDING-P5-3 — `log.setLevel()` muta estado de módulo — isolamento de testes comprometido

**Severidade**: P5 — Baixo **Localização**: `log.setLevel()` (~linha 210)

`minLevel` é variável de módulo (singleton ESM). `log.setLevel('DEBUG')` em um teste afeta todos os
outros consumidores do módulo no mesmo processo. Testes que dependem de isolamento de nível de log
podem ter comportamento não determinístico se executados em paralelo.

**Proposta**: Documentar que `setLevel()` é global-process scope, ou expor via factory pattern com
escopo local.

---

### FINDING-P5-4 — `audit()` falha silenciosamente no console mas com mensagem crítica

**Severidade**: P5 — Cosmético **Localização**: `audit()` (~linha 230)

```js
} catch (_) {
    console.error(`[copilot/logger] [CRITICAL_AUDIT_FAIL] ${entry}`);
}
```

A string `[CRITICAL_AUDIT_FAIL]` no console sem nenhum mecanismo de alerta adicional pode passar
despercebida. Para auditoria de segurança, falhas de escrita deveriam ser mais barulhentas.

---

## 4. Pontos positivos

- **Isolamento completo** de logs: namespace `[copilot]`, diretório próprio, sem dependência de
  `#core/logger` — elimina acoplamento com workspace pai.
- **`getRecentLogs(n, level)`** via ring buffer: consulta em memória eficiente para API de debug.
- **`log.setLevel()` dinâmico**: permite mudar nível em runtime sem restart.
- **`LOG_DIR` exportado**: consumidores externos (ex: `audit-log.js`) podem usar a mesma const.
- **Rotação com `MAX_ARCHIVES`**: não acumula arquivos .bak indefinidamente.
- **`fs.mkdirSync` no module load**: diretório criado antes de qualquer log — sem erros de "dir not
  found" na primeira escrita.

---

## 5. Score

| Dimensão        | Nota       |
| --------------- | ---------- |
| Correção lógica | 9/10       |
| Performance I/O | 6/10       |
| API e JSDoc     | 9/10       |
| Isolamento      | 9/10       |
| **Global**      | **8.3/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
