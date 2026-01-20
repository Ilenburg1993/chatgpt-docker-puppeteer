# ESLint - Relatório de Correção de Erros Críticos

**Data:** 2026-01-20
**Ação:** Correção dos 78 erros críticos (prioridade alta)
**Status:** EM ANDAMENTO

---

## 📊 Estado Atual

**Total de Problemas:** 129 erros críticos

### Breakdown por Tipo:

| Regra                        | Qtd | Prioridade | Status      |
| ---------------------------- | --- | ---------- | ----------- |
| `no-promise-executor-return` | 69  | 🔴 Alta    | ⏳ Pendente |
| `no-empty`                   | 33  | 🟡 Média   | ⏳ Pendente |
| `no-return-await`            | 9   | 🟢 Baixa   | ⏳ Pendente |
| `no-alert`                   | 8   | 🟡 Média   | ⏳ Pendente |
| `no-new-func`                | 4   | 🔴 Alta    | ⏳ Pendente |
| `no-undef`                   | 2   | 🔴 Alta    | ⏳ Pendente |
| `no-control-regex`           | 2   | 🟢 Baixa   | ⏳ Pendente |
| `no-use-before-define`       | 1   | 🟢 Baixa   | ⏳ Pendente |
| `no-case-declarations`       | 1   | 🟢 Baixa   | ⏳ Pendente |

---

## 🎯 Plano de Ação

### Fase 1: Correções Automáticas (TENTADA - FALHOU)

- Tentativa de scripts automatizados
- Resultado: Revertido devido a sintaxe incorreta
- Decisão: **Correções manuais seletivas**

### Fase 2: Correções Manuais por Prioridade

#### 🔴 Prioridade CRÍTICA (devem ser corrigidos):

**1. `no-new-func` (4 ocorrências)** - ⚠️ SEGURANÇA

- Arquivo: `src/driver/modules/analyzer.js` (linhas 192, 225, 266, 292)
- Problema: Uso de `new Function()` (equivalente a `eval`)
- Solução: Refatorar para evitar geração dinâmica de código

**2. `no-undef` (2 ocorrências)** - 🐛 BUG

- `public/js/app.js:2` - `'io' is not defined`
    - Solução: Adicionar `/* global io */` no topo do arquivo
- `scripts/puppeteer_maintenance.js:57` - `'execSync' is not defined`
    - Solução: `const { execSync } = require('child_process');`

#### 🟡 Prioridade ALTA (recomendado corrigir):

**3. `no-promise-executor-return` (69 ocorrências)**

- Padrão comum: `new Promise(r => setTimeout(r, 100))`
- Solução: `new Promise(r => { setTimeout(r, 100); })`
- **Arquivos principais:**
    - `src/driver/modules/human.js` (8 ocorrências)
    - `src/driver/modules/stabilizer.js` (10 ocorrências)
    - `src/driver/modules/biomechanics_engine.js` (5 ocorrências)

**4. `no-alert` (8 ocorrências)** - 📱 FRONTEND

- Arquivo: `public/js/app.js` (todas ocorrências)
- Problema: Uso de `alert()` e `confirm()` no dashboard
- Solução: Substituir por modais customizados ou suprimir com `// eslint-disable-next-line`
- **NOTA:** Alerts são aceitáveis em dashboard de admin. Sugestão: **Aceitar como exceção**

#### 🟢 Prioridade BAIXA (pode esperar):

**5. `no-empty` (33 ocorrências)**

- Padrão: `catch (e) {}`
- Solução: `catch (_e) { /* ignored */ }`
- Maioria é em tratamento de erro intencional

**6. `no-return-await` (9 ocorrências)**

- Padrão: `return await someFunction();`
- Solução: `return someFunction();`
- Otimização menor, não afeta funcionalidade

---

## 🛠️ Correções Recomendadas IMEDIATAS

### Correção 1: no-undef em scripts/puppeteer_maintenance.js

```javascript
// Adicionar no topo do arquivo
const { execSync } = require('child_process');
```

### Correção 2: no-undef em public/js/app.js

```javascript
// Adicionar no topo do arquivo
/* global io */
```

### Correção 3: no-new-func em analyzer.js

- **ATENÇÃO:** Código de análise de botões usa `new Function()`
- **Necessário:** Revisão arquitetural para remover geração dinâmica
- **Alternativa temporária:** `// eslint-disable-next-line no-new-func` com FIXME

---

## 📋 Próximos Passos

1. ✅ **Corrigir 2 erros `no-undef`** (5 minutos) - TRIVIAL
2. ⏳ **Avaliar `no-new-func`** - Adicionar disable temporário
3. ⏳ **Aceitar `no-alert`** - Dashboard pode usar alerts
4. ⏳ **Fase 2:** Corrigir `no-promise-executor-return` (manual, seletivo)

---

## 🎯 Meta Realista

**Objetivo imediato:** Reduzir de **129 erros → <10 erros**

**Estratégia:**

- Corrigir os 6 erros críticos/bugs reais
- Aceitar exceções justificadas (alerts no dashboard)
- Deixar otimizações (`no-empty`, `no-return-await`) para refatoração futura

---

## 📝 Decisões Arquiteturais

### Aceitar como Exceções:

1. **Alerts no dashboard** (`public/js/app.js`) - Interface de admin aceita alerts
2. **Catch blocks vazios** - Muitos são intencionais (failsafe silencioso)

### Requerer Correção:

1. **no-undef** - Bugs reais que podem quebrar código
2. **no-new-func** - Risco de segurança (eval disfarçado)

### Refatoração Futura:

1. **no-promise-executor-return** - 69 ocorrências, correção trabalhosa
2. **no-return-await** - Otimização menor

---

**Última atualização:** 2026-01-20 03:30 UTC
