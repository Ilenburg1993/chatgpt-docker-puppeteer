// @ts-check
/** JSDoc-only contracts for the in-memory L1 cache. */
/**
 * @typedef {object} IoCacheEntry
 * @property {Buffer|string} content
 * @property {number} bytes
 * @property {number} cachedAt
 * @property {number} [mtime]
 * @property {number} [size]
 * @property {number} [ctime]
 * @property {number} [dev]
 * @property {number} [ino]
 * @property {number} [lastValidatedAt]
 * @property {number} [accessCount]
 * @property {string} [contentHash]
 * @property {string} [fingerprintStrategy]
 * @typedef {{hits:number;misses:number;evictions:number;invalidations:number;staleHits:number;hashRevalidations:number;hashRevalidationHits:number;size:number;bytesStored:number;ttlMs:number;staleProbeIntervalMs:number;hashRevalidateMaxBytes:number}} IoCacheStats
 * @typedef {{get:(key:string)=>IoCacheEntry|null;getVerified:(key:string,filePath:string)=>Promise<IoCacheEntry|null>;set:(key:string,entry:IoCacheEntry)=>void;invalidate:(filePath:string,options?:{recursive?:boolean})=>void;stats:()=>IoCacheStats;clear:()=>void;reset:()=>void;dispose:()=>void;readonly materialized:boolean}} IoL1Cache
 */
export {};
