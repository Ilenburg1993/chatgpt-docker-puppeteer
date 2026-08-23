// @ts-check
import { BlockList, isIP } from 'node:net';

/** @type {readonly (readonly [string, number])[]} */
const IPV4_SUBNETS = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
];
/** @type {readonly (readonly [string, number])[]} */
const IPV6_SUBNETS = [
    ['::', 128],
    ['::1', 128],
    ['100::', 64],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8],
];

const IPV4_BLOCKS = new BlockList();
for (const [network, prefix] of IPV4_SUBNETS) IPV4_BLOCKS.addSubnet(network, prefix, 'ipv4');
const IPV6_BLOCKS = new BlockList();
for (const [network, prefix] of IPV6_SUBNETS) IPV6_BLOCKS.addSubnet(network, prefix, 'ipv6');

/** @param {string} address @returns {string | null} */
function mappedIpv4(address) {
    const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(address);
    if (dotted?.[1] && isIP(dotted[1]) === 4) return dotted[1];
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(address);
    if (!hex?.[1] || !hex[2]) return null;
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

/** Returns true for private, loopback, link-local, multicast, documentation, reserved and otherwise non-public IPs. */
/** @param {string} address */
export function isPrivateIp(address) {
    const normalized = String(address ?? '')
        .trim()
        .replace(/^\[|\]$/gu, '')
        .toLowerCase();
    const mapped = mappedIpv4(normalized);
    if (mapped) return IPV4_BLOCKS.check(mapped, 'ipv4');
    const family = isIP(normalized);
    if (family === 4) return IPV4_BLOCKS.check(normalized, 'ipv4');
    if (family === 6) return IPV6_BLOCKS.check(normalized, 'ipv6');
    return true;
}
