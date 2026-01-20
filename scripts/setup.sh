#!/bin/bash
# Setup completo do ambiente de desenvolvimento
# Usage: npm run setup

set -e

echo "🚀 Iniciando setup do chatgpt-docker-puppeteer..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js version
echo "📋 Verificando Node.js..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}❌ Node.js 20+ é necessário. Versão atual: $(node -v)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node -v)${NC}"

# Check npm
echo "📋 Verificando npm..."
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm não encontrado${NC}"
    exit 1
fi
echo -e "${GREEN}✅ npm $(npm -v)${NC}"

# Create directories
echo ""
echo "📁 Criando estrutura de diretórios..."
mkdir -p fila fila/corrupted
mkdir -p respostas
mkdir -p logs logs/crash_reports
mkdir -p profile/profile
mkdir -p local-login/profile
mkdir -p tmp
echo -e "${GREEN}✅ Diretórios criados${NC}"

# Check if config.json exists
echo ""
echo "⚙️ Verificando configurações..."
if [ ! -f "config.json" ]; then
    echo -e "${YELLOW}⚠️  config.json não encontrado, criando padrão...${NC}"
    cat > config.json << 'EOF'
{
  "chromePath": "http://localhost:9222",
  "maxRetries": 3,
  "backoff": {
    "baseDelay": 5000,
    "maxDelay": 60000,
    "jitter": true
  },
  "healthCheck": {
    "enabled": true,
    "interval": 300000,
    "maxConsecutiveFailures": 3
  },
  "logging": {
    "level": "INFO",
    "structured": true,
    "telemetry": true
  },
  "targets": {
    "chatgpt": {
      "enabled": true,
      "url": "https://chatgpt.com",
      "timeout": 120000,
      "maxConcurrent": 1
    }
  }
}
EOF
    echo -e "${GREEN}✅ config.json criado${NC}"
else
    echo -e "${GREEN}✅ config.json existe${NC}"
fi

# Check if dynamic_rules.json exists
if [ ! -f "dynamic_rules.json" ]; then
    echo -e "${YELLOW}⚠️  dynamic_rules.json não encontrado, criando padrão...${NC}"
    cat > dynamic_rules.json << 'EOF'
{
  "rules": [
    {
      "name": "default_validation",
      "condition": {
        "minLength": 10
      },
      "action": {
        "type": "validate"
      },
      "priority": 1,
      "enabled": true
    }
  ]
}
EOF
    echo -e "${GREEN}✅ dynamic_rules.json criado${NC}"
else
    echo -e "${GREEN}✅ dynamic_rules.json existe${NC}"
fi

# Check Chrome availability
echo ""
echo "🌐 Verificando Chrome/Chromium..."
CHROME_FOUND=false

# Check if Chrome is running on 9222
if curl -s http://localhost:9222/json/version &> /dev/null; then
    echo -e "${GREEN}✅ Chrome com remote debugging detectado na porta 9222${NC}"
    CHROME_INFO=$(curl -s http://localhost:9222/json/version)
    CHROME_VERSION=$(echo $CHROME_INFO | grep -oP '"Browser":\s*"\K[^"]+')
    echo "   Versão: $CHROME_VERSION"
    CHROME_FOUND=true
else
    echo -e "${YELLOW}⚠️  Chrome não detectado na porta 9222${NC}"
    echo ""
    echo "Para iniciar o Chrome com remote debugging:"
    echo ""
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "  google-chrome --remote-debugging-port=9222 --user-data-dir=\"\$HOME/chrome-automation-profile\""
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=\"\$HOME/chrome-automation-profile\""
    fi
    echo ""
fi

# Install dependencies if needed
echo ""
echo "📦 Verificando dependências..."
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules não encontrado, instalando...${NC}"
    npm install
    echo -e "${GREEN}✅ Dependências instaladas${NC}"
else
    echo -e "${GREEN}✅ node_modules existe${NC}"
fi

# Run basic validation
echo ""
echo "🔍 Executando validações..."

# Check if main entry point exists
if [ ! -f "index.js" ]; then
    echo -e "${RED}❌ index.js não encontrado${NC}"
    exit 1
fi
echo -e "${GREEN}✅ index.js encontrado${NC}"

# Check if src/ exists
if [ ! -d "src" ]; then
    echo -e "${RED}❌ Diretório src/ não encontrado${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Diretório src/ encontrado${NC}"

# Run linter if available
if [ -f "node_modules/.bin/eslint" ]; then
    echo ""
    echo "🔎 Executando linter..."
    npm run lint 2>&1 | head -n 20 || echo -e "${YELLOW}⚠️  Linter encontrou problemas (não crítico)${NC}"
fi

# Summary
echo ""
echo "=============================================="
echo -e "${GREEN}✨ Setup concluído com sucesso!${NC}"
echo "=============================================="
echo ""
echo "📖 Próximos passos:"
echo ""
if [ "$CHROME_FOUND" = false ]; then
    echo "1. ${YELLOW}Inicie o Chrome com remote debugging (veja comando acima)${NC}"
    echo "2. Execute: npm run dev"
else
    echo "1. Execute: npm run dev"
fi
echo "3. Acesse o dashboard: http://localhost:3008"
echo "4. Crie uma tarefa: npm run queue:add"
echo ""
echo "📚 Documentação:"
echo "   - Quick Start: DOCUMENTAÇÃO/QUICK_START.md"
echo "   - Arquitetura: DOCUMENTAÇÃO/ARCHITECTURE_DIAGRAMS.md"
echo "   - API: DOCUMENTAÇÃO/API.md"
echo ""
echo "🆘 Problemas?"
echo "   - Diagnóstico: npm run doctor"
echo "   - Logs: npm run daemon:logs"
echo ""
