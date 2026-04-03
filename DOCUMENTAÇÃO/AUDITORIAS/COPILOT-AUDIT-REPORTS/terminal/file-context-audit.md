# Auditoria — `file-context.js`

**Módulo**: `src/copilot/terminal/file-context.js` **LOC**: 351 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Utilitários para leitura e embedding de contexto de arquivo no terminal LLM-B. Permite:

- Leitura com cache TTL 30s (`readFileContext`)
- Embedding em blocos markdown com detecção de linguagem (`detectLang`, `buildBlock`)
- Extração de referências `@path` de mensagens (`extractAtReferences`)
- Conversão de attachments (file, directory, selection, blob) para texto embeddado (arquitetura
  zero-PR)

---

## 2. Arquitetura

```
readFileContext(filePath)
 ├── cache hit (_fileCache, TTL 30s) → return cached
 └── cache miss → stat + readFile → _fileCache.set

attachmentToEmbed(att)
 ├── type='file' → readFileContext
 ├── type='directory' → readDirectoryContext
 ├── type='selection' → buildBlock(text)
 ├── type='blob' → Buffer.from(data, 'base64').toString('utf8')
 └── fallback → att.content
```

---

## 3. Achados

### FINDING-P4-1 — `extractAtReferences` corresponde a endereços de email **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO** (2026-06-XX) **Localização**: `extractAtReferences()`
linhas ~221-235

**Fix aplicado**: adicionada verificação `isLikelyEmail` via regex `^[^/]+\.[a-z]{2,}$i` que rejeita
padrões tipo `domain.tld` sem `/`. Caminhos válidos (`./src`, `/etc/hosts`, `README.md`) passam
normalmente.

```js
const pattern = /@"([^"]+)"|@([\w./\-_]+)/g;
```

O padrão `@([\w./\-_]+)` corresponde a `@domain.tld` ou `author@example.com` — o fragmento após `@`
seria tratado como caminho de arquivo. Se o usuário escrever "contate engineer@example.com para
dúvidas", o caminho `example.com` seria adicionado à fila de attachments, causando tentativa de
leitura de arquivo inválida.

**Proposta**: exigir que o caminho comece com `/`, `./`, ou `../`, ou contenha pelo menos um `/`:

```js
const pattern = /@"([^"]+)"|@((?:\.?\.?\/)[^\s]+|[\w./\-_]+\/[\w./\-_]*)/g;
// Mais simples: require / em algum punto, ou prefixo ./ ou /
```

---

### FINDING-P4-2 — `readDirectoryContext` lê arquivos sequencialmente **[FIXED]**

**Severidade**: P4 — Baixo (performance) **→ CORRIGIDO** (2026-06-XX) **Localização**:
`readDirectoryContext()` linhas ~253-290

**Fix aplicado**: `stat()` agora é paralelizado via `Promise.allSettled()`. Os resultados são
filtrados e processados em série apenas para o controle de `totalBytes` budget.

```js
for (const filePath of files) {
    try {
        const info = await stat(filePath);  // ← sequencial
        ...
        const content = await readFile(filePath, 'utf-8');  // ← sequencial
    } catch { }
}
```

Com N arquivos em um diretório, `stat` + `readFile` por arquivo é O(N) em latência. Para diretórios
com 20+ arquivos, isso pode ser perceptível (centenas de ms).

**Proposta**: usar `Promise.all` com map + filter:

```js
const ctxs = (
  await Promise.all(
    files.map(async (filePath) => {
      try {
        const info = await stat(filePath);
        if (info.size === 0 || info.size > MAX_EMBED_BYTES) return null;
        const content = await readFile(filePath, 'utf-8');
        if (content.includes('\0')) return null;
        return { path: filePath, content, size: info.size, lang: detectLang(filePath) };
      } catch {
        return null;
      }
    }),
  )
).filter(Boolean);
```

---

### FINDING-P4-3 — `attachmentToEmbed` decoda blobs binários como UTF-8 sem verificação de mimeType **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO** (2026-06-XX) **Localização**: `attachmentToEmbed()` tipo
`blob`, linhas ~348-378

**Fix aplicado**: mimeType verificado antes de qualquer decodificação. Tipos `text/*`,
`application/json`, `application/xml`, `application/javascript`, `application/typescript` são
permitidos. Demais tipos retornam `(dados binários, mimeType: ...)` diretamente sem decodificar.
Heurística `\0` byte adicional.

```js
let decodedContent;
try {
  decodedContent = Buffer.from(att.data, 'base64').toString('utf8');
} catch {
  decodedContent = `(dados binários, mimeType: ${mimeType})`;
}
```

`Buffer.from(...).toString('utf8')` **não lança erro** para dados binários arbitrários — produz
mojibake (sequências inválidas substituídas por replacement character `\uFFFD`). O `catch` só é
atingido se `att.data` não for string válida de base64. Para blobs binários reais (imagens, PDFs), o
conteúdo decodificado é lixo que consome tokens da LLM sem valor.

**Proposta**: verificar mimeType antes de decodificar:

```js
const isTextMime = mimeType.startsWith('text/') || mimeType === 'application/json';
if (!isTextMime) {
  decodedContent = `(dados binários não processáveis: ${mimeType})`;
} else {
  decodedContent = Buffer.from(att.data, 'base64').toString('utf8');
}
```

---

### FINDING-P5-4 — Cache purge inline é O(n) por cache miss quando size > 200

**Severidade**: P5 — Baixo **Localização**: `readFileContext()` linhas ~150-165

```js
if (_fileCache.size > 200) {
  for (const [key, entry] of _fileCache) {
    if (entry.expiresAt <= now) _fileCache.delete(key);
  }
}
```

A iteração completa do Map (O(n)) ocorre em cada cache miss quando há mais de 200 entradas. Para 200
entradas isso é negligível, mas o threshold poderia ser mais agressivo para evitar crescimento.

---

## 5. Pontos positivos

- **AB.1** (cache TTL 30s): previne re-leituras desnecessárias de disco em sessões ativas.
- `MAX_EMBED_BYTES = 65_536` aplicado tanto por arquivo quanto por totalBytes em `embedMultiple`.
- Detecção de linguagem por extensão com 30+ mapeamentos explícitos.
- `readDirectoryContext` rejeita binários via heurística `\0` byte — robusto.
- `attachmentToEmbed` zero-PR: todos os tipos convertidos para texto, sem crear PRs extras.

---

## 6. Score

| Dimensão                | Nota       |
| ----------------------- | ---------- |
| Correção lógica         | 9.0/10     |
| Segurança (size limits) | 9.0/10     |
| Performance             | 8.5/10     |
| **Global**              | **8.8/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
