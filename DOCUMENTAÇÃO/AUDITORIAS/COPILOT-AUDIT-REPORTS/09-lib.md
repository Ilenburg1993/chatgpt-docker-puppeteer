# 09-lib.md — Módulo lib/ — Consolidado

**Módulo**: `src/copilot/lib/` **Gerado por**: COPILOT-FULL-AUDIT MF-II (F13) **Score geral**:
9.0/10 **LOC total**: 1904 (12 arquivos)

---

## Visão Geral

`lib/` é a camada de utilities e facades puras da infra Copilot. Não possui estado global público
(exceção: `sdk-client.js` tem o singleton do CopilotClient, necessário por design). Todos os módulos
são ESM com `// @ts-check` e JSDoc robusto.

---

## Inventário de Arquivos

| Arquivo             | LOC | Score | Função                                     |
| ------------------- | --- | ----- | ------------------------------------------ |
| `sdk-client.js`     | 435 | 8.5   | Singleton CopilotClient + session registry |
| `session.js`        | 300 | 9.0   | Operações puras de sessão SDK              |
| `tools-registry.js` | 261 | 10.0  | Registry funcional de Tool SDK             |
| `models.js`         | 253 | 9.0   | Listagem/filtro/cache de modelos           |
| `agents.js`         | 173 | 9.0   | Factories CustomAgentConfig                |
| `event-helpers.js`  | 140 | 9.5   | waitForEvent/raceEvents sem leak           |
| `index.js`          | 120 | 9.5   | Barrel centralizado                        |
| `url-validator.js`  | 88  | 8.5   | Anti-SSRF URL validation                   |
| `http-request.js`   | 61  | 8.0   | HTTP helper loopback                       |
| `utils.js`          | 37  | 10.0  | pickDefined                                |
| `hooks.js`          | 19  | 9.0   | @deprecated shim                           |
| `permissions.js`    | 17  | 9.0   | @deprecated shim                           |

---

## Achados — P4 (corrigir em sprint próximo)

### C13-01 — `sdk-client.js` — P4

**`_startError` race: N waiters retentam criação do cliente após falha**

**Contexto**: `getClient()` tem um polling loop para waiters enquanto `_starting=true`. Quando o
primeiro attempt falha, `_startError` é set e `_starting=false`. Todos os N waiters acordam
simultaneamente; apenas o **primeiro** lê e limpa `_startError`. Os demais encontram
`_startError=null` e `_client=null` — e prosseguem para criar o cliente novamente, causando um storm
de tentativas paralelas.

**Impacto**: Em alta concorrência com CLI indisponível, N tentativas paralelas de inicialização. Em
produção com CLI via PM2 isso é mitigado (CLI está sempre disponível), mas um restart do CLI durante
o uso pode ativar esse path.

**Localização**: `sdk-client.js` linhas ~125-160 (`getClient()` waiter block)

**Correção**: Usar uma promise compartilhada côncorrente:

```js
let _startPromise = null;
export async function getClient(overrides = {}) {
  if (_client && _client.getState() === 'connected') return _client;
  if (_startPromise) return _startPromise;
  _startPromise = _doStart(overrides).finally(() => {
    _startPromise = null;
  });
  return _startPromise;
}
```

---

### C13-02 — `url-validator.js` — P4

**DNS rebinding não prevenido**

**Contexto**: `validateUrl()` valida o hostname **antes** da resolução DNS. Um hostname controlado
por atacante pode resolver para IP público na validação e para IP privado na requisição efetiva (DNS
rebinding attack).

**Impacto**: Bypass de anti-SSRF em cenários de DNS rebinding se o sistema faz requisições HTTP
baseadas em URLs de usuário.

**Correção recomendada**: Documentar a limitação no JSDoc de `validateUrl`/`validateUrlString`; para
proteção completa, considerar `dns.lookup()` + re-validação pós-DNS ou implementar allowlist em vez
de blocklist.

---

## Achados — P5 (melhorias incrementais)

| ID     | Arquivo            | Título                                                                           |
| ------ | ------------------ | -------------------------------------------------------------------------------- |
| C13-03 | `http-request.js`  | `https://` URLs silenciosamente conectam via HTTP — sem verificação de protocolo |
| C13-04 | `sdk-client.js`    | `resumeClientSession` retorna sessão stale sem revalidar conectividade           |
| C13-05 | `session.js`       | `buildSystemMessageConfig` usa `mode:'customize'` sem verificação de versão SDK  |
| C13-06 | `models.js`        | `_modelsCache` module-level: isolamento entre testes sem `clearModelsCache()`    |
| C13-07 | `models.js`        | `buildReasoningConfig` passa effort sem validar quando `supported.length === 0`  |
| C13-08 | `agents.js`        | `READ_ONLY_TOOLS` hardcoded — drift potencial com SDK                            |
| C13-09 | `agents.js`        | `createFullAccessAgent` depende de SDK interpretar `tools: null` como "todos"    |
| C13-10 | `hooks.js`         | `@deprecated` sem data de remoção agendada                                       |
| C13-11 | `permissions.js`   | `@deprecated` sem data de remoção agendada                                       |
| C13-12 | `url-validator.js` | `fe80` IPv6 link-local check captura apenas prefixo exato, não CIDR /10          |

---

## Pontos Fortes do Módulo

### Segurança

- `url-validator.js` tem cobertura SSRF robusta: IPv4 privado (10.x, 172.16-31.x, 192.168.x),
  link-local (169.254.x), metadata.google.internal, ::1, fd::/8
- `http-request.js` tem limite de 1MB em response + timeout preemptivo via `req.destroy()`
- `sdk-client.js` expõe `_resetClientState()` + `_injectClientForTest()` — design correto para
  isolamento sem exposição de estado em produção

### Confiabilidade

- `event-helpers.js`: cleanup perfeito em todos os paths (resolve/reject/abort/timeout)
- `session.js`: BUG-HIGH-06 fix correto — `infiniteSessions` só ativado quando explicitamente
  fornecido; evita compaction não intencional
- `sdk-client.js`: `stopClient()` retorna `Error[]` em vez de swallowing — caller tem contexto
- `getClient()` UPG-05: backoff exponencial para waiters reduce pressão em startup concorrente

### Qualidade de código

- `tools-registry.js`: funcional puro, zero side effects, 10/10
- `utils.js`: `pickDefined` correto com genérico `T extends Record<string, unknown>`
- `index.js`: barrel importa de caminhos canônicos, não dos deprecated shims
- JSDoc robusto em todos os arquivos com `@param`, `@returns`, `@throws`

---

## Mapa de Dependências lib/

```
lib/index.js
├── sdk-client.js
│   └── #copilot/observability/logger
│   └── @github/copilot-sdk
├── #copilot/hooks/factory           (não via lib/hooks.js)
├── #copilot/hooks/permission        (não via lib/permissions.js)
├── session.js
│   └── sdk-client.js (getClient)
├── agents.js           (sem deps externas)
├── models.js
│   └── sdk-client.js (getClient)
├── tools-registry.js   (sem deps externas)
├── event-helpers.js    (sem deps externas)
├── http-request.js     (node:http)
├── url-validator.js    (sem deps externas)
└── utils.js            (sem deps externas)
```

---

## Recomendações Prioritárias

1. **[P4]** Corrigir race em `getClient()` → usar promise compartilhada (C13-01)
2. **[P4]** Adicionar doc de limitação DNS rebinding em `validateUrl` (C13-02)
3. **[P5]** Adicionar suporte `https://` em `http-request.js` (C13-03)
4. **[P5]** Agendar remoção de `hooks.js` e `permissions.js` no roadmap (C13-10/11)
5. **[P5]** `buildReasoningConfig`: adicionar log WARN quando `supported.length === 0` (C13-07)

---

_Módulo auditado por COPILOT-FULL-AUDIT MF-II (F13) — 12 arquivos, 1904 LOC._
