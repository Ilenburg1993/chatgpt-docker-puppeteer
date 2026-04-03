# Auditoria: hooks/prompt-transformer.js

**ID de rastreamento**: F06-08 **Arquivo**: `src/copilot/hooks/prompt-transformer.js` **LOC**: 145
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                                     |
| ----------- | ----------------------------------------- |
| Caminho     | `src/copilot/hooks/prompt-transformer.js` |
| Módulo pai  | `#copilot/hooks`                          |
| Exportações | 4 funções públicas                        |
| Importações | logger                                    |

---

## 2. Contexto no Módulo

Implementa o **Gap 1** do SDK: retorno de `modifiedPrompt` em `onUserPromptSubmitted`. Permite
sanitização de PII, truncamento de prompts longos e injeção de contexto. Exporta handlers de alto
nível que podem ser usados diretamente como `onUserPromptSubmitted`.

---

## 3. Análise Estrutural

### 3.1 Fluxo de transformação

```js
export function createPromptTransformer({ sensitivePattern, transformFn }) {
  return async function onUserPromptSubmitted(input) {
    let { prompt } = input;
    if (sensitivePattern) prompt = prompt.replace(sensitivePattern, '[REDACTED]');
    const transformed = transformFn ? transformFn(prompt) : null;
    return transformed ? { modifiedPrompt: transformed } : {};
  };
}
```

Fluxo correto. `transformFn` retornar `null` preserva o prompt original. ✅

### 3.2 createSensitiveDataRedactor

```js
const SENSITIVE_PATTERN =
  /Bearer\s+\S+|api[-_]key\s*[:=]\s*\S+|token\s*[:=]\s*\S+|password\s*[:=]\s*\S+|secret\s*[:=]\s*\S+/gi;
```

Padrão razoável mas incompleto. Não detecta:

- JWT encoded (só três segmentos `xxxxx.yyyyy.zzzzz`)
- AWS keys (`AKIA...`)
- Chaves GitHub `ghp_`, `gho_`, `ghu_`

### 3.3 createContextInjector

```js
return async function onUserPromptSubmitted(input) {
  return { modifiedPrompt: `${contextPrefix}\n\n${input.prompt}` };
};
```

Sempre modifica prompt — mesmo quando `contextPrefix` é string vazia. Deveria guardar vazio. ✅
(baixo impacto)

---

## 4. Issues Encontrados

| ID         | Tipo | Sev | Descrição                                                   |
| ---------- | ---- | --- | ----------------------------------------------------------- |
| SEC-PT-001 | SEC  | P3  | SENSITIVE_PATTERN não detecta JWT, AWS keys e tokens GitHub |
| UPG-PT-001 | UPG  | P4  | createContextInjector injeta mesmo com contextPrefix vazio  |

---

## 5. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                |
| ---------------- | ------- | ---------------------------- |
| Corretude        | 8.5     | Lógica de transform correta  |
| Segurança        | 7.5     | Padrão de redação incompleto |
| Arquitetura      | 9.0     | Bem desacoplado              |
| Manutenibilidade | 9.0     | Limpo                        |
| Performance      | 9.0     | Regex global precompilados   |
| Testabilidade    | 9.0     | Funções puras                |
| **Média**        | **8.7** |                              |

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-PT-001 — Padrões JWT, AWS keys e tokens GitHub adicionados ao SENSITIVE_PATTERN

SENSITIVE_PATTERN agora inclui:

- JWT (3-part base64url: eyJ*.eyJ*.\*)
- AWS Access Key IDs (AKIA/ASIA/ABIA[A-Z0-9]{16})
- AWS Secret Access Key via padrão
- Tokens GitHub (ghp*/ghs*/gho*/ghr*/github*pat* com 36+ caracteres)

### [IMPROVED] UPG-PT-001 — createContextInjector com prefix/suffix vazios retorna identidade

Adicionado early return quando prefix e suffix são ambos vazios, evitando transformar o prompt
desnecessariamente com template literal vazio.

**Pontuação atualizada: 9.2/10**
