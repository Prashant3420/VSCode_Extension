import * as path from 'path';
import * as fs from 'fs';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { ConfigManager } from '../config/configManager';

const execAsync = promisify(exec);

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

export interface PythonAnalysisOptions {
    runPylint: boolean;
    runFlake8: boolean;
    runBlack: boolean;
    runIsort: boolean;
    runMypy: boolean;
    runBandit: boolean;
    enforceNaming: boolean;
    enforceDocstrings: boolean;
}

export class PythonAnalyzer {
    private configManager: ConfigManager;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configManager = ConfigManager.getInstance();
    }

    public async analyze(files: string[], options?: Partial<PythonAnalysisOptions>): Promise<AnalysisResult[]> {
        const config = this.configManager.getPythonConfig();
        const results: AnalysisResult[] = [];

        const pyFiles = files.filter(f => f.endsWith('.py'));
        if (pyFiles.length === 0) {
            return results;
        }

        const enabledOptions: PythonAnalysisOptions = {
            runPylint: options?.runPylint ?? config.runPylint.level !== 'off',
            runFlake8: options?.runFlake8 ?? config.runFlake8.level !== 'off',
            runBlack: options?.runBlack ?? config.runBlack.level !== 'off',
            runIsort: options?.runIsort ?? config.runIsort.level !== 'off',
            runMypy: options?.runMypy ?? config.runMypy.level !== 'off',
            runBandit: options?.runBandit ?? config.runBandit.level !== 'off',
            enforceNaming: options?.enforceNaming ?? config.enforceNaming.level !== 'off',
            enforceDocstrings: options?.enforceDocstrings ?? config.enforceDocstrings.level !== 'off',
        };

        if (enabledOptions.runPylint) {
            results.push(await this.runPylint(pyFiles));
        }

        if (enabledOptions.runFlake8) {
            results.push(await this.runFlake8(pyFiles));
        }

        if (enabledOptions.runBlack) {
            results.push(await this.runBlack(pyFiles));
        }

        if (enabledOptions.runIsort) {
            results.push(await this.runIsort(pyFiles));
        }

        if (enabledOptions.runMypy) {
            results.push(await this.runMypy(pyFiles));
        }

        if (enabledOptions.runBandit) {
            results.push(await this.runBandit(pyFiles));
        }

        if (enabledOptions.enforceNaming) {
            results.push(await this.checkNamingConventions(pyFiles));
        }

        if (enabledOptions.enforceDocstrings) {
            results.push(await this.checkDocstrings(pyFiles));
        }

        return results;
    }

    private async runPylint(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'pylint',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        try {
            const fileList = files.join(' ');
            const output = execSync(`pylint --output-format=text "${fileList}"`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
            });
            result.output = output;
            result.errors = this.parsePylintOutput(output);
            result.warnings = [];
        } catch (error: any) {
            result.success = false;
            result.output = error.message || '';
            if (error.stdout) {
                result.errors = this.parsePylintOutput(error.stdout.toString());
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parsePylintOutput(output: string): AnalysisError[] {
        const errors: AnalysisError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/(\S+):(\d+):(\d+):\s*(\w+):\s*(.+)/);
            if (match) {
                const [, file, lineNum, col, code, message] = match;
                const severity = code.startsWith('E') ? 'error' : 'warning';
                errors.push({
                    line: parseInt(lineNum),
                    column: parseInt(col),
                    message: message.trim(),
                    code: code,
                    severity,
                });
            }
        }

        return errors;
    }

    private async runFlake8(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'flake8',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        try {
            const fileList = files.join(' ');
            const output = execSync(`flake8 "${fileList}"`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
            });
            result.output = output;
            result.errors = this.parseFlake8Output(output);
        } catch (error: any) {
            if (error.stdout) {
                result.errors = this.parseFlake8Output(error.stdout.toString());
                result.success = result.errors.length === 0;
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseFlake8Output(output: string): AnalysisError[] {
        const errors: AnalysisError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/(.+):(\d+):(\d+):\s*(\w+)\s+(.+)/);
            if (match) {
                const [, file, lineNum, col, code, message] = match;
                const severity = code.startsWith('E') || code.startsWith('F') ? 'error' : 'warning';
                errors.push({
                    line: parseInt(lineNum),
                    column: parseInt(col),
                    message: message.trim(),
                    code: code,
                    severity,
                });
            }
        }

        return errors;
    }

    private async runBlack(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'black',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        try {
            const fileList = files.join(' ');
            const output = execSync(`black --check "${fileList}"`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
            });
            result.output = output;
        } catch (error: any) {
            result.success = false;
            if (error.stdout) {
                result.output = error.stdout.toString();
                result.errors = this.parseBlackOutput(error.stdout.toString(), files);
            } else if (error.stderr) {
                result.output = error.stderr.toString();
                result.errors = this.parseBlackOutput(error.stderr.toString(), files);
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseBlackOutput(output: string, files: string[]): AnalysisError[] {
        const errors: AnalysisError[] = [];

        for (const line of output.split('\n')) {
            const match = line.match(/would reformat\s+(.+)/);
            if (match) {
                const file = match[1];
                errors.push({
                    line: 1,
                    message: `File would be reformatted by Black`,
                    code: 'BLACK001',
                    severity: 'error',
                });
            }
        }

        return errors;
    }

    private async runIsort(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'isort',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        try {
            const fileList = files.join(' ');
            const output = execSync(`isort --check-only "${fileList}"`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
            });
            result.output = output;
        } catch (error: any) {
            result.success = false;
            if (error.stdout) {
                result.output = error.stdout.toString();
                result.errors = this.parseIsortOutput(error.stdout.toString());
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseIsortOutput(output: string): AnalysisError[] {
        const errors: AnalysisError[] = [];

        for (const line of output.split('\n')) {
            const match = line.match(/(.+?)\s+(\d+)\s+(.+)/);
            if (match) {
                const [, file, lineNum, message] = match;
                errors.push({
                    line: parseInt(lineNum),
                    message: message.trim(),
                    code: 'ISORT001',
                    severity: 'error',
                });
            }
        }

        return errors;
    }

    private async runMypy(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'mypy',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        try {
            const fileList = files.join(' ');
            const output = execSync(`mypy "${fileList}"`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
            });
            result.output = output;
        } catch (error: any) {
            if (error.stdout) {
                result.output = error.stdout.toString();
                const parsed = this.parseMypyOutput(error.stdout.toString());
                result.errors = parsed.errors;
                result.warnings = parsed.warnings;
                result.success = result.errors.length === 0;
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseMypyOutput(output: string): { errors: AnalysisError[]; warnings: AnalysisError[] } {
        const errors: AnalysisError[] = [];
        const warnings: AnalysisError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/(.+):(\d+):\s*(error|warning|note):\s*(.+)/);
            if (match) {
                const [, file, lineNum, type, message] = match;
                const error: AnalysisError = {
                    line: parseInt(lineNum),
                    message: message.trim(),
                    severity: type === 'error' ? 'error' : 'warning',
                };

                if (type === 'error') {
                    errors.push(error);
                } else {
                    warnings.push(error);
                }
            }
        }

        return { errors, warnings };
    }

    private async runBandit(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'bandit',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        try {
            const fileList = files.join(' ');
            const output = execSync(`bandit -r "${fileList}"`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
            });
            result.output = output;
        } catch (error: any) {
            if (error.stdout) {
                result.output = error.stdout.toString();
                result.errors = this.parseBanditOutput(error.stdout.toString());
                result.success = result.errors.length === 0;
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseBanditOutput(output: string): AnalysisError[] {
        const errors: AnalysisError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/(.+):(\d+):\s*(\w+):\s*(.+)/);
            if (match) {
                const [, file, lineNum, code, message] = match;
                errors.push({
                    line: parseInt(lineNum),
                    message: `[SECURITY] ${message.trim()}`,
                    code: code,
                    severity: 'error',
                });
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

                    const classMatch = line.match(/^class\s+(\w+)/);
                    if (classMatch && !/^[A-Z][a-zA-Z0-9]*$/.test(classMatch[1])) {
                        result.errors.push({
                            line: i + 1,
                            message: `Class name "${classMatch[1]}" should use PascalCase`,
                            code: 'NAMING001',
                            severity: 'error',
                        });
                    }

                    const funcMatch = line.match(/^\s*def\s+(\w+)/);
                    if (funcMatch && !/^[a-z_][a-z0-9_]*$/.test(funcMatch[1])) {
                        result.errors.push({
                            line: i + 1,
                            message: `Function name "${funcMatch[1]}" should use snake_case`,
                            code: 'NAMING002',
                            severity: 'error',
                        });
                    }

                    const constMatch = line.match(/^([A-Z][A-Z0-9_]+)\s*=/);
                    if (constMatch && !/^[A-Z][A-Z0-9_]*$/.test(constMatch[1])) {
                        result.errors.push({
                            line: i + 1,
                            message: `Constant "${constMatch[1]}" should use UPPER_SNAKE_CASE`,
                            code: 'NAMING003',
                            severity: 'error',
                        });
                    }
                }
            } catch (error) {
                console.error(`Failed to check naming in ${file}:`, error);
            }
        }

        result.success = result.errors.length === 0;
        result.executionTime = Date.now() - startTime;
        return result;
    }

    private async checkDocstrings(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'docstrings',
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

                let inClass = false;
                let inFunction = false;
                let className = '';
                let funcName = '';
                let lineOffset = 0;
                let hasDocstring = false;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    const classMatch = line.match(/^class\s+(\w+)/);
                    if (classMatch) {
                        if (inClass && !hasDocstring && !line.startsWith('#')) {
                            result.warnings.push({
                                line: lineOffset + 1,
                                message: `Class "${className}" is missing a docstring`,
                                code: 'DOCS001',
                                severity: 'warning',
                            });
                        }
                        inClass = true;
                        className = classMatch[1];
                        hasDocstring = false;
                        lineOffset = i;
                    }

                    const funcMatch = line.match(/^\s*def\s+(\w+)/);
                    if (funcMatch && !funcMatch[1].startsWith('_')) {
                        if (inFunction && !hasDocstring) {
                            result.warnings.push({
                                line: lineOffset + 1,
                                message: `Function "${funcName}" is missing a docstring`,
                                code: 'DOCS002',
                                severity: 'warning',
                            });
                        }
                        inFunction = true;
                        funcName = funcMatch[1];
                        hasDocstring = false;
                        lineOffset = i;
                    }

                    if (line.trim().startsWith('"""') || line.trim().startsWith("'''")) {
                        hasDocstring = true;
                    }
                }
            } catch (error) {
                console.error(`Failed to check docstrings in ${file}:`, error);
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

export async function analyzePython(files: string[], workspaceRoot: string): Promise<AnalysisResult[]> {
    const analyzer = new PythonAnalyzer(workspaceRoot);
    return analyzer.analyze(files);
}
