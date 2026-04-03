# pinned-files-loader.js — Auditoria

**Módulo**: `src/copilot/config/` **Arquivo**: `pinned-files-loader.js` **LOC**: 261 | **Score**:
8.5/10

## Responsabilidade

`PinnedFilesLoader extends EventEmitter` — carrega e monitora arquivos de contexto para injeção em
novas sessões. Usa `fs.watch` com debounce de 500ms para detectar mudanças em tempo real.

API pública: `start()`, `stop()`, `getFiles()`, `buildContext()`, evento `changed`.

## ACHADO C12-05 — P5

**Watcher Linux não monitora subdirs de segunda profundidade**

```js
if (!supportsRecursive) {
    // Apenas subdirs de primeiro nível:
    for (const entry of readdirSync(dir)) {
        const subPath = join(dir, entry);
        if (!statSync(subPath).isDirectory()) continue;
        watch(subPath, ...);
        // subPath/nested/*.md NÃO é monitorado
    }
}
```

Em DevContainer (Linux), apenas `dir/` e `dir/subdir/` são monitorados. Arquivos em
`dir/subdir/nested/` não disparam eventos `changed`.

Se `PinnedFilesLoader` for usado com estrutura hierárquica de contexto (ex:
`.github/context/ guides/`), mudanças em arquivos nested serão invisíveis.

## Destaques Positivos

- BUG-CRIT-07 fix: compatibilidade Linux para `fs.watch` sem `recursive` nativo
- `#debounceTimers` em Map — garante que múltiplos eventos rápidos resultem em um único reload
- `stop()` limpa TODOS os timers e watchers — sem memory leak
- `watcher.on('error')` com handler — previne crash por diretório removido
- `#loadFile` async com readFile não-blocking — correto; `#loadDir` usa `Promise.all` para
  paralelismo
- `buildContext()` formata com delimitadores `<!-- pinned:path -->` para identificação clara no
  contexto

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
