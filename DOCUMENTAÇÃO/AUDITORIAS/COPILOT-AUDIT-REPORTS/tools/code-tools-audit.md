# Audit: src/copilot/tools/code-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/code-tools.js` **LOC**: 143 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 3 tools de qualidade de código: `lint_check`, `run_tests` e `typecheck`. Todas marcadas com
`withSkipPermission`. `safeExec()` usa `execFileAsync` com timeout 60s e buffer 4MB. `ESLINT_BIN` é
determinado no load do módulo via `execFileSync('which', ['eslint'])`.

**Score**: 7.8/10

---

## Achados

### P4 — ESLINT_BIN Resolvido com execFileSync no Load do Módulo

**Localização**: Topo do arquivo, inicialização de `ESLINT_BIN`.

```js
let ESLINT_BIN = 'eslint';
try {
  const resolved = createRequire(import.meta.url).resolve('eslint/bin/eslint.js');
  if (existsSync(resolved)) ESLINT_BIN = resolved;
} catch {
  try {
    ESLINT_BIN = execFileSync('which', ['eslint'], { encoding: 'utf8' }).trim();
  } catch {
    // usa 'eslint' como fallback
  }
}
```

O `execFileSync('which', ['eslint'])` no load do módulo bloqueia o event loop. `which` é geralmente
rápido (< 1ms), mas em sistemas lentos ou com PATH longo pode demorar.

**Impacto**: Muito baixo; `which` é praticamente instantâneo.

---

### P4 — lint_check com fix: true Sem Backup Prévio

**Localização**: `lintCheckTool`, handler com `fix: true`.

```js
if (args.fix) execArgs.push('--fix');
```

Aplicar `--fix` é destrutivo. Não há backup dos arquivos afetados. Se o modelo pedir fix incorreto,
as alterações podem ser difíceis de reverter sem controle de versão.

**Impacto**: Baixo em repositórios git (todas as mudanças são rastreadas). Alto em ambientes sem
git.

---

### P5 — run_tests com suite 'all' Pode Ser de Longa Duração

**Localização**: `runTestsTool`, `scriptMap`.

```js
const scriptMap = {
  fast: 'test:fast',
  unit: 'test:fast',
  integration: 'test:integration',
  all: 'test:all',
};
```

`test:all` executa todos os testes. O timeout fixo de 60s pode não ser suficiente. Porém, o timeout
de 60s é apenas para o `execFileAsync` — `npm test:all` pode demorar mais e aparentemente usa outro
mecanismo de timeout.

**Impacto**: Baixo; model caller geralmente sabe que `all` é mais lento.

---

## Positivos

- `safeExec()` usa `execFileAsync` — sem shell injection (OWASP A3)
- `lint_check` sem `--fix` por default — não-destrutivo por padrão
- `withSkipPermission` correto para estas tools de diagnóstico
- `typecheck` usa `tsc --noEmit` — sem emissão de arquivos, puramente diagnóstico
- `ESLINT_BIN` resolve via require, depois via `which`, com fallback para `eslint` — robusto
