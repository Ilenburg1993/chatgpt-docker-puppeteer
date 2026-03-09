declare module 'turndown' {
    interface TurndownOptions {
        headingStyle?: string;
        codeBlockStyle?: string;
        hr?: string;
        bulletListMarker?: string;
        emDelimiter?: string;
        [key: string]: any;
    }

    class TurndownService {
        constructor(options?: TurndownOptions);
        turndown(html: string): string;
        keep(tags: string[]): void;
    }

    export default TurndownService;
}
