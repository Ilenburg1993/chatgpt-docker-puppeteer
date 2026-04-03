# Auditoria — `alias-store.js`

**Módulo**: `src/copilot/bridges/alias-store.js` **LOC**: 200 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Gerenciamento de aliases de comandos do terminal REPL LLM-B. Suporta:

- Aliases built-in não-removíveis (`/st`, `/glog`, `/issues`, etc.)
- Aliases custom persistidos em `~/.copilot-aliases.json` (env: `LLM_B_ALIASES_FILE`)
- Resolução em cadeia com detecção de ciclos (BUG-LEVE-06)

---

## 2. Arquitetura

```
loadAliases() ← chamado em startTerminalServer
 └── readFileSync(ALIASES_FILE) → merge builtin + custom → _aliases

resolve(input) → 5-level chain resolution com seen-Set para ciclos
setAlias(name, command) → cycle detection em testAliases → _aliases + saveCustomAliases
removeAlias(name) → delete → saveCustomAliases
resetAliases() → _aliases = {...BUILTIN_ALIASES} → saveCustomAliases
```

---

## 3. Achados

### FINDING-P5-1 — `loadAliases` e `saveCustomAliases` usam sync I/O

**Severidade**: P5 — Baixo **Localização**: `loadAliases()` linha ~44, `saveCustomAliases()` linha
~64

```js
const raw = fs.readFileSync(ALIASES_FILE, 'utf8'); // bloqueia event loop
fs.writeFileSync(ALIASES_FILE, JSON.stringify(custom, null, 2)); // bloqueia event loop
```

`loadAliases()` é chamado durante o boot (`startTerminalServer`), quando a sincronia é aceitável
(antes do servidor HTTP estar ouvindo). `saveCustomAliases` é chamado com baixa frequência (em
`setAlias`, `removeAlias`, `resetAliases`). O impacto prático é mínimo — a troca por async não
traria benefícios significativos dado o padrão de uso.

---

### FINDING-P5-2 — `saveCustomAliases` silencia erros de escrita

**Severidade**: P5 — Baixo **Localização**: `saveCustomAliases()` linhas ~70-75

```js
try {
  fs.writeFileSync(ALIASES_FILE, JSON.stringify(custom, null, 2));
} catch {
  // silently ignore write errors
}
```

Se o arquivo de aliases não puder ser escrito (permissão negada, disco cheio), o usuário não recebe
nenhum feedback. O alias é aplicado na sessão mas perdido no próximo restart.

**Proposta**: expor o erro para o caller e logar:

```js
} catch (err) {
    log('WARN', `[alias-store] Falha ao salvar aliases em ${ALIASES_FILE}: ${err.message}`);
}
```

---

## 4. Pontos positivos

- **BUG-LEVE-06**: detecção de ciclo de alias em `resolve()` (loop `seen` Set) e em `setAlias()`
  (pre-check em `testAliases`) — sólido.
- `LLM_B_ALIASES_FILE` via env — testável e configurável.
- `formatAliases()` com cores ANSI e marcação `[builtin]` vs `[custom]` — boa UX.
- `getAliases()` retorna cópia defensiva (`{ ..._aliases }`) — sem aliasing externo.
- `resetAliases()` restaura built-ins sem recarregar do arquivo — comportamento previsível.

---

## 5. Score

| Dimensão        | Nota       |
| --------------- | ---------- |
| Correção lógica | 9/10       |
| Robustez        | 8/10       |
| **Global**      | **8.5/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
