#!/bin/bash
# Helper para acessar dashboard do Windows
# Execute: bash scripts/dashboard-url.sh

echo ""
echo "🎨 Dashboard URLs:"
echo ""
echo "📍 Localhost (dentro do container):"
echo "   http://localhost:5173/dashboard/"
echo ""
echo "📍 Network (Windows Host):"
echo "   http://172.17.0.2:5173/dashboard/"
echo ""
echo "📍 Porta alternativa (se 5173 ocupada):"
echo "   Vite tentará 5174, 5175, etc..."
echo ""
echo "💡 Para verificar IP do container:"
echo "   hostname -I | awk '{print \$1}'"
echo ""
