import * as vscode from 'vscode';
import { ConfigManager } from '../config/configManager';
import { analyzePython, AnalysisResult as PythonAnalysisResult } from '../python/pythonAnalyzer';
import { analyzeCSharp, AnalysisResult as CSharpAnalysisResult } from '../csharp/csharpAnalyzer';
import { analyzeWithAST, ASTAnalysisResult } from './astLayer';
import { analyzeSemantically, SemanticAnalysisResult } from './semanticLayer';
import { runDiffImpactAnalysis, ImpactAnalysisResult } from '../impact/diffImpactAnalyzer';
import { reportDiagnostics, DiagnosticReport } from '../diagnostics/diagnosticsEngine';

export interface StagedFile {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    language: 'python' | 'csharp' | 'unknown';
}

export interface AnalysisResult {
    tool: string;
    success: boolean;
    errors: AnalysisError[];
    warnings: AnalysisError[];
    output: string;
    executionTime: number;
    layer: 'lint' | 'ast' | 'semantic' | 'impact';
}

export interface AnalysisError {
    line: number;
    column?: number;
    message: string;
    code?: string;
    severity: 'error' | 'warning' | 'info';
    file: string;
}

export interface FullAnalysisResult {
    stagedFiles: StagedFile[];
    lintResults: AnalysisResult[];
    astResults: AnalysisResult[];
    semanticResults: AnalysisResult[];
    impactResults: AnalysisResult[];
    totalErrors: number;
    totalWarnings: number;
    success: boolean;
    executionTime: number;
    diagnosticReport: DiagnosticReport;
}

export class AnalyzerEngine {
    private configManager: ConfigManager;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configManager = ConfigManager.getInstance();
    }

    public async runAnalysis(stagedFiles: StagedFile[]): Promise<FullAnalysisResult> {
        const startTime = Date.now();
        const results: FullAnalysisResult = {
            stagedFiles,
            lintResults: [],
            astResults: [],
            semanticResults: [],
            impactResults: [],
            totalErrors: 0,
            totalWarnings: 0,
            success: true,
            executionTime: 0,
            diagnosticReport: {
                errors: [],
                warnings: [],
                summary: '',
            },
        };

        const pythonFiles = stagedFiles.filter(f => f.language === 'python').map(f => f.path);
        const csharpFiles = stagedFiles.filter(f => f.language === 'csharp').map(f => f.path);

        const analysisConfig = this.configManager.getAnalysisConfig();

        if (pythonFiles.length > 0 || csharpFiles.length > 0) {
            if (analysisConfig.enableAstAnalysis) {
                results.astResults = await this.runASTAnalysis(stagedFiles);
            }

            if (results.astResults.some(r => !r.success)) {
                await this.processResults(results, 'ast');
                results.success = false;
                results.executionTime = Date.now() - startTime;
                results.diagnosticReport = reportDiagnostics(results, this.workspaceRoot);
                return results;
            }
        }

        if (pythonFiles.length > 0) {
            const pyResults = await this.runLintAnalysis(pythonFiles, 'python');
            results.lintResults.push(...pyResults);
        }

        if (csharpFiles.length > 0) {
            const csResults = await this.runLintAnalysis(csharpFiles, 'csharp');
            results.lintResults.push(...csResults);
        }

        if (results.lintResults.some(r => !r.success)) {
            await this.processResults(results, 'lint');
            results.success = false;
            results.executionTime = Date.now() - startTime;
            results.diagnosticReport = reportDiagnostics(results, this.workspaceRoot);
            return results;
        }

        if (analysisConfig.enableSemanticAnalysis) {
            results.semanticResults = await this.runSemanticAnalysis(stagedFiles);
            if (results.semanticResults.some(r => !r.success)) {
                results.totalErrors += results.semanticResults.filter(r => !r.success).length;
            }
        }

        if (analysisConfig.enableImpactAnalysis) {
            results.impactResults = await runDiffImpactAnalysis(stagedFiles, this.workspaceRoot);
            if (results.impactResults.some(r => !r.success)) {
                results.totalErrors += results.impactResults.filter(r => !r.success).length;
            }
        }

        await this.processResults(results, 'all');

        if (this.configManager.isStrictMode() && results.totalErrors > 0) {
            results.success = false;
        }

        results.executionTime = Date.now() - startTime;
        results.diagnosticReport = reportDiagnostics(results, this.workspaceRoot);

        return results;
    }

    private async runLintAnalysis(files: string[], language: 'python' | 'csharp'): Promise<AnalysisResult[]> {
        const results: AnalysisResult[] = [];

        if (language === 'python') {
            const pyResults = await analyzePython(files, this.workspaceRoot);
            for (const result of pyResults) {
                results.push({
                    ...result,
                    layer: 'lint' as const,
                    errors: result.errors.map(e => ({ ...e, file: files[0] })),
                    warnings: result.warnings.map(w => ({ ...w, file: files[0] })),
                });
            }
        } else {
            const csResults = await analyzeCSharp(files, this.workspaceRoot);
            for (const result of csResults) {
                results.push({
                    ...result,
                    layer: 'lint' as const,
                    errors: result.errors.map(e => ({ ...e, file: files[0] })),
                    warnings: result.warnings.map(w => ({ ...w, file: files[0] })),
                });
            }
        }

        return results;
    }

    private async runASTAnalysis(stagedFiles: StagedFile[]): Promise<AnalysisResult[]> {
        const results: AnalysisResult[] = [];

        for (const file of stagedFiles) {
            const astResults = await analyzeWithAST(file.path, file.language, this.workspaceRoot);
            results.push(...astResults);
        }

        return results;
    }

    private async runSemanticAnalysis(stagedFiles: StagedFile[]): Promise<AnalysisResult[]> {
        const results: AnalysisResult[] = [];

        const semanticResults = await analyzeSemantically(stagedFiles, this.workspaceRoot);
        results.push(...semanticResults);

        return results;
    }

    private async processResults(results: FullAnalysisResult, phase: 'lint' | 'ast' | 'semantic' | 'impact' | 'all'): void {
        switch (phase) {
            case 'lint':
                for (const result of results.lintResults) {
                    results.totalErrors += result.errors.length;
                    results.totalWarnings += result.warnings.length;
                    if (result.errors.length > 0) {
                        results.success = false;
                    }
                }
                break;
            case 'ast':
                for (const result of results.astResults) {
                    results.totalErrors += result.errors.length;
                    results.totalWarnings += result.warnings.length;
                    if (result.errors.length > 0) {
                        results.success = false;
                    }
                }
                break;
            case 'semantic':
                for (const result of results.semanticResults) {
                    results.totalErrors += result.errors.length;
                    results.totalWarnings += result.warnings.length;
                    if (result.errors.length > 0) {
                        results.success = false;
                    }
                }
                break;
            case 'impact':
                for (const result of results.impactResults) {
                    results.totalErrors += result.errors.length;
                    results.totalWarnings += result.warnings.length;
                    if (result.errors.length > 0) {
                        results.success = false;
                    }
                }
                break;
            case 'all':
                this.processResults(results, 'lint');
                this.processResults(results, 'ast');
                this.processResults(results, 'semantic');
                this.processResults(results, 'impact');
                break;
        }
    }

    public async runChecks(stagedFiles: StagedFile[], workspaceRoot: string): Promise<FullAnalysisResult> {
        const engine = new AnalyzerEngine(workspaceRoot);
        return engine.runAnalysis(stagedFiles);
    }
}

export async function runChecks(stagedFiles: StagedFile[], workspaceRoot: string): Promise<FullAnalysisResult> {
    const engine = new AnalyzerEngine(workspaceRoot);
    return engine.runAnalysis(stagedFiles);
}

export async function quickLint(stagedFiles: StagedFile[], workspaceRoot: string): Promise<boolean> {
    const configManager = ConfigManager.getInstance();
    configManager.initialize(workspaceRoot);

    const pythonFiles = stagedFiles.filter(f => f.language === 'python').map(f => f.path);
    const csharpFiles = stagedFiles.filter(f => f.language === 'csharp').map(f => f.path);

    const errors: AnalysisError[] = [];

    if (pythonFiles.length > 0) {
        const pyResults = await analyzePython(pythonFiles, workspaceRoot);
        for (const result of pyResults) {
            errors.push(...result.errors);
        }
    }

    if (csharpFiles.length > 0) {
        const csResults = await analyzeCSharp(csharpFiles, workspaceRoot);
        for (const result of csResults) {
            errors.push(...result.errors);
        }
    }

    return errors.length === 0;
}