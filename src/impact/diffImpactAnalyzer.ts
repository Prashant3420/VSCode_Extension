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

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const stagedContent = fs.readFileSync(fullPath, 'utf-8');

            const previousContent = await getPreviousVersion(file.path, workspaceRoot);
            if (!previousContent) continue;

            const currentSignatures = extractSignatures(stagedContent, file.language);
            const previousSignatures = extractSignatures(previousContent, file.language);

            for (const [name, currentSig] of currentSignatures) {
                const previousSig = previousSignatures.get(name);

                if (!previousSig) continue;

                if (currentSig !== previousSig) {
                    const breakType = detectBreakingChange(currentSig, previousSig);

                    if (breakType === 'parameter-removed') {
                        result.errors.push({
                            line: 0,
                            message: `Breaking change: Parameter removed from ${name}`,
                            code: 'IMP001',
                            severity: 'error',
                            file: file.path,
                        });
                    } else if (breakType === 'parameter-type-changed') {
                        result.errors.push({
                            line: 0,
                            message: `Breaking change: Parameter type changed in ${name}`,
                            code: 'IMP002',
                            severity: 'error',
                            file: file.path,
                        });
                    } else if (breakType === 'return-type-changed') {
                        result.warnings.push({
                            line: 0,
                            message: `Warning: Return type changed in ${name}`,
                            code: 'IMP003',
                            severity: 'warning',
                            file: file.path,
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to analyze signatures in ${file.path}:`, error);
        }
    }

    result.success = result.errors.length === 0;
    result.executionTime = Date.now() - startTime;
    return result;
}

function extractSignatures(content: string, language: string): Map<string, string> {
    const signatures = new Map<string, string>();
    const lines = content.split('\n');

    for (const line of lines) {
        if (language === 'python') {
            const match = line.match(/^\s*def\s+(\w+)\s*\((.*?)\)/);
            if (match) {
                const name = match[1];
                const params = match[2];
                signatures.set(name, params.trim());
            }

            const asyncMatch = line.match(/^\s*async\s+def\s+(\w+)\s*\((.*?)\)/);
            if (asyncMatch) {
                const name = asyncMatch[1];
                const params = asyncMatch[2];
                signatures.set(name, params.trim());
            }

            const classMethodMatch = line.match(/^\s+def\s+(\w+)\s*\((.*?)\)/);
            if (classMethodMatch) {
                const name = classMethodMatch[1];
                const params = classMethodMatch[2];
                signatures.set(name, params.trim());
            }
        } else if (language === 'csharp') {
            const match = line.match(/(public|private|protected|internal)\s+(\w+)\s+(\w+)\s*\((.*?)\)/);
            if (match) {
                const returnType = match[2];
                const name = match[3];
                const params = match[4];
                signatures.set(`${returnType} ${name}`, params.trim());
            }
        }
    }

    return signatures;
}

async function getPreviousVersion(filePath: string, workspaceRoot: string): Promise<string | null> {
    try {
        const result = execSync(`git show HEAD:${filePath}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
        });
        return result;
    } catch {
        return null;
    }
}

function detectBreakingChange(current: string, previous: string): string | null {
    const currentParams = current.split(',').map(p => p.trim()).filter(Boolean);
    const previousParams = previous.split(',').map(p => p.trim()).filter(Boolean);

    if (previousParams.length > currentParams.length) {
        return 'parameter-removed';
    }

    for (let i = 0; i < Math.min(currentParams.length, previousParams.length); i++) {
        const currentType = extractParamType(currentParams[i]);
        const previousType = extractParamType(previousParams[i]);

        if (currentType && previousType && currentType !== previousType) {
            return 'parameter-type-changed';
        }
    }

    return null;
}

function extractParamType(param: string): string | null {
    const match = param.match(/:(\s*\w+\??)/);
    return match ? match[1].trim() : null;
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

    const language = stagedFiles[0]?.language || 'python';

    if (language === 'python') {
        result.errors.push(...detectPythonBreakingChanges(stagedFiles, workspaceRoot));
    } else {
        result.errors.push(...detectCSharpBreakingChanges(stagedFiles, workspaceRoot));
    }

    result.success = result.errors.length === 0;
    result.executionTime = Date.now() - startTime;
    return result;
}

function detectPythonBreakingChanges(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): AnalysisError[] {
    const errors: AnalysisError[] = [];

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.includes('raise NotImplementedError')) {
                    errors.push({
                        line: i + 1,
                        message: `NotImplementedError raises - ensure this is intentional`,
                        code: 'IMP010',
                        severity: 'warning',
                        file: file.path,
                    });
                }

                if (line.includes('sys.exit')) {
                    errors.push({
                        line: i + 1,
                        message: `sys.exit() called - may break consumers`,
                        code: 'IMP011',
                        severity: 'error',
                        file: file.path,
                    });
                }

                if (line.match(/global\s+\w+/)) {
                    errors.push({
                        line: i + 1,
                        message: `global keyword used - consider avoiding global state`,
                        code: 'IMP012',
                        severity: 'warning',
                        file: file.path,
                    });
                }
            }
        } catch (error) {
            console.error(`Failed to check breaking changes in ${file.path}:`, error);
        }
    }

    return errors;
}

function detectCSharpBreakingChanges(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): AnalysisError[] {
    const errors: AnalysisError[] = [];

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.includes('throw new NotImplementedException')) {
                    errors.push({
                        line: i + 1,
                        message: `NotImplementedException thrown - ensure this is intentional`,
                        code: 'IMP020',
                        severity: 'warning',
                        file: file.path,
                    });
                }

                if (line.match(/Environment\.Exit/)) {
                    errors.push({
                        line: i + 1,
                        message: `Environment.Exit() called - may break consumers`,
                        code: 'IMP021',
                        severity: 'error',
                        file: file.path,
                    });
                }

                if (line.match(/sealed\s+override/)) {
                    errors.push({
                        line: i + 1,
                        message: `Method is sealed override - consider if this is intentional`,
                        code: 'IMP022',
                        severity: 'warning',
                        file: file.path,
                    });
                }
            }
        } catch (error) {
            console.error(`Failed to check breaking changes in ${file.path}:`, error);
        }
    }

    return errors;
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

    const exports = new Map<string, Set<string>>();

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const fileExports = extractExports(content, file.language);

            for (const exportName of fileExports) {
                if (!exports.has(exportName)) {
                    exports.set(exportName, new Set());
                }
                exports.get(exportName)!.add(file.path);
            }
        } catch (error) {
            console.error(`Failed to extract exports from ${file.path}:`, error);
        }
    }

    for (const [exportName, files] of exports) {
        if (files.size > 1) {
            result.errors.push({
                line: 0,
                message: `Duplicate export: ${exportName} defined in multiple files`,
                code: 'IMP030',
                severity: 'error',
                file: Array.from(files).join(', '),
            });
        }
    }

    result.success = result.errors.length === 0;
    result.executionTime = Date.now() - startTime;
    return result;
}

function extractExports(content: string, language: string): Set<string> {
    const exports = new Set<string>();
    const lines = content.split('\n');

    for (const line of lines) {
        if (language === 'python') {
            const match = line.match(/^(?:def|class|async)\s+(\w+)/);
            if (match) {
                exports.add(match[1]);
            }

            const __all__Match = line.match(/^__all__\s*=\s*\[(.*)\]/);
            if (__all__Match) {
                const exportsList = __all__Match[1].split(',');
                for (const exp of exportsList) {
                    exports.add(exp.trim().replace(/['"]/g, ''));
                }
            }
        } else if (language === 'csharp') {
            const publicMatch = line.match(/^public\s+(class|interface|struct|enum|delegate)\s+(\w+)/);
            if (publicMatch) {
                exports.add(publicMatch[2]);
            }

            const publicMethodMatch = line.match(/^public\s+(\w+)\s+(\w+)\s*\(/);
            if (publicMethodMatch) {
                exports.add(publicMethodMatch[2]);
            }
        }
    }

    return exports;
}

export function runImpactAnalysis(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<ImpactAnalysisResult[]> {
    return runDiffImpactAnalysis(stagedFiles, workspaceRoot);
}