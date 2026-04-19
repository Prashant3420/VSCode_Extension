import * as vscode from 'vscode';
import * as path from 'path';
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

export function reportDiagnostics(
    results: FullAnalysisResult,
    workspaceRoot: string
): DiagnosticReport {
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
            for (const diag of diags) {
                const icon = diag.severity === 'error' ? '✗' : '⚠';
                summary += `  ${icon} L${diag.line}: ${diag.message}\n`;
                if (diag.code) {
                    summary += `     [${diag.code}]\n`;
                }
            }
        }
    }

    return summary;
}

export function showDiagnosticsInProblemsPanel(
    diagnostics: DiagnosticItem[],
    workspaceRoot: string
): void {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('code-quality');

    const groupedDiagnostics = new Map<string, vscode.Diagnostic[]>();

    for (const diag of diagnostics) {
        const filePath = path.join(workspaceRoot, diag.file);

        if (!groupedDiagnostics.has(filePath)) {
            groupedDiagnostics.set(filePath, []);
        }

        const range = new vscode.Range(
            new vscode.Position(diag.line - 1, diag.column || 0),
            new vscode.Position(diag.line - 1, (diag.column || 0) + 1)
        );

        const vscodeDiag = new vscode.Diagnostic(range, diag.message);

        if (diag.code) {
            vscodeDiag.code = diag.code;
        }

        vscodeDiag.severity = diag.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;

        groupedDiagnostics.get(filePath)!.push(vscodeDiag);
    }

    for (const [file, diags] of groupedDiagnostics) {
        const uri = vscode.Uri.file(file);
        diagnosticCollection.set(uri, diags);
    }
}

export function clearDiagnostics(): void {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('code-quality');
    diagnosticCollection.clear();
}

export function showOutputPanel(
    report: DiagnosticReport,
    success: boolean
): void {
    const outputChannel = vscode.window.createOutputChannel('Code Quality Guardian');

    outputChannel.appendLine('');
    outputChannel.appendLine('═'.repeat(50));
    outputChannel.appendLine(report.summary);
    outputChannel.appendLine('═'.repeat(50));

    if (!success) {
        outputChannel.appendLine('');
        outputChannel.appendLine('COMMIT BLOCKED due to quality violations');
    }

    outputChannel.show(true);
}

export function showErrorNotification(message: string): void {
    vscode.window.showErrorMessage(message);
}

export function showWarningNotification(message: string): void {
    vscode.window.showWarningMessage(message);
}

export function showInfoNotification(message: string): void {
    vscode.window.showInformationMessage(message);
}

export async function showFormattedErrors(
    results: FullAnalysisResult,
    workspaceRoot: string
): Promise<void> {
    const report = reportDiagnostics(results, workspaceRoot);

    showDiagnosticsInProblemsPanel([...report.errors, ...report.warnings], workspaceRoot);
    showOutputPanel(report, results.success);

    if (!results.success) {
        showErrorNotification(`Code Quality: ${report.errors.length} errors, ${report.warnings.length} warnings found`);

        if (vscode.window.activeTextEditor) {
            const firstError = report.errors[0];
            if (firstError) {
                const filePath = path.join(workspaceRoot, firstError.file);
                const doc = await vscode.workspace.openTextDocument(filePath);

                await vscode.window.showTextDocument(doc, {
                    viewColumn: vscode.ViewColumn.One,
                    preserveFocus: false,
                });

                const position = new vscode.Position(firstError.line - 1, firstError.column || 0);
                const selection = new vscode.Selection(position, position);

                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    editor.selection = selection;
                    editor.revealRangeInScroll(selection);
                }
            }
        }
    } else {
        showInfoNotification('Code Quality: All checks passed');
    }
}