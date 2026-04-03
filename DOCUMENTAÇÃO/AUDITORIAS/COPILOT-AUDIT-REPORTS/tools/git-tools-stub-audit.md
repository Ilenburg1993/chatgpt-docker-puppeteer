# Audit: src/copilot/tools/git-tools.js

**Módulo**: `copilot/tools` **Arquivo**: `src/copilot/tools/git-tools.js` **LOC**: 11 **Data**:
2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Stub de compatibilidade. Apenas re-exporta `gitTools` de `./git/index.js`. Marcado com
`@deprecated`. Mantido para callers que importavam de `git-tools.js` diretamente antes da
reorganização em sub-pasta.

**Score**: N/A (compatibilidade)

---

## Achados

### P4 — Stub Deprecated Mantido sem Plano de Remoção

**Localização**: Todo o arquivo.

Não há comentário com data de remoção planejada ou referência a issue. Em crescimento do projeto,
stubs deprecated tendem a se perpetuar.

**Recomendação**: Adicionar `@since vX.X.X @removal vY.Y.Y` no JSDoc ou abrir issue de rastreamento
para remoção.

---

## Positivos

- `@deprecated` documentado no JSDoc — callers são avisados
- Re-export puro sem lógica adicional — sem risco de side-effects
