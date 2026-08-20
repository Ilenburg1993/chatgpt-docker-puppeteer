declare module 'madge' {
    export interface MadgeOptions {
        fileExtensions?: readonly string[];
    }

    export interface MadgeResult {
        obj(): Record<string, string[]>;
    }

    export default function madge(
        path: string | readonly string[],
        options?: MadgeOptions,
    ): Promise<MadgeResult>;
}
