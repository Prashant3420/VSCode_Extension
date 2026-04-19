import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { StagedFile } from '../git/gitIntegration';

export interface ImpactAnalysisResult {
    tool: string;
    success: boolean;
    errors: AnalysisError[];
    warnings: AnalysisError[];
    output: string;
    executionTime: number;
    layer: 'impact';
    impactedFiles: string[];
}

export interface AnalysisError {
    line: number;
    column?: number;
    message: string;
    code?: string;
    severity: 'error' | 'warning' | 'info';
    file?: string;
}

export async function runDiffImpactAnalysis(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<ImpactAnalysisResult[]> {
    const results: ImpactAnalysisResult[] = [];

    results.push(await analyzeSignatureChanges(stagedFiles, workspaceRoot));
    results.push(await analyzeBreakingChanges(stagedFiles, workspaceRoot));
    results.push(await analyzeExportChanges(stagedFiles, workspaceRoot));

    return results;
}

async function analyzeSignatureChanges(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<ImpactAnalysisResult> {
    const startTime = Date.now();
    const result: ImpactAnalysisResult = {
        tool: 'signature-changes',
        success: true,
        errors: [],
        warnings: [],
        output: '',
        executionTime: 0,
        layer: 'impact',
        impactedFiles: [],
    };

    result.executionTime = Date.now() - startTime;
    return result;
}

async function analyzeBreakingChanges(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<ImpactAnalysisResult> {
    const startTime = Date.now();
    const result: ImpactAnalysisResult = {
        tool: 'breaking-changes',
        success: true,
        errors: [],
        warnings: [],
        output: '',
        executionTime: 0,
        layer: 'impact',
        impactedFiles: [],
    };

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.includes('sys.exit') && file.language === 'python') {
                    result.errors.push({
                        line: i + 1,
                        message: `sys.exit() called - may break consumers`,
                        code: 'IMP011',
                        severity: 'error',
                        file: file.path,
                    });
                }

                if (line.match(/Environment\.Exit/) && file.language === 'csharp') {
                    result.errors.push({
                        line: i + 1,
                        message: `Environment.Exit() called - may break consumers`,
                        code: 'IMP021',
                        severity: 'error',
                        file: file.path,
                    });
                }
            }
        } catch (e) {
            console.error(`Failed to check breaking changes in ${file.path}:`, e);
        }
    }

    result.success = result.errors.length === 0;
    result.executionTime = Date.now() - startTime;
    return result;
}

async function analyzeExportChanges(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<ImpactAnalysisResult> {
    const startTime = Date.now();
    const result: ImpactAnalysisResult = {
        tool: 'export-changes',
        success: true,
        errors: [],
        warnings: [],
        output: '',
        executionTime: 0,
        layer: 'impact',
        impactedFiles: [],
    };

    const exportsMap = new Map<string, string[]>();

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const exports = extractExports(content, file.language);

            for (const exp of exports) {
                if (!exportsMap.has(exp)) {
                    exportsMap.set(exp, []);
                }
                exportsMap.get(exp)!.push(file.path);
            }
        } catch (e) {
            console.error(`Failed to extract exports from ${file.path}:`, e);
        }
    }

    for (const [expName, files] of exportsMap) {
        if (files.length > 1) {
            result.errors.push({
                line: 0,
                message: `Duplicate export: ${expName} defined in multiple files`,
                code: 'IMP030',
                severity: 'error',
                file: files.join(', '),
            });
        }
    }

    result.success = result.errors.length === 0;
    result.executionTime = Date.now() - startTime;
    return result;
}

function extractExports(content: string, language: string): string[] {
    const exports = new Set<string>();
    const lines = content.split('\n');

    for (const line of lines) {
        if (language === 'python') {
            const match = line.match(/^(?:def|class|async)\s+(\w+)/);
            if (match) {
                exports.add(match[1]);
            }
        } else if (language === 'csharp') {
            const publicMatch = line.match(/^public\s+(class|interface|struct|enum)\s+(\w+)/);
            if (publicMatch) {
                exports.add(publicMatch[2]);
            }
            const publicMethodMatch = line.match(/^public\s+(\w+)\s+(\w+)\s*\(/);
            if (publicMethodMatch) {
                exports.add(publicMethodMatch[2]);
            }
        }
    }

    return Array.from(exports);
}