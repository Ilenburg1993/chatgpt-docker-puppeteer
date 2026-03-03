#!/usr/bin/env bash
# Notificação: Configuração de porta 5173 adicionada

cat << 'EOF'

╔════════════════════════════════════════════════════════════════╗
║  ✅ CONFIGURAÇÃO CORRIGIDA - RECARREGAR VS CODE NECESSÁRIO     ║
╚════════════════════════════════════════════════════════════════╝

🔧 MUDANÇA APLICADA:
   ✅ Porta 5173 adicionada ao devcontainer.json
   ✅ Vite Dev Server agora será exposto automaticamente

📋 PRÓXIMOS PASSOS:

1️⃣  RECARREGAR VS CODE (IMPORTANTE!)
   • Pressione Ctrl+Shift+P
   • Digite: "Developer: Reload Window"
   • Ou feche e reabra o VS Code

2️⃣  AGUARDAR CONTAINER REINICIAR
   • VS Code vai recarregar o container
   • Aguarde ~30 segundos

3️⃣  VERIFICAR PORTA EXPOSTA
   • No VS Code, vá para aba "PORTS" (parte inferior)
   • Deve aparecer: "5173 - Vite Dev Server"
   • Status: "Forwarded"

4️⃣  ACESSAR DASHBOARD
   • No Windows: http://localhost:5173/dashboard/
   • Deve funcionar agora! ✅

═══════════════════════════════════════════════════════════════

🔍 VERIFICAÇÃO ALTERNATIVA (Sem recarregar VS Code):

Se não quiser recarregar agora, pode fazer port forward manual:

1. No VS Code, aba "PORTS" (inferior)
2. Clique no botão "+" (Forward a Port)
3. Digite: 5173
4. Pressione Enter

Isso expõe a porta temporariamente (até container reiniciar).

═══════════════════════════════════════════════════════════════

💡 POR QUE ISSO FOI NECESSÁRIO?

O devcontainer.json controla quais portas do container são
expostas para o Windows. A porta 5173 (Vite) não estava
configurada, então o Windows não conseguia acessar.

Agora está corrigido! 🎉

EOF

echo ""
echo "Pressione qualquer tecla para continuar..."
read -r -n 1 -s
