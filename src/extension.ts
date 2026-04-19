import * as vscode from 'vscode';
import { ConfigManager } from './config/configManager';
import { GitIntegration } from './git/gitIntegration';
import { runChecks, FullAnalysisResult } from './analyzer/engine';
import { runScan } from './scanner/codebaseScanner';
import { reportDiagnostics } from './diagnostics/diagnosticsEngine';

let gitIntegration: GitIntegration | null = null;
let outputChannel: vscode.OutputChannel;
let currentWorkspaceRoot: string | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        outputChannel = vscode.window.createOutputChannel('Code Quality Guardian');
        
        outputChannel.appendLine('='.repeat(50));
        outputChannel.appendLine('Code Quality Guardian - Activating');
        outputChannel.appendLine('='.repeat(50));
        
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        
        if (!workspaceRoot) {
            outputChannel.appendLine('WARNING: No workspace folder open');
            outputChannel.appendLine('Extension will work with limited functionality');
            outputChannel.show(true);
            vscode.window.showWarningMessage('Code Quality Guardian: No workspace detected. Some features may be limited.');
        } else {
            currentWorkspaceRoot = workspaceRoot;
            outputChannel.appendLine(`Workspace: ${workspaceRoot}`);
            
            const configManager = ConfigManager.getInstance();
            configManager.initialize(workspaceRoot);
            
            gitIntegration = new GitIntegration(workspaceRoot);
            await gitIntegration.initialize();
            
            const profile = configManager.loadProjectProfile();
            if (!profile || !configManager.getAnalysisConfig().enableCodebaseScan) {
                try {
                    outputChannel.appendLine('Scanning project to build profile...');
                    await runScan(workspaceRoot, { force: false });
                    outputChannel.appendLine('Project scan complete');
                } catch (scanError) {
                    outputChannel.appendLine(`Scan warning: ${scanError}`);
                }
            }
            
            gitIntegration.showHookInstallationPrompt();
        }
        
        registerCommands(context);
        
        outputChannel.appendLine('');
        outputChannel.appendLine('✓ Extension activated successfully');
        outputChannel.appendLine('Commands registered and ready');
        outputChannel.show(true);
        
        vscode.window.showInformationMessage('Code Quality Guardian Active');
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        outputChannel?.appendLine(`FATAL ERROR during activation: ${errorMsg}`);
        outputChannel?.show(true);
        vscode.window.showErrorMessage(`Code Quality Guardian activation failed: ${errorMsg}`);
        console.error('Extension activation failed:', error);
    }
}

function registerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('code-quality.installHook', async () => {
            if (!currentWorkspaceRoot) {
                vscode.window.showWarningMessage('No workspace open. Please open a folder first.');
                return;
            }
            try {
                const git = gitIntegration || new GitIntegration(currentWorkspaceRoot);
                await git.installHook();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('code-quality.uninstallHook', async () => {
            if (!currentWorkspaceRoot) {
                vscode.window.showWarningMessage('No workspace open. Please open a folder first.');
                return;
            }
            try {
                const git = gitIntegration || new GitIntegration(currentWorkspaceRoot);
                await git.uninstallHook();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('code-quality.runChecks', async () => {
            if (!currentWorkspaceRoot) {
                vscode.window.showWarningMessage('No workspace open. Please open a folder first.');
                return;
            }
            await runQualityChecks();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('code-quality.scanProject', async () => {
            if (!currentWorkspaceRoot) {
                vscode.window.showWarningMessage('No workspace open. Please open a folder first.');
                return;
            }
            
            outputChannel?.appendLine('Scanning project...');
            const result = await runScan(currentWorkspaceRoot, { force: true });
            
            if (result.success) {
                outputChannel?.appendLine(`✓ Project scanned. ${result.filesScanned} files analyzed.`);
                vscode.window.showInformationMessage(`Project scanned. ${result.filesScanned} files analyzed.`);
            } else {
                outputChannel?.appendLine(`✗ Scan failed: ${result.error}`);
                vscode.window.showErrorMessage(`Scan failed: ${result.error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('code-quality.showConfig', async () => {
            const configManager = ConfigManager.getInstance();
            const config = configManager.getConfig();
            const configJson = JSON.stringify(config, null, 2);
            
            const doc = await vscode.workspace.openTextDocument({
                content: configJson,
                language: 'json'
            });
            await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('code-quality.enableAutoOnCommit', async () => {
            if (!currentWorkspaceRoot) {
                vscode.window.showWarningMessage('No workspace open. Please open a folder first.');
                return;
            }
            const configManager = ConfigManager.getInstance();
            configManager.updateConfig({ enableAutoOnCommit: true });
            vscode.window.showInformationMessage('✓ Auto-run on commit enabled');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('code-quality.disableAutoOnCommit', async () => {
            if (!currentWorkspaceRoot) {
                vscode.window.showWarningMessage('No workspace open. Please open a folder first.');
                return;
            }
            const configManager = ConfigManager.getInstance();
            configManager.updateConfig({ enableAutoOnCommit: false });
            vscode.window.showInformationMessage('✓ Auto-run on commit disabled');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('code-quality.showStatus', async () => {
            const configManager = ConfigManager.getInstance();
            const profile = configManager.loadProjectProfile();
            
            let statusText = 'Code Quality Guardian Status\n';
            statusText += '─'.repeat(40) + '\n';
            statusText += `Workspace: ${currentWorkspaceRoot || 'None'}\n`;
            statusText += `Hook Installed: ${gitIntegration?.isHookInstalled() ? 'Yes' : 'No'}\n`;
            statusText += `Strict Mode: ${configManager.isStrictMode() ? 'Yes' : 'No'}\n`;
            
            if (profile) {
                statusText += `Language: ${profile.language}\n`;
                statusText += `Last Scanned: ${profile.lastScanned}\n`;
            }
            
            outputChannel?.appendLine(statusText);
            outputChannel?.show(true);
        })
    );
}

async function runQualityChecks(): Promise<FullAnalysisResult | null> {
    if (!currentWorkspaceRoot) {
        outputChannel?.appendLine('ERROR: No workspace open');
        vscode.window.showWarningMessage('No workspace open. Please open a folder first.');
        return null;
    }

    const out = outputChannel || vscode.window.createOutputChannel('Code Quality Guardian');
    
    out.clear();
    out.appendLine('═'.repeat(50));
    out.appendLine('Code Quality Guardian - Running Checks');
    out.appendLine('═'.repeat(50));
    out.appendLine('');

    try {
        const configManager = ConfigManager.getInstance();
        configManager.initialize(currentWorkspaceRoot);

        const git = gitIntegration || new GitIntegration(currentWorkspaceRoot);
        const staged = await git.getStagedFilesOnly();

        if (staged.length === 0) {
            out.appendLine('No staged files found');
            out.appendLine('Hint: Stage files with: git add <file>');
            out.show(true);
            vscode.window.showInformationMessage('No staged files to check');
            return null;
        }

        out.appendLine(`Staged files: ${staged.length}`);
        for (const file of staged) {
            out.appendLine(`  - ${file.path} (${file.language})`);
        }
        out.appendLine('');

        const results = await runChecks(staged, currentWorkspaceRoot);
        const report = reportDiagnostics(results, currentWorkspaceRoot);

        out.appendLine('');
        if (results.success) {
            out.appendLine('✓ ✓ ✓ All checks passed! ✓ ✓ ✓');
            vscode.window.showInformationMessage('✓ All code quality checks passed!');
        } else {
            out.appendLine(`✗ ${results.totalErrors} errors, ${results.totalWarnings} warnings`);
            out.appendLine('');
            out.appendLine('Error Details:');
            for (const err of report.errors.slice(0, 10)) {
                out.appendLine(`  ${err.file}:${err.line} - ${err.message}`);
            }
            out.appendLine('');
            out.appendLine('COMMIT BLOCKED - Fix errors before committing');
            vscode.window.showErrorMessage(`Code Quality: ${results.totalErrors} errors found. Commit blocked.`);
        }
        
        out.appendLine('');
        out.appendLine(`Execution time: ${results.executionTime}ms`);
        out.show(true);

        return results;
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        out.appendLine(`ERROR during analysis: ${errorMsg}`);
        out.show(true);
        vscode.window.showErrorMessage(`Code Quality check failed: ${errorMsg}`);
        return null;
    }
}

export function deactivate(): void {
    outputChannel?.appendLine('Code Quality Guardian deactivated');
    if (gitIntegration) {
        gitIntegration.dispose();
    }
}