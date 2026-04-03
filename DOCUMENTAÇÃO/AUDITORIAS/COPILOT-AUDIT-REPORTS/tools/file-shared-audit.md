# Audit: src/copilot/tools/file/shared.js

**Módulo**: `copilot/tools/file` **Arquivo**: `src/copilot/tools/file/shared.js` **LOC**: 138
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Módulo utilitário compartilhado para file tools. Define constantes de limites, dois arrays de
padrões bloqueados (`BLOCKED_PATTERNS_SECRETS` e `BLOCKED_PATTERNS_WRITE_ONLY`), lazy-check de
disponibilidade de `rg`, e `validatePath()` assíncrona com resolução de symlinks + workspace
containment.

**Score**: 8.5/10

---

## Achados

### P4 — validatePath: Verifica Apenas basename Contra BLOCKED_PATTERNS

**Localização**: `validatePath()`, bloco de verificação de patterns.

```js
const base = path.basename(resolved);
for (const pat of patterns) {
  if (pat.test(base)) throw new Error(`Acesso bloqueado: ${base}`);
}
```

Apenas o `basename` (nome do arquivo) é verificado. Um arquivo em
`/workspace/.github/secret_config/data.json` não teria `data.json` como match para `/secret/i`, mas
o diretório pai contém "secret". A verificação deveria incluir o path relativo completo.

**Impacto**: Baixo; parâmetros como `BLOCKED_PATTERNS_SECRETS` têm padrões específicos de nome de
arquivo (`.pem`, `.env`, `id_rsa`, etc.) que raramente são nomes de diretório.

**Recomendação**: Verificar `path.relative(WORKSPACE_ROOT, resolved)` ao invés de apenas `basename`.

---

### P4 — \_rgAvailable: Cache Após Primeira Verificação Pode Ser Stale

**Localização**: `isRgAvailable()`.

```js
let _rgAvailable = null;
export function isRgAvailable() {
  if (_rgAvailable !== null) return _rgAvailable;
  try {
    execFileSync('rg', ['--version'], { timeout: 2000, stdio: 'ignore' });
    _rgAvailable = true;
  } catch {
    _rgAvailable = false;
  }
  return _rgAvailable;
}
```

Após a primeira verificação, o resultado é cacheado para sempre. Se `rg` for instalado após o
processo iniciar, não será detectado. Impacto na direção oposta: se `rg` for removido após início,
`isRgAvailable()` continuará retornando `true`.

**Impacto**: Muito baixo; `rg` é instalado durante DevContainer build — não muda em runtime.

---

## Positivos

- `validatePath()` usa `path.realpath()` para resolver symlinks — evita path traversal via symlinks
- `validatePath()` tem fallback para `path.dirname(filePath)` se o arquivo não existe (para writes)
- `BLOCKED_PATTERNS_WRITE_ONLY` inclui `.sh`, `docker*` — proteção de infraestrutura
- `BLOCKED_PATTERNS_SECRETS` inclui padrões como `/id_rsa/`, `/.pem$/`, `/.env$/` — cobertura
  razoável
- Constantes exportadas (`MAX_CONTENT_BYTES`, `MAX_SEARCH_OUTPUT`, etc.) definem limites
  centralizados
- `isRgAvailable()` com timeout de 2s em `execFileSync` — não bloqueia indefinidamente
