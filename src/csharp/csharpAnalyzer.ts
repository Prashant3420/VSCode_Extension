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

export class CSharpAnalyzer {
    private configManager: ConfigManager;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configManager = ConfigManager.getInstance();
    }

    public async analyze(files: string[], options?: any): Promise<AnalysisResult[]> {
        const config = this.configManager.getCSharpConfig();
        const results: AnalysisResult[] = [];

        const csFiles = files.filter(f => f.endsWith('.cs'));
        if (csFiles.length === 0) {
            return results;
        }

        if (config.runRoslyn.level !== 'off') {
            results.push(await this.runDotnetBuild(csFiles));
        }

        if (config.runDotnetFormat.level !== 'off') {
            results.push(await this.runDotnetFormat(csFiles));
        }

        if (config.enforceNaming.level !== 'off') {
            results.push(await this.checkNamingConventions(csFiles));
        }

        return results;
    }

    private findProjectFile(): string | null {
        const files = fs.readdirSync(this.workspaceRoot).filter(f => f.endsWith('.csproj'));
        if (files.length > 0) {
            return files[0];
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

        const projectFile = this.findProjectFile();

        if (!projectFile) {
            result.success = false;
            result.errors.push({
                line: 0,
                message: 'No .csproj file found',
                code: 'CSHARP001',
                severity: 'error',
            });
            return result;
        }

        try {
            execSync(`dotnet build "${projectFile}" --no-incremental --verbosity quiet`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
            });
        } catch (error: any) {
            result.success = false;
            const errorOutput = error.stdout?.toString() || error.message || '';
            result.errors = this.parseDotnetBuildOutput(errorOutput);
            if (result.errors.length === 0) {
                result.errors.push({ line: 0, message: 'Build failed', code: 'CSHARP002', severity: 'error' });
            }
        }

        result.executionTime = Date.now() - startTime;
        return result;
    }

    private parseDotnetBuildOutput(output: string): AnalysisError[] {
        const errors: AnalysisError[] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const match = line.match(/(\S+\.cs)\((\d+),(\d+)\):\s*(\w+)\s+(CS\d+):\s*(.+)/);
            if (match) {
                const severity = match[4].toLowerCase().includes('error') ? 'error' : 'warning';
                errors.push({
                    line: parseInt(match[2]),
                    column: parseInt(match[3]),
                    message: match[6].trim(),
                    code: match[5],
                    severity,
                });
            }
        }

        return errors;
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

        const projectFile = this.findProjectFile();
        if (!projectFile) {
            result.success = false;
            result.errors.push({ line: 0, message: 'No .csproj file found', code: 'FORMAT001', severity: 'error' });
            return result;
        }

        try {
            execSync(`dotnet format "${projectFile}" --verify-no-changes`, {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
            });
        } catch (error: any) {
            result.success = false;
            result.errors.push({
                line: 1,
                message: 'Code needs formatting (run dotnet format)',
                code: 'FORMAT002',
                severity: 'error',
            });
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

                    const classMatch = line.match(/^(public|internal|private)?\s*(class|interface|struct|enum)\s+(\w+)/);
                    if (classMatch) {
                        const name = classMatch[4];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            result.errors.push({
                                line: i + 1,
                                message: `Type "${name}" should use PascalCase`,
                                code: 'NAMING010',
                                severity: 'error',
                            });
                        }
                    }

                    const methodMatch = line.match(/^(public|private|protected|internal)\s+(\w+)\s+(\w+)\s*\(/);
                    if (methodMatch) {
                        const name = methodMatch[3];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            result.errors.push({
                                line: i + 1,
                                message: `Method "${name}" should use PascalCase`,
                                code: 'NAMING011',
                                severity: 'error',
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

export async function analyzeCSharp(files: string[], workspaceRoot: string): Promise<AnalysisResult[]> {
    const analyzer = new CSharpAnalyzer(workspaceRoot);
    return analyzer.analyze(files);
}