import { FullAnalysisResult } from '../analyzer/engine';

export interface DiagnosticReport {
    errors: DiagnosticItem[];
    warnings: DiagnosticItem[];
    summary: string;
}

export interface DiagnosticItem {
    file: string;
    line: number;
    column?: number;
    message: string;
    code?: string;
    severity: 'error' | 'warning' | 'info';
    tool: string;
    layer: string;
}

export function reportDiagnostics(results: FullAnalysisResult, workspaceRoot: string): DiagnosticReport {
    const allDiagnostics: DiagnosticItem[] = [];

    const addResults = (results: any[], layer: string) => {
        for (const result of results) {
            for (const error of result.errors) {
                allDiagnostics.push({
                    file: error.file || '',
                    line: error.line,
                    column: error.column,
                    message: error.message,
                    code: error.code,
                    severity: 'error',
                    tool: result.tool,
                    layer,
                });
            }

            for (const warning of result.warnings) {
                allDiagnostics.push({
                    file: warning.file || '',
                    line: warning.line,
                    column: warning.column,
                    message: warning.message,
                    code: warning.code,
                    severity: 'warning',
                    tool: result.tool,
                    layer,
                });
            }
        }
    };

    addResults(results.lintResults, 'lint');
    addResults(results.astResults, 'ast');
    addResults(results.semanticResults, 'semantic');
    addResults(results.impactResults, 'impact');

    const report: DiagnosticReport = {
        errors: allDiagnostics.filter(d => d.severity === 'error'),
        warnings: allDiagnostics.filter(d => d.severity === 'warning'),
        summary: generateSummary(results, allDiagnostics),
    };

    return report;
}

function generateSummary(results: FullAnalysisResult, diagnostics: DiagnosticItem[]): string {
    const errorCount = diagnostics.filter(d => d.severity === 'error').length;
    const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

    let summary = `Code Quality Analysis Complete\n`;
    summary += `───────────────────\n`;
    summary += `Errors: ${errorCount}\n`;
    summary += `Warnings: ${warningCount}\n`;
    summary += `Execution time: ${results.executionTime}ms\n\n`;

    if (errorCount === 0 && warningCount === 0) {
        summary += `✓ All checks passed`;
    } else {
        summary += `✗ Checks failed\n\n`;
        summary += `Details:\n`;

        const grouped = new Map<string, DiagnosticItem[]>();
        for (const diag of diagnostics) {
            if (!grouped.has(diag.file)) {
                grouped.set(diag.file, []);
            }
            grouped.get(diag.file)!.push(diag);
        }

        for (const [file, diags] of grouped) {
            summary += `\n${file}:\n`;
            for (const diag of diags.slice(0, 5)) {
                const icon = diag.severity === 'error' ? '✗' : '⚠';
                summary += `  ${icon} L${diag.line}: ${diag.message}\n`;
                if (diag.code) {
                    summary += `     [${diag.code}]\n`;
                }
            }
            if (diags.length > 5) {
                summary += `  ... and ${diags.length - 5} more errors\n`;
            }
        }
    }

    return summary;
}

export function generateSummary2(results: FullAnalysisResult): string {
    let summary = '';

    if (results.success) {
        summary = '✓ All checks passed';
    } else {
        summary = `✗ ${results.totalErrors} errors, ${results.totalWarnings} warnings found`;
    }

    return summary;
}