# core/index.js — Auditoria

**Módulo**: `src/copilot/core/` **Arquivo**: `index.js` **LOC**: 23 | **Score**: 9.5/10

## Responsabilidade

Barrel: ponto de entrada único para `#copilot/core`. Re-exporta:

- `../types/index.js` — StructuredMessage (também auditado em F18 types/)
- `./constants.js` — constantes centralizadas
- `./errors.js` — hierarquia de erros

## Achados

Nenhum.

## Destaques Positivos

- Alias `#copilot/core` reduz acoplamento a caminhos relativos profundos
- Documentação clara dos sub-módulos disponíveis no JSDoc

---

## Status de Correção

### [FIXED] INC-CORE-002 — Re-export de `../types/index.js` removido

A linha `export * from '../types/index.js'` foi removida por violar a separação de camadas (core não
deve re-exportar types). Nenhum consumidor importava types via `#copilot/core`. Testes 2049/0 após
remoção.

Barrel agora re-exporta apenas:

- `./constants.js`
- `./errors.js`

**Score atualizado: 9.5/10** (sem impacto — era uma linha desnecessária)

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
