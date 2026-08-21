// @ts-check
/** Shared JSDoc-only contracts for session scopes. */

/**
 * @typedef {object} ScopeDeclareOptions
 * @property {string} sessionId - ID único da sessão LLM-B.
 * @property {string[]} [paths] - Lista explícita de paths a incluir no escopo.
 * @property {string} [directory] - Diretório raiz a escanear (alternativo a paths).
 * @property {string} [workspaceRoot] - Raiz canônica usada pelo índice compartilhado; obrigatória para auto-index
 *   seguro.
 * @property {string[]} [extensions] - Extensões a incluir no scan de diretório.
 * @property {number} [maxFiles=500] - Limite efetivo de arquivos selecionados no scan de diretório. Default is `500`
 * @property {string[]} [include] - Padrões glob simples para incluir arquivos no escopo.
 * @property {string[]} [exclude] - Padrões glob simples para excluir arquivos do escopo.
 * @property {'coverage' | 'lexical'} [selectionMode='coverage'] - Política bounded de seleção em directory scopes.
 *   Default is `'coverage'`
 * @property {string[]} [preferredPaths] - Candidatos elegíveis a priorizar dentro do mesmo hard maxFiles cap.
 * @property {string[]} [seedSymbols] - Símbolos exatos resolvidos pelo índice local para preferred paths dentro do cap.
 * @property {boolean} [recursive=true] - Se false, declara apenas arquivos imediatos do diretório. Default is `true`
 * @property {boolean} [parseSymbols=true] - Se true, parseia símbolos JS/TS em background. Default is `true`
 * @property {'auto' | 'off'} [indexMode='auto'] - Se auto, materializa índice L2/FTS para diretórios declarados.
 *   Default is `'auto'`
 * @property {number} [concurrency=8] - Concorrência do prefetch. Default is `8`
 * @property {boolean} [silent=true] - Silencia erros de leitura/parse. Default is `true`
 */

/**
 * @typedef {{
 *     mode: 'coverage' | 'lexical' | 'explicit';
 *     candidateBuckets: number;
 *     selectedBuckets: number;
 *     preferredRequested: number;
 *     preferredSelected: number;
 *     seedSymbolsRequested: number;
 *     seedSymbolPathsResolved: number;
 * }} ScopeSelectionStats
 */

/**
 * @typedef {object} ScopeStats
 * @property {string} sessionId
 * @property {number} pathCount - Total de arquivos selecionados no escopo.
 * @property {number} candidateFiles - Arquivos candidatos antes do maxFiles no scan de diretório.
 * @property {number} selectedFiles - Arquivos efetivamente selecionados.
 * @property {boolean} hardLimitReached - Indica se maxFiles cortou candidatos do diretório.
 * @property {ScopeSelectionStats} selection - Resumo compacto da política de seleção aplicada.
 * @property {number} preloaded - Arquivos carregados no L1.
 * @property {number} parsed - Arquivos parseados.
 * @property {number} failed - Arquivos com falha.
 * @property {number} invalidated - Arquivos do escopo invalidados desde o último refresh.
 * @property {{
 *     available: boolean;
 *     requested: number;
 *     indexed: number;
 *     unchanged: number;
 *     invalidated: number;
 *     snapshotReuses: number;
 *     parsedSymbolReuses: number;
 *     parsedSymbolPolicyRejects: number;
 *     failed: number;
 *     durationMs: number;
 *     mode: 'selected-path-refresh';
 * } | null} index
 * @property {number} symbolBytes - Estimativa UTF-8 do estado simbólico mantido pelo escopo.
 * @property {number} warmDurationMs - Duração do warm-up em ms.
 * @property {boolean} ready - Se o escopo está pronto (prefetch completo).
 * @property {boolean} degraded - Se o último warm-up/refresh terminou com falha.
 * @property {'warming' | 'ready' | 'stale' | 'degraded'} status
 * @property {ScopeFailureSummary | null} lastError - Erro sanitizado, sem path/mensagem crua.
 * @property {number} startedAt - Timestamp de início.
 * @property {number | null} completedAt - Timestamp do último warm-up/refresh concluído.
 * @property {number} maxActiveScopes - Capacidade máxima configurada para escopos ativos simultâneos.
 */

/**
 * @typedef {{
 *     phase: 'warm' | 'parse' | 'index' | 'refresh' | 'lifecycle';
 *     code: string;
 *     name: string;
 *     summary: string;
 *     atMs: number;
 * }} ScopeFailureSummary
 */

/**
 * @typedef {object} SymbolSearchResult
 * @property {string} filePath
 * @property {import('#copilot/infra/internal/indexing/parser').SymbolEntry} symbol
 */

/**
 * @typedef {object} _InternalScope
 * @property {string} sessionId
 * @property {string | null} workspaceRoot
 * @property {string | null} directory
 * @property {string[]} paths
 * @property {Map<string, import('#copilot/infra/internal/indexing/parser').FileSymbols>} symbolIndex
 * @property {Map<string, number>} symbolBytesByPath
 * @property {number} symbolBytes
 * @property {number} candidateFiles
 * @property {number} selectedFiles
 * @property {boolean} hardLimitReached
 * @property {ScopeSelectionStats} selection
 * @property {number} refreshConcurrency
 * @property {'auto' | 'off'} indexMode
 * @property {number} preloaded
 * @property {number} failed
 * @property {Set<string>} invalidatedPaths
 * @property {{
 *     available: boolean;
 *     requested: number;
 *     indexed: number;
 *     unchanged: number;
 *     invalidated: number;
 *     snapshotReuses: number;
 *     parsedSymbolReuses: number;
 *     parsedSymbolPolicyRejects: number;
 *     failed: number;
 *     durationMs: number;
 *     mode: 'selected-path-refresh';
 * } | null} index
 * @property {number} warmDurationMs
 * @property {boolean} ready
 * @property {boolean} degraded
 * @property {ScopeFailureSummary | null} lastError
 * @property {number} startedAt
 * @property {number | null} completedAt
 * @property {number} lastAccessAt
 */

export {};
