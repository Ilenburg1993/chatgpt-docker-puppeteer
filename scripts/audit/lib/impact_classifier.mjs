import {
    pickJSDocDeltaFiles,
    pickJsCheckFiles,
    pickPrettierFiles,
    resolveEntrypointSmokeTargets,
    summarizeChangeImpact,
} from './quality_targets.mjs';

/** @typedef {'quick'|'deep'|'nightly'} Profile */
/** @typedef {'smart'|'full'|'changed'|'off'} QualityMode */
/** @typedef {'skip'|'changed-only'|'full'} StepMode */

/**
 * @param {{ mode: StepMode, [k:string]: any }} step
 */
function step(step) {
    return step;
}

/**
 * @param {{ profile: Profile, changedFiles?: string[], qualityMode?: QualityMode, qualityJsdoc?: boolean, qualityPrettier?: boolean }} options
 */
export function buildQualityExecutionPlan(options) {
    const profile = options.profile;
    const qualityMode = options.qualityMode || (profile === 'quick' ? 'smart' : 'full');
    const impact = summarizeChangeImpact(options.changedFiles || []);
    const reasons = [];
    const fallbacks = [];

    /** @type {'changed-only'|'full'|'off'|'smart'} */
    let strategy = qualityMode === 'changed' ? 'changed-only' : qualityMode;
    /** @type {'low'|'medium'|'high'} */
    let risk = 'low';

    if (qualityMode === 'off') {
        reasons.push('quality-mode=off');
        return {
            strategy: 'off',
            risk,
            reasons,
            fallbacks,
            impact,
            steps: {
                node_check: step({ mode: 'skip', files: [] }),
                entrypoint_import_smoke: step({ mode: 'skip', targets: [] }),
                lint: step({ mode: 'skip', files: [] }),
                typecheck_node: step({ mode: 'skip' }),
                typecheck_browser: step({ mode: 'skip' }),
                prettier_check: step({ mode: 'skip', files: [] }),
                jsdoc_delta: step({ mode: 'skip', files: [] }),
                jsdoc_full: step({ mode: 'skip' }),
                ts_ignore_scan: step({ mode: 'skip' }),
            },
        };
    }

    if (profile !== 'quick' && qualityMode === 'smart') {
        strategy = 'full';
        reasons.push(`profile=${profile} => quality full`);
    }

    if (impact.onlyDocs) {
        reasons.push('docs-only changes detected');
    }
    if (impact.hasHighRiskConfig) {
        risk = 'high';
        reasons.push('high-risk quality config changed');
    } else if (impact.hasTypes || impact.hasAuditInfra) {
        risk = 'medium';
        reasons.push('types/audit infrastructure changed');
    } else if (impact.hasCode) {
        risk = 'medium';
        reasons.push('code changes detected');
    }

    if (qualityMode === 'smart' && profile === 'quick' && impact.hasHighRiskConfig) {
        fallbacks.push('config-change => full lint/typecheck/prettier');
    }

    const forceFull =
        qualityMode === 'full' || (qualityMode === 'smart' && profile === 'quick' && impact.hasHighRiskConfig);
    const changedOnly = qualityMode === 'changed' || (qualityMode === 'smart' && !forceFull);

    const jsFiles = pickJsCheckFiles(impact.changed);
    const prettierFiles = pickPrettierFiles(impact.changed);
    const jsdocDeltaFiles = pickJSDocDeltaFiles(impact.changed);
    const smokeTargets = resolveEntrypointSmokeTargets(impact.changed);

    const nodeCheckMode = forceFull
        ? jsFiles.length > 0
            ? 'changed-only'
            : 'skip'
        : changedOnly
          ? jsFiles.length > 0
              ? 'changed-only'
              : 'skip'
          : 'skip';

    const lintMode =
        impact.onlyDocs && !impact.hasHighRiskConfig
            ? 'skip'
            : forceFull
              ? 'full'
              : changedOnly
                ? impact.hasCode || impact.hasHighRiskConfig
                    ? 'changed-only'
                    : 'skip'
                : 'skip';

    const typecheckNodeMode = !impact.hasNodeTypeImpact ? 'skip' : 'full';

    const typecheckBrowserMode = !impact.hasBrowserTypeImpact ? 'skip' : 'full';

    const prettierMode =
        options.qualityPrettier === false
            ? 'skip'
            : impact.onlyDocs && prettierFiles.length === 0
              ? 'skip'
              : forceFull
                ? 'full'
                : prettierFiles.length > 0
                  ? 'changed-only'
                  : 'skip';

    const entrypointSmokeMode = smokeTargets.length > 0 ? 'changed-only' : 'skip';

    const jsdocDeltaMode =
        options.qualityJsdoc === false
            ? 'skip'
            : profile === 'quick'
              ? jsdocDeltaFiles.length > 0
                  ? 'changed-only'
                  : 'skip'
              : 'skip';

    const jsdocFullMode = options.qualityJsdoc === false ? 'skip' : profile === 'quick' ? 'skip' : 'full';

    const tsIgnoreScanMode = profile === 'quick' ? (impact.changed.length > 0 ? 'changed-only' : 'skip') : 'full';

    return {
        strategy: forceFull ? 'full' : changedOnly ? 'changed-only' : strategy,
        risk,
        reasons,
        fallbacks,
        impact,
        steps: {
            node_check: step({ mode: nodeCheckMode, files: jsFiles }),
            entrypoint_import_smoke: step({ mode: entrypointSmokeMode, targets: smokeTargets }),
            lint: step({ mode: lintMode, files: impact.changed.filter(f => /\.(js|mjs|cjs|vue|json)$/.test(f)) }),
            typecheck_node: step({ mode: typecheckNodeMode }),
            typecheck_browser: step({ mode: typecheckBrowserMode }),
            prettier_check: step({ mode: prettierMode, files: prettierFiles }),
            jsdoc_delta: step({ mode: jsdocDeltaMode, files: jsdocDeltaFiles }),
            jsdoc_full: step({ mode: jsdocFullMode }),
            ts_ignore_scan: step({ mode: tsIgnoreScanMode }),
        },
    };
}
