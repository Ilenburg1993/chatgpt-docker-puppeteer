// @ts-check
/**
 * Ilha de compatibilidade para a API JavaScript estável do TypeScript 6.
 *
 * TypeScript 7 é o compilador e o servidor de linguagem canônicos. O pacote TS6 permanece na raiz porque
 * `typescript-eslint` ainda exige essa faixa e porque estes analisadores dependem de APIs AST/config estáveis que o
 * pacote nativo oferece apenas sob namespaces `unstable/*`.
 */
import typescriptCompat from 'typescript';

export default typescriptCompat;
