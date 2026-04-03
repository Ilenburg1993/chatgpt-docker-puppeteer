# Audit: src/copilot/tools/file/read-tools.js

**Módulo**: `copilot/tools/file` **Arquivo**: `src/copilot/tools/file/read-tools.js` **LOC**: 398
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Implementa as 4 file-read tools: `read_file_content`, `list_directory`, `search_in_files` e
`diff_files`. Todas são marcadas com `withSkipPermission()`. Usa `validatePath()` de `shared.js`
para isolamento de workspace. `search_in_files` usa ripgrep com fallback de erro. Sanitização
SENSITIVE_LINE_RE em resultados de busca.

**Score**: 8.2/10

---

## Achados

### P4 — maxBuffer em search_in_files 4x maior que limite de saída

**Localização**: `searchInFilesTool`, chamada `execFileAsync('rg', ...)`.

```js
maxBuffer: MAX_SEARCH_OUTPUT * 4,  // 80KB de buffer
// Depois: .slice(0, MAX_SEARCH_OUTPUT)  // corta para 20KB
```

O buffer de leitura do processo `rg` é 4x maior que o limite final retornado. Isso significa que até
80KB de dados de busca são lidos na memória antes do truncamento. Para buscas em projetos grandes,
isso pode ser desperdiçado.

**Impacto**: Baixo; 80KB é tolerável, mas poderia ser `MAX_SEARCH_OUTPUT * 1.2` para ser mais
eficiente.

---

### P5 — list_directory: Glob Pattern Limitado a `*.ext`

**Localização**: `listDirectoryTool`, função `readDir()`, bloco de `filter`.

```js
const globMatch = filter.startsWith('*.') ? name.endsWith(filter.slice(1)) : name === filter;
```

O suporte a globs é muito básico: `*.ext` funciona, `*.test.js` seria interpretado como
`name.endsWith('.test.js')` (correto por acidente), mas padrões como `src/**/*.ts` ou `*-test*` não
são suportados.

**Impacto**: Baixo; a limitação não é documentada no description, podendo surpreender callers.

**Recomendação**: Documentar no `description` que `filter` suporta apenas extensão `*.ext` ou nome
exato.

---

### P4 — diff_files: Dependência de binário externo `diff`

**Localização**: `diffFilesTool`, handler.

```js
await execFileAsync('diff', [`-U${context_lines ?? 3}`, va.resolved, vb.resolved]);
```

`diff` é um utilitário POSIX padrão mas não está nos containers mínimos. Se indisponível, retorna
`{ success: false, error: '...' }` — comportamento correto, mas sem fallback interno.

**Impacto**: Muito baixo em ambientes Linux padrão.

---

### P4 — SENSITIVE_LINE_RE Filtra Apenas Secrets Conhecidos

**Localização**: `searchInFilesTool`, filtro de saída:

```js
const SENSITIVE_LINE_RE = /-----BEGIN [A-Z ]+-----|ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
```

Filtra PEM headers e JWTs, mas não filtra API keys de outros formatos (ex: `sk-...`, `ghp_...`,
`AKIA...`).

**Impacto**: Baixo; rg já respeita `.gitignore` que normalmente exclui arquivos de credenciais.

---

## Positivos

- Todas as 4 tools usam `validatePath()` — isolamento de workspace garantido
- `read_file_content` suporta `startLine`/`endLine` com slicing eficiente
- `search_in_files` limita `pattern.length <= 500` prevenindo ReDoS (comentado `SEC-P2-02`)
- Pattern length guard explicitamente documentado como segurança
- Todos os resultados têm campo `truncated` para transparência
- `read_file_content` em base64 usa stream com `end` para limitar leitura
