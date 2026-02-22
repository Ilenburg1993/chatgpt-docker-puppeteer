import fs from 'node:fs';

const PRETTIER_EXT_RE = /\.(js|mjs|cjs|json|md|vue|yml|yaml|css|html)$/i;
const JS_SOURCE_RE = /\.(js|mjs|cjs)$/i;
const CODE_EXT_RE = /\.(js|mjs|cjs|ts|tsx|jsx|vue|json)$/i;

export const ENTRYPOINT_SMOKE_IMPACT_PATHS = Object.freeze([
  'src/main.js',
  'src/server/main.js',
  'src/core/env_bootstrap.js',
  'src/core/config.js',
  'src/core/entrypoint_guard.js',
  'src/driver/factory.js',
]);

/** @param {string|null|undefined} file */
export function normalizeRepoPath(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** @param {unknown} value */
export function normalizeChangedFiles(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeRepoPath).filter(Boolean))];
}

/** @param {string} file */
export function isDocOnlyFile(file) {
  const f = normalizeRepoPath(file);
  if (!f) return false;
  if (f.startsWith('DOCUMENTAÇÃO/') || f.startsWith('docs/')) return true;
  return /\.(md|txt|rst)$/i.test(f);
}

/** @param {string} file */
export function isCodeFile(file) {
  return CODE_EXT_RE.test(normalizeRepoPath(file));
}

/** @param {string} file */
export function isJsSourceFile(file) {
  return JS_SOURCE_RE.test(normalizeRepoPath(file));
}

/** @param {string} file */
export function isPrettierEligibleFile(file) {
  return PRETTIER_EXT_RE.test(normalizeRepoPath(file));
}

/** @param {string} file */
export function isDashboardFile(file) {
  const f = normalizeRepoPath(file);
  return f.startsWith('src/dashboard-ui/');
}

/** @param {string} file */
export function isBrowserTypeImpactFile(file) {
  const f = normalizeRepoPath(file);
  return (
    f.startsWith('src/dashboard-ui/') ||
    f.startsWith('src/shared/') ||
    f.startsWith('src/driver/') ||
    f.startsWith('src/types/') ||
    f === 'tsconfig.browser.json' ||
    f === 'package.json'
  );
}

/** @param {string} file */
export function isNodeTypeImpactFile(file) {
  const f = normalizeRepoPath(file);
  return (
    f.startsWith('src/') ||
    f.startsWith('scripts/') ||
    f.startsWith('tests/') ||
    f.startsWith('src/types/') ||
    f === 'tsconfig.json' ||
    f === 'jsconfig.json' ||
    f === 'package.json'
  );
}

/** @param {string} file */
export function isHighRiskQualityConfigFile(file) {
  const f = normalizeRepoPath(file);
  return (
    f === 'package.json' ||
    f === 'tsconfig.json' ||
    f === 'tsconfig.browser.json' ||
    f === 'jsconfig.json' ||
    f === 'eslint.config.js' ||
    f === 'eslint.config.mjs' ||
    f === '.eslintrc' ||
    f.startsWith('.eslintrc.') ||
    f === '.prettierrc' ||
    f.startsWith('.prettierrc.') ||
    f === 'prettier.config.js' ||
    f === 'prettier.config.mjs' ||
    f.startsWith('scripts/audit/')
  );
}

/** @param {string[]} files */
export function filterExistingFiles(files) {
  return files.filter(file => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  });
}

/** @param {string[]} changed */
export function pickJsCheckFiles(changed) {
  return filterExistingFiles(changed.filter(isJsSourceFile));
}

/** @param {string[]} changed */
export function pickPrettierFiles(changed) {
  return filterExistingFiles(changed.filter(isPrettierEligibleFile));
}

/** @param {string[]} changed */
export function pickJSDocDeltaFiles(changed) {
  return filterExistingFiles(
    changed.filter(file => isJsSourceFile(file) && !file.includes('/dist/') && !file.startsWith('src/dashboard-ui/dist/'))
  );
}

/** @param {string[]} changed */
export function summarizeChangeImpact(changed) {
  const normalized = normalizeChangedFiles(changed);
  return {
    changed: normalized,
    onlyDocs: normalized.length > 0 && normalized.every(isDocOnlyFile),
    hasCode: normalized.some(isCodeFile),
    hasHighRiskConfig: normalized.some(isHighRiskQualityConfigFile),
    hasNodeTypeImpact: normalized.some(isNodeTypeImpactFile),
    hasBrowserTypeImpact: normalized.some(isBrowserTypeImpactFile),
    hasSrcOutsideDashboard: normalized.some(f => f.startsWith('src/') && !f.startsWith('src/dashboard-ui/')),
    hasTypes: normalized.some(f => f.startsWith('src/types/')),
    hasAuditInfra: normalized.some(f => f.startsWith('scripts/audit/')),
  };
}

/** @param {string[]} changed */
export function resolveEntrypointSmokeTargets(changed) {
  const impacted = new Set();
  const normalized = normalizeChangedFiles(changed);
  for (const file of normalized) {
    if (ENTRYPOINT_SMOKE_IMPACT_PATHS.includes(file)) {
      impacted.add('src/main.js');
      impacted.add('src/server/main.js');
      continue;
    }
    if (file.startsWith('src/server/engine/')) {
      impacted.add('src/server/main.js');
      continue;
    }
    if (file === 'src/main.js') impacted.add('src/main.js');
    if (file === 'src/server/main.js') impacted.add('src/server/main.js');
  }
  return [...impacted].filter(file => fs.existsSync(file));
}
