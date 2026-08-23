// @ts-check
/** Pure normalization of unknown throwable values. No logging, tracking or domain classification. */
const errorCtor = /** @type {{ isError?: (value: unknown) => boolean }} */ (Error);
const isError =
    typeof errorCtor.isError === 'function'
        ? /** @type {(value: unknown) => boolean} */ (errorCtor.isError.bind(Error))
        : /** @type {(value: unknown) => boolean} */ ((value) => value instanceof Error);

/** @typedef {Error & { code?: string | number }} NormalizedError */
/**
 * @param {unknown} value
 * @returns {NormalizedError}
 */
export function toError(value) {
    if (isError(value)) return /** @type {NormalizedError} */ (value);
    if (typeof value === 'string') return /** @type {NormalizedError} */ (new Error(value));
    if (typeof value === 'object' && value !== null) {
        const objectValue = /** @type {Record<string, unknown>} */ (value);
        const serialized = (() => {
            try {
                return JSON.stringify(objectValue);
            } catch {
                return '';
            }
        })();
        const message =
            typeof objectValue['message'] === 'string' && objectValue['message'].trim()
                ? objectValue['message']
                : typeof objectValue['errorMessage'] === 'string' && objectValue['errorMessage'].trim()
                  ? objectValue['errorMessage']
                  : typeof objectValue['detail'] === 'string' && objectValue['detail'].trim()
                    ? objectValue['detail']
                    : serialized && serialized !== '{}'
                      ? serialized
                      : 'Erro recebido como objeto sem mensagem estruturada.';
        const error = /** @type {NormalizedError} */ (new Error(message));
        if (typeof objectValue['stack'] === 'string') error.stack = objectValue['stack'];
        if (typeof objectValue['code'] === 'string' || typeof objectValue['code'] === 'number')
            error.code = objectValue['code'];
        return error;
    }
    return /** @type {NormalizedError} */ (new Error(String(value)));
}

/** @typedef {{message:string;stdout?:string;stderr?:string;code?:number|string;status?:number;stack?:string}} ExecError */
/** @param {unknown} value @returns {ExecError} */
export function toExecError(value) {
    if (isError(value)) {
        const error = /** @type {Error} */ (value);
        const record = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (value));
        return {
            message: error.message,
            ...(typeof record['stdout'] === 'string' ? { stdout: record['stdout'] } : {}),
            ...(typeof record['stderr'] === 'string' ? { stderr: record['stderr'] } : {}),
            ...(typeof record['code'] === 'number' || typeof record['code'] === 'string'
                ? { code: record['code'] }
                : {}),
            ...(typeof record['status'] === 'number' ? { status: record['status'] } : {}),
            ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
        };
    }
    if (typeof value === 'object' && value !== null) {
        const record = /** @type {Record<string, unknown>} */ (value);
        return {
            message: typeof record['message'] === 'string' ? record['message'] : String(value),
            ...(typeof record['stdout'] === 'string' ? { stdout: record['stdout'] } : {}),
            ...(typeof record['stderr'] === 'string' ? { stderr: record['stderr'] } : {}),
            ...(typeof record['code'] === 'number' || typeof record['code'] === 'string'
                ? { code: record['code'] }
                : {}),
            ...(typeof record['status'] === 'number' ? { status: record['status'] } : {}),
            ...(typeof record['stack'] === 'string' ? { stack: record['stack'] } : {}),
        };
    }
    return { message: String(value) };
}
