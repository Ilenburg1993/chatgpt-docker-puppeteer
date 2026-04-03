# Audit: src/copilot/tools/file/write-tools.js

**Módulo**: `copilot/tools/file` **Arquivo**: `src/copilot/tools/file/write-tools.js` **LOC**: 305
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Fornece 6 file-write tools: `write_file_content`, `create_file`, `delete_file`, `copy_file`,
`move_file` e `patch_file`. Todas requerem aprovação (sem `withSkipPermission`). Todas usam
`validatePath()` de `shared.js`. `patch_file` usa substituição cirúrgica de string com escaping
correto de `$` de substituição.

**Score**: 8.3/10

---

## Achados

### P4 — delete_file: Não Verifica Symlinks

**Localização**: `deleteFileTool`, handler.

```js
const stats = fs.statSync(resolved);
if (stats.isDirectory()) return { success: false, error: '...' };
fs.unlinkSync(resolved);
```

`fs.statSync()` segue symlinks. Se `resolved` for um symlink para um diretório, `isDirectory()`
retornará `true` e a operação é bloqueada. Se for um symlink para um arquivo, `unlinkSync()`
deletará o symlink (não o alvo) — comportamento correto para `unlink`.

**Impacto**: Muito baixo; comportamento é o padrão POSIX esperado.

---

### P4 — write_file_content: Sem Verificação de Tamanho do Conteúdo

**Localização**: `writeFileContentTool`, handler.

```js
const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
fs.writeFileSync(resolved, buf);
```

Não há limite de tamanho para `content`. Um modelo pode passar strings muito grandes. Para operações
TCP (SDK), o tamanho já é limitado pelo payload do SDK, mas vale ter guarda explícita.

**Impacto**: Baixo; o SDK provavelmente já limita o tamanho dos args.

---

### P3 (Positivo Documentado) — patch_file: Escaping Correto de $ em new_string

**Localização**: `patchFileTool`, handler.

```js
// BUG-HIGH-01 fix: escapar padrões especiais de substituição ($&, $', $`, $$, $n)
const safeNewString = new_string.replace(/\$/g, '$$$$');
const updated = content.replace(old_string, safeNewString);
```

Este é um bug clássico em JavaScript: `String.prototype.replace()` interpreta `$` especialmente no
segundo argumento. A correção com `/\$/g → '$$$$'` é correta e bem documentada. Registro positivo.

---

## Positivos

- `patch_file` verifica que `old_string` ocorre exatamente 1 vez — previne substituições ambíguas
- `create_file` com `overwrite: false` retorna erro descritivo se arquivo já existe
- `move_file` usa `fs.renameSync` (atômico se mesmo filesystem) — correto
- `copy_file` cria diretórios intermediários com `mkdirSync({ recursive: true })` automaticamente
- Todas as operações usam `validatePath()` — workspace containment garantido
- BUG-HIGH-01 fix documentado explicitamente com comentário
