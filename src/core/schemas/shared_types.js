// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { STATUS_VALUES, STATUS_VALUES_ARRAY } from '#core/constants/tasks';
import { cleanText } from '#infra/fs/fs_utils';
import { z } from 'zod';

/**
 * ID_SCHEMA: Regra estrita para identificadores. [FIX 1.1] Proíbe IDs que comecem com ponto (.) para evitar arquivos
 * ocultos e garante compatibilidade absoluta com sistemas de arquivos Windows/Linux.
 */
const ID_SCHEMA = z
    .string()['regex'](
        /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/,
        'ID inválido: Não pode ser vazio, começar com ponto ou conter caracteres especiais.',
    )
    .min(1, 'ID não pode ser vazio.')
    .max(64, 'ID excede o limite de 64 caracteres.');

/**
 * TIMESTAMP_SCHEMA: Padronização absoluta para datas ISO-8601. [FIX 1.2] Integridade Temporal: Valida estritamente se a
 * string fornecida é uma data válida. Gera uma nova data APENAS se o valor for omitido (undefined), impedindo que datas
 * malformadas sejam mascaradas como 'agora'.
 */
const TIMESTAMP_SCHEMA = z
    .string()['datetime']({ message: 'Data inválida: Deve seguir o padrão ISO-8601.' })
    .default(() => new Date().toISOString());

/**
 * CLEAN_STRING_SCHEMA: O "Filtro Atômico". Aplica automaticamente a sanitização centralizada do fs_utils.
 */
const CLEAN_STRING_SCHEMA = z.string()['transform']((/** @type {string} */ val) => cleanText(val));

/**
 * PRIORITY_SCHEMA: Controle de urgência. Range: 0 (Baixa) a 100 (Crítica). Default: 5.
 */
const PRIORITY_SCHEMA = z.number().int().min(0).max(100).default(5);

/**
 * SOURCE_SCHEMA: Origem da intenção.
 */
const SOURCE_SCHEMA = z
    .enum(['manual', 'api', 'gui', 'flow_manager', 'self_generated', 'bulk_import'])
    .default('manual');

/**
 * STATUS_SCHEMA: Estados permitidos no ciclo de vida. Utiliza constantes centralizadas de STATUS_VALUES.
 */
// z.enum() (Zod v4) requer tuple readonly [string, ...string[]]
const STATUS_SCHEMA = z.enum(/** @type {[string, ...string[]]} */ (STATUS_VALUES_ARRAY)).default(STATUS_VALUES.PENDING);

export { CLEAN_STRING_SCHEMA, ID_SCHEMA, PRIORITY_SCHEMA, SOURCE_SCHEMA, STATUS_SCHEMA, TIMESTAMP_SCHEMA };
