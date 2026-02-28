// Shared prompts for audit skills
// Export strings so that SKILL.md files can reference them by name.

export const readCodePrompt = `Você é um auditor de código. Antes de mais nada, identifique a intenção / finalidade do código apresentado – o que ele deveria fazer no fluxo maior da aplicação. Em seguida, responda:
1. Existe validação de entrada suficiente? Onde poderiam ocorrer undefined/null?
2. Há loops ou recursões que podem gerar bloqueio ou uso excessivo de CPU?
3. Comente se há padrões conhecidos de bugs (variáveis globais, callback omisso, sincronização incorreta, etc.).
4. Sugira pequenas melhorias ou riscos potenciais.`;

export const triagePrompt = `Você recebeu um conjunto de findings de auditoria. Classifique-os em ordem de severidade e sugira um patch simplificado para os 3 primeiros. Forneça também uma justificativa curta para cada classificação.`;

export const generateReadmePrompt = `O código abaixo não possui README. Escreva um parágrafo de README explicando seu propósito, como é usado e quaisquer pré-requisitos ou limitações.`;
