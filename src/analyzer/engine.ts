import { ConfigManager } from '../config/configManager';
import { analyzePython } from '../python/pythonAnalyzer';
import { analyzeCSharp } from '../csharp/csharpAnalyzer';
import { analyzeTypeScript } from '../typescript/typescriptAnalyzer';
import { analyzeJavaScript } from '../javascript/javascriptAnalyzer';
import { analyzeWithAST } from './astLayer';
import { analyzeSemantically } from './semanticLayer';
import { runDiffImpactAnalysis } from '../impact/diffImpactAnalyzer';
import { reportDiagnostics, DiagnosticReport } from '../diagnostics/diagnosticsEngine';

export interface StagedFile {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    language: 'python' | 'csharp' | 'typescript' | 'javascript' | 'unknown';
}

export interface AnalysisResult {
    tool: string;
    success: boolean;
    errors: any[];
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
        const typeScriptFiles = stagedFiles.filter(f => f.language === 'typescript').map(f => f.path);
        const javaScriptFiles = stagedFiles.filter(f => f.language === 'javascript').map(f => f.path);

        const analysisConfig = this.configManager.getAnalysisConfig();

        if (pythonFiles.length > 0 || csharpFiles.length > 0 || typeScriptFiles.length > 0 || javaScriptFiles.length > 0) {
            if (analysisConfig.enableAstAnalysis) {
                for (const file of stagedFiles) {
                    const astResults = await analyzeWithAST(file.path, file.language, this.workspaceRoot);
                    for (const r of astResults) {
                        results.astResults.push({
                            tool: r.tool,
                            success: r.success,
                            errors: r.errors.map(e => ({ ...e, file: e.file || file.path })),
                            warnings: r.warnings.map(w => ({ ...w, file: w.file || file.path })),
                            output: r.output,
                            executionTime: r.executionTime,
                            layer: 'ast',
                        });
                    }
                }
            }
        }

        if (pythonFiles.length > 0) {
            const pyResults = await analyzePython(pythonFiles, this.workspaceRoot);
            for (const result of pyResults) {
                results.lintResults.push({
                    ...result,
                    layer: 'lint' as const,
                    errors: result.errors.map(e => ({ ...e, file: pythonFiles[0] })),
                    warnings: result.warnings.map(w => ({ ...w, file: pythonFiles[0] })),
                });
            }
        }

        if (csharpFiles.length > 0) {
            const csResults = await analyzeCSharp(csharpFiles, this.workspaceRoot);
            for (const result of csResults) {
                results.lintResults.push({
                    ...result,
                    layer: 'lint' as const,
                    errors: result.errors.map(e => ({ ...e, file: csharpFiles[0] })),
                    warnings: result.warnings.map(w => ({ ...w, file: csharpFiles[0] })),
                });
            }
        }

        if (typeScriptFiles.length > 0) {
            const tsResults = await analyzeTypeScript(typeScriptFiles, this.workspaceRoot);
            for (const result of tsResults) {
                results.lintResults.push({
                    ...result,
                    layer: 'lint' as const,
                    errors: result.errors.map(e => ({ ...e, file: typeScriptFiles[0] })),
                    warnings: result.warnings.map(w => ({ ...w, file: typeScriptFiles[0] })),
                });
            }
        }

        if (javaScriptFiles.length > 0) {
            const jsResults = await analyzeJavaScript(javaScriptFiles, this.workspaceRoot);
            for (const result of jsResults) {
                results.lintResults.push({
                    ...result,
                    layer: 'lint' as const,
                    errors: result.errors.map(e => ({ ...e, file: javaScriptFiles[0] })),
                    warnings: result.warnings.map(w => ({ ...w, file: javaScriptFiles[0] })),
                });
            }
        }

        if (analysisConfig.enableSemanticAnalysis && stagedFiles.length > 0) {
            const semanticResults = await analyzeSemantically(stagedFiles, this.workspaceRoot);
            for (const r of semanticResults) {
                results.semanticResults.push({
                    tool: r.tool,
                    success: r.success,
                    errors: r.errors.map(e => ({ ...e, file: e.file || '' })),
                    warnings: r.warnings.map(w => ({ ...w, file: w.file || '' })),
                    output: r.output,
                    executionTime: r.executionTime,
                    layer: 'semantic',
                });
            }
        }

        if (analysisConfig.enableImpactAnalysis && stagedFiles.length > 0) {
            const impactResults = await runDiffImpactAnalysis(stagedFiles, this.workspaceRoot);
            for (const r of impactResults) {
                results.impactResults.push({
                    tool: r.tool,
                    success: r.success,
                    errors: r.errors.map(e => ({ ...e, file: e.file || '' })),
                    warnings: r.warnings.map(w => ({ ...w, file: w.file || '' })),
                    output: r.output,
                    executionTime: r.executionTime,
                    layer: 'impact',
                });
            }
        }

        for (const result of results.lintResults) {
            results.totalErrors += result.errors.length;
            results.totalWarnings += result.warnings.length;
            if (result.errors.length > 0) {
                results.success = false;
            }
        }

        for (const result of results.astResults) {
            results.totalErrors += result.errors.length;
            results.totalWarnings += result.warnings.length;
            if (result.errors.length > 0) {
                results.success = false;
            }
        }

        for (const result of results.semanticResults) {
            results.totalErrors += result.errors.length;
            results.totalWarnings += result.warnings.length;
            if (result.errors.length > 0) {
                results.success = false;
            }
        }

        for (const result of results.impactResults) {
            results.totalErrors += result.errors.length;
            results.totalWarnings += result.warnings.length;
            if (result.errors.length > 0) {
                results.success = false;
            }
        }

        if (this.configManager.isStrictMode() && results.totalErrors > 0) {
            results.success = false;
        }

        results.executionTime = Date.now() - startTime;
        results.diagnosticReport = reportDiagnostics(results, this.workspaceRoot);

        return results;
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
    const typeScriptFiles = stagedFiles.filter(f => f.language === 'typescript').map(f => f.path);
    const javaScriptFiles = stagedFiles.filter(f => f.language === 'javascript').map(f => f.path);

    const errors: AnalysisError[] = [];

    if (pythonFiles.length > 0) {
        const pyResults = await analyzePython(pythonFiles, workspaceRoot);
        for (const result of pyResults) {
            errors.push(...result.errors as any);
        }
    }

    if (csharpFiles.length > 0) {
        const csResults = await analyzeCSharp(csharpFiles, workspaceRoot);
        for (const result of csResults) {
            errors.push(...result.errors as any);
        }
    }

    if (typeScriptFiles.length > 0) {
        const tsResults = await analyzeTypeScript(typeScriptFiles, workspaceRoot);
        for (const result of tsResults) {
            errors.push(...result.errors as any);
        }
    }

    if (javaScriptFiles.length > 0) {
        const jsResults = await analyzeJavaScript(javaScriptFiles, workspaceRoot);
        for (const result of jsResults) {
            errors.push(...result.errors as any);
        }
    }

    return errors.length === 0;
}