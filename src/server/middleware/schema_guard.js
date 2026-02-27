// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log, audit } from '#core/logger';

/**
 * Factory de Validação: Cria um middleware Express para um Schema específico.
 * Atua como o "Guarda de Fronteira" para as intenções de negócio.
 *
 * @param {import('zod').ZodType} schema - O Schema Zod (ex: TaskSchema) para validação.
 * @returns {import('express').RequestHandler} Middleware Express (req, res, next).
 */
const schemaGuard = schema => (req, res, next) => {
    const requestId = req.id || 'no-id';

    // 1. Verificação de Existência
    if (!req.body || Object.keys(req.body).length === 0) {
        log('WARN', `[GUARD] Tentativa de requisição com payload vazio.`, requestId);
        return res.status(400).json({
            success: false,
            error: 'Payload vazio detectado. A operação exige um corpo JSON íntegro.',
            request_id: requestId,
        });
    }

    // 2. Execução da Validação "Safe"
    // safeParse não lança exceções, permitindo controle total sobre o fluxo de erro.
    const result = /** @type {any} */ (schema.safeParse(req.body));

    if (!result.success) {
        // 3. Formatação Amigável de Erros
        // Converte a árvore de erros do Zod em uma lista simples de campo/mensagem.
        const errorDetails = result.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message,
        }));

        // 4. Registro de Auditoria Administrativa
        // Essencial para detectar bugs no Dashboard ou tentativas de abuso da API.
        audit('SCHEMA_VIOLATION', {
            path: req.originalUrl,
            method: req.method,
            errors: errorDetails,
            request_id: requestId,
            ip: req.ip,
        });

        log('WARN', `[GUARD] Violação de contrato em ${req.originalUrl}: ${errorDetails.length} erro(s).`, requestId);

        // 5. Resposta de Rejeição (400 Bad Request)
        return res.status(400).json({
            success: false,
            error: 'O payload enviado viola o contrato de dados do sistema.',
            request_id: requestId,
            details: errorDetails,
        });
    }

    /**
     * SUCESSO E CURA:
     * Substituímos o req.body original pelo dado retornado pelo Zod (result.data).
     *
     * Por que isso é vital?
     * O Zod aplica valores padrão (defaults), remove campos extras não autorizados
     * e realiza coerções de tipo (ex: string para número). Isso garante que o
     * Controller receba um objeto "limpo" e confiável.
     */
    req.body = result.data;

    next();
};

export default schemaGuard;
