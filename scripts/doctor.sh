#!/bin/bash
# Doctor script - Diagnóstico completo do sistema
# Usage: npm run doctor

set +e  # Don't exit on errors, we're diagnosing

echo "🏥 GPT-Agent Doctor - Diagnóstico do Sistema"
echo "=============================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ISSUES=0
WARNINGS=0

# Function to check and report
check() {
    local name=$1
    local command=$2
    local type=${3:-error}  # error or warning
    
    echo -n "[$name] "
    if eval "$command" &> /dev/null; then
        echo -e "${GREEN}✅ OK${NC}"
        return 0
    else
        if [ "$type" = "error" ]; then
            echo -e "${RED}❌ FALHA${NC}"
            ((ISSUES++))
        else
            echo -e "${YELLOW}⚠️  ATENÇÃO${NC}"
            ((WARNINGS++))
        fi
        return 1
    fi
}

# System Checks
echo -e "${BLUE}📋 Verificações do Sistema${NC}"
echo "-------------------------------------------"

check "Node.js ≥20" "node -v | grep -E 'v(2[0-9]|[3-9][0-9])'"
check "npm instalado" "command -v npm"
check "git instalado" "command -v git" warning

NODE_VERSION=$(node -v)
NPM_VERSION=$(npm -v)
echo "   Node: $NODE_VERSION | npm: $NPM_VERSION"
echo ""

# Dependencies
echo -e "${BLUE}📦 Dependências${NC}"
echo "-------------------------------------------"

check "node_modules existe" "test -d node_modules"
check "puppeteer instalado" "test -d node_modules/puppeteer"
check "express instalado" "test -d node_modules/express"
check "socket.io instalado" "test -d node_modules/socket.io"

# Verify critical packages
if [ -f "package.json" ]; then
    DEPS_COUNT=$(node -e "console.log(Object.keys(require('./package.json').dependencies).length)")
    echo "   Dependências instaladas: $DEPS_COUNT"
fi
echo ""

# File Structure
echo -e "${BLUE}📁 Estrutura de Arquivos${NC}"
echo "-------------------------------------------"

check "index.js existe" "test -f index.js"
check "config.json existe" "test -f config.json"
check "src/ existe" "test -d src"
check "fila/ existe" "test -d fila"
check "respostas/ existe" "test -d respostas"
check "logs/ existe" "test -d logs"

# Check directory permissions
check "fila/ gravável" "test -w fila"
check "respostas/ gravável" "test -w respostas"
check "logs/ gravável" "test -w logs"
echo ""

# Configuration Validation
echo -e "${BLUE}⚙️  Configuração${NC}"
echo "-------------------------------------------"

if [ -f "config.json" ]; then
    check "config.json válido (JSON)" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"config.json\"))'"
    
    CHROME_PATH=$(node -e "console.log(require('./config.json').chromePath || '')")
    echo "   Chrome Path: $CHROME_PATH"
else
    echo -e "${RED}❌ config.json não encontrado${NC}"
    ((ISSUES++))
fi

if [ -f "dynamic_rules.json" ]; then
    check "dynamic_rules.json válido" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"dynamic_rules.json\"))'"
else
    echo -e "${YELLOW}⚠️  dynamic_rules.json não encontrado${NC}"
    ((WARNINGS++))
fi
echo ""

# Chrome Connection
echo -e "${BLUE}🌐 Chrome Remote Debugging${NC}"
echo "-------------------------------------------"

CHROME_PORT=9222
check "Porta 9222 acessível" "curl -s http://localhost:$CHROME_PORT/json/version"

if curl -s http://localhost:$CHROME_PORT/json/version &> /dev/null; then
    CHROME_INFO=$(curl -s http://localhost:$CHROME_PORT/json/version)
    BROWSER=$(echo $CHROME_INFO | node -e "const d=require('fs').readFileSync(0);console.log(JSON.parse(d).Browser || 'Unknown')")
    WS_URL=$(echo $CHROME_INFO | node -e "const d=require('fs').readFileSync(0);console.log(JSON.parse(d).webSocketDebuggerUrl || 'N/A')")
    
    echo "   Browser: $BROWSER"
    echo "   WebSocket: ${WS_URL:0:50}..."
    
    # Check if pages are available
    PAGES=$(curl -s http://localhost:$CHROME_PORT/json/list | node -e "const d=require('fs').readFileSync(0);console.log(JSON.parse(d).length || 0)")
    echo "   Páginas abertas: $PAGES"
else
    echo -e "${RED}   Chrome não está rodando com --remote-debugging-port=9222${NC}"
    echo ""
    echo "   Para iniciar:"
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "   google-chrome --remote-debugging-port=9222 --user-data-dir=\"\$HOME/chrome-automation-profile\""
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222"
    fi
fi
echo ""

# Process Status
echo -e "${BLUE}🔄 Processos${NC}"
echo "-------------------------------------------"

# Check if PM2 is available
if command -v pm2 &> /dev/null; then
    echo "PM2 Status:"
    pm2 list 2>/dev/null || echo "   Nenhum processo PM2 rodando"
else
    echo -e "${YELLOW}⚠️  PM2 não instalado globalmente${NC}"
    ((WARNINGS++))
fi

# Check for running node processes
NODE_PROCS=$(pgrep -f "node.*index.js" | wc -l)
if [ $NODE_PROCS -gt 0 ]; then
    echo "   Processos Node (index.js): $NODE_PROCS"
else
    echo "   Nenhum processo do agente rodando"
fi
echo ""

# Queue Status
echo -e "${BLUE}📋 Status da Fila${NC}"
echo "-------------------------------------------"

if [ -d "fila" ]; then
    PENDING=$(find fila -maxdepth 1 -name "*.json" -not -name "*.tmp.*" | wc -l)
    LOCKED=$(find fila -maxdepth 1 -name "*.tmp.*" | wc -l)
    CORRUPTED=$(find fila/corrupted -name "*.json" 2>/dev/null | wc -l)
    
    echo "   Pendentes: $PENDING"
    echo "   Travadas: $LOCKED"
    echo "   Corrompidas: $CORRUPTED"
    
    if [ $LOCKED -gt 0 ]; then
        echo ""
        echo "   Tarefas travadas:"
        find fila -maxdepth 1 -name "*.tmp.*" -exec basename {} \; | while read lock; do
            PID=$(echo $lock | grep -oP 'tmp\.\K[0-9]+')
            if ps -p $PID > /dev/null 2>&1; then
                echo "      - $lock (PID $PID ativo)"
            else
                echo -e "      - $lock ${RED}(PID $PID morto - orphan!)${NC}"
                ((WARNINGS++))
            fi
        done
    fi
fi
echo ""

# Disk Space
echo -e "${BLUE}💾 Espaço em Disco${NC}"
echo "-------------------------------------------"

DISK_USAGE=$(df -h . | awk 'NR==2 {print $5}' | sed 's/%//')
DISK_AVAIL=$(df -h . | awk 'NR==2 {print $4}')

echo "   Uso: $DISK_USAGE% | Disponível: $DISK_AVAIL"

if [ $DISK_USAGE -gt 90 ]; then
    echo -e "   ${RED}⚠️  Espaço em disco crítico!${NC}"
    ((WARNINGS++))
fi

# Check logs size
if [ -d "logs" ]; then
    LOGS_SIZE=$(du -sh logs 2>/dev/null | cut -f1)
    echo "   Tamanho dos logs: $LOGS_SIZE"
fi

# Check responses size
if [ -d "respostas" ]; then
    RESP_SIZE=$(du -sh respostas 2>/dev/null | cut -f1)
    RESP_COUNT=$(find respostas -name "*.txt" | wc -l)
    echo "   Respostas: $RESP_COUNT arquivos ($RESP_SIZE)"
fi
echo ""

# Recent Errors
echo -e "${BLUE}📝 Erros Recentes${NC}"
echo "-------------------------------------------"

if [ -d "logs/crash_reports" ]; then
    CRASH_COUNT=$(find logs/crash_reports -name "*.json" -mtime -7 | wc -l)
    echo "   Crashes (últimos 7 dias): $CRASH_COUNT"
    
    if [ $CRASH_COUNT -gt 0 ]; then
        echo "   Crashes mais recentes:"
        find logs/crash_reports -name "*.json" -mtime -1 -exec basename {} \; | head -3 | while read crash; do
            echo "      - $crash"
        done
    fi
fi

# Check for error patterns in logs
if [ -f "logs/agente.log" ]; then
    ERROR_COUNT=$(grep -c "ERROR" logs/agente.log 2>/dev/null || echo 0)
    echo "   Erros no log (agente.log): $ERROR_COUNT"
fi
echo ""

# Summary
echo "=============================================="
echo -e "${BLUE}📊 Resumo${NC}"
echo "=============================================="

if [ $ISSUES -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ Sistema saudável! Nenhum problema detectado.${NC}"
elif [ $ISSUES -eq 0 ]; then
    echo -e "${YELLOW}⚠️  $WARNINGS avisos encontrados (não críticos)${NC}"
else
    echo -e "${RED}❌ $ISSUES problemas críticos e $WARNINGS avisos${NC}"
    echo ""
    echo "Ações recomendadas:"
    [ $ISSUES -gt 0 ] && echo "  1. Revise os erros acima e corrija problemas críticos"
    [ $WARNINGS -gt 0 ] && echo "  2. Considere resolver os avisos para melhor estabilidade"
    echo "  3. Consulte a documentação: DOCUMENTAÇÃO/TROUBLESHOOTING.md"
fi

echo ""
echo "💡 Dicas:"
echo "   - Setup inicial: npm run setup"
echo "   - Ver logs: npm run daemon:logs"
echo "   - Status da fila: npm run queue:status"
echo "   - Limpar ambiente: npm run clean"
echo ""

exit $ISSUES
