// Shared prompts for audit skills
// Export strings so that SKILL.md files can reference them by name.

export const readCodePrompt = `Você é um auditor de código. Antes de mais nada, identifique a intenção / finalidade do código apresentado – o que ele deveria fazer no fluxo maior da aplicação. Em seguida, responda:
1. Existe validação de entrada suficiente? Onde poderiam ocorrer undefined/null?
2. Há loops ou recursões que podem gerar bloqueio ou uso excessivo de CPU?
3. Comente se há padrões conhecidos de bugs (variáveis globais, callback omisso, sincronização incorreta, etc.).
4. Sugira pequenas melhorias ou riscos potenciais.`;

export const triagePrompt = `Você recebeu um conjunto de findings de auditoria. Classifique-os em ordem de severidade e sugira um patch simplificado para os 3 primeiros. Forneça também uma justificativa curta para cada classificação.`;

export const generateReadmePrompt = `O código abaixo não possui README. Escreva um parágrafo de README explicando seu propósito, como é usado e quaisquer pré-requisitos ou limitações.`;

// sugestões adicionais que podem ser úteis no dia a dia
export const securityChecklistPrompt = `Você é um especialista em segurança. Analise o trecho de código e responda:
1. Existem vetores de ataque evidentes (injection, XSS, CSRF, etc.)?
2. Alguma informação sensível está sendo logada ou exposta?
3. As dependências usadas são conhecidas por vulnerabilidades?
Forneça uma lista curta de recomendações.`;

export const performanceAuditPrompt = `Você está revisando este algoritmo para desempenho. Indique:
1. Complexidade temporal/espacial aproximada.
2. Qualquer loop aninhado ou chamada recursiva que possa ser custosa.
3. Sugestões para otimizar ou caches que poderiam ser usados.`;

export const codeStylePrompt = `Revise o código abaixo em busca de violações das convenções do
projeto (ex.: 4 espaços, nomes em camelCase, sem var, etc.). Liste as infrações e
proponha correções.`;

export const explainModulePrompt = `Explique em linguagem clara o que este módulo faz,
dependências principais e como ele se encaixa na arquitetura geral.`;
