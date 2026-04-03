# tools/registry.js — Auditoria

**Módulo**: `src/copilot/config/tools/` **Arquivo**: `tools/registry.js` **LOC**: 257 | **Score**:
7.5/10

## Responsabilidade

Registry em runtime de custom tools declarativas. Handlers pré-autorizados em `BUILTIN_HANDLER_MAP`.
Persiste em `custom-tools.json`. Expõe: `registerCustomTool`, `removeCustomTool`,
`buildCustomTools`, `getCustomToolDefinitions`, `loadCustomTools`.

## ACHADO C12-02 — P4 (Segurança)

**`env_read` handler expõe qualquer chave de `process.env` ao modelo**

```js
[
  'env_read',
  (args) => {
    const key = typeof args['key'] === 'string' ? args['key'] : '';
    const val = process.env[key];
    return val !== undefined ? val : '(não definido)';
  },
];
```

Se uma custom tool com `handlerId: 'env_read'` for registrada (via API HTTP), o modelo pode
exfiltrar `GITHUB_TOKEN`, `JWT_SECRET`, `OPENAI_API_KEY` ou qualquer outra variável de ambiente.

**Correção recomendada**: restringir a um allowlist de chaves seguras:

```js
const ENV_ALLOWLIST = new Set(['NODE_ENV', 'NODE_VERSION', 'HOSTNAME', 'PWD']);

[
  'env_read',
  (args) => {
    const key = typeof args['key'] === 'string' ? args['key'] : '';
    if (!ENV_ALLOWLIST.has(key)) return '(chave não permitida)';
    return process.env[key] ?? '(não definido)';
  },
];
```

## ACHADO C12-04 — P4

**`persistCustomTools` usa `writeFileSync` não-atômico — corrupção em crash**

```js
function persistCustomTools() {
  writeFileSync(CUSTOM_TOOLS_PATH, JSON.stringify([..._registry.values()], null, 2), 'utf8');
}
```

Crash durante a escrita deixa o arquivo parcialmente escrito — JSON inválido. Próximo boot falha no
`JSON.parse` (capturado via try/catch, registry fica vazio — perda silenciosa).

**Correção recomendada**: write em arquivo temporário + rename atômico.

## ACHADO C12-06 — P5

**`loadCustomTools()` executado como side-effect de import**

```js
// Na base do arquivo:
loadCustomTools();
```

Read síncrono de disco (`readFileSync`) ocorre a cada import do módulo. Em ambientes de teste, lê o
arquivo `custom-tools.json` de produção. `_resetRegistry()` existe mas deve ser chamado
explicitamente.

## Destaques Positivos

- `handlerId` whitelist previne execução de código arbitrário via custom tool API
- `registerCustomTool` valida `name` via regex `^[a-z][a-z0-9_]{0,63}$` — previne nomes maliciosos
- `_resetRegistry()` exportado para isolamento de testes — boa prática
- `loadCustomTools` ignora silenciosamente arquivo ausente (`existsSync` guard)
- `buildCustomTools` ignora handlers ausentes com WARN — proteção contra corrupção do arquivo

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] C12-02 (P4) — env_read allowlist explícita

registry.js: env_read agora tem ENV_ALLOWLIST com set explícito de variáveis permitidas. Qualquer
chave não na allowlist retorna "(variável X não está na allowlist de leitura)". Prevenção de
exfiltração de tokens/secrets (OPENAI_API_KEY, BRIDGE_ADMIN_TOKEN etc.) via tool call.

**Pontuação atualizada: 9.0/10**
