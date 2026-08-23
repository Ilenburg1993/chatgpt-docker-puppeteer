// @ts-check
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isPrivateIp } from './address.js';
import { PublicNetworkPolicyError } from './url.js';

/** @typedef {{address:string;family:number}} AddressRecord */
/** @typedef {(hostname:string, options:{all:true;verbatim:true}) => Promise<AddressRecord[]>} DnsResolver */

/** @param {string} hostname @param {{allowPrivate?:boolean;resolver?:DnsResolver;family?:number}} [options] */
export async function resolvePublicAddresses(hostname, options = {}) {
    const host = hostname
        .toLowerCase()
        .replace(/^\[|\]$/gu, '')
        .replace(/\.$/u, '');
    const literalFamily = isIP(host);
    /** @type {AddressRecord[]} */
    let records;
    if (literalFamily) records = [{ address: host, family: literalFamily }];
    else {
        try {
            const resolver = /** @type {DnsResolver} */ (options.resolver ?? dnsLookup);
            records = await resolver(host, { all: true, verbatim: true });
        } catch (cause) {
            throw new PublicNetworkPolicyError(
                `Falha DNS para ${host}; conexão bloqueada por fail-closed.`,
                'DNS_RESOLUTION_FAILED',
                { cause },
            );
        }
    }
    if (!Array.isArray(records) || records.length === 0)
        throw new PublicNetworkPolicyError(`DNS sem endereços para ${host}.`, 'DNS_NO_ADDRESSES');
    const normalized = records.filter(
        (record) =>
            (record.family === 4 || record.family === 6) && (!options.family || options.family === record.family),
    );
    if (normalized.length === 0)
        throw new PublicNetworkPolicyError(`DNS sem endereço compatível para ${host}.`, 'DNS_NO_COMPATIBLE_ADDRESS');
    if (options.allowPrivate !== true) {
        const blocked = normalized.find((record) => isPrivateIp(record.address));
        if (blocked)
            throw new PublicNetworkPolicyError(
                `DNS/SSRF bloqueado: ${host} resolveu para endereço não público ${blocked.address}.`,
                'DNS_PRIVATE_ADDRESS',
            );
    }
    return Object.freeze(normalized.map((record) => Object.freeze({ address: record.address, family: record.family })));
}

/**
 * Node lookup callback that validates and returns the exact addresses used by the socket connector. This closes the
 * resolve-then-fetch TOCTOU window: the request cannot perform an independent second DNS resolution.
 * @param {{allowPrivate?:boolean;resolver?:DnsResolver}} [policy]
 * @returns {import('node:net').LookupFunction}
 */
export function createPinnedPublicLookup(policy = {}) {
    /** @type {import('node:net').LookupFunction} */
    const lookup = (hostname, options, callback) => {
        const family =
            typeof options === 'object' && typeof options.family === 'number' && options.family > 0
                ? options.family
                : undefined;
        const all = typeof options === 'object' && options.all === true;
        resolvePublicAddresses(hostname, { ...policy, ...(family ? { family } : {}) }).then(
            (records) => {
                if (all) {
                    /** @type {(error:null, addresses:AddressRecord[])=>void} */ (callback)(null, [...records]);
                    return;
                }
                const selected = records[0];
                if (!selected) {
                    const error = new PublicNetworkPolicyError(
                        `DNS sem endereço selecionável para ${hostname}.`,
                        'DNS_NO_ADDRESS',
                    );
                    if (all) /** @type {(error:Error, addresses:AddressRecord[])=>void} */ (callback)(error, []);
                    else /** @type {(error:Error,address:string,family:number)=>void} */ (callback)(error, '', 0);
                    return;
                }
                /** @type {(error:null,address:string,family:number)=>void} */ (callback)(
                    null,
                    selected.address,
                    selected.family,
                );
            },
            (error) => {
                const normalized = /** @type {Error} */ (error);
                if (all) /** @type {(error:Error, addresses:AddressRecord[])=>void} */ (callback)(normalized, []);
                else /** @type {(error:Error,address:string,family:number)=>void} */ (callback)(normalized, '', 0);
            },
        );
    };
    return lookup;
}
