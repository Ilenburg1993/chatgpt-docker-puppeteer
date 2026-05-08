// @ts-check
import { describe, expect, it } from 'vitest';

import { getAllToolNames, normalizeAgentToolList, resolveToolName } from '#copilot/config/tool-aliases';

describe('tool aliases', () => {
    it('resolve legacy filesystem aliases to canonical tools', () => {
        expect(resolveToolName('view')).toBe('read_file_content');
        expect(resolveToolName('glob')).toBe('list_directory');
        expect(resolveToolName('grep')).toBe('search_in_files');
    });

    it('resolve legacy shell and reporting names to loaded runtime tools', () => {
        expect(resolveToolName('bash')).toBe('exec_command');
        expect(resolveToolName('read_bash')).toBe('exec_command');
        expect(resolveToolName('report_intent')).toBe('report_intent_local');
    });

    it('keeps wildcard valid for agent-full', () => {
        expect(resolveToolName('*')).toBe('*');
        expect(getAllToolNames('*')).toEqual(['*']);
    });

    it('normalizes and deduplicates mixed tool lists', () => {
        expect(normalizeAgentToolList(['view', 'read_file_content', 'grep', 'bash'])).toEqual({
            canonical: ['exec_command', 'read_file_content', 'search_in_files'],
            unresolved: [],
        });
    });
});
