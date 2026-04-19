import * as path from 'path';
import * as fs from 'fs';
import * as { execSync } from 'child_process';

export interface ASTAnalysisResult {
    tool: string;
    success: boolean;
    errors: AnalysisError[];
    warnings: AnalysisError[];
    output: string;
    executionTime: number;
    layer: 'ast';
}

export interface AnalysisError {
    line: number;
    column?: number;
    message: string;
    code?: string;
    severity: 'error' | 'warning' | 'info';
    file?: string;
}

export async function analyzeWithAST(
    filePath: string,
    language: 'python' | 'csharp' | 'unknown',
    workspaceRoot: string
): Promise<ASTAnalysisResult[]> {
    if (language === 'python') {
        return analyzePythonAST(filePath, workspaceRoot);
    } else if (language === 'csharp') {
        return analyzeCSharpAST(filePath, workspaceRoot);
    }
    return [];
}

async function analyzePythonAST(filePath: string, workspaceRoot: string): Promise<ASTAnalysisResult[]> {
    const results: ASTAnalysisResult[] = [];
    const fullPath = path.join(workspaceRoot, filePath);
    const executionTime = Date.now();

    try {
        const content = fs.readFileSync(fullPath, 'utf-8');

        const astErrors: AnalysisError[] = [];

        try {
            const { parse } = await import('python-ast');
            const ast = parse(content);
            astErrors.push(...detectDeadCodePython(ast, filePath));
            astErrors.push(...detectUnusedImportsPython(ast, filePath));
            astErrors.push(...detectAntiPatternsPython(ast, filePath));
        } catch (e) {
            astErrors.push({
                line: 1,
                message: `Failed to parse Python AST: ${e instanceof Error ? e.message : 'Unknown error'}`,
                code: 'AST001',
                severity: 'error',
                file: filePath,
            });
        }

        astErrors.push(...detectPythonStructureIssues(content, filePath));

        results.push({
            tool: 'python-ast',
            success: astErrors.filter(e => e.severity === 'error').length === 0,
            errors: astErrors.filter(e => e.severity === 'error'),
            warnings: astErrors.filter(e => e.severity === 'warning'),
            output: '',
            executionTime: Date.now() - executionTime,
            layer: 'ast',
        });
    } catch (error) {
        results.push({
            tool: 'python-ast',
            success: false,
            errors: [{
                line: 1,
                message: `Failed to analyze Python AST: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: 'AST002',
                severity: 'error',
                file: filePath,
            }],
            warnings: [],
            output: '',
            executionTime: Date.now() - executionTime,
            layer: 'ast',
        });
    }

    return results;
}

function detectDeadCodePython(ast: any, filePath: string): AnalysisError[] {
    const errors: AnalysisError[] = [];
    return errors;
}

function detectUnusedImportsPython(ast: any, filePath: string): AnalysisError[] {
    const errors: AnalysisError[] = [];
    return errors;
}

function detectAntiPatternsPython(ast: any, filePath: string): AnalysisError[] {
    const errors: AnalysisError[] = [];
    return errors;
}

function detectPythonStructureIssues(content: string, filePath: string): AnalysisError[] {
    const errors: AnalysisError[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        if (line.length > 120) {
            errors.push({
                line: lineNum,
                message: `Line too long (${line.length} > 120 characters)`,
                code: 'AST010',
                severity: 'warning',
                file: filePath,
            });
        }

        if (/^\s+$/.test(line)) {
            errors.push({
                line: lineNum,
                message: 'Trailing whitespace detected',
                code: 'AST011',
                severity: 'warning',
                file: filePath,
            });
        }

        const tabMatch = line.match(/\t/);
        if (tabMatch) {
            errors.push({
                line: lineNum,
                message: 'Tab character found. Use spaces for indentation.',
                code: 'AST012',
                severity: 'warning',
                file: filePath,
            });
        }

        if (line.match(/^#.*TODO.*/i) && !line.match(/^#.*TODO:.*FIXME/i)) {
            errors.push({
                line: lineNum,
                message: 'TODO comment found without FIXME',
                code: 'AST013',
                severity: 'warning',
                file: filePath,
            });
        }

        if (line.match(/assert\s+True/)) {
            errors.push({
                line: lineNum,
                message: 'assert True found - remove or use proper assertion',
                code: 'AST014',
                severity: 'error',
                file: filePath,
            });
        }

        if (line.match(/pass\s*$/)) {
            errors.push({
                line: lineNum,
                message: 'Empty pass statement found - use ellipsis (...) or add docstring',
                code: 'AST015',
                severity: 'warning',
                file: filePath,
            });
        }
    }

    const importSet = new Set<string>();
    const usedNames = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const importMatch = line.match(/^import\s+(\w+)/);
        if (importMatch) {
            importSet.add(importMatch[1]);
        }

        const fromImportMatch = line.match(/^from\s+(\w+)\s+import/);
        if (fromImportMatch) {
            importSet.add(fromImportMatch[1]);
        }

        const nameMatch = line.match(/\b(\w+)\b/g);
        if (nameMatch) {
            for (const name of nameMatch) {
                if (importSet.has(name)) {
                    usedNames.add(name);
                }
            }
        }
    }

    for (const unused of importSet) {
        if (!usedNames.has(unused)) {
            const lineNum = lines.findIndex(l => l.includes(`import ${unused}`)) + 1;
            if (lineNum > 0) {
                errors.push({
                    line: lineNum,
                    message: `Unused import: ${unused}`,
                    code: 'AST016',
                    severity: 'warning',
                    file: filePath,
                });
            }
        }
    }

    return errors;
}

async function analyzeCSharpAST(filePath: string, workspaceRoot: string): Promise<ASTAnalysisResult[]> {
    const results: ASTAnalysisResult[] = [];
    const fullPath = path.join(workspaceRoot, filePath);
    const executionTime = Date.now();

    try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const errors = detectCSharpStructureIssues(content, filePath);

        results.push({
            tool: 'csharp-ast',
            success: errors.filter(e => e.severity === 'error').length === 0,
            errors: errors.filter(e => e.severity === 'error'),
            warnings: errors.filter(e => e.severity === 'warning'),
            output: '',
            executionTime: Date.now() - executionTime,
            layer: 'ast',
        });
    } catch (error) {
        results.push({
            tool: 'csharp-ast',
            success: false,
            errors: [{
                line: 1,
                message: `Failed to analyze C# AST: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: 'AST020',
                severity: 'error',
                file: filePath,
            }],
            warnings: [],
            output: '',
            executionTime: Date.now() - executionTime,
            layer: 'ast',
        });
    }

    return results;
}

function detectCSharpStructureIssues(content: string, filePath: string): AnalysisError[] {
    const errors: AnalysisError[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        if (line.length > 200) {
            errors.push({
                line: lineNum,
                message: `Line too long (${line.length} > 200 characters)`,
                code: 'AST030',
                severity: 'warning',
                file: filePath,
            });
        }

        if (/^\s+$/.test(line)) {
            errors.push({
                line: lineNum,
                message: 'Trailing whitespace detected',
                code: 'AST031',
                severity: 'warning',
                file: filePath,
            });
        }

        if (line.match(/var\s+\w+\s*=\s*null;/)) {
            errors.push({
                line: lineNum,
                message: 'Explicit null assignment found. Consider using nullable type.',
                code: 'AST032',
                severity: 'warning',
                file: filePath,
            });
        }

        if (line.match(/catch\s*\(\s*Exception\s+\w+\s*\)\s*\{\s*\}/)) {
            errors.push({
                line: lineNum,
                message: 'Empty catch block found - should log or rethrow',
                code: 'AST033',
                severity: 'error',
                file: filePath,
            });
        }

        if (line.match(/catch\s*\(\s*Exception\s*\)\s*\{\s*\}/)) {
            errors.push({
                line: lineNum,
                message: 'Empty catch block for base Exception - should log or rethrow',
                code: 'AST034',
                severity: 'error',
                file: filePath,
            });
        }

        if (line.match(/\.ToString\(\)/) && !line.includes('string.Format') && !line.includes('InterpolatedString')) {
            errors.push({
                line: lineNum,
                message: 'Consider using string interpolation instead of .ToString()',
                code: 'AST035',
                severity: 'info',
                file: filePath,
            });
        }

        if (line.match(/string\s*\+\s*string/) || line.match(/\+\s*"/)) {
            const prevLine = lines[i - 1] || '';
            if (!prevLine.includes('StringBuilder')) {
                errors.push({
                    line: lineNum,
                    message: 'String concatenation detected. Consider using StringBuilder for multiple concatenations.',
                    code: 'AST036',
                    severity: 'warning',
                    file: filePath,
                });
            }
        }

        const asyncMatch = line.match(/async\s+Task\s+/);
        if (asyncMatch) {
            const nextLine = lines[i + 1] || '';
            if (!nextLine.includes('await')) {
                errors.push({
                    line: lineNum,
                    message: 'Async method does not contain await - consider removing async keyword',
                    code: 'AST037',
                    severity: 'warning',
                    file: filePath,
                });
            }
        }

        if (line.match(/public\s+class/) && !line.match(/partial/)) {
            const className = line.match(/public\s+class\s+(\w+)/)?.[1];
            if (className && !className.endsWith(filePath.replace('.cs', ''))) {
                errors.push({
                    line: lineNum,
                    message: 'Class name should match file name',
                    code: 'AST038',
                    severity: 'warning',
                    file: filePath,
                });
            }
        }
    }

    return errors;
}

export function analyzeAST(
    filePath: string,
    language: 'python' | 'csharp' | 'unknown',
    workspaceRoot: string
): Promise<ASTAnalysisResult[]> {
    return analyzeWithAST(filePath, language, workspaceRoot);
}