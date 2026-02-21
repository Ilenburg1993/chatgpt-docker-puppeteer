#!/bin/bash
# Master script para aplicar todas as transformações de constantes automaticamente
# Aplica os 3 codemods em todos os arquivos src/ e valida com ESLint

set -e  # Exit on error

ROOT="/workspaces/chatgpt-docker-puppeteer"
cd "$ROOT"

echo "🚀 Iniciando transformação automatizada de magic strings"
echo "=========================================================="
echo ""

# Arquivos a transformar (excluindo constants/ para evitar loops)
TARGET_PATTERN="src/**/*.js"
EXCLUDE_PATTERN="src/core/constants"

echo "📁 Listando arquivos alvo..."
FILES=$(find src -name "*.js" -not -path "src/core/constants/*" -not -path "*/node_modules/*" -not -path "*/dist/*")
FILE_COUNT=$(echo "$FILES" | wc -l)
echo "✓ $FILE_COUNT arquivos encontrados"
echo ""

# Backup antes de começar
BACKUP_DIR="backups/pre-constants-migration-$(date +%Y%m%d_%H%M%S)"
echo "💾 Criando backup em $BACKUP_DIR..."
mkdir -p "$BACKUP_DIR"
cp -r src "$BACKUP_DIR/"
echo "✓ Backup criado"
echo ""

# Aplicar transformações em sequência
echo "🔄 FASE 1/3: Aplicando transform-status-values.js..."
npx jscodeshift \
    -t scripts/codemods/transform-status-values.js \
    src \
    --ignore-pattern="src/core/constants/*" \
    --parser=babel \
    --silent
echo "✓ STATUS_VALUES aplicado"
echo ""

echo "🔄 FASE 2/3: Aplicando transform-log-categories.js..."
npx jscodeshift \
    -t scripts/codemods/transform-log-categories.js \
    src \
    --ignore-pattern="src/core/constants/*" \
    --parser=babel \
    --silent
echo "✓ LOG_CATEGORIES aplicado"
echo ""

echo "🔄 FASE 3/3: Aplicando transform-connection-modes.js..."
npx jscodeshift \
    -t scripts/codemods/transform-connection-modes.js \
    src \
    --ignore-pattern="src/core/constants/*" \
    --parser=babel \
    --silent
echo "✓ CONNECTION_MODES aplicado"
echo ""

# Verificar erros ESLint
echo "🔍 Validando com ESLint..."
if npx eslint src --quiet; then
    echo "✓ 0 erros ESLint"
    ESLINT_OK=true
else
    echo "⚠️  ESLint encontrou problemas - verificar manualmente"
    ESLINT_OK=false
fi
echo ""

# Estatísticas de mudanças
echo "📊 Estatísticas de transformação:"
echo "================================="

# Contar imports adicionados
STATUS_IMPORTS=$(grep -r --exclude-dir=dist --exclude-dir=constants "require.*constants/tasks" src | wc -l)
LOG_IMPORTS=$(grep -r --exclude-dir=dist --exclude-dir=constants "require.*constants/logging" src | wc -l)
BROWSER_IMPORTS=$(grep -r --exclude-dir=dist --exclude-dir=constants "require.*constants/browser" src | wc -l)

echo "STATUS_VALUES imports: $STATUS_IMPORTS arquivos"
echo "LOG_CATEGORIES imports: $LOG_IMPORTS arquivos"
echo "CONNECTION_MODES imports: $BROWSER_IMPORTS arquivos"
echo ""

# Contar usos de constantes
STATUS_USES=$(grep -r --exclude-dir=dist --exclude-dir=constants "STATUS_VALUES\." src | wc -l)
LOG_USES=$(grep -r --exclude-dir=dist --exclude-dir=constants "LOG_CATEGORIES\." src | wc -l)
BROWSER_USES=$(grep -r --exclude-dir=dist --exclude-dir=constants "CONNECTION_MODES\." src | wc -l)

echo "STATUS_VALUES usos: $STATUS_USES"
echo "LOG_CATEGORIES usos: $LOG_USES"
echo "CONNECTION_MODES usos: $BROWSER_USES"
echo "Total de usos: $((STATUS_USES + LOG_USES + BROWSER_USES))"
echo ""

# Verificar se há magic strings restantes
echo "🔎 Verificando magic strings restantes..."
REMAINING_PENDING=$(grep -r --exclude-dir=dist --exclude-dir=constants "'PENDING'" src 2>/dev/null | wc -l)
REMAINING_BOOT=$(grep -r --exclude-dir=dist --exclude-dir=constants "'BOOT'" src 2>/dev/null | wc -l)
REMAINING_HYBRID=$(grep -r --exclude-dir=dist --exclude-dir=constants "'hybrid'" src 2>/dev/null | wc -l)

if [ "$REMAINING_PENDING" -gt 0 ]; then
    echo "⚠️  'PENDING' restante: $REMAINING_PENDING ocorrências"
fi
if [ "$REMAINING_BOOT" -gt 0 ]; then
    echo "⚠️  'BOOT' restante: $REMAINING_BOOT ocorrências"
fi
if [ "$REMAINING_HYBRID" -gt 0 ]; then
    echo "⚠️  'hybrid' restante: $REMAINING_HYBRID ocorrências"
fi

if [ "$REMAINING_PENDING" -eq 0 ] && [ "$REMAINING_BOOT" -eq 0 ] && [ "$REMAINING_HYBRID" -eq 0 ]; then
    echo "✓ Nenhum magic string comum encontrado!"
fi
echo ""

# Resumo final
echo "=========================================================="
echo "✅ Transformação concluída!"
echo ""
echo "Próximos passos:"
echo "1. Revisar mudanças: git diff"
echo "2. Executar testes: npm test"
if [ "$ESLINT_OK" = false ]; then
    echo "3. Corrigir erros ESLint: npx eslint src --fix"
fi
echo "4. Commit: git add . && git commit -m 'refactor: migrate to centralized constants'"
echo ""
echo "Backup disponível em: $BACKUP_DIR"
