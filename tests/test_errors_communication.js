// ============================================================
// TESTE DE COMUNICAÇÃO VISUAL DE ERROS/WARNINGS
// ============================================================
// Este arquivo demonstra diferentes tipos de problemas
// para validar a configuração do ESLint + VS Code
// ============================================================

// ✅ ERRO 1: no-undef (variável não declarada)
console.log(variavel_nao_existe); // eslint-disable-line

// ⚠️ WARNING 2: no-unused-vars (variável não usada)
const variavelNaoUsada = 123; // eslint-disable-line

// ⚠️ WARNING 3: no-shadow (sombreamento de variável)
const x = 1;
function testShadow() {
    const x = 2; // shadow - deve aparecer como warning
    return x;
}

// ✅ ERRO 4: no-redeclare (redeclaração)
let y = 1;
// let y = 2; // COMENTADO: causaria erro (descomentar para testar)

// ⚠️ WARNING 5: prefer-const (deveria usar const)
let neverReassigned = 'test'; // deveria ser const

// ✅ CÓDIGO VÁLIDO (para comparação)
const validVariable = 'test';
console.log(validVariable);
console.log(testShadow());

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
