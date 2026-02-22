# Code Graph Analyzer (TypeScript Language Server)

Ferramenta de análise de grafos de código usando TypeScript Language Server para análise precisa de
JavaScript.

## 🎯 Recursos

- ✅ **Dependency Graph**: Mapeia todas as dependências entre módulos
- ✅ **Circular Dependencies**: Detecta ciclos de importação
- ✅ **Orphaned Modules**: Identifica módulos não referenciados
- ✅ **NERV Event Flows**: Mapeia eventos pub/sub (`.emit()` e `.on()`)
- ✅ **Architecture Stats**: Estatísticas por camada (NERV, KERNEL, DRIVER, etc.)
- ✅ **Export Formats**: JSON para análise programática, DOT para Graphviz

## 📊 Uso Rápido

```bash
# Estatísticas de arquitetura (padrão)
npm run analyze:graph

# Encontrar dependências circulares
npm run analyze:circular

# Encontrar módulos órfãos
npm run analyze:orphans

# Mapear eventos NERV
npm run analyze:nerv

# Análise completa
npm run analyze:graph:full

# Exportar para JSON e DOT
npm run analyze:graph:export
```

## 🔍 Resultados da Última Análise

### Estatísticas Gerais

- **Total de módulos**: 177
- **Arquivos analisados**: JavaScript + JSX via jsconfig.json

### Distribuição por Camada

```
CORE       30 módulos (17%)
INFRA      22 módulos (12%)
NERV       22 módulos (12%)
SERVER     20 módulos (11%)
TESTS      20 módulos (11%)
SCRIPTS    18 módulos (10%)
DRIVER     17 módulos (10%)
OTHER      15 módulos (8%)
KERNEL     13 módulos (7%)
```

### Top Importers (mais dependências)

1. `src/server/main.js` - 17 deps
2. `src/main.js` - 15 deps
3. `src/infra/io.js` - 12 deps
4. `src/nerv/nerv.js` - 12 deps
5. `src/server/engine/lifecycle.js` - 11 deps

### Top Imported (mais referências)

1. `fs` - 53 refs (Node.js core)
2. `path` - 51 refs (Node.js core)
3. `../../core/logger` - 28 refs ⭐
4. `../../core/constants/tasks.js` - 17 refs ⭐
5. `child_process` - 7 refs (Node.js core)

### ⚠️ Dependência Circular Detectada

```
src/infra/queue/task_loader.js
  → src/core/config.js
  → src/infra/io.js
  → src/infra/queue/task_loader.js
```

**Impacto**: Potencial deadlock durante inicialização se não houver lazy loading.

**Solução sugerida**:

- Mover cache de task_loader para módulo separado
- Usar dependency injection no config.js
- Lazy load io.js no task_loader

## 📁 Arquivos Gerados

### `analysis/code-graph.json`

JSON completo com:

- Grafo de dependências (arquivo → [deps])
- Grafo reverso (arquivo → [dependents])
- Eventos NERV (emitters, listeners)
- Dependências circulares
- Módulos órfãos
- Estatísticas

### `analysis/dependency-graph.dot`

Graphviz DOT format para visualização:

```bash
# Gerar imagem SVG
dot -Tsvg analysis/dependency-graph.dot -o analysis/graph.svg

# Gerar PNG
dot -Tpng analysis/dependency-graph.dot -o analysis/graph.png

# Filtrar apenas NERV
grep -E "(NERV|nerv)" analysis/dependency-graph.dot > analysis/nerv-only.dot
dot -Tsvg analysis/nerv-only.dot -o analysis/nerv.svg
```

## 🛠️ Opções do Script

```bash
node scripts/analyze-code-graph.js [options]

--stats          Mostra estatísticas de arquitetura (padrão)
--deps           Mostra grafo de dependências completo
--circular       Encontra dependências circulares
--nerv           Mapeia eventos NERV (emit/on)
--orphans        Encontra módulos órfãos
--export-json    Exporta para analysis/code-graph.json
--export-dot     Exporta para analysis/dependency-graph.dot
```

## 🎯 Casos de Uso

### 1. Validar Arquitetura Zero-Coupling

```bash
npm run analyze:graph:full > arch-report.txt
# Verificar se componentes se comunicam apenas via NERV
grep -E "(NERV|direct import)" arch-report.txt
```

### 2. Antes de Refatoração

```bash
# Mapear dependências do módulo a ser refatorado
npm run analyze:graph:export
node -e "
const graph = require('./analysis/code-graph.json');
const target = 'src/infra/io.js';
console.log('Dependents:', graph.reverseDependencies[target]);
"
```

### 3. Code Review

```bash
# Verificar se PR introduz ciclos
git checkout main
npm run analyze:circular > /tmp/main-cycles.txt

git checkout feature-branch
npm run analyze:circular > /tmp/feature-cycles.txt

diff /tmp/main-cycles.txt /tmp/feature-cycles.txt
```

### 4. Documentação Automática

```bash
# Gerar diagrama de arquitetura
npm run analyze:graph:export
dot -Tsvg analysis/dependency-graph.dot -o DOCUMENTAÇÃO/architecture-graph.svg
```

## 🧩 Integração com CI/CD

### GitHub Actions

```yaml
- name: Analyze Code Graph
  run: |
    npm run analyze:circular
    npm run analyze:graph:export

- name: Check for new cycles
  run: |
    if grep -q "Found [1-9]" analyze-output.txt; then
      echo "⚠️ Circular dependencies detected!"
      exit 1
    fi
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit
npm run analyze:circular --silent | grep -q "Found 0" || {
  echo "❌ Commit rejected: introduces circular dependencies"
  npm run analyze:circular
  exit 1
}
```

## 📚 Comparação com Outras Ferramentas

| Feature        | TypeScript LS     | madge          | dependency-cruiser |
| -------------- | ----------------- | -------------- | ------------------ |
| Precisão JS    | ⭐⭐⭐⭐⭐        | ⭐⭐⭐⭐       | ⭐⭐⭐⭐⭐         |
| Velocidade     | ⭐⭐⭐⭐          | ⭐⭐⭐⭐⭐     | ⭐⭐⭐             |
| NERV Events    | ✅                | ❌             | ❌                 |
| AST Analysis   | ✅                | Partial        | ✅                 |
| Export Formats | JSON, DOT         | JSON, DOT, SVG | JSON, DOT, HTML    |
| Zero Config    | ✅ (via jsconfig) | ✅             | ❌                 |

## 🐛 Limitações Conhecidas

1. **Falsos Positivos em Orphans**: Módulos re-exportados aparecem como órfãos
2. **Dynamic Imports**: `require(variable)` não é rastreado
3. **NERV Events**: Apenas detecta `.emit()` e `.on()` literais (não variáveis)

## 🔗 Recursos Relacionados

- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [jsconfig.json Documentation](https://code.visualstudio.com/docs/languages/jsconfig)
- [Graphviz DOT Language](https://graphviz.org/doc/info/lang.html)

## 📝 Changelog

### v1.0.0 (2026-01-20)

- ✅ Initial release
- ✅ TypeScript Language Server integration
- ✅ Dependency graph analysis
- ✅ Circular dependency detection
- ✅ NERV event mapping
- ✅ JSON and DOT export
- ✅ npm scripts integration
