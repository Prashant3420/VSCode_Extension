import * as vscode from 'vscode';
import { ConfigManager } from './config/configManager';
import { GitIntegration } from './git/gitIntegration';
import { runChecks, FullAnalysisResult } from './analyzer/engine';
import { runScan } from './scanner/codebaseScanner';
import { reportDiagnostics } from './diagnostics/diagnosticsEngine';

let gitIntegration: GitIntegration | null = null;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('Code Quality Guardian');

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!workspaceRoot) {
        outputChannel.appendLine('No workspace folder found. Code Quality Guardian requires an open workspace.');
        return;
    }

    outputChannel.appendLine(`Activating Code Quality Guardian in: ${workspaceRoot}`);

    const configManager = ConfigManager.getInstance();
    configManager.initialize(workspaceRoot);

    gitIntegration = new GitIntegration(workspaceRoot);
    await gitIntegration.initialize();

    const profile = configManager.loadProjectProfile();
    if (!profile || !configManager.getAnalysisConfig().enableCodebaseScan) {
        outputChannel.appendLine('Scanning project to build profile...');
        await runScan(workspaceRoot, { force: false });
    }

    gitIntegration.showHookInstallationPrompt();

    registerCommands(context, workspaceRoot);

    outputChannel.appendLine('Code Quality Guardian activated successfully');
}

function registerCommands(context: vscode.ExtensionContext, workspaceRoot: string): void {
    const installHookCmd = vscode.commands.registerCommand('code-quality.installHook', async () => {
        if (gitIntegration) {
            await gitIntegration.installHook();
        }
    });

    const uninstallHookCmd = vscode.commands.registerCommand('code-quality.uninstallHook', async () => {
        if (gitIntegration) {
            await gitIntegration.uninstallHook();
        }
    });

    const runChecksCmd = vscode.commands.registerCommand('code-quality.runChecks', async () => {
        await runQualityChecks(workspaceRoot);
    });

    const scanProjectCmd = vscode.commands.registerCommand('code-quality.scanProject', async () => {
        outputChannel.appendLine('Scanning project...');
        const result = await runScan(workspaceRoot, { force: true });

        if (result.success) {
            vscode.window.showInformationMessage(`Project scanned. ${result.filesScanned} files analyzed.`);
        } else {
            vscode.window.showErrorMessage(`Scan failed: ${result.error}`);
        }
    });

    const showConfigCmd = vscode.commands.registerCommand('code-quality.showConfig', () => {
        const configManager = ConfigManager.getInstance();
        const config = configManager.getConfig();

        const configJson = JSON.stringify(config, null, 2);
        vscode.workspace.openTextDocument({ content: configJson, language: 'json' });
    });

    const enableAutoOnCommitCmd = vscode.commands.registerCommand('code-quality.enableAutoOnCommit', async () => {
        const configManager = ConfigManager.getInstance();
        configManager.updateConfig({ enableAutoOnCommit: true });
        vscode.window.showInformationMessage('Auto-run on commit enabled');
    });

    const disableAutoOnCommitCmd = vscode.commands.registerCommand('code-quality.disableAutoOnCommit', async () => {
        const configManager = ConfigManager.getInstance();
        configManager.updateConfig({ enableAutoOnCommit: false });
        vscode.window.showInformationMessage('Auto-run on commit disabled');
    });

    context.subscriptions.push(
        installHookCmd,
        uninstallHookCmd,
        runChecksCmd,
        scanProjectCmd,
        showConfigCmd,
        enableAutoOnCommitCmd,
        disableAutoOnCommitCmd
    );
}

async function runQualityChecks(workspaceRoot: string): Promise<FullAnalysisResult | null> {
    const outputChannel = vscode.window.createOutputChannel('Code Quality Guardian');

    outputChannel.clear();
    outputChannel.appendLine('='.repeat(50));
    outputChannel.appendLine('Code Quality Guardian - Running Checks');
    outputChannel.appendLine('='.repeat(50));
    outputChannel.appendLine('');

    const configManager = ConfigManager.getInstance();
    configManager.initialize(workspaceRoot);

    const gitIntegration = new GitIntegration(workspaceRoot);
    const staged = await gitIntegration.getStagedFilesOnly();

    if (staged.length === 0) {
        outputChannel.appendLine('No staged files found');
        outputChannel.show(true);
        vscode.window.showInformationMessage('No staged files to check');
        return null;
    }

    outputChannel.appendLine(`Staged files: ${staged.length}`);
    outputChannel.appendLine('');

    const results = await runChecks(staged, workspaceRoot);

    const report = reportDiagnostics(results, workspaceRoot);

    outputChannel.appendLine('');
    if (results.success) {
        outputChannel.appendLine('✓ All checks passed');
    } else {
        outputChannel.appendLine(`✗ ${results.totalErrors} errors, ${results.totalWarnings} warnings`);
    }
    outputChannel.appendLine(`Execution time: ${results.executionTime}ms`);
    outputChannel.show(true);

    return results;
}

export function deactivate(): void {
    if (gitIntegration) {
        gitIntegration.dispose();
    }
}