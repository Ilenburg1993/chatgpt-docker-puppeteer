// ============================================================
// TESTE DE COMUNICAÇÃO VISUAL DE ERROS/WARNINGS
// ============================================================
// Este arquivo demonstra diferentes tipos de problemas
// para validar a configuração do ESLint + VS Code
// ============================================================

// Os exemplos são dados deliberadamente inválidos. Mantê-los como strings permite validar a
// comunicação visual sem introduzir erros reais no workspace tipado.
const diagnosticExamples = [
    { rule: 'no-undef', source: 'console.log(variavel_nao_existe);' },
    { rule: 'no-unused-vars', source: 'const variavelNaoUsada = 123;' },
    { rule: 'no-shadow', source: 'const x = 1; function testShadow() { const x = 2; return x; }' },
    { rule: 'no-redeclare', source: 'let y = 1; let y = 2;' },
    { rule: 'prefer-const', source: "let neverReassigned = 'test';" },
];

console.log(`Exemplos de diagnóstico disponíveis: ${diagnosticExamples.length}`);

// ============================================================
// INSTRUÇÕES DE USO:
// ============================================================
// 1. Abra este arquivo no VS Code
// 2. Observe os sublinhados (squiggles):
//    - Vermelho = ERRO
//    - Amarelo = WARNING
// 3. Veja a barra lateral esquerda (decoradores):
//    - Ícone amarelo/vermelho ao lado do número da linha
// 4. Problems Panel (Ctrl+Shift+M):
//    - Lista todos os problemas
// 5. Status Bar (rodapé):
//    - Mostra contagem: "❌ 0  ⚠️ 3"
// ============================================================
