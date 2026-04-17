# 08-INFRA-OBSERVABILITY — Auditoria dos Módulos `infra/` e `observability/`

**Auditoria Profunda de `src/copilot`** · Abril 2026
**Módulos**: `src/copilot/infra/` e `src/copilot/observability/`
**Documentado em**: 2026-04-18

---

## 1. Mapa dos Módulos

```
infra/
├── storage.js                  (readJson, writeJson — filesystem abstraction)
├── sdk-session-registry.js     (registro de sessões SDK ativas)
├── sqlite.js                   (abstração SQLite para conversation store)
├── queue.js                    (fila persistida)
└── lock.js                     (file locking)

observability/
├── logger.js                   (log() — saída estruturada)
├── metrics.js                  (defaultMetrics — contadores e histogramas)
├── collectors/                 (coletores de métricas)
│   ├── tool-handlers.js
│   └── session-handlers.js
├── otel.js                     (OpenTelemetry spans)
└── index.js                    (barrel)
```

---

## 2. Arquivo: `infra/storage.js` — BUG CRÍTICO

### JSDoc Mentiroso vs Implementação Real

**JSDoc (linha 38)**:
```
* Usa escrita em arquivo temporário + rename para atomicidade (quando possível).
```

**Implementação real**:
```js
export async function writeJson(filePath, data) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }
    const content = JSON.stringify(data, null, 2) + '\n';
    await writeFile(filePath, content, 'utf-8');  // ← direto, sem temp+rename!
}
```

| ID                         | Sev               | Arquivo                  | Descrição                                                                                                                                                                                                                                                          |
| -------------------------- | ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **BUG-INFRA-01** / CAT-010 | **P0 (CRITICAL)** | `infra/storage.js:42-46` | `writeJson()` **não é atômica** apesar do JSDoc afirmar que usa temp+rename. `writeFile` direto pode deixar arquivo corrompido/vazio se o processo crashar no meio da escrita. Estado do agente (`agent-state.json`, `session.json`) ficará corrompido após crash. |

> **Status de execução (2026-04-17): corrigido no código.**
> `src/copilot/infra/storage.js` agora escreve em arquivo temporário com nome aleatório e faz `rename()` atômico para o destino, além de limpar o temporário em caso de erro.

**Correção Recomendada**:

```js
import { rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export async function writeJson(filePath, data) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }
    const content = JSON.stringify(data, null, 2) + '\n';
    const tmpPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
    try {
        await writeFile(tmpPath, content, 'utf-8');
        await rename(tmpPath, filePath);  // atômico no POSIX
    } catch (err) {
        // cleanup temp em caso de erro
        try { await unlink(tmpPath); } catch { /* ignore */ }
        throw err;
    }
}
```

---

## 3. Arquivo: `infra/sdk-session-registry.js`

Auditado indiretamente via `sdk/session/client.js`:

```js
import {
    clearActiveSdkSessions,
    getActiveSdkSession,
    registerActiveSdkSession,
    removeActiveSdkSession,
} from '../../infra/sdk-session-registry.js';
```

**Positivo**: Registry externalizado para infra — permite auditoria de sessões ativas sem acesso ao cliente SDK diretamente.

| ID               | Sev | Descrição                                                                                                                                                                                                                                                                                                                      |
| ---------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-INFRA-01** | P3  | `clearActiveSdkSessions()` é chamado no início de `stopClient()` — antes do `client.stop()` completar. Se `client.stop()` falhar, as sessões foram removidas do registry mas podem ainda estar ativas no SDK. Registry fica out-of-sync com o SDK. Correto: limpar registry apenas após `client.stop()` completar com sucesso. |

> **Status de execução (2026-04-17): mitigado no código.**
> O registry de sessões ativas agora só é limpo depois que `client.stop()` / `forceStop()` concluem, reduzindo o risco de descompasso entre registry local e estado real do SDK.

---

## 4. Módulo `observability/`

### `logger.js`

Saída estruturada com nível configurável via `COPILOT_LOG_LEVEL`. Sem achados críticos.

### `metrics.js`

`defaultMetrics` com contadores e histogramas. Integrado com OTEL quando `OTEL_EXPORTER_OTLP_ENDPOINT` configurado.

| ID             | Sev | Descrição                                                                                                                                                                      |
| -------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-OBS-01** | P3  | `defaultMetrics` é singleton global. Sem suporte a reset em testes — contadores acumulam entre test cases. Testes de métricas são não-determinísticos se rodarem em sequência. |

### `otel.js`

```js
// F4.8: OTLP via SDK
if (otlpEndpoint) {
    anyOptions['telemetry'] = { otlpEndpoint };
}
```

**Positivo**: Telemetria OTLP opcional, ativada apenas se env var configurada.

---

## 5. Resumo de Achados

| ID                         | Severidade        | Arquivo                         | Descrição                                                                                               |
| -------------------------- | ----------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **BUG-INFRA-01** / CAT-010 | **P0 (CRITICAL)** | `infra/storage.js:42-46`        | `writeJson()` não atômica — JSDoc mentiroso — estado corrompível em crash — **corrigido em 2026-04-17** |
| GAP-INFRA-01               | P3                | `infra/sdk-session-registry.js` | Registry limpo antes de `client.stop()` completar — **mitigado em 2026-04-17**                          |
| GAP-OBS-01                 | P3                | `observability/metrics.js`      | `defaultMetrics` singleton sem reset para testes                                                        |

### Severidade Geral do Módulo: **P0 (CRÍTICO)**

BUG-INFRA-01 era um P0 real: em qualquer crash do processo (SIGKILL, OOM, crash de módulo), o estado persistido do agente ficaria corrompido ou vazio. O código atual já protege esse caminho com write-atômica.

---

*Próximo: [09-HOOKS.md](./09-HOOKS.md)*
