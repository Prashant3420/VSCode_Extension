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

export interface CSharpAnalysisOptions {
    runRoslyn: boolean;
    runStyleCop: boolean;
    runSonarAnalyzer: boolean;
    runDotnetFormat: boolean;
    enforceNaming: boolean;
}

export class CSharpAnalyzer {
    private configManager: ConfigManager;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configManager = ConfigManager.getInstance();
    }

    public async analyze(files: string[], options?: Partial<CSharpAnalysisOptions>): Promise<AnalysisResult[]> {
        const config = this.configManager.getCSharpConfig();
        const results: AnalysisResult[] = [];

        const csFiles = files.filter(f => f.endsWith('.cs'));
        if (csFiles.length === 0) {
            return results;
        }

        const enabledOptions: CSharpAnalysisOptions = {
            runRoslyn: options?.runRoslyn ?? config.runRoslyn.level !== 'off',
            runStyleCop: options?.runStyleCop ?? config.runStyleCop.level !== 'off',
            runSonarAnalyzer: options?.runSonarAnalyzer ?? config.runSonarAnalyzer.level !== 'off',
            runDotnetFormat: options?.runDotnetFormat ?? config.runDotnetFormat.level !== 'off',
            enforceNaming: options?.enforceNaming ?? config.enforceNaming.level !== 'off',
        };

        if (enabledOptions.runRoslyn || enabledOptions.runStyleCop || enabledOptions.runSonarAnalyzer) {
            results.push(await this.runDotnetBuild(csFiles));
        }

        if (enabledOptions.runDotnetFormat) {
            results.push(await this.runDotnetFormat(csFiles));
        }

        if (enabledOptions.enforceNaming) {
            results.push(await this.checkNamingConventions(csFiles));
        }

        return results;
    }

    private buildProject(): string | null {
        const projectFiles = fs.readdirSync(this.workspaceRoot)
            .filter(f => f.endsWith('.csproj'));

        if (projectFiles.length > 0) {
            return projectFiles[0];
        }

        const subDirs = fs.readdirSync(this.workspaceRoot).filter(f => {
            return fs.statSync(path.join(this.workspaceRoot, f)).isDirectory();
        });

        for (const dir of subDirs) {
            const dirPath = path.join(this.workspaceRoot, dir);
            const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.csproj'));
            if (files.length > 0) {
                return path.join(dir, files[0]);
            }
        }

        return null;
    }

    private async runDotnetBuild(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'dotnet-build',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        const projectFile = this.buildProject();

        if (!projectFile) {
            result.success = false;
            result.errors.push({
                line: 0,
                message: 'No .csproj file found. Please create a project file first.',
                code: 'CSHARP001',
                severity: 'error',
            });
            return result;
        }

        try {
            const output = execSync(`dotnet build "${projectFile}" --no-incremental --verbosity quiet`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
            });
            result.output = output;
            result.errors = this.parseDotnetBuildOutput(output);
            result.warnings = this.parseDotnetWarnings(output);
        } catch (error: any) {
            result.success = false;
            const errorOutput = error.stdout?.toString() || error.message || '';
            result.output = errorOutput;
            result.errors = this.parseDotnetBuildOutput(errorOutput);

            if (result.errors.length === 0) {
                result.errors.push({
                    line: 0,
                    message: 'Build failed. Check the output for details.',
                    code: 'CSHARP002',
                    severity: 'error',
                });
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseDotnetBuildOutput(output: string): AnalysisError[] {
        const errors: AnalysisError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/(\S+\.cs)\((\d+),(\d+)\):\s*(\w+)\s+(.+):\s*(.+)/);
            if (match) {
                const [, file, lineNum, col, severity, code, message] = match;
                const errorSeverity = severity.toLowerCase().includes('error') ? 'error' : 'warning';

                errors.push({
                    line: parseInt(lineNum),
                    column: parseInt(col),
                    message: message.trim(),
                    code: code || undefined,
                    severity: errorSeverity,
                });
            }

            const errorMatch = line.match(/(\S+\.cs)\((\d+),\d+\)):\s*error\s+(CS\d+):\s*(.+)/);
            if (errorMatch) {
                const [, file, location, code, message] = errorMatch;
                const lineNum = location.match(/\d+/)?.[0] || '0';

                errors.push({
                    line: parseInt(lineNum),
                    message: message.trim(),
                    code: code,
                    severity: 'error',
                });
            }
        }

        return errors;
    }

    private parseDotnetWarnings(output: string): AnalysisError[] {
        return [];
    }

    private async runDotnetFormat(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'dotnet-format',
            success: true,
            errors: [],
            warnings: [],
            output: '',
            executionTime: 0,
        };

        const projectFile = this.buildProject();

        if (!projectFile) {
            result.success = false;
            result.errors.push({
                line: 0,
                message: 'No .csproj file found. Cannot run dotnet-format.',
                code: 'FORMAT001',
                severity: 'error',
            });
            return result;
        }

        try {
            const output = execSync(`dotnet format "${projectFile}" --verify-no-changes`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
            });
            result.output = output;
        } catch (error: any) {
            result.success = false;
            const errorOutput = error.stdout?.toString() || error.message || '';
            result.output = errorOutput;

            if (errorOutput.includes('would format')) {
                result.errors.push({
                    line: 0,
                    message: 'Code needs formatting. Run "dotnet format" to fix.',
                    code: 'FORMAT002',
                    severity: 'error',
                });
            } else {
                result.errors.push({
                    line: 0,
                    message: 'dotnet-format failed: ' + errorOutput.substring(0, 200),
                    code: 'FORMAT003',
                    severity: 'error',
                });
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
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

                    const classMatch = line.match(/^(public|internal|private|protected)?\s*(class|interface|struct|enum)\s+(\w+)/);
                    if (classMatch) {
                        const className = classMatch[3];
                        const isInterface = classMatch[2] === 'interface';

                        let expectedPrefix = '';
                        if (isInterface && !className.startsWith('I')) {
                            expectedPrefix = 'I';
                        }

                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(className)) {
                            result.errors.push({
                                line: i + 1,
                                message: `Type name "${className}" should use PascalCase${expectedPrefix ? ` (expected: I${className})` : ''}`,
                                code: 'NAMING010',
                                severity: 'error',
                            });
                        }
                    }

                    const methodMatch = line.match(/^(public|private|protected|internal|static)?\s+(async)?\s*(\w+)\s+(\w+)\s*\(/);
                    if (methodMatch) {
                        const isPrivate = methodMatch[1]?.toLowerCase() === 'private';
                        const methodName = methodMatch[4];

                        if (isPrivate) {
                            if (!/^_[a-z][a-zA-Z0-9]*$/.test(methodName) && !/^[a-z][a-zA-Z0-9]*$/.test(methodName)) {
                                result.errors.push({
                                    line: i + 1,
                                    message: `Private method "${methodName}" should start with lowercase or underscore (camelCase or _camelCase)`,
                                    code: 'NAMING011',
                                    severity: 'error',
                                });
                            }
                        } else {
                            if (!/^[A-Z][a-zA-Z0-9]*$/.test(methodName)) {
                                result.errors.push({
                                    line: i + 1,
                                    message: `Method "${methodName}" should use PascalCase`,
                                    code: 'NAMING012',
                                    severity: 'error',
                                });
                            }
                        }
                    }

                    const fieldMatch = line.match(/^(private|public|protected|internal)\s+(readonly)?\s*(\w+)\s+(\w+)\s*[=;]/);
                    if (fieldMatch) {
                        const fieldName = fieldMatch[4];
                        const isReadonly = fieldMatch[2] === 'readonly';

                        if (!/^_[a-z][a-zA-Z0-9]*$/.test(fieldName) && !/^[a-z][a-zA-Z0-9]*$/.test(fieldName)) {
                            result.errors.push({
                                line: i + 1,
                                message: `Field "${fieldName}" should use camelCase or _camelCase`,
                                code: 'NAMING013',
                                severity: 'error',
                            });
                        }
                    }

                    const constMatch = line.match(/^(public|private|protected|internal)?\s*const\s+(\w+)\s+(\w+)\s*=/);
                    if (constMatch) {
                        const constName = constMatch[3];
                        if (!/^[A-Z][A-Z0-9_]*$/.test(constName)) {
                            result.errors.push({
                                line: i + 1,
                                message: `Constant "${constName}" should use PascalCase`,
                                code: 'NAMING014',
                                severity: 'error',
                            });
                        }
                    }

                    const propertyMatch = line.match(/^(public|private|protected|internal)\s+(\w+)\s+(\w+)\s*\{/);
                    if (propertyMatch) {
                        const propertyName = propertyMatch[3];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(propertyName)) {
                            result.errors.push({
                                line: i + 1,
                                message: `Property "${propertyName}" should use PascalCase`,
                                code: 'NAMING015',
                                severity: 'error',
                            });
                        }
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

    private async checkBraceStyle(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'brace-style',
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
                    const nextLine = lines[i + 1] || '';

                    if (line.trim() && !line.trim().startsWith('//') && !line.trim().StartsWith('/*')) {
                        const hasOpeningBrace = line.includes('{');
                        const hasClosingBrace = line.includes('}');

                        if (hasOpeningBrace && nextLine && !nextLine.includes('{') && !nextLine.trim().startsWith('}')) {
                            if (!nextLine.trim().startsWith('{')) {
                                result.errors.push({
                                    line: i + 1,
                                    message: 'Opening brace should be on a new line (K&R style) or same line',
                                    code: 'BRACE001',
                                    severity: 'warning',
                                });
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Failed to check brace style in ${file}:`, error);
            }
        }

        result.success = result.errors.length === 0;
        result.executionTime = Date.now() - startTime;
        return result;
    }

    private async checkUsingDirectives(files: string[]): Promise<AnalysisResult> {
        const startTime = Date.now();
        const result: AnalysisResult = {
            tool: 'using-directives',
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

                const usingDirectives: string[] = [];
                let inNamespace = false;
                let inClass = false;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    if (line.trim().startsWith('using ')) {
                        usingDirectives.push(line.trim());
                    }

                    if (line.includes('namespace ')) {
                        inNamespace = true;
                    }

                    if (line.includes('class ') || line.includes('struct ')) {
                        inClass = true;
                    }
                }

                const sortedUsing = [...usingDirectives].sort();
                if (JSON.stringify(usingDirectives) !== JSON.stringify(sortedUsing)) {
                    result.warnings.push({
                        line: 0,
                        message: 'Using directives should be alphabetically sorted',
                        code: 'USING001',
                        severity: 'warning',
                    });
                }
            } catch (error) {
                console.error(`Failed to check using directives in ${file}:`, error);
            }
        }

        result.success = result.errors.length === 0;
        result.executionTime = Date.now() - startTime;
        return result;
    }

    public isToolAvailable(tool: string): boolean {
        try {
            if (tool === 'dotnet') {
                execSync('dotnet --version', { stdio: 'ignore' });
                return true;
            }
            execSync(`which ${tool}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    public async checkStyleCop(): Promise<boolean> {
        try {
            const projectFile = this.buildProject();
            if (!projectFile) return false;

            const content = fs.readFileSync(path.join(this.workspaceRoot, projectFile), 'utf-8');
            return content.includes('StyleCop') || content.includes('Microsoft.CodeQuality');
        } catch {
            return false;
        }
    }

    public async checkSonarAnalyzer(): Promise<boolean> {
        try {
            const projectFile = this.buildProject();
            if (!projectFile) return false;

            const content = fs.readFileSync(path.join(this.workspaceRoot, projectFile), 'utf-8');
            return content.includes('SonarAnalyzer') || content.includes('SonarLint');
        } catch {
            return false;
        }
    }
}

export async function analyzeCSharp(files: string[], workspaceRoot: string): Promise<AnalysisResult[]> {
    const analyzer = new CSharpAnalyzer(workspaceRoot);
    return analyzer.analyze(files);
}