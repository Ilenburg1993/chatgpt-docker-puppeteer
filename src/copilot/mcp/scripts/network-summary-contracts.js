// @ts-check
/**
 * Validate and explain the canonical DevContainer network summary-contract catalog.
 *
 * Zero external dependencies by design. The parser accepts JSONC comments and trailing commas while rejecting duplicate
 * object keys before object materialization.
 *
 * @module copilot/mcp/scripts/network-summary-contracts
 */

import { createWorkspaceReadIo } from '#copilot/infra/public/composition/workspace/read-io';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const networkContractsWorkspaceIo = createWorkspaceReadIo({ workspaceRoot: REPO_ROOT });
export const DEFAULT_NETWORK_SUMMARY_CONTRACTS_FILE = '.devcontainer/scripts/network/contracts/summary-contracts.jsonc';
const DEFAULT_COMMAND = `node src/copilot/mcp/scripts/network-summary-contracts.js validate ${DEFAULT_NETWORK_SUMMARY_CONTRACTS_FILE}`;
const DEFAULT_EXPLAIN_COMMAND = `node src/copilot/mcp/scripts/network-summary-contracts.js explain ${DEFAULT_NETWORK_SUMMARY_CONTRACTS_FILE}`;
const SECRET_BEARING_KEY =
    /(?:^|[_-])(?:api[_-]?key|authorization|bearer|cookie|password|private[_-]?key|secret|token)(?:$|[_-])/iu;
const SEMVER = /^\d+\.\d+\.\d+$/u;
const PRODUCER_VERSION = /^v\d+\.\d+\.\d+$/u;

/** @typedef {{ type: 'punct' | 'string' | 'primitive' | 'eof'; value: string; offset: number }} JsonToken */

/** @param {string} source */
function stripJsoncComments(source) {
    const chars = [...source];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        const next = chars[index + 1];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '/' && next === '/') {
            chars[index] = ' ';
            chars[index + 1] = ' ';
            index += 2;
            while (index < chars.length && chars[index] !== '\n' && chars[index] !== '\r') {
                chars[index] = ' ';
                index += 1;
            }
            index -= 1;
            continue;
        }
        if (char === '/' && next === '*') {
            chars[index] = ' ';
            chars[index + 1] = ' ';
            index += 2;
            let closed = false;
            while (index < chars.length) {
                if (chars[index] === '*' && chars[index + 1] === '/') {
                    chars[index] = ' ';
                    chars[index + 1] = ' ';
                    index += 1;
                    closed = true;
                    break;
                }
                if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
                index += 1;
            }
            if (!closed) throw new SyntaxError('Unterminated JSONC block comment.');
        }
    }
    return chars.join('');
}

/** @param {string} source */
function removeTrailingCommas(source) {
    const chars = [...source];
    let inString = false;
    let escaped = false;
    for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        if (inString) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char !== ',') continue;
        let lookahead = index + 1;
        while (lookahead < chars.length && /\s/u.test(chars[lookahead] ?? '')) lookahead += 1;
        if (chars[lookahead] === '}' || chars[lookahead] === ']') chars[index] = ' ';
    }
    return chars.join('');
}

/** @param {string} source */
function tokenizeJson(source) {
    /** @type {JsonToken[]} */
    const tokens = [];
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        if (/\s/u.test(char ?? '')) {
            index += 1;
            continue;
        }
        if ('{}[]:,'.includes(char ?? '')) {
            tokens.push({ type: 'punct', value: /** @type {string} */ (char), offset: index });
            index += 1;
            continue;
        }
        if (char === '"') {
            const start = index;
            index += 1;
            let escaped = false;
            while (index < source.length) {
                const current = source[index];
                if (escaped) escaped = false;
                else if (current === '\\') escaped = true;
                else if (current === '"') {
                    index += 1;
                    break;
                }
                index += 1;
            }
            if (source[index - 1] !== '"') throw new SyntaxError(`Unterminated JSON string at offset ${start}.`);
            const literal = source.slice(start, index);
            tokens.push({ type: 'string', value: JSON.parse(literal), offset: start });
            continue;
        }
        const start = index;
        while (index < source.length && !/\s/u.test(source[index] ?? '') && !'{}[]:,'.includes(source[index] ?? ''))
            index += 1;
        const value = source.slice(start, index);
        if (!value) throw new SyntaxError(`Unexpected JSON token at offset ${start}.`);
        tokens.push({ type: 'primitive', value, offset: start });
    }
    tokens.push({ type: 'eof', value: '', offset: source.length });
    return tokens;
}

/**
 * @param {string} source
 * @returns {{ value: unknown; duplicateKeys: { path: string; key: string; offset: number }[] }}
 */
export function parseJsoncWithDuplicateKeys(source) {
    const clean = removeTrailingCommas(stripJsoncComments(source));
    const tokens = tokenizeJson(clean);
    let cursor = 0;
    /** @type {{ path: string; key: string; offset: number }[]} */
    const duplicateKeys = [];
    const current = () => tokens[cursor] ?? tokens[tokens.length - 1];
    /** @param {string} punctuation */
    const expectPunct = (punctuation) => {
        const token = current();
        if (token?.type !== 'punct' || token.value !== punctuation) {
            throw new SyntaxError(`Expected '${punctuation}' at offset ${token?.offset ?? clean.length}.`);
        }
        cursor += 1;
    };
    /** @param {string} path */
    const parseValue = (path) => {
        const token = current();
        if (!token) throw new SyntaxError('Unexpected end of JSONC input.');
        if (token.type === 'string') {
            cursor += 1;
            return token.value;
        }
        if (token.type === 'primitive') {
            cursor += 1;
            if (token.value === 'true') return true;
            if (token.value === 'false') return false;
            if (token.value === 'null') return null;
            if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(token.value)) return Number(token.value);
            throw new SyntaxError(`Invalid JSON primitive '${token.value}' at offset ${token.offset}.`);
        }
        if (token.type === 'punct' && token.value === '{') {
            cursor += 1;
            /** @type {Record<string, unknown>} */
            const object = {};
            const seen = new Set();
            if (current()?.type === 'punct' && current()?.value === '}') {
                cursor += 1;
                return object;
            }
            while (true) {
                const keyToken = current();
                if (keyToken?.type !== 'string')
                    throw new SyntaxError(`Expected object key at offset ${keyToken?.offset ?? clean.length}.`);
                cursor += 1;
                const key = keyToken.value;
                const childPath = path ? `${path}.${key}` : key;
                if (seen.has(key)) duplicateKeys.push({ path: path || '$', key, offset: keyToken.offset });
                seen.add(key);
                expectPunct(':');
                object[key] = parseValue(childPath);
                const separator = current();
                if (separator?.type === 'punct' && separator.value === '}') {
                    cursor += 1;
                    break;
                }
                expectPunct(',');
            }
            return object;
        }
        if (token.type === 'punct' && token.value === '[') {
            cursor += 1;
            /** @type {unknown[]} */
            const array = [];
            if (current()?.type === 'punct' && current()?.value === ']') {
                cursor += 1;
                return array;
            }
            while (true) {
                array.push(parseValue(`${path}[${array.length}]`));
                const separator = current();
                if (separator?.type === 'punct' && separator.value === ']') {
                    cursor += 1;
                    break;
                }
                expectPunct(',');
            }
            return array;
        }
        throw new SyntaxError(`Unexpected JSON token '${token.value}' at offset ${token.offset}.`);
    };
    const value = parseValue('$');
    if (current()?.type !== 'eof')
        throw new SyntaxError(`Unexpected trailing JSON token at offset ${current()?.offset ?? clean.length}.`);
    return { value, duplicateKeys };
}

/** @param {unknown} value */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : null;
}

/** @param {unknown} value */
function stringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? /** @type {string[]} */ (value)
        : null;
}

/** @param {string[]} values */
function duplicates(values) {
    const seen = new Set();
    const duplicate = new Set();
    for (const value of values) {
        if (seen.has(value)) duplicate.add(value);
        seen.add(value);
    }
    return [...duplicate];
}

/** @param {string} workspacePath */
async function isExistingWorkspaceFile(workspacePath) {
    if (!workspacePath || isAbsolute(workspacePath) || workspacePath.includes('..')) return false;
    try {
        const info = (await networkContractsWorkspaceIo.statPath(resolve(REPO_ROOT, workspacePath))).stats;
        return info.isFile();
    } catch {
        return false;
    }
}

/**
 * @param {unknown} parsed
 * @param {{ duplicateKeys?: { path: string; key: string; offset: number }[] }} [options]
 */
export async function validateNetworkSummaryContractsValue(parsed, options = {}) {
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    const root = asRecord(parsed);
    if (!root) return { ok: false, errors: ['Catalog root must be an object.'], warnings, summary: null };
    for (const duplicate of options.duplicateKeys ?? []) {
        errors.push(`Duplicate object key '${duplicate.key}' at ${duplicate.path} (offset ${duplicate.offset}).`);
    }
    if (typeof root['schemaVersion'] !== 'string' || !SEMVER.test(root['schemaVersion']))
        errors.push('schemaVersion must be semantic version x.y.z.');
    if (root['status'] !== 'canonical')
        warnings.push(`catalog status is '${String(root['status'] ?? 'missing')}', expected 'canonical'.`);
    if (root['canonicalPath'] !== DEFAULT_NETWORK_SUMMARY_CONTRACTS_FILE)
        errors.push(`canonicalPath must be ${DEFAULT_NETWORK_SUMMARY_CONTRACTS_FILE}.`);

    const common = asRecord(root['common']);
    const formats = asRecord(common?.['fileFormats']);
    if (!formats || Object.keys(formats).length === 0)
        errors.push('common.fileFormats must declare at least one format.');
    const artifacts = asRecord(root['artifacts']);
    if (!artifacts || Object.keys(artifacts).length === 0)
        errors.push('artifacts must declare at least one artifact contract.');

    const seenPaths = new Map();
    const producers = new Set();
    let requiredKeyCount = 0;
    let secretBearingKeyCount = 0;
    if (artifacts) {
        for (const [artifactId, candidate] of Object.entries(artifacts)) {
            const artifact = asRecord(candidate);
            if (!artifact) {
                errors.push(`artifact ${artifactId} must be an object.`);
                continue;
            }
            const artifactPath = typeof artifact['path'] === 'string' ? artifact['path'] : '';
            if (!artifactPath || !isAbsolute(artifactPath))
                errors.push(`artifact ${artifactId} path must be absolute.`);
            else if (seenPaths.has(artifactPath))
                errors.push(
                    `artifact path ${artifactPath} is reused by ${String(seenPaths.get(artifactPath))} and ${artifactId}.`,
                );
            else seenPaths.set(artifactPath, artifactId);

            const format = typeof artifact['format'] === 'string' ? artifact['format'] : '';
            if (!format || !formats?.[format])
                errors.push(`artifact ${artifactId} references unknown format '${format || 'missing'}'.`);

            const producer = typeof artifact['producer'] === 'string' ? artifact['producer'] : '';
            if (!producer) errors.push(`artifact ${artifactId} producer is missing.`);
            else {
                producers.add(producer);
                if (!(await isExistingWorkspaceFile(producer)))
                    errors.push(`artifact ${artifactId} producer does not exist: ${producer}.`);
            }
            const producerVersion = typeof artifact['producerVersion'] === 'string' ? artifact['producerVersion'] : '';
            if (!PRODUCER_VERSION.test(producerVersion))
                errors.push(`artifact ${artifactId} producerVersion must be vX.Y.Z.`);

            const requiredKeys = stringArray(artifact['requiredKeys']);
            if (!requiredKeys) errors.push(`artifact ${artifactId} requiredKeys must be a string array.`);
            else {
                requiredKeyCount += requiredKeys.length;
                for (const duplicate of duplicates(requiredKeys))
                    errors.push(`artifact ${artifactId} duplicates requiredKey '${duplicate}'.`);
                for (const key of requiredKeys) {
                    if (!/^<[^>]+>$/u.test(key) && SECRET_BEARING_KEY.test(key)) {
                        secretBearingKeyCount += 1;
                        errors.push(`artifact ${artifactId} declares secret-bearing key '${key}'.`);
                    }
                }
            }
            for (const field of ['acceptedStatusValues', 'invariants']) {
                if (artifact[field] === undefined) continue;
                const values = stringArray(artifact[field]);
                if (!values) errors.push(`artifact ${artifactId} ${field} must be a string array.`);
                else
                    for (const duplicate of duplicates(values))
                        errors.push(`artifact ${artifactId} duplicates ${field} value '${duplicate}'.`);
            }
        }
    }

    const validatorProfile = asRecord(root['validatorProfile']);
    if (!validatorProfile) errors.push('validatorProfile must be an object.');
    else {
        if (validatorProfile['implementationStatus'] !== 'active')
            errors.push("validatorProfile.implementationStatus must be 'active'.");
        if (validatorProfile['recommendedCommand'] !== DEFAULT_COMMAND)
            errors.push(`validatorProfile.recommendedCommand must be '${DEFAULT_COMMAND}'.`);
        if (validatorProfile['explainerCommand'] !== DEFAULT_EXPLAIN_COMMAND)
            errors.push(`validatorProfile.explainerCommand must be '${DEFAULT_EXPLAIN_COMMAND}'.`);
        const checks = stringArray(validatorProfile['requiredChecks']);
        if (!checks || checks.length === 0)
            errors.push('validatorProfile.requiredChecks must be a non-empty string array.');
        else
            for (const duplicate of duplicates(checks))
                errors.push(`validatorProfile.requiredChecks duplicates '${duplicate}'.`);
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        summary: {
            schemaVersion: root['schemaVersion'] ?? null,
            status: root['status'] ?? null,
            artifactCount: artifacts ? Object.keys(artifacts).length : 0,
            formatCount: formats ? Object.keys(formats).length : 0,
            producerCount: producers.size,
            requiredKeyCount,
            secretBearingKeyCount,
            duplicateObjectKeyCount: options.duplicateKeys?.length ?? 0,
        },
    };
}

/** @param {string} [workspacePath] */
export async function validateNetworkSummaryContractsFile(workspacePath = DEFAULT_NETWORK_SUMMARY_CONTRACTS_FILE) {
    const absolute = resolve(REPO_ROOT, workspacePath);
    const source = (await networkContractsWorkspaceIo.readTextFresh(absolute, { includeHash: false })).content;
    let parsed;
    try {
        parsed = parseJsoncWithDuplicateKeys(source);
    } catch (error) {
        return {
            ok: false,
            file: workspacePath,
            errors: [error instanceof Error ? error.message : String(error)],
            warnings: [],
            summary: null,
        };
    }
    const validation = await validateNetworkSummaryContractsValue(parsed.value, {
        duplicateKeys: parsed.duplicateKeys,
    });
    return { file: workspacePath, ...validation };
}

/** @param {string} [workspacePath] */
export async function explainNetworkSummaryContractsFile(workspacePath = DEFAULT_NETWORK_SUMMARY_CONTRACTS_FILE) {
    const validation = await validateNetworkSummaryContractsFile(workspacePath);
    return {
        ...validation,
        commands: { validate: DEFAULT_COMMAND, explain: DEFAULT_EXPLAIN_COMMAND },
        authority: 'static-contract-catalog',
    };
}

async function main() {
    const action = process.argv[2] ?? 'validate';
    const workspacePath = process.argv[3] ?? DEFAULT_NETWORK_SUMMARY_CONTRACTS_FILE;
    if (!['validate', 'explain'].includes(action)) {
        process.stderr.write(
            `Usage: node src/copilot/mcp/scripts/network-summary-contracts.js <validate|explain> [catalog]\n`,
        );
        process.exitCode = 2;
        return;
    }
    const result =
        action === 'explain'
            ? await explainNetworkSummaryContractsFile(workspacePath)
            : await validateNetworkSummaryContractsFile(workspacePath);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
