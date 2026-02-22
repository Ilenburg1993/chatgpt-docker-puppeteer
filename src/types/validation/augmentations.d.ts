/**
 * Validation System - Module Augmentations
 *
 * Declara tipos para o sistema de validação.
 */

// ============================================================
// Validators
// ============================================================

declare module '#validation/validators' {
    export interface ValidationResult {
        valid: boolean;
        errors?: ValidationError[];
        warnings?: string[];
        [key: string]: unknown;
    }

    export interface ValidationError {
        field: string;
        message: string;
        code?: string;
        [key: string]: unknown;
    }

    export function validateTask(task: unknown): ValidationResult;
    export function validateConfig(config: unknown): ValidationResult;
    export function validateSchema(data: unknown, schema: unknown): ValidationResult;
}

// ============================================================
// Schema Definitions
// ============================================================

declare module '#validation/schemas' {
    export const TaskSchema: unknown;
    export const ConfigSchema: unknown;
    export const UserSchema: unknown;
}
