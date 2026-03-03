// @ts-check - Type checking rigoroso habilitado (arquivo core)
import TurndownService from 'turndown';
import { parse as parseHTML } from 'node-html-parser';
import * as logger from '#core/logger';

/**
 * StructuredExtractor - Extrai resposta LLM em múltiplos formatos
 *
 * @class
 */
class StructuredExtractor {
    constructor() {
        // Configurar turndown (HTML → Markdown)
        this.turndownService = new TurndownService({
            headingStyle: 'atx', // # Heading ao invés de Heading\n========
            codeBlockStyle: 'fenced', // ```python ao invés de indentação
            hr: '---', // Horizontal rule
            bulletListMarker: '-', // - item ao invés de * item
            emDelimiter: '_', // _italic_ ao invés de *italic*
        });

        // Manter code blocks (não converter para texto)
        this.turndownService.keep(['pre', 'code']);
    }

    /**
     * Extrai resposta em múltiplos formatos
     *
     * @param {object} page - Puppeteer page instance
     * @param {object} protocol - SADI protocol (selector, etc)
     * @returns {Promise<object>} - { text, markdown, html, json }
     */
    async extract(page, protocol) {
        try {
            // 1. Extração HTML (browser-side)
            const rawExtraction = await page.evaluate(this._extractHTML, protocol);

            if (!rawExtraction || !rawExtraction.html) {
                logger.warn('[STRUCTURED_EXTRACTOR] Resposta vazia, retornando fallback');
                return this._emptyResponse();
            }

            // 2. Conversão Markdown
            const markdown = this._convertToMarkdown(rawExtraction.html);

            // 3. Parsing estruturado (JSON)
            const structured = this._parseStructured(rawExtraction.html);

            // 4. Preview estruturado
            const preview = this._generatePreview(rawExtraction.text, structured);

            logger.debug('[STRUCTURED_EXTRACTOR] Extração completa', {
                textLength: rawExtraction.text.length,
                codeBlocks: structured.codeBlocks.length,
                links: structured.links.length,
                sections: structured.sections.length,
            });

            return {
                text: rawExtraction.text,
                markdown,
                html: rawExtraction.html,
                json: structured,
                preview,
            };
        } catch (error) {
            logger.error('[STRUCTURED_EXTRACTOR] Erro ao extrair resposta', { error: error.message });
            return this._emptyResponse();
        }
    }

    /**
     * Extrai HTML do browser (browser-side function)
     *
     * @param {object} protocol - SADI protocol
     * @returns {object} - { html, text, thoughtBlocksRemoved }
     * @private
     */
    _extractHTML(protocol) {
        // Esta função roda NO BROWSER (não tem acesso a Node.js)
        const msgs = Array.from(document.querySelectorAll(protocol.selector));
        const targetMsg = msgs[msgs.length - 1];

        if (!targetMsg) {
            return { html: '', text: '', thoughtBlocksRemoved: 0 };
        }

        // Clone para não modificar DOM real
        const clone = targetMsg.cloneNode(true);

        // Remove thought blocks (o1/o3 reasoning)
        const thoughtSelectors = [
            '[data-testid*="thought"]',
            '[data-testid*="reasoning"]',
            '.thought-block',
            'details', // Colapsáveis genéricos
            '.sr-only', // Screen reader only (hidden)
            '[aria-hidden="true"]',
        ];

        let thoughtBlocksRemoved = 0;
        thoughtSelectors.forEach(selector => {
            const thoughts = clone.querySelectorAll(selector);
            thoughts.forEach(t => {
                t.remove();
                thoughtBlocksRemoved++;
            });
        });

        return {
            html: clone.innerHTML,
            text: clone.innerText.trim(),
            thoughtBlocksRemoved,
        };
    }

    /**
     * Converte HTML para Markdown
     *
     * @param {string} html - HTML bruto
     * @returns {string} - Markdown formatado
     * @private
     */
    _convertToMarkdown(html) {
        try {
            return this.turndownService.turndown(html);
        } catch (error) {
            logger.warn('[STRUCTURED_EXTRACTOR] Erro ao converter HTML → Markdown', { error: error.message });
            // Fallback: retorna HTML como texto
            return html.replace(/<[^>]*>/g, '');
        }
    }

    /**
     * Parseia HTML para JSON estruturado
     *
     * @param {string} html - HTML bruto
     * @returns {object} - { sections, codeBlocks, links, images, tables }
     * @private
     */
    _parseStructured(html) {
        try {
            const root = /** @type {HTMLElement} */ (/** @type {unknown} */ (parseHTML(html)));

            return {
                sections: this._extractSections(root),
                codeBlocks: this._extractCodeBlocks(root),
                links: this._extractLinks(root),
                images: this._extractImages(root),
                tables: this._extractTables(root),
            };
        } catch (error) {
            logger.warn('[STRUCTURED_EXTRACTOR] Erro ao parsear HTML', { error: error.message });
            return {
                sections: [],
                codeBlocks: [],
                links: [],
                images: [],
                tables: [],
            };
        }
    }

    /**
     * Extrai seções (headings)
     *
     * @param {object} root - Parsed HTML
     * @returns {unknown[]} - [{ level, text, content }]
     * @private
     */
    _extractSections(root) {
        const sections = [];
        const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');

        headings.forEach(heading => {
            const level = parseInt(heading.tagName[1], 10);
            const text = heading.text.trim();

            // Pega conteúdo até próximo heading
            let content = '';
            let sibling = heading.nextElementSibling;
            while (sibling && !sibling.tagName.match(/^H[1-6]$/)) {
                content += sibling.text + '\n';
                sibling = sibling.nextElementSibling;
            }

            sections.push({
                level,
                text,
                content: content.trim(),
            });
        });

        return sections;
    }

    /**
     * Extrai code blocks
     *
     * @param {object} root - Parsed HTML
     * @returns {unknown[]} - [{ language, code, isInline }]
     * @private
     */
    _extractCodeBlocks(root) {
        const codeBlocks = [];

        // Code blocks (fenced)
        const preBlocks = root.querySelectorAll('pre code, pre');
        preBlocks.forEach(el => {
            const codeEl = el.tagName === 'PRE' ? el.querySelector('code') || el : el;
            const language = this._detectLanguage(codeEl);
            const code = codeEl.text.trim();

            if (code) {
                codeBlocks.push({
                    language,
                    code,
                    isInline: false,
                });
            }
        });

        // Inline code
        const inlineCodes = root.querySelectorAll('code:not(pre code)');
        inlineCodes.forEach(el => {
            const code = el.text.trim();
            if (code && code.length < 100) {
                // Apenas code curtos
                codeBlocks.push({
                    language: 'text',
                    code,
                    isInline: true,
                });
            }
        });

        return codeBlocks;
    }

    /**
     * Detecta linguagem de code block
     *
     * @param {object} codeEl - Code element
     * @returns {string} - Language (python, javascript, etc)
     * @private
     */
    _detectLanguage(codeEl) {
        // Tenta pegar de class (language-python, lang-js, etc)
        const className = codeEl.getAttribute('class') || '';
        const match = className.match(/(?:language-|lang-)([a-z0-9]+)/i);
        if (match) {
            return match[1].toLowerCase();
        }

        // Tenta pegar de data-language
        const dataLang = codeEl.getAttribute('data-language');
        if (dataLang) {
            return dataLang.toLowerCase();
        }

        // Fallback: text
        return 'text';
    }

    /**
     * Extrai links
     *
     * @param {object} root - Parsed HTML
     * @returns {unknown[]} - [{ text, href, title }]
     * @private
     */
    _extractLinks(root) {
        const links = [];
        const anchors = root.querySelectorAll('a[href]');

        anchors.forEach(a => {
            const href = a.getAttribute('href');
            const text = a.text.trim();
            const title = a.getAttribute('title') || null;

            if (href && text) {
                links.push({ text, href, title });
            }
        });

        return links;
    }

    /**
     * Extrai images
     *
     * @param {object} root - Parsed HTML
     * @returns {unknown[]} - [{ src, alt, title }]
     * @private
     */
    _extractImages(root) {
        const images = [];
        const imgs = root.querySelectorAll('img[src]');

        imgs.forEach(img => {
            const src = img.getAttribute('src');
            const alt = img.getAttribute('alt') || '';
            const title = img.getAttribute('title') || null;

            if (src) {
                images.push({ src, alt, title });
            }
        });

        return images;
    }

    /**
     * Extrai tables
     *
     * @param {object} root - Parsed HTML
     * @returns {unknown[]} - [{ headers, rows }]
     * @private
     */
    _extractTables(root) {
        const tables = [];
        const tableEls = root.querySelectorAll('table');

        tableEls.forEach(table => {
            // Headers
            const headers = [];
            const headerCells = table.querySelectorAll('thead th, thead td');
            headerCells.forEach(th => {
                headers.push(th.text.trim());
            });

            // Rows
            const rows = [];
            const bodyRows = table.querySelectorAll('tbody tr, tr:not(thead tr)');
            bodyRows.forEach(tr => {
                const cells = [];
                const tds = tr.querySelectorAll('td, th');
                tds.forEach(td => {
                    cells.push(td.text.trim());
                });
                if (cells.length > 0) {
                    rows.push(cells);
                }
            });

            if (headers.length > 0 || rows.length > 0) {
                tables.push({ headers, rows });
            }
        });

        return tables;
    }

    /**
     * Gera preview estruturado
     *
     * @param {string} text - Texto plano
     * @param {object} structured - Dados estruturados
     * @returns {object} - { text, sections_count, code_blocks_count, links_count, images_count }
     * @private
     */
    _generatePreview(text, structured) {
        // Primeiro parágrafo (até 500 chars)
        const previewText = text.slice(0, 500) + (text.length > 500 ? '...' : '');

        return {
            text: previewText,
            sections_count: structured.sections.length,
            code_blocks_count: structured.codeBlocks.filter(cb => !cb.isInline).length,
            links_count: structured.links.length,
            images_count: structured.images.length,
        };
    }

    /**
     * Resposta vazia (fallback)
     *
     * @returns {object}
     * @private
     */
    _emptyResponse() {
        return {
            text: '',
            markdown: '',
            html: '',
            json: {
                sections: [],
                codeBlocks: [],
                links: [],
                images: [],
                tables: [],
            },
            preview: {
                text: '',
                sections_count: 0,
                code_blocks_count: 0,
                links_count: 0,
                images_count: 0,
            },
        };
    }
}

export default StructuredExtractor;
