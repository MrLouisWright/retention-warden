export * from './core.js';
import type { Report, Finding } from './core.js';
export declare const RULES: Record<string, { severity: string; title: string }>;
export declare const DEFAULT_FILES: string[];
export declare function parsePeriod(v: unknown): { days: number } | { indefinite: true } | null;
export declare function parseYaml(text: string): { value: unknown; lines: Record<string, number> };
export declare function lintPolicy(doc: unknown, opts?: { file?: string; lines?: Record<string, number>; now?: Date; config?: Record<string, unknown> }): Finding[];
export declare function loadPolicy(file: string): { value: unknown; lines: Record<string, number> };
export declare function check(target?: string, opts?: { now?: Date; maxPeriod?: string; specialMaxPeriod?: string; reviewEveryMonths?: number; toolVersion?: string }, config?: Record<string, unknown>, configFile?: string): Report;
