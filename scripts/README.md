# Scripts Utility Reference

Este documento lista todos os scripts utilitários e suas finalidades.

## 🔧 Ferramentas de Análise

### scan_magic_strings.js

**Propósito**: Detecta strings hardcoded que deveriam ser constantes

**Uso**:

```bash
node scripts/scan_magic_strings.js                   # Scan src/ only
node scripts/scan_magic_strings.js --include-tests   # Include tests/
node scripts/scan_magic_strings.js --directory path/ # Custom directory
```

**Detecta 11 padrões**:

1. `actor: 'STRING'` assignments
2. `messageType: 'STRING'` assignments
3. `actionCode: 'STRING'` assignments
4. `kind: 'STRING'` assignments
5. `envelope.actor === 'STRING'` comparisons
6. `envelope.messageType === 'STRING'` comparisons
7. `envelope.kind === 'STRING'` comparisons
8. `actionCode === 'STRING'` comparisons
9. `case 'ACTIONCODE':` switch statements
10. `{ actor: 'STRING' }` object literals
11. `source/target: 'role'` em headers

**Exit Codes**:

- 0: Nenhuma magic string encontrada
- 1: Magic strings encontradas em src/
- 2: Erro durante execução

**Relacionado**: Substituído versões antigas `/tmp/deep_scan.js`, `/tmp/final_analysis.js`

---

### validate-nerv-constants.js

**Propósito**: Valida que todos os ActionCodes usados estão definidos em constants.js

**Uso**:

```bash
node scripts/validate-nerv-constants.js          # Validação padrão
node scripts/validate-nerv-constants.js --strict # Exit 1 se houver constantes não usadas
node scripts/validate-nerv-constants.js --json   # Output JSON
```

**Verifica**:

- ActionCodes usados no código estão definidos em constants.js
- ActionCodes definidos mas não usados (para considerar remoção)
- Cobertura percentual

**Exit Codes**:

- 0: Constantes válidas
- 1: Constantes faltando ou não usadas (modo --strict)
- 2: Erro de execução

**Nota**: Lista de ActionCodes usados é mantida manualmente. Atualizar quando adicionar novos.

---

### audit-dependencies.js

**Propósito**: Compara dependências declaradas com módulos usados no código

**Uso**:

```bash
node scripts/audit-dependencies.js        # Output formatado
node scripts/audit-dependencies.js --json # JSON output
```

**Detecta**:

- Dependências faltando (usadas mas não declaradas)
- Dependências não utilizadas (declaradas mas não encontradas no código)
- Módulos nativos do Node.js (para referência)

**Exit Codes**:

- 0: Todas as dependências corretas
- 1: Dependências faltando
- 2: Erro de execução

**Nota**: Análise heurística. Revisar manualmente before remover dependências.

---

### audit-tmp-scripts.js

**Propósito**: Audita scripts temporários e classifica por utilidade

**Uso**:

```bash
node scripts/audit-tmp-scripts.js                # Apenas análise
node scripts/audit-tmp-scripts.js --auto-cleanup # Executa recomendações
```

**Categorias**:

- **IMMEDIATE**: Scripts de uso único (podem ser deletados)
- **REUSABLE**: Ferramentas reutilizáveis (devem ir para scripts/)
- **DEV_TOOL**: Utilidades de desenvolvimento
- **SYSTEM**: Arquivos do sistema (ignorar)
- **UNKNOWN**: Requer revisão manual

**Output**: Recomendações de mover/deletar/revisar com justificativas

---

### scan_literals.js & scan_literals_deep.js

**Propósito**: Scanners genéricos para literais no código

**Uso**:

```bash
node scripts/scan_literals.js      # Scan básico
node scripts/scan_literals_deep.js # Scan profundo com mais padrões
```

**Diferenças**:

- `scan_literals.js`: Patterns básicos (strings em maiúsculas)
- `scan_literals_deep.js`: Patterns avançados (enums, switches, comparações)

---

## 🧪 Ferramentas de Teste

### run-tests.js

**Propósito**: Runner customizado para testes

**Uso**:

```bash
node scripts/run-tests.js               # Roda todos os testes
node scripts/run-tests.js --unit        # Apenas unit tests
node scripts/run-tests.js --integration # Apenas integration tests
```

**Features**:

- Suporte a filtros de categoria
- Output formatado
- Relatório de cobertura

---

### test_schema_validation.js

**Propósito**: Valida schemas Zod do projeto

**Uso**:

```bash
node scripts/test_schema_validation.js
```

**Valida**:

- Task schemas
- Config schemas
- NERV envelope schemas

---

## ⚙️ Ferramentas de Configuração

### validate_config.js

**Propósito**: Valida arquivos de configuração

**Uso**:

```bash
node scripts/validate_config.js                    # Valida config.json
node scripts/validate_config.js --file custom.json # Arquivo customizado
```

**Verifica**:

- Schema compliance
- Required fields
- Value ranges
- Deprecated settings

---

## 🔨 Ferramentas de Manutenção

### doctor.sh

**Propósito**: Diagnóstico completo do ambiente

**Uso**:

```bash
bash scripts/doctor.sh
```

**Verifica**:

- Dependências instaladas
- Conexões de browser
- Permissões de arquivos
- Estado do sistema

---

### healthcheck.js

**Propósito**: Health check rápido

**Uso**:

```bash
node scripts/healthcheck.js
```

**Verifica**:

- Arquivos críticos existem
- Processos estão rodando
- Espaço em disco
- Memória disponível

---

## 📦 Ferramentas de Código

### Codemods históricos de constantes — aposentados

A migração antiga de `STATUS_VALUES`, `LOG_CATEGORIES` e `CONNECTION_MODES` foi concluída e os
codemods baseados em `jscodeshift` foram retirados do workspace ativo. Eles ainda apontavam para
módulos `.js` que hoje são fontes TypeScript `.ts` e, se reexecutados, podiam gerar imports
inexistentes. Os artefatos foram preservados na quarentena reversível do MCP apenas para
rastreabilidade histórica; não fazem parte da toolchain canônica.

Transformações sintáticas novas devem reutilizar a policy Babel 8 em
`src/copilot/infra/parse/babel-policy.js` e somente adotar geração de código quando houver um caso
de uso atual, testado e explicitamente necessário.

---

### fix-empty-catch.js & fix-promise-executor-return.js

**Propósito**: Correções automáticas ESLint

**Uso**:

```bash
node scripts/fix-empty-catch.js             # Fix empty catch blocks
node scripts/fix-promise-executor-return.js # Fix promise executor returns
```

**Alterações**:

- Adiciona logging apropriado
- Remove returns desnecessários
- Mantém semântica original

---

### fixes/fix-unused-vars.js

**Propósito**: Corrige automaticamente variáveis não utilizadas prefixando com underscore

**Uso**:

```bash
# Step 1: Gerar lista de vars não usadas
npx eslint . --format unix | grep "is defined but never used" > /tmp/unused-vars.txt

# Step 2: Aplicar correções
node scripts/fixes/fix-unused-vars.js /tmp/unused-vars.txt

# Step 3: Verificar
npx eslint . --quiet
```

**Padrões corrigidos**:

- `catch (e)` → `catch (_e)`
- `function(param)` → `function(_param)`
- `const varName =` → `const _varName =`
- `{ destructured }` → `{ destructured: _destructured }`

**Exit Codes**:

- 0: Correções aplicadas
- 1: Arquivo de input não encontrado
- 2: Erro durante processamento

**⚠️ WARNING**: Modifica arquivos in-place. Commit antes de usar!

---

## 🗂️ Ferramentas de Gerenciamento

### status_fila.js & visualizar_fila.js

**Propósito**: Gerenciamento da fila de tarefas

**Uso**:

```bash
node scripts/status_fila.js     # Status textual
node scripts/visualizar_fila.js # Visualização detalhada
npm run queue:status            # Alias
npm run queue:status -- --watch # Live watch
```

---

### gerador_tarefa.js

**Propósito**: Cria novas tarefas

**Uso**:

```bash
node scripts/gerador_tarefa.js --prompt "Texto" --target chatgpt
npm run queue:add # Modo interativo
```

---

### importar_prompts.js

**Propósito**: Importa prompts em lote

**Uso**:

```bash
node scripts/importar_prompts.js prompts.txt
```

**Formato esperado**: Um prompt por linha ou arquivo txt

---

## 🔧 Setup & Manutenção

### setup.sh & setup-dev-tools.sh

**Propósito**: Scripts de inicialização

**Uso**:

```bash
bash scripts/setup.sh           # Setup inicial
bash scripts/setup-dev-tools.sh # Dev tools (ESLint, Prettier, etc)
```

---

## 📊 Análise de Código

### analyze-code-graph.js

**Propósito**: Gera grafo de dependências

**Uso**:

```bash
node scripts/analyze-code-graph.js
```

**Output**: `analysis/code-graph.json`

**Features**:

- Mapeamento de imports
- Detecção de ciclos
- Visualização de dependências

---

## 🚫 Scripts Obsoletos (Deletados)

Os seguintes scripts temporários foram **deletados** após cumprirem seu propósito:

- `/tmp/analyze.js` - Análise básica (redundante, substituído por validate-nerv-constants.js)
- `/tmp/final_analysis.js` - Scan básico (obsoleto, substituído por scan_magic_strings.js)

## ✅ Scripts Migrados de /tmp/ para /scripts/

Os seguintes scripts foram **movidos** e documentados adequadamente:

- `/tmp/analyze_constants.js` → `scripts/validate-nerv-constants.js` ✅
- `/tmp/check_deps.js` → `scripts/audit-dependencies.js` ✅
- `/tmp/fix-unused.js` → `scripts/fixes/fix-unused-vars.js` ✅
- `/tmp/deep_scan.js` → `scripts/scan_magic_strings.js` ✅

---

## 🧪 Scripts de Teste Temporários (Para Revisar)

Os seguintes scripts em `/tmp/` precisam de revisão:

### test_chrome_simple.js

**Propósito**: Testa conexão Chrome em múltiplas URLs

**Decisão Pendente**:

- Mover para `tools/` como utilitário de diagnóstico?
- Integrar no `doctor.sh`?
- Deletar se redundante com `test-puppeteer.js`

### test_puppeteer_launch.js

**Propósito**: Testa Puppeteer em modo launcher

**Decisão Pendente**:

- Redundante com `test-puppeteer.js` na raiz?
- Mover para `tests/manual/`?

### test_dna\*.js (3 arquivos)

**Propósito**: Testes do sistema de identidade DNA

**Decisão Pendente**:

- Migrar para testes unitários formais?
- Mover para `tests/exploratory/`?
- Deletar se já cobertos por testes formais

### test_record.js

**Propósito**: Teste de gravação (propósito unclear)

**Ação**: Revisar código para determinar utilidade

---

## 📝 Convenções

### Nomenclatura

- `scan_*.js` - Ferramentas de análise estática
- `test_*.js` - Scripts de teste
- `fix_*.js` - Ferramentas de correção automática
- `*.sh` - Shell scripts (setup, CI/CD)

### Localização

- `/scripts/` - Ferramentas de longo prazo, documentadas, reutilizáveis
- `/tools/` - Utilitários de diagnóstico e troubleshooting
- `/tests/` - Testes formais (unit, integration, e2e)
- `/tmp/` - Scripts temporários (one-off, experimental)

### Documentação Obrigatória

Todo script em `/scripts/` deve ter:

1. **Header comment** com propósito, uso, exit codes
2. **CLI args** documentados com exemplos
3. **Output format** especificado
4. **Related scripts** referenciados

---

## 🔄 Workflow de Migração

Quando criar um script temporário:

1. **Desenvolvimento**: Criar em `/tmp/` para prototipagem rápida
2. **Validação**: Testar funcionalidade completa
3. **Decisão**:
   - Uso único → Deletar após execução
   - Reutilizável → Mover para `/scripts/` com documentação
   - Exploratório → Mover para `/tools/`
4. **Registro**: Adicionar entrada neste README
5. **Cleanup**: Remover de `/tmp/`

---

## 🎯 Próximos Passos

1. ✅ Criar `audit-tmp-scripts.js` (CONCLUÍDO)
2. ✅ Criar `scan_magic_strings.js` (CONCLUÍDO)
3. ⏳ Revisar scripts `test_*.js` em `/tmp/`
4. ⏳ Integrar `test_chrome_simple.js` no `doctor.sh`
5. ⏳ Migrar testes DNA para suite formal
6. ⏳ Criar `/tools/` directory para utilitários de diagnóstico
7. ⏳ Documentar todos os codemods individuais

---

**Última atualização**: 2026-01-20 **Autor**: Copilot Coding Agent **Versão**: 1.0.0
