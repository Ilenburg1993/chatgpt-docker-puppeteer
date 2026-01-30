/* ==========================================================================
   src/orchestrator/memory_store.js
   Memory Store - Armazenamento de Patterns Aprendidos
   Status: NEW (V2.0)

   Responsabilidade:
     - Armazenar patterns aprendidos de missões anteriores
     - Buscar patterns relevantes baseado em query
     - Gerenciar cache LRU (Least Recently Used)
     - Fornecer estatísticas de uso
========================================================================== */

const { log } = require('@core/logger');

/**
 * Tipos de patterns suportados
 */
const PATTERN_TYPE = {
    FEEDBACK: 'feedback', // Feedback do usuário
    VALIDATION: 'validation', // Resultados de validação
    ERROR: 'error', // Erros encontrados
    SUCCESS: 'success', // Sucessos (boas práticas)
    CUSTOM: 'custom' // Pattern customizado
};

class MemoryStore {
    constructor(options = {}) {
        this.config = {
            maxSize: options.maxSize || 1000, // Max patterns armazenados
            persistToDisk: options.persistToDisk || false, // Persistir em disk (TODO)
            storePath: options.storePath || './missions/memory_store.json'
        };

        // Array de patterns
        this.patterns = [];

        // Índice por tipo (para busca rápida)
        this.indexByType = new Map();

        // Estatísticas
        this.stats = {
            total_added: 0,
            total_searches: 0,
            total_hits: 0,
            evictions: 0
        };

        log('INFO', `[MemoryStore] Inicializado com maxSize=${this.config.maxSize}`);
    }

    /**
     * Adiciona pattern ao store
     */
    addPattern(pattern) {
        // Valida pattern
        if (!pattern || !pattern.type || !pattern.content) {
            log('WARN', '[MemoryStore] Pattern inválido, ignorando');
            return false;
        }

        const patternData = {
            id: this._generateId(),
            type: pattern.type,
            content: pattern.content,
            metadata: pattern.metadata || {},
            created_at: Date.now(),
            last_accessed: Date.now(),
            access_count: 0
        };

        // Adiciona ao array
        this.patterns.push(patternData);

        // Adiciona ao índice por tipo
        if (!this.indexByType.has(patternData.type)) {
            this.indexByType.set(patternData.type, []);
        }
        this.indexByType.get(patternData.type).push(patternData.id);

        this.stats.total_added++;

        log('DEBUG', `[MemoryStore] Pattern adicionado: type=${patternData.type}, id=${patternData.id}`);

        // Verifica se precisa fazer eviction
        this._maybeEvict();

        return true;
    }

    /**
     * Busca patterns relevantes
     */
    searchPatterns(query, limit = 5) {
        this.stats.total_searches++;

        // Se query é vazia, retorna patterns mais recentes
        if (!query || query.trim() === '') {
            return this._getMostRecent(limit);
        }

        // Busca simples por keywords
        const keywords = query.toLowerCase().split(' ');

        const matches = [];

        for (const pattern of this.patterns) {
            const score = this._calculateRelevanceScore(pattern, keywords);

            if (score > 0) {
                matches.push({ pattern, score });
            }
        }

        // Ordena por score (descendente)
        matches.sort((a, b) => b.score - a.score);

        // Pega top N
        const results = matches.slice(0, limit).map((m) => {
            // Atualiza last_accessed e access_count
            m.pattern.last_accessed = Date.now();
            m.pattern.access_count++;

            return m.pattern;
        });

        if (results.length > 0) {
            this.stats.total_hits++;
        }

        log('DEBUG', `[MemoryStore] Busca por "${query}" retornou ${results.length} resultados`);

        return results;
    }

    /**
     * Busca patterns por tipo
     */
    getPatternsByType(type, limit = 10) {
        const patternIds = this.indexByType.get(type) || [];

        const results = patternIds
            .slice(0, limit)
            .map((id) => this.patterns.find((p) => p.id === id))
            .filter((p) => p !== undefined);

        return results;
    }

    /**
     * Calcula relevância de um pattern para uma query
     */
    _calculateRelevanceScore(pattern, keywords) {
        let score = 0;

        const contentLower = pattern.content.toLowerCase();

        // Conta quantas keywords aparecem no content
        for (const keyword of keywords) {
            if (contentLower.includes(keyword)) {
                score += 1;
            }
        }

        // Bonus: pattern recente tem score maior
        const ageInDays = (Date.now() - pattern.created_at) / (1000 * 60 * 60 * 24);
        if (ageInDays < 7) {
            score += 0.5; // Bonus para patterns da última semana
        }

        // Bonus: pattern muito acessado
        if (pattern.access_count > 5) {
            score += 0.3;
        }

        return score;
    }

    /**
     * Retorna patterns mais recentes
     */
    _getMostRecent(limit) {
        return [...this.patterns].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
    }

    /**
     * Remove patterns antigos se exceder maxSize (LRU)
     */
    _maybeEvict() {
        if (this.patterns.length <= this.config.maxSize) {
            return;
        }

        // Ordena por last_accessed (ascendente) - menos usados primeiro
        this.patterns.sort((a, b) => a.last_accessed - b.last_accessed);

        // Remove 10% dos patterns menos usados
        const toRemove = Math.ceil(this.config.maxSize * 0.1);
        const removed = this.patterns.splice(0, toRemove);

        this.stats.evictions += removed.length;

        log('INFO', `[MemoryStore] Evicted ${removed.length} patterns (LRU policy)`);

        // Reconstrói índice
        this._rebuildIndex();
    }

    /**
     * Reconstrói índice por tipo
     */
    _rebuildIndex() {
        this.indexByType.clear();

        for (const pattern of this.patterns) {
            if (!this.indexByType.has(pattern.type)) {
                this.indexByType.set(pattern.type, []);
            }
            this.indexByType.get(pattern.type).push(pattern.id);
        }
    }

    /**
     * Gera ID único para pattern
     */
    _generateId() {
        return `pattern-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Retorna estatísticas do MemoryStore
     */
    getStats() {
        return {
            total_patterns: this.patterns.length,
            max_size: this.config.maxSize,
            types: Object.fromEntries(
                Array.from(this.indexByType.entries()).map(([type, ids]) => [type, ids.length])
            ),
            ...this.stats
        };
    }

    /**
     * Limpa todos os patterns
     */
    clear() {
        this.patterns = [];
        this.indexByType.clear();
        log('INFO', '[MemoryStore] Todos os patterns removidos');
    }

    /**
     * Cleanup (chamado no shutdown)
     */
    cleanup() {
        // TODO: Se persistToDisk=true, salvar patterns em disco
        this.clear();
        log('INFO', '[MemoryStore] Cleanup concluído');
    }
}

module.exports = MemoryStore;
module.exports.PATTERN_TYPE = PATTERN_TYPE;
