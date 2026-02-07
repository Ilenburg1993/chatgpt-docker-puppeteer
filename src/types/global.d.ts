/**
 * Global Type Extensions
 *
 * Extensões de tipos nativos do JavaScript/TypeScript.
 * Declarações globais que não pertencem a nenhum módulo específico.
 */

// ============================================================
// Error Extensions
// ============================================================

interface Error {
  /** Detalhes adicionais do erro */
  details?: string | Record<string, unknown>;

  /** Histórico de tentativas (recovery systems) */
  history?: Array<{
    attempt?: number;
    error?: unknown;
    errorClass?: string;
    ts?: number;
    timestamp?: number;
    action?: string;
    result?: string;
    [key: string]: unknown;
  }>;

  /** Número de tentativas */
  attempts?: number;

  /** Operação que causou o erro */
  operation?: string;

  /** Código de erro */
  code?: string | number;

  /** Contexto adicional */
  context?: Record<string, unknown>;

  /** Deprecation warnings */
  originalFunction?: string;
  replacedBy?: string;

  /** Status HTTP ou custom */
  status?: number | string;
}

// ============================================================
// Navigator Extensions
// ============================================================

interface Navigator {
  /** User Agent Client Hints API (experimental) */
  userAgentData?: {
    brands: Array<{ brand: string; version: string }>;
    mobile: boolean;
    platform: string;
  };
}

// ============================================================
// Puppeteer Types (global para browser context)
// ============================================================

declare class Page {
  evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;
  $<T>(selector: string): Promise<T | null>;
  $$<T>(selector: string): Promise<T[]>;
  waitForSelector(selector: string, options?: unknown): Promise<unknown>;
  url(): string;
  close(): Promise<void>;
  [key: string]: unknown;
}

declare class Browser {
  close(): Promise<void>;
  pages(): Promise<Page[]>;
  wsEndpoint(): string;
  [key: string]: unknown;
}

declare class BrowserPoolManager {
  constructor(config?: unknown);
  allocate(options?: unknown): Promise<unknown>;
  release(page: unknown): Promise<void>;
  getStats(): unknown;
}

// ============================================================
// Puppeteer Module (complete)
// ============================================================

declare module 'puppeteer' {
  export function executablePath(): string;

  export interface ConnectOptions {
    browserWSEndpoint?: string;
    browserURL?: string;
    timeout?: number;
    [key: string]: unknown;
  }

  export interface LaunchOptions {
    headless?: boolean;
    executablePath?: string;
    args?: string[];
    [key: string]: unknown;
  }

  export class Browser {
    close(): Promise<void>;
    pages(): Promise<Page[]>;
    wsEndpoint(): string;
    [key: string]: unknown;
  }

  export class Page {
    evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T>;
    $<T>(selector: string): Promise<T | null>;
    $$<T>(selector: string): Promise<T[]>;
    waitForSelector(selector: string, options?: unknown): Promise<unknown>;
    url(): string;
    close(): Promise<void>;
    [key: string]: unknown;
  }
}

// ============================================================
// Puppeteer Extra
// ============================================================

declare module 'puppeteer-extra' {
  import type { Browser, ConnectOptions, LaunchOptions } from 'puppeteer';

  export interface PuppeteerExtra {
    use(plugin: unknown): this;
    connect(options?: ConnectOptions & { timeout?: number }): Promise<Browser>;
    launch(options?: LaunchOptions): Promise<Browser>;
  }

  const puppeteer: PuppeteerExtra;
  export default puppeteer;
}

// ============================================================
// Zod Module - Permitir uso como valor em arquivos JavaScript
// ============================================================

declare module 'zod' {
  // Tipos básicos do Zod
  export interface ZodType<T = any> {
    parse(data: unknown): T;
    safeParse(data: unknown): { success: boolean; data?: T; error?: unknown };
    optional(): ZodType<T | undefined>;
    nullable(): ZodType<T | null>;
    default(value: T): ZodType<T>;
    [key: string]: any;
  }

  export interface ZodString extends ZodType<string> {
    min(limit: number, message?: string): this;
    max(limit: number, message?: string): this;
    email(message?: string): this;
    url(message?: string): this;
    uuid(message?: string): this;
    [key: string]: any;
  }

  export interface ZodNumber extends ZodType<number> {
    min(limit: number, message?: string): this;
    max(limit: number, message?: string): this;
    int(message?: string): this;
    positive(message?: string): this;
    nonnegative(message?: string): this;
    [key: string]: any;
  }

  export interface ZodBoolean extends ZodType<boolean> {}

  export interface ZodArray<T = any> extends ZodType<T[]> {
    min(limit: number, message?: string): this;
    max(limit: number, message?: string): this;
    length(len: number, message?: string): this;
    nonempty(message?: string): this;
    [key: string]: any;
  }

  export interface ZodObject<T = any> extends ZodType<T> {
    shape: Record<string, ZodType>;
    extend(shape: Record<string, ZodType>): ZodObject;
    merge(other: ZodObject): ZodObject;
    pick(keys: Record<string, true>): ZodObject;
    omit(keys: Record<string, true>): ZodObject;
    partial(): ZodObject;
    [key: string]: any;
  }

  export interface ZodEnum<T extends string = string> extends ZodType<T> {
    enum: readonly T[];
    [key: string]: any;
  }

  export interface ZodUnion<T = any> extends ZodType<T> {}
  export interface ZodIntersection<T = any> extends ZodType<T> {}
  export interface ZodTuple<T = any> extends ZodType<T> {}
  export interface ZodRecord<T = any> extends ZodType<T> {}
  export interface ZodMap<T = any> extends ZodType<T> {}
  export interface ZodSet<T = any> extends ZodType<T> {}
  export interface ZodFunction<T = any> extends ZodType<T> {}
  export interface ZodLazy<T = any> extends ZodType<T> {}
  export interface ZodLiteral<T = any> extends ZodType<T> {}
  export interface ZodEffects<T = any> extends ZodType<T> {}
  export interface ZodNative<T = any> extends ZodType<T> {}
  export interface ZodPromise<T = any> extends ZodType<Promise<T>> {}

  // ✅ CRÍTICO: Exportar z como objeto com métodos
  // Isso permite usar z.string(), z.object(), etc. em arquivos .js com @ts-check
  export const z: {
    string(): ZodString;
    number(): ZodNumber;
    boolean(): ZodBoolean;
    array<T>(schema: ZodType<T>): ZodArray<T>;
    object<T extends Record<string, ZodType>>(shape: T): ZodObject;
    object<T extends Record<string, ZodType>>(shape: T, params?: unknown): ZodObject;
    union<T extends readonly [ZodType, ZodType, ...ZodType[]]>(types: T): ZodUnion;
    union<T extends readonly [ZodType, ZodType, ...ZodType[]]>(types: T, params?: unknown): ZodUnion;
    intersection<A, B>(left: ZodType<A>, right: ZodType<B>): ZodIntersection;
    tuple<T extends [ZodType, ...ZodType[]]>(schemas: T): ZodTuple;
    record<T>(valueSchema: ZodType<T>): ZodRecord<T>;
    record<K, V>(keySchema: ZodType<K>, valueSchema: ZodType<V>): ZodRecord<V>;
    map<K, V>(keySchema: ZodType<K>, valueSchema: ZodType<V>): ZodMap;
    set<T>(schema: ZodType<T>): ZodSet<T>;
    lazy<T>(fn: () => ZodType<T>): ZodLazy<T>;
    literal<T>(value: T): ZodLiteral<T>;
    effects<T>(schema: ZodType<T>): ZodEffects<T>;
    native<T>(check: (data: unknown) => boolean): ZodNative<T>;
    promise<T>(schema: ZodType<T>): ZodPromise<T>;
    any(): ZodType<any>;
    unknown(): ZodType<unknown>;
    never(): ZodType<never>;
    coerce: any;

    // Palavras reservadas do TypeScript (usando computed property names)
    'enum'<T extends readonly [string, ...string[]]>(values: T): ZodEnum<T[number]>;
    'enum'<T extends readonly [string, ...string[]]>(values: T, params?: unknown): ZodEnum<T[number]>;
    'function'<Args extends ZodTuple, Returns extends ZodType>(args: Args, returns: Returns): ZodFunction;
    'void'(): ZodType<void>;
    'undefined'(): ZodType<undefined>;
    'null'(): ZodType<null>;

    // Permitir qualquer outra propriedade/método (signatures dinâmicas)
    [key: string]: any;
  };
}

// ============================================================
// Type Helpers Globais
// ============================================================

/**
 * Type helper para objetos dinâmicos com propriedades conhecidas
 */
type DynamicObject<T = unknown> = Record<string, unknown> & T;

/**
 * Type helper para tornar propriedades específicas required
 */
type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Type helper para propriedades opcionais
 */
type Optional<T> = T | undefined;

/**
 * Type helper para callbacks
 */
type Callback<T = void> = (error?: Error, result?: T) => void;

/**
 * Type helper para promises que podem retornar void
 */
type MaybePromise<T> = T | Promise<T>;
