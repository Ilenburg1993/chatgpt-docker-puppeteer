// @ts-check
/** Public membrane for the Company Knowledge domain configuration. */

/** @typedef {import('../config.js').CompanyKnowledgeProcessConfig} CompanyKnowledgeProcessConfig */

export {
    COMPANY_KNOWLEDGE_PROCESS_CONFIG_KIND,
    COMPANY_KNOWLEDGE_PROCESS_CONFIG_SCHEMA_VERSION,
    DEFAULT_COMPANY_KNOWLEDGE_CACHE_TTL_MS,
    DEFAULT_COMPANY_KNOWLEDGE_CORPUS_ROOTS,
    DEFAULT_COMPANY_KNOWLEDGE_MAX_DOCUMENTS,
    DEFAULT_COMPANY_KNOWLEDGE_REPOSITORY_WEB_BASE,
    DEFAULT_COMPANY_KNOWLEDGE_WIDGET_DOMAIN,
    isCompanyKnowledgeProcessConfig,
    readCompanyKnowledgeCorpusRoots,
    readCompanyKnowledgeProcessConfig,
    resolveCompanyKnowledgeProcessConfig,
} from '../config.js';
export {
    MAX_QUERY_LENGTH,
    buildCompanyKnowledgeDocumentMetadata,
    fetchCompanyKnowledgeDocument,
    searchCompanyKnowledge,
} from '../runtime.js';
