# PARTE-22E — Critérios e Métricas: Definição Rigorosa de "Pronto"

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 1.0  
**Scope**: Definição formal de critérios de conclusão para cada dimensão arquitetural  
**Princípio**: Cada critério é verificável por script ou ferramenta — sem avaliação subjetiva

---

## 1. Filosofia dos Critérios PARTE-22

### 1.1 Diferença Entre PARTE-21 e PARTE-22

| Dimensão               | PARTE-21 (permissivo)               | PARTE-22 (rigoroso)                          |
|------------------------|-------------------------------------|----------------------------------------------|
| Tamanho de arquivo     | "Preferir ≤300 LoC quando possível" | **ZERO arquivos de lógica >250 LoC**         |
| EventEmitter           | "Migrar progressivamente"           | **ZERO EventEmitter direto — CI bloqueia**   |
| Singletons             | "Refinamento via exclusões"         | **Sem exclusões retroativas — DI ou constante** |
| Score                  | Pode subir refinando métricas       | **Score só pode subir resolvendo problemas** |
| TypeCheck              | "Baseline pré-existente, não alterar" | **Zero erros, sem baseline**               |
| Deep imports           | "Refinamento via lista allow"       | **Zero, sem lista de exclusões**             |
| Test coverage          | "Exists test files"                 | **Coverage funcional ≥70% por módulo**       |

### 1.2 Regra Primeira: Nunca Calibrar Critérios Para Cima

> Uma métrica só pode ser recalibrada para ser **mais exigente**, nunca mais leniente.  
> Se um critério foi relaxado no passado (ex.: fan-out via exclusão de intra-módulo), isso é legítimo  
> SE corrigiu uma imprecisão de medição — mas NÃO se foi feito para inflar o score sem realizar trabalho.

---

## 2. Critérios por Dimensão

### 2.1 CRITÉRIO C1 — Tamanho de Arquivo

**Métrica:** Contagem de LoC de lógica por arquivo (`*.js` em `src/copilot/`)  
**Threshold:** `0` arquivos com **LoC > 250** (exceto tipos puros e barrels)

**Script de verificação:**
```bash
#!/bin/bash
# Verifica god files — falha se houver arquivo de lógica >250 LoC
VIOLATIONS=0
for file in $(find src/copilot -name "*.js" \
    ! -name "index.js" \
    ! -name "types.js" \
    ! -name "*.test.js" \
    ! -name "constants.js"); do
  LOC=$(wc -l < "$file")
  if [ "$LOC" -gt 250 ]; then
    echo "VIOLATION: $file has $LOC LoC (max 250)"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done
exit $VIOLATIONS
```

**Exceções permitidas (documentadas):**
- `sdk/types.js` — typedefs puros (≤600 LoC aceito)
- `*/index.js` combarrel > 250 — só re-exports, sem lógica
- `*/constants.js` — constantes puras

**Estado atual:** 17 violações  
**Estado target:** 0 violações

---

### 2.2 CRITÉRIO C2 — Zero EventEmitter Direto

**Métrica:** Contagem de arquivos com `new EventEmitter()` ou `extends EventEmitter`  
**Threshold:** `0` arquivos

**Script de verificação:**
```bash
#!/bin/bash
COUNT=$(grep -rl "new EventEmitter\|extends EventEmitter" src/copilot/ \
    --include="*.js" | grep -v "\.test\." | wc -l)
echo "EventEmitter direto: $COUNT arquivos"
[ "$COUNT" -eq 0 ] && echo "PASS" || { echo "FAIL"; exit 1; }
```

**Estado atual:** 8 arquivos  
**Estado target:** 0

**Nota:** `hooks/bus.js` atualmente estende EventEmitter para implementar o bus. Se o próprio bus usa EventEmitter como implementação interna (encapsulado), é aceitável — contanto que o módulo não exporte EventEmitter como interface. A checagem deve ser por interface pública, não implementação.

---

### 2.3 CRITÉRIO C3 — EventBus Adoption Rate

**Métrica:** % de arquivos que emitem eventos cross-módulo usando `getEventBus()` vs total de arquivos que emitem eventos  
**Threshold:** ≥ 80% dos arquivos que emitem eventos cross-módulo usam EventBus

**Método de verificação:**
1. Listar arquivos com `emit(` → candidatos que emitem eventos
2. De esses, contar quantos usam `getEventBus` ou `EventBus` importados
3. Contar quantos usam EventEmitter direto cross-módulo

**Estado atual:** ~13 de 21 que emitem = 62% (mas muitos emissores estão em EventEmitter)  
**Estado target:** ≥80% de todos os emissores cross-módulo

---

### 2.4 CRITÉRIO C4 — DI Container Coverage

**Métrica:** Número de tokens DI registrados no container  
**Threshold:** ≥ 40 tokens

**Script de verificação:**
```bash
node -e "
import('#copilot/core').then(m => {
  const tokens = Object.keys(m.DI_TOKENS || m.diTokens || {});
  console.log('DI tokens:', tokens.length);
  process.exit(tokens.length >= 40 ? 0 : 1);
});
" 2>/dev/null || node scripts/arch-health.mjs --json | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const j=JSON.parse(d);
console.log('DI tokens:', j.diTokens);
process.exit(j.diTokens >= 40 ? 0 : 1);
"
```

**Estado atual:** 13 tokens  
**Estado target:** ≥ 40 tokens

---

### 2.5 CRITÉRIO C5 — Zero Deep Imports

**Métrica:** Número de imports que bypassam barrels (`from '#copilot/módulo/sub/path'`)  
**Threshold:** `0` deep imports em qualquer arquivo de produção

**Script de verificação:**
```bash
#!/bin/bash
# Detecta imports que têm mais de 1 segmento após #copilot/
COUNT=$(grep -rh "from '#copilot/" src/copilot/ --include="*.js" | \
    grep -oP "from '#copilot/[^']*'" | \
    grep -P "#copilot/[^/']+/[^'\"]+'" | \
    grep -v "nerv-bridge" | wc -l)
echo "Deep imports: $COUNT"
[ "$COUNT" -eq 0 ] && echo "PASS" || { echo "FAIL"; exit 1; }
```

**Estado atual:** 4 refinados  
**Estado target:** 0

---

### 2.6 CRITÉRIO C6 — Zero TypeCheck Errors

**Métrica:** Saída do `npm run typecheck:node` — contagem de erros  
**Threshold:** `0` erros (sem lista de exclusões, sem "baseline pré-existente")

**Script de verificação:**
```bash
#!/bin/bash
ERRORS=$(npm run typecheck:node 2>&1 | grep "error TS" | wc -l)
echo "TypeCheck errors: $ERRORS"
[ "$ERRORS" -eq 0 ] && echo "PASS" || { echo "FAIL"; exit 1; }
```

**Estado atual:** 16 erros (em rpc-ops.js, rpc-session.js)  
**Estado target:** 0

---

### 2.7 CRITÉRIO C7 — Test Coverage ≥ 70% por Módulo

**Métrica:** Branch/line coverage por módulo medida via vitest/c8  
**Threshold:** ≥ 70% em cada módulo com ≥ 300 LoC de lógica  
**Módulos críticos:** agent, sdk, terminal, tools, observability, hooks, bridges, api, services, conversation-hub

**Verificação:**
```bash
npx vitest run --coverage --reporter=json 2>/dev/null | \
  node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const modules = ['agent','sdk','terminal','tools','observability','hooks','bridges','api','services'];
let fail = false;
Object.entries(data.coverageMap || {}).forEach(([file, cov]) => {
  const mod = file.match(/src\/copilot\/([^\/]+)\//)?.[1];
  if (!mod || !modules.includes(mod)) return;
  const pct = cov.s ? Object.values(cov.s).filter(Boolean).length / Object.values(cov.s).length * 100 : 0;
  if (pct < 70) { console.log('LOW COVERAGE:', mod, file, pct.toFixed(1)+'%'); fail = true; }
});
process.exit(fail ? 1 : 0);
"
```

**Estado atual:** ~30% estimado (sem measurement formal)  
**Estado target:** ≥ 70% nos módulos críticos

---

### 2.8 CRITÉRIO C8 — Fan-out Máximo ≤ 8

**Métrica:** Fan-out inter-módulo (imports `#copilot/MODULE`) por módulo  
**Threshold:** `0` módulos com fan-out > 8

**Script de verificação:**
```bash
node scripts/arch-health.mjs --json | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
let fail=false;
Object.entries(d.fanOut?.details || {}).forEach(([mod, fo]) => {
  if (fo > 8) { console.log('FAIL fan-out:', mod, fo); fail=true; }
});
process.exit(fail ? 1 : 0);
"
```

**Estado atual:** terminal=10, api=8 (borderline)  
**Estado target:** nenhum > 8

---

### 2.9 CRITÉRIO C9 — Singletons Lazy-Init ≤ 15

**Métrica:** Contagem de `let x = null` / `let x = false` module-scope que não são constantes nem loggers  
**Threshold:** ≤ 15 total no codebase

**Script de verificação:**
```bash
# Conta singletons lazy
COUNT=$(grep -rn "^let " src/copilot/ --include="*.js" | \
    grep -v "\.test\." | \
    grep -E "= null;$|= false;$|= 0;$|= \[\];$|= '';$" | \
    grep -vE "log|logger|level|dir|exitHandlerRegistered|_?sseEventIdCounter|_recordCompaction" | \
    wc -l)
echo "Singletons lazy-init: $COUNT"
[ "$COUNT" -le 15 ] && echo "PASS" || { echo "FAIL (target: ≤15)"; exit 1; }
```

**Estado atual:** 53 refined  
**Estado target:** ≤ 15

---

### 2.10 CRITÉRIO C10 — services/ Coverage ≥ 80%

**Métrica:** % de casos de uso de L5/L6 que passam por services/ (não importam L4 diretamente)  
**Threshold:** api/ e terminal/ não importam de agent/, conversation-hub/, channel/ diretamente

**Script de verificação:**
```bash
#!/bin/bash
VIOLATIONS=0

echo "api/ → L4 direto:"
grep -rn "from '#copilot/agent\|from '#copilot/conversation-hub\|from '#copilot/channel" \
    src/copilot/api/ --include="*.js" | grep -v "\.test\." | head -10
VIOLATIONS=$((VIOLATIONS + $?))

echo "terminal/ → L4 direto:"
grep -rn "from '#copilot/agent\|from '#copilot/conversation-hub\|from '#copilot/channel" \
    src/copilot/terminal/ --include="*.js" | grep -v "\.test\." | head -10
VIOLATIONS=$((VIOLATIONS + $?))

[ "$VIOLATIONS" -eq 0 ] && echo "PASS" || { echo "FAIL"; exit 1; }
```

**Estado atual:** api/ importa agent/ em 2 arquivos, terminal/ importa agent/ em ~11 arquivos  
**Estado target:** 0 imports diretos de L5/L6 para L4

---

### 2.11 CRITÉRIO C11 — events/ Module Adoption

**Métrica:** % de strings de evento inline que foram migradas para `#copilot/events`  
**Threshold:** 0 strings inline de evento cross-módulo

**Script de verificação:**
```bash
#!/bin/bash
# Detecta strings que parecem nomes de evento (namespace:action pattern)
INLINE=$(grep -rn "'\(agent:\|hub:\|terminal:\|system:\|dialog:\|audit:\|rpc:\)" \
    src/copilot/ --include="*.js" | grep -v "\.test\." | grep -v "#copilot/events" | wc -l)
echo "Inline event strings: $INLINE"
[ "$INLINE" -eq 0 ] && echo "PASS" || { echo "FAIL (target: 0)"; exit 1; }
```

**Estado atual:** events/ não existe — 100% são inline  
**Estado target:** 0 inline

---

### 2.12 CRITÉRIO C12 — Circuit Breakers ≥ 6

**Métrica:** Número de circuit breakers ativos no sistema  
**Threshold:** ≥ 6 circuit breakers (um por cada dependência externa crítica)

**Verificação via health endpoint:**
```bash
# Após startup:
curl -s http://localhost:3001/health | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const cbs = (d.circuitBreakers || []).length;
console.log('Circuit breakers:', cbs);
process.exit(cbs >= 6 ? 0 : 1);
"
```

**Dependências externas que requerem CB:** SDK calls, NERV bridge, MCP server (já existe), GitHub CLI, SSE connections, SQLite writes  
**Estado atual:** 1 (MCP)  
**Estado target:** ≥ 6

---

### 2.13 CRITÉRIO C13 — Zero Layer Violations (Expandido)

**Métrica:** Violações de camada incluindo bypass de services/ (novo critério)  
**Threshold:** 0 violações nos dois sentidos:
1. Violação de ordem (L5 → L3 skip — já verificado)
2. Bypass de services/ facade (L5/L6 → L4 direto)

**Script:** Os dois critérios de C10 + checagem original de `arch-health.mjs`  
**Estado atual:** 0 (ordem) + 3 (bypass services/)  
**Estado target:** 0 em ambos

---

## 3. Score PARTE-22 — Fórmula

```
Score = sum(peso_i * atingiu_i) para todo critério i
```

| ID  | Critério                          | Peso | Score se atingido |
|-----|-----------------------------------|------|-------------------|
| C1  | Zero god files >250 LoC           | 20   | 20                |
| C2  | Zero EventEmitter direto          | 10   | 10                |
| C3  | EventBus adoption ≥ 80%           | 10   | 10                |
| C4  | DI tokens ≥ 40                    | 8    | 8                 |
| C5  | Zero deep imports                 | 5    | 5                 |
| C6  | Zero typecheck errors             | 7    | 7                 |
| C7  | Test coverage ≥ 70%               | 15   | 15                |
| C8  | Fan-out máximo ≤ 8                | 5    | 5                 |
| C9  | Singletons ≤ 15                   | 5    | 5                 |
| C10 | services/ coverage ≥ 80%          | 7    | 7                 |
| C11 | events/ adoption (0 inline)       | 5    | 5                 |
| C12 | Circuit breakers ≥ 6              | 3    | 3                 |
| C13 | Zero layer violations (expandido) | — (incluído em C10) | — |
| **Total** |                         | **100** | **100**        |

### 3.1 Score Atual

| ID  | Critério                          | Peso | Atingido? | Parcial | Score |
|-----|-----------------------------------|------|-----------|---------|-------|
| C1  | Zero god files                    | 20   | Não       | 0%      | 0     |
| C2  | Zero EventEmitter direto          | 10   | Não       | 0%      | 0     |
| C3  | EventBus adoption ≥ 80%           | 10   | Não       | 4%→0    | 0     |
| C4  | DI tokens ≥ 40                    | 8    | Não       | 32%     | 2.5   |
| C5  | Zero deep imports                 | 5    | Não       | 0%      | 0     |
| C6  | Zero typecheck errors             | 7    | Não       | 0%      | 0     |
| C7  | Test coverage ≥ 70%               | 15   | Não       | ~43%    | 4     |
| C8  | Fan-out máximo ≤ 8                | 5    | Parcial   | 80%     | 4     |
| C9  | Singletons ≤ 15                   | 5    | Não       | 28%     | 1.5   |
| C10 | services/ coverage ≥ 80%          | 7    | Não       | 20%     | 1     |
| C11 | events/ adoption                  | 5    | Não       | 0%      | 0     |
| C12 | Circuit breakers ≥ 6              | 3    | Não       | 17%     | 0.5   |
| **TOTAL** |                         | 100  |           |         | **13.5/100** |

> **O score real da PARTE-22 antes de executar qualquer faixa é 13.5/100 (F)**  
> Isso é mais honesto que o 24/100 estimado na PARTE-22A (que ainda tinha scoring parcial).

---

## 4. Critérios de Conclusão por Faixa (PARTE-22C)

Cada faixa tem critérios de conclusão específicos que devem ser verificados antes de commitar:

| Faixa | Critério de conclusão verificável                              | Script/Método                     |
|-------|----------------------------------------------------------------|-----------------------------------|
| O1    | `arch-health.mjs` → deepImports.refined = 0                   | `arch-health.mjs --json \| jq`    |
| O2    | `arch-health.mjs` → diTokens ≥ 30                             | `arch-health.mjs --json \| jq`    |
| O3    | `wc -l src/copilot/agent/always-alive.js` ≤ 150               | `wc -l`                           |
| O4    | `wc -l src/copilot/agent/dialog/loop-manager.js` ≤ 150        | `wc -l`                           |
| O5    | `npm run typecheck:node` saída 0 erros                        | CI check                          |
| O6    | `core/cache.js`, `core/mutex.js`, `core/timer-registry.js` existem com testes | `ls` + `npm test` |
| O7    | `GET /health` retorna 4+ circuit breakers                     | curl + assert                     |
| P1    | `src/copilot/events/` tem 6+ arquivos, HUB_EVENTS importado de lá | `ls` + grep               |
| P2    | `grep -rl "new EventEmitter" src/copilot/` = 0 results        | grep count                        |
| P3    | 9 service files existem, api/ e terminal/ usam 4+ deles       | grep + ls                         |
| P4    | Todos arquivos conv-hub/ ≤ 250 LoC                            | wc -l + awk                       |
| P5    | Todos arquivos terminal/ de lógica ≤ 250 LoC                  | wc -l + awk                       |
| P6    | Todos arquivos observability/ ≤ 250 LoC                       | wc -l + awk                       |
| P7    | Todos hooks/ e tools/ arquivos ≤ 250 LoC                      | wc -l + awk                       |
| P8    | api/express/ todos ≤ 150 LoC, sem import a L4               | wc -l + grep                      |
| Q1    | Coverage agent/ ≥ 70% nos arquivos críticos                   | vitest --coverage                 |
| Q2    | Coverage terminal/ + api/ ≥ 70%                              | vitest --coverage                 |
| Q3    | Coverage sdk/ + bridges/ + observability/ ≥ 70%              | vitest --coverage                 |
| Q4    | audit/ tem pipeline-wal.js com replay + testes               | ls + grep + test                  |
| Q5    | `/health` retorna JSON estruturado com status de todos CBs   | curl + assert                     |
| R1    | Zero strings inline de evento (C11 PASS)                     | grep                              |
| R2    | `container.fork()` existe, 2 agents em paralelo no test      | test passa                        |
| R3    | Score PARTE-22 ≥ 90/100 em todos critérios C1-C12            | script consolidado                |

---

## 5. Script Consolidado de Verificação (health-check-parte22.mjs)

Este script deve ser criado em `scripts/health-check-parte22.mjs` e executado a cada faixa:

```js
#!/usr/bin/env node
// scripts/health-check-parte22.mjs
// Verificação consolidada dos critérios PARTE-22

import { execSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const results = {};
let totalScore = 0;
let maxScore = 0;

function check(id, label, weight, fn) {
    maxScore += weight;
    try {
        const { score, detail } = fn();
        results[id] = { label, weight, score, detail, pass: score === weight };
        totalScore += score;
    } catch(e) {
        results[id] = { label, weight, score: 0, detail: e.message, pass: false };
    }
}

// C1: Zero god files >250 LoC
check('C1', 'Zero god files >250 LoC', 20, () => {
    const out = execSync(
        "find src/copilot -name '*.js' ! -name 'index.js' ! -name 'types.js' ! -name 'constants.js' | " +
        "xargs wc -l 2>/dev/null | awk '$1>250{print $2}' | grep -v total || true",
        { encoding: 'utf8' }
    ).trim();
    const violations = out ? out.split('\n').filter(Boolean) : [];
    return { score: violations.length === 0 ? 20 : 0, detail: `${violations.length} violações` };
});

// C2: Zero EventEmitter direto
check('C2', 'Zero EventEmitter direto', 10, () => {
    const out = execSync(
        "grep -rl 'new EventEmitter\\|extends EventEmitter' src/copilot/ --include='*.js' | grep -v '\\.test\\.' | wc -l",
        { encoding: 'utf8', shell: true }
    ).trim();
    const count = parseInt(out);
    return { score: count === 0 ? 10 : 0, detail: `${count} arquivos` };
});

// C5: Zero deep imports
check('C5', 'Zero deep imports', 5, () => {
    const count = parseInt(execSync(
        "node scripts/arch-health.mjs --json | node -e \"process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(String(JSON.parse(d).deepImports?.refined??99)));\"",
        { encoding: 'utf8', shell: true }
    ).trim());
    return { score: count === 0 ? 5 : 0, detail: `${count} deep imports` };
});

// C6: Zero typecheck errors
check('C6', 'Zero typecheck errors', 7, () => {
    const out = execSync('npm run typecheck:node 2>&1 | grep "error TS" | wc -l', { encoding: 'utf8', shell: true }).trim();
    const count = parseInt(out);
    return { score: count === 0 ? 7 : 0, detail: `${count} erros` };
});

// C8: Fan-out máximo ≤ 8
check('C8', 'Fan-out máximo ≤ 8', 5, () => {
    const json = JSON.parse(execSync('node scripts/arch-health.mjs --json', { encoding: 'utf8' }));
    const max = Math.max(...Object.values(json.fanOut?.details || { terminal: 99 }));
    return { score: max <= 8 ? 5 : 0, detail: `max=${max}` };
});

// Imprimir resultados
console.log('\n=== PARTE-22 HEALTH CHECK ===\n');
Object.entries(results).forEach(([id, r]) => {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} ${id} (${r.score}/${r.weight}): ${r.label} — ${r.detail}`);
});
console.log(`\nSCORE: ${totalScore}/${maxScore} (${(totalScore/maxScore*100).toFixed(1)}%)\n`);
process.exit(totalScore >= maxScore * 0.9 ? 0 : 1);
```

---

## 6. Baseline vs Milestones

| Checkpoint    | Faixas concluídas      | Score esperado | Critérios novos atingidos    |
|---------------|------------------------|----------------|------------------------------|
| Baseline      | Nenhuma (agora)        | 13.5/100       | —                            |
| Milestone 1   | O1~O4                  | ~30/100        | C5, C1 parcial               |
| Milestone 2   | O5~O7, P1              | ~40/100        | C6, C5 total, C11 início     |
| Milestone 3   | P2~P5                  | ~55/100        | C2, C1 quase total           |
| Milestone 4   | P6~P8, Q1~Q2           | ~70/100        | C10, C7 parcial              |
| Milestone 5   | Q3~Q5                  | ~82/100        | C7 total, C12                |
| Target Final  | R1~R3                  | **≥95/100**    | C3, C11 total, C2 confirmado |

---

## 7. Regras de Governança

### 7.1 O Que Fazer a Cada Commit

Antes de commitar qualquer alteração de código:
1. Executar `npm run lint`
2. Executar `npm run test:unit`
3. Executar `node scripts/arch-health.mjs` — verificar que score não regrediu
4. Verificar que nenhum critério C1-C13 regrediu

### 7.2 O Que Nunca Fazer

1. **Nunca** adicionar exclusões a `singletonCount()` para inflar o score
2. **Nunca** calibrar thresholds de fan-out sem corrigir o problema real
3. **Nunca** marcar faixa como "✅ concluída" sem rodar o script de verificação dessa faixa
4. **Nunca** aceitar "já foi parcialmente feito"  — critério é binário (pass/fail)
5. **Nunca** criar deep imports temporários com "refatoro depois"

### 7.3 O Que Fazer Quando um Critério Regride

1. Identificar o commit que causou a regressão
2. Reverter ou corrigir imediatamente
3. Não avançar para próxima faixa enquanto houver regressão
4. Documentar a causa em PARTE-22F (status de execução)

---

## 8. Relação com arch-health.mjs

O `scripts/arch-health.mjs` existente mede critérios diferentes (score PARTE-21 = 95/100).  
Para a PARTE-22:

| arch-health.mjs (PARTE-21)    | health-check-parte22.mjs (PARTE-22)    |
|-------------------------------|----------------------------------------|
| Score 95/100                  | Score 13.5/100                         |
| Inclui exclusões de singletons| Singletons contados sem exclusões subjetivas |
| Fan-out: apenas inter-módulo  | Fan-out + bypass-services penalizado   |
| Deep imports refinados (4)    | Deep imports absolutos (0 target)      |
| Tests bonus (195+ files exist)| Coverage ≥ 70% funcional por módulo   |
| Não mede EventBus adoption    | EventBus é critério C3 com 10% peso    |
| Não mede god files            | God files é critério C1 com 20% peso   |

**Os dois scripts coexistem** — `arch-health.mjs` continua como legado/referência histórica.  
`health-check-parte22.mjs` é o novo critério oficial de qualidade.
