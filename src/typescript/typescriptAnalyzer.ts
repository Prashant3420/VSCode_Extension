import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ConfigManager } from '../config/configManager';

export interface AnalysisResult {
    tool: string;
    success: boolean;
    errors: AnalysisError[];
    warnings: AnalysisError[];
    output: string;
    executionTime: number;
}

export interface AnalysisError {
    line: number;
    column?: number;
    message: string;
    code?: string;
    severity: 'error' | 'warning' | 'info';
}

export class TypeScriptAnalyzer {
    private configManager: ConfigManager;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configManager = ConfigManager.getInstance();
    }

    public async analyze(files: string[], options?: any): Promise<AnalysisResult[]> {
        const results: AnalysisResult[] = [];
        const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
        
        if (tsFiles.length === 0) {
            return results;
        }

        const config = this.configManager.getTypeScriptConfig();
        
        if (config.runTsc.level !== 'off') {
            results.push(await this.runTscCheck(tsFiles));
        }
        
        if (config.runEslint.level !== 'off') {
            results.push(await this.runEslint(tsFiles));
        }
        
        if (config.enforceNaming.level !== 'off') {
            results.push(await this.checkNamingConventions(tsFiles));
        }

        return results;
    }

    private async runTscCheck(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'tsc',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        try {
            const fileList = files.map(f => `"${f}"`).join(' ');
            const output = execSync(`npx tsc --noEmit --skipLibCheck ${fileList}`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                timeout: 60000,
            });
            result.output = output;
        } catch (error: any) {
            result.success = false;
            const errorOutput = error.stdout?.toString() || error.stderr?.toString() || error.message || '';
            result.output = errorOutput;
            result.errors = this.parseTscOutput(errorOutput);
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseTscOutput(output: string): AnalysisError[] {
        const errors: AnalysisError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/^(.+)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)/);
            if (match) {
                errors.push({
                    line: parseInt(match[2]),
                    column: parseInt(match[3]),
                    message: match[5].trim(),
                    code: match[4],
                    severity: 'error',
                });
            }

            const noEmitMatch = line.match(/^(.+)\((\d+),\d+\):\s*(.+)/);
            if (noEmitMatch && line.includes('error TS')) {
                errors.push({
                    line: parseInt(noEmitMatch[2]),
                    message: noEmitMatch[3].trim(),
                    severity: 'error',
                });
            }
        }

        return errors;
    }

    private async runEslint(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'eslint',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        try {
            const fileList = files.map(f => `"${f}"`).join(' ');
            const output = execSync(`npx eslint ${fileList} --format json`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                timeout: 60000,
            });
            result.output = output;
            result.errors = this.parseEslintOutput(output);
        } catch (error: any) {
            if (error.stdout) {
                result.errors = this.parseEslintOutput(error.stdout.toString());
                result.success = result.errors.length === 0;
            } else if (error.stderr && !error.stderr.includes('ESLint')) {
                result.success = false;
                result.errors.push({
                    line: 1,
                    message: `ESLint not found or not configured. Run: npm install eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin`,
                    code: 'ESLINT_SETUP',
                    severity: 'warning',
                });
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseEslintOutput(output: string): AnalysisError[] {
        const errors: AnalysisError[] = [];
        
        try {
            const json = JSON.parse(output);
            for (const file of json) {
                for (const msg of file.messages) {
                    errors.push({
                        line: msg.line,
                        column: msg.column,
                        message: msg.message,
                        code: msg.ruleId || 'ESLINT',
                        severity: msg.severity === 2 ? 'error' : 'warning',
                    });
                }
            }
        } catch {
            // Not JSON output, try to parse as text
            const lines = output.split('\n');
            for (const line of lines) {
                const match = line.match(/:(\d+):(\d+):\s*(error|warning)\s+(.+)/);
                if (match) {
                    errors.push({
                        line: parseInt(match[1]),
                        column: parseInt(match[2]),
                        message: match[4].trim(),
                        severity: match[3] === 'error' ? 'error' : 'warning',
                    });
                }
            }
        }

        return errors;
    }

    private async checkNamingConventions(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'naming-conventions',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        for (const file of files) {
            const filePath = path.join(this.workspaceRoot, file);
            if (!fs.existsSync(filePath)) continue;

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const lineNum = i + 1;

                    const classMatch = line.match(/^(export\s+)?(class|interface|type)\s+(\w+)/);
                    if (classMatch) {
                        const name = classMatch[3];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            result.errors.push({
                                line: lineNum,
                                message: `Type name "${name}" should use PascalCase`,
                                code: 'TS_NAMING001',
                                severity: 'error',
                            });
                        }
                    }

                    const functionMatch = line.match(/^(export\s+)?(async\s+)?function\s+(\w+)/);
                    if (functionMatch) {
                        const name = functionMatch[3];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            result.errors.push({
                                line: lineNum,
                                message: `Function "${name}" should use PascalCase`,
                                code: 'TS_NAMING002',
                                severity: 'error',
                            });
                        }
                    }

                    const constMatch = line.match(/^(export\s+)?const\s+(\w+)\s*=/);
                    if (constMatch) {
                        const name = constMatch[2];
                        if (!/^[A-Z][A-Z0-9_]*$/.test(name) && !/^[a-z][a-zA-Z0-9]*$/.test(name)) {
                            if (name === name.toUpperCase()) {
                                result.warnings.push({
                                    line: lineNum,
                                    message: `Constant "${name}" should use UPPER_SNAKE_CASE or camelCase`,
                                    code: 'TS_NAMING003',
                                    severity: 'warning',
                                });
                            }
                        }
                    }

                    const arrowMatch = line.match(/^(export\s+)?const\s+(\w+)\s*=/);
                    if (arrowMatch) {
                        const name = arrowMatch[2];
                        if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
                            result.warnings.push({
                                line: lineNum,
                                message: `Variable "${name}" should use camelCase`,
                                code: 'TS_NAMING004',
                                severity: 'warning',
                            });
                        }
                    }
                }
            } catch (e) {
                console.error(`Failed to check naming in ${file}:`, e);
            }
        }

        result.success = result.errors.length === 0;
        result.executionTime = Date.now() - startTime;
        return result;
    }

    public isToolAvailable(tool: string): boolean {
        try {
            execSync(`which ${tool}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }
}

export async function analyzeTypeScript(files: string[], workspaceRoot: string): Promise<AnalysisResult[]> {
    const analyzer = new TypeScriptAnalyzer(workspaceRoot);
    return analyzer.analyze(files);
}
