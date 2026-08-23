// @ts-check
/** Configuration-domain errors. */
export class ConfigError extends Error {
    /** @param {string} message @param {string} [code='CONFIG_ERROR'] */
    constructor(message, code = 'CONFIG_ERROR') {
        super(message);
        this.name = 'ConfigError';
        this.code = code;
        this.status = 400;
    }
}
