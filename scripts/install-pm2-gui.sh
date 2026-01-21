#!/usr/bin/env bash
# ============================================================================
#  INSTALL-PM2-GUI v3.0 - Helper para instalação do pm2-gui
#  Interface gráfica Electron para gerenciar processos PM2
#  Version: 3.0 (2026-01-21) - Enhanced validation & error handling
# ============================================================================

set -euo pipefail

COLOR_GREEN="\033[92m"
COLOR_YELLOW="\033[93m"
COLOR_CYAN="\033[96m"
COLOR_RESET="\033[0m"

echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo -e "${COLOR_CYAN}  PM2-GUI INSTALLER${COLOR_RESET}"
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""
echo "O pm2-gui é uma interface gráfica Electron para PM2."
echo ""
echo "Recursos:"
echo "  - Dashboard visual de processos"
echo "  - Monitoramento de CPU/RAM em tempo real"
echo "  - Logs integrados"
echo "  - Controles start/stop/restart"
echo "  - Gratuito e open-source"
echo ""
echo "Repositório: https://github.com/Tjatse/pm2-gui"
echo ""
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""

# Verificar se npm está disponível
if ! command -v npm &> /dev/null; then
    echo -e "${COLOR_RED}✗ npm não encontrado! Instale Node.js primeiro.${COLOR_RESET}"
    exit 1
fi

# Verificar se já está instalado
if command -v pm2-gui &> /dev/null; then
    echo -e "${COLOR_GREEN}[INFO] pm2-gui já está instalado!${COLOR_RESET}"
    echo ""
    read -p "Deseja abrir pm2-gui agora? (s/n): " launch
    if [[ "$launch" =~ ^[Ss]$ ]]; then
        echo ""
        echo "Abrindo pm2-gui..."
        pm2-gui &
    fi
    exit 0
fi

echo -e "${COLOR_YELLOW}[INFO] pm2-gui não encontrado no sistema.${COLOR_RESET}"
echo ""
read -p "Deseja instalar pm2-gui globalmente? (s/n): " confirm

if [[ ! "$confirm" =~ ^[Ss]$ ]]; then
    echo ""
    echo "Instalação cancelada."
    exit 0
fi

echo ""
echo -e "${COLOR_YELLOW}[INFO] Instalando pm2-gui via npm...${COLOR_RESET}"
echo "       Isso pode levar alguns minutos..."
echo ""

if npm install -g pm2-gui 2>&1 | tee /tmp/pm2-gui-install.log; then
    echo ""
    echo -e "${COLOR_GREEN}============================================================${COLOR_RESET}"
    echo -e "${COLOR_GREEN}  [SUCCESS] pm2-gui instalado com sucesso!${COLOR_RESET}"
    echo -e "${COLOR_GREEN}============================================================${COLOR_RESET}"
    echo ""
    echo "Para usar:"
    echo "  1. Execute: pm2-gui"
    echo "  2. Acesse: http://localhost:8088"
    echo ""
    echo "Ou use o launcher.sh opção [6]"
    echo ""

    read -p "Deseja abrir pm2-gui agora? (s/n): " launch
    if [[ "$launch" =~ ^[Ss]$ ]]; then
        echo ""
        echo "Abrindo pm2-gui..."
        pm2-gui &
        echo -e "${COLOR_GREEN}✓ pm2-gui iniciado em background${COLOR_RESET}"
        echo -e "${COLOR_CYAN}Acesse: http://localhost:8088${COLOR_RESET}"
    fi
    exit 0
else
    echo ""
    echo -e "${COLOR_RED}============================================================${COLOR_RESET}"
    echo -e "${COLOR_RED}  [ERROR] Falha na instalação!${COLOR_RESET}"
    echo -e "${COLOR_RED}============================================================${COLOR_RESET}"
    echo ""
    echo "Verifique o log: /tmp/pm2-gui-install.log"
    echo ""
    echo "Tente manualmente:"
    echo "  npm install -g pm2-gui"
    echo ""
    echo "Problemas comuns:"
    echo "  - Permissões: tente com 'sudo npm install -g pm2-gui'"
    echo "  - Rede: verifique conexão com npmjs.com"
    echo ""
    exit 1
fi
