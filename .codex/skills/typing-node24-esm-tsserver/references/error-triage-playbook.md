# Playbook de Triage de Erros TS (pacotes)

## Sequência de ataque
1. Executar `npm run -s typecheck:node`.
2. Agrupar erros por código (`TS2307`, `TS2339`, `TS7006`, etc.).
3. Resolver primeiro erros estruturais de import/resolução.
4. Resolver contratos de API (tipos de parâmetros/retornos).
5. Resolver `implicit any` e refinamentos finais.

## Mapeamento rápido de correção
- `TS2307`, `TS2835`: corrigir caminho, extensão `.js`, alias `paths`, arquivo alvo.
- `TS2339`: adicionar propriedade no tipo/typedef ou ajustar narrowing.
- `TS2345`, `TS2322`: alinhar assinatura da função e o tipo passado.
- `TS7006`, `TS7031`: adicionar `@param` e tipos de destructuring.
- `TS2554`: ajustar aridade e parâmetros opcionais/defaults.
- `TS2688`, `TS7016`: declarar tipo ausente (`.d.ts`) ou ajustar import.

## Estratégia por lote
1. Corrigir 1 código de erro por vez.
2. Rodar `typecheck:node` após cada lote.
3. Evitar refactors amplos enquanto houver erro estrutural ativo.
4. Confirmar que correção não quebrou `lint` e `test:unit`.

## Critério de aceitação por lote
- Redução líquida do total de erros.
- Nenhuma regressão de runtime aparente.
- Mudanças com contrato documentado (JSDoc/typedef/.d.ts).
