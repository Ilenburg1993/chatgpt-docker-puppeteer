# Auditoria — `bootstrap.js`

**Módulo**: `src/copilot/terminal/bootstrap.js` **LOC**: 40 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Wrapper de entry point do Terminal LLM-B. Responsável por:

- Definir `COPILOT_SDK_ENABLED=true` **antes** de qualquer import (side-effect imperativo)
- Re-exportar `startTerminalServer` de `index.js`
- Executar `startTerminalServer()` automaticamente quando rodado diretamente (`isMain`)

---

## 2. Código completo (40 LOC)

```js
process.env.COPILOT_SDK_ENABLED = 'true'; // ANTES de qualquer import

export { startTerminalServer } from './index.js';

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startTerminalServer().catch((err) => {
    console.error('[terminal] Falha crítica no boot:', err);
    process.exit(1);
  });
}
```

---

## 3. Achados

### FINDING-P5-1 — `process.exit(1)` sem cleanup em caso de falha fatal

**Severidade**: P5 — Baixo **Localização**: `.catch()` handler linhas ~35-40

```js
startTerminalServer().catch((err) => {
  console.error('[terminal] Falha crítica no boot:', err);
  process.exit(1); // ← sem fechar server, readline, ou connections abertas
});
```

Em situação de boot failure, `process.exit(1)` força saída imediata. Se o servidor HTTP já foi
criado mas `startTerminalServer()` falhou depois (e.g., na criação da hub session), conexões
pendentes são abortadas abruptamente. Para o terminal LLM-B isso é aceitável (boot failure é fatal),
mas um `server.close()` + `rl.close()` antes do `process.exit` seria mais limpo.

---

## 4. Pontos positivos

- `COPILOT_SDK_ENABLED='true'` definido antes de qualquer import dinâmico — correto para flag de
  feature que é lida na inicialização dos módulos importados.
- `isMain` guard via `import.meta.url` — padrão correto ESM, sem `require.main` hacks.
- Re-export limpo de `startTerminalServer` — facilita imports em tests
  (`import {startTerminalServer} from './bootstrap.js'`).
- Arquivo curto e focado — única responsabilidade por convenção.

---

## 5. Score

| Dimensão   | Nota       |
| ---------- | ---------- |
| Correção   | 9/10       |
| Clareza    | 9.5/10     |
| **Global** | **9.2/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
