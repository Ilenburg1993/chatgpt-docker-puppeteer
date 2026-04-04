// @ts-check
/**
 * @module copilot/gh-bridge
 * @file GitHub CLI Bridge — barrel de compatibilidade.
 *
 *   Implementação real em `./gh/`. Este arquivo re-exporta tudo para manter backward-compat.
 * @deprecated F33.1: Barrel de compatibilidade — usar `./gh/index.js` diretamente. Este re-export será removido em
 *   versão futura.
 * @see module:copilot/bridges/gh
 */

export {
    // ci
    cancelRun,
    // issues
    closeIssue,
    commentIssue,
    createIssue,
    // prs
    diffPr,
    fmtDate,
    formatIssueList,
    formatPrList,
    // releases + utils
    formatReleaseList,
    formatRunList,
    getDefaultRepo,
    getStatus,
    listIssues,
    listPrs,
    listReleases,
    listRuns,
    mergePr,
    rawApi,
    rerunRun,
    runIcon,
    searchCode,
    searchIssues,
    viewIssue,
    viewPr,
    viewRelease,
    viewRun,
    watchRun,
} from './gh/index.js';
