#!/bin/bash
# ============================================================================
#  SETUP-PM2-PLUS - Guia de configuração PM2 Plus (opcional)
#  Monitoramento cloud profissional para PM2
# ============================================================================

COLOR_GREEN="\033[92m"
COLOR_YELLOW="\033[93m"
COLOR_CYAN="\033[96m"
COLOR_BOLD="\033[1m"
COLOR_RESET="\033[0m"

echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo -e "${COLOR_CYAN}  PM2 PLUS - Monitoramento Cloud Profissional${COLOR_RESET}"
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""
echo "O PM2 Plus é um serviço cloud OPCIONAL da Keymetrics"
echo "para monitoramento avançado de aplicações PM2."
echo ""
echo "Recursos (plano FREE até 4 servidores):"
echo "  - Dashboard web centralizado"
echo "  - Métricas em tempo real (CPU, RAM, eventos)"
echo "  - Alertas e notificações"
echo "  - Logs centralizados"
echo "  - Monitoramento de múltiplos servidores"
echo "  - API de gerenciamento remoto"
echo ""
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""
echo -e "${COLOR_YELLOW}[IMPORTANTE] Este projeto NÃO requer PM2 Plus.${COLOR_RESET}"
echo "             O sistema funciona 100% standalone com PM2 local."
echo ""
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""

read -p "Deseja ver as instruções de setup? (s/n): " proceed

if [[ ! "$proceed" =~ ^[Ss]$ ]]; then
    echo ""
    echo "Setup cancelado."
    exit 0
fi

echo ""
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo -e "${COLOR_BOLD}  INSTRUÇÕES DE SETUP PM2 PLUS${COLOR_RESET}"
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""
echo "1. Acesse: https://app.pm2.io/"
echo ""
echo "2. Crie uma conta gratuita"
echo ""
echo "3. Crie um novo \"Bucket\" para este projeto"
echo ""
echo "4. Copie a chave pública e privada fornecidas"
echo ""
echo "5. No terminal, execute:"
echo ""
echo -e "   ${COLOR_GREEN}pm2 link [chave-secreta] [chave-publica]${COLOR_RESET}"
echo ""
echo "6. Seus processos PM2 aparecerão no dashboard web"
echo ""
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""
echo "Documentação completa:"
echo "  https://pm2.io/docs/plus/quick-start/"
echo ""
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""

read -p "Deseja abrir o site do PM2 Plus? (s/n): " open_browser

if [[ "$open_browser" =~ ^[Ss]$ ]]; then
    echo ""
    echo "Abrindo navegador..."

    # Detectar sistema e abrir navegador
    if command -v xdg-open &> /dev/null; then
        xdg-open https://app.pm2.io/ &
    elif command -v open &> /dev/null; then
        open https://app.pm2.io/ &
    else
        echo "Não foi possível abrir o navegador automaticamente."
        echo "Acesse manualmente: https://app.pm2.io/"
    fi
fi

exit 0
