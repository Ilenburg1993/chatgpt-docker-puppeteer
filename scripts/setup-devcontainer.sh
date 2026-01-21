#!/usr/bin/env bash
# ============================================================
# setup-devcontainer.sh - Dev Container Post-Create Setup
# Runs automatically after Dev Container is created
# ============================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║  🚀 DevContainer Setup - chatgpt-docker-puppeteer               ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# 1. Install PM2 globally
# ============================================================
echo -e "${BLUE}[1/7]${NC} Installing PM2 globally..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2@latest
    echo -e "${GREEN}✓${NC} PM2 installed successfully"
else
    echo -e "${GREEN}✓${NC} PM2 already installed ($(pm2 --version))"
fi

# ============================================================
# 2. Install Chromium dependencies (for Puppeteer)
# ============================================================
echo -e "${BLUE}[2/7]${NC} Installing Chromium dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    > /dev/null 2>&1

echo -e "${GREEN}✓${NC} Chromium dependencies installed"

# ============================================================
# 3. Configure Git
# ============================================================
echo -e "${BLUE}[3/7]${NC} Configuring Git..."

# Check if Git user is configured
if ! git config --global user.name > /dev/null 2>&1; then
    git config --global user.name "DevContainer User"
    echo -e "${YELLOW}⚠${NC}  Git user.name set to 'DevContainer User' (change with: git config --global user.name 'Your Name')"
else
    echo -e "${GREEN}✓${NC} Git user.name: $(git config --global user.name)"
fi

if ! git config --global user.email > /dev/null 2>&1; then
    git config --global user.email "devcontainer@example.com"
    echo -e "${YELLOW}⚠${NC}  Git user.email set to 'devcontainer@example.com' (change with: git config --global user.email 'your@email.com')"
else
    echo -e "${GREEN}✓${NC} Git user.email: $(git config --global user.email)"
fi

# Set useful Git defaults
git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global core.autocrlf input

echo -e "${GREEN}✓${NC} Git configured"

# ============================================================
# 4. Create necessary directories
# ============================================================
echo -e "${BLUE}[4/7]${NC} Creating project directories..."

mkdir -p fila respostas logs tmp backups monitoring/alerts monitoring/metrics

echo -e "${GREEN}✓${NC} Directories created"

# ============================================================
# 5. Set correct permissions
# ============================================================
echo -e "${BLUE}[5/7]${NC} Setting permissions..."

# Make scripts executable
chmod +x scripts/*.sh 2>/dev/null || true
chmod +x launcher.sh 2>/dev/null || true

# Set directory permissions
chmod 755 fila respostas logs tmp backups monitoring 2>/dev/null || true

echo -e "${GREEN}✓${NC} Permissions set"

# ============================================================
# 6. Verify dependencies
# ============================================================
echo -e "${BLUE}[6/7]${NC} Verifying dependencies..."

if command -v make &> /dev/null; then
    echo -e "${GREEN}✓${NC} Make: $(make --version | head -n1)"
else
    echo -e "${RED}✗${NC} Make not found"
fi

if command -v node &> /dev/null; then
    echo -e "${GREEN}✓${NC} Node.js: $(node --version)"
else
    echo -e "${RED}✗${NC} Node.js not found"
fi

if command -v npm &> /dev/null; then
    echo -e "${GREEN}✓${NC} npm: $(npm --version)"
else
    echo -e "${RED}✗${NC} npm not found"
fi

if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓${NC} Docker: $(docker --version)"
else
    echo -e "${YELLOW}⚠${NC}  Docker not available (Docker-in-Docker may need rebuild)"
fi

if command -v gh &> /dev/null; then
    echo -e "${GREEN}✓${NC} GitHub CLI: $(gh --version | head -n1)"
else
    echo -e "${YELLOW}⚠${NC}  GitHub CLI not available"
fi

# ============================================================
# 7. Display welcome message
# ============================================================
echo ""
echo -e "${BLUE}[7/7]${NC} Setup complete!"
echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║  ✅ DevContainer Setup Complete!                                 ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}🎉 Environment is ready!${NC}"
echo ""
echo "Quick Start:"
echo "  • make help          - Show all available commands"
echo "  • make info          - Show project info"
echo "  • make start         - Start PM2 agent + dashboard"
echo "  • make health        - Check system health"
echo "  • make test-all      - Run all tests"
echo ""
echo "Debugging:"
echo "  • F5                 - Start debugging (see launch.json)"
echo "  • make logs-follow   - Tail logs in real-time"
echo "  • make dashboard     - Open dashboard in browser"
echo ""
echo "Documentation:"
echo "  • README.md          - Project overview"
echo "  • DEVELOPER_WORKFLOW.md - Development guide"
echo "  • .devcontainer/README.md - DevContainer info"
echo ""
echo -e "${YELLOW}⚠  Important:${NC}"
echo "  • Configure Git user: git config --global user.name 'Your Name'"
echo "  • Configure Git email: git config --global user.email 'your@email.com'"
echo ""
echo "Happy coding! 🚀"
echo ""
