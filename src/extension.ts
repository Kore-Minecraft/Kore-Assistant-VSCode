// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import { koreElementManager, KoreElement } from './koreElements';

// Patterns to match in Kotlin files
const KORE_PATTERNS = {
	DATAPACK: /dataPack\s*\(\s*["']([^"']+)["']\s*\)\s*\{/g,
	FUNCTION: /function\s*\(\s*["']([^"']+)["']\s*\)\s*\{/g,
};

// Decoration types for gutter icons
let datapackDecoration: vscode.TextEditorDecorationType;
let functionDecoration: vscode.TextEditorDecorationType;

// Output channel for logging
let outputChannel: vscode.OutputChannel;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Create output channel
	outputChannel = vscode.window.createOutputChannel("Kore Assistant");
	outputChannel.appendLine("Kore Assistant is now active");

	// Get paths to icons - using only dark icons for better visibility in all themes
	const datapackIconUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'assets', 'datapack-dark.svg');
	const functionIconUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'assets', 'function-dark.svg');

	// Create decorations
	datapackDecoration = vscode.window.createTextEditorDecorationType({
		gutterIconPath: datapackIconUri,
		gutterIconSize: '100%'
	});

	functionDecoration = vscode.window.createTextEditorDecorationType({
		gutterIconPath: functionIconUri,
		gutterIconSize: '100%'
	});

	// Register the command to refresh gutter icons
	const refreshCommand = vscode.commands.registerCommand('kore-assistant.refreshGutterIcons', () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			updateDecorations(editor);
		}
	});

	// Add a test command to verify the extension is working
	const testCommand = vscode.commands.registerCommand('kore-assistant.testExtension', () => {
		vscode.window.showInformationMessage('Kore Assistant test command executed successfully!');
	});

	// Update decorations when opening, changing or saving documents
	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			updateDecorations(editor);
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		const editor = vscode.window.activeTextEditor;
		if (editor && event.document === editor.document) {
			updateDecorations(editor);
		}
	}, null, context.subscriptions);

	// Initial update for current editor
	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}

	context.subscriptions.push(refreshCommand);
	context.subscriptions.push(testCommand);
}

function updateDecorations(editor: vscode.TextEditor) {
	if (!editor || editor.document.languageId !== 'kotlin') {
		return;
	}

	const document = editor.document;
	const documentUri = document.uri;
	const text = document.getText();

	// Clear existing elements for this document
	koreElementManager.clearElements();

	// Find datapack patterns
	const datapackRanges: vscode.DecorationOptions[] = [];
	let match;

	KORE_PATTERNS.DATAPACK.lastIndex = 0; // Reset regex index
	while ((match = KORE_PATTERNS.DATAPACK.exec(text)) !== null) {
		const startPos = document.positionAt(match.index);
		const endPos = document.positionAt(match.index + match[0].length);
		const range = new vscode.Range(startPos, endPos);

		// Create a Kore element and add it to the manager
		const element: KoreElement = {
			name: match[1],
			type: 'datapack',
			range,
			uri: documentUri
		};

		koreElementManager.addElement(element);

		datapackRanges.push({
			range,
			hoverMessage: `Datapack: ${match[1]}`
		});
	}

	// Find function patterns
	const functionRanges: vscode.DecorationOptions[] = [];
	KORE_PATTERNS.FUNCTION.lastIndex = 0; // Reset regex index

	while ((match = KORE_PATTERNS.FUNCTION.exec(text)) !== null) {
		const startPos = document.positionAt(match.index);
		const endPos = document.positionAt(match.index + match[0].length);
		const range = new vscode.Range(startPos, endPos);

		// Create a Kore element and add it to the manager
		const element: KoreElement = {
			name: match[1],
			type: 'function',
			range,
			uri: documentUri
		};

		koreElementManager.addElement(element);

		functionRanges.push({
			range,
			hoverMessage: `Function: ${match[1]}`
		});
	}

	// Apply decorations
	editor.setDecorations(datapackDecoration, datapackRanges);
	editor.setDecorations(functionDecoration, functionRanges);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Clean up decorations
	if (datapackDecoration) {
		datapackDecoration.dispose();
	}
	if (functionDecoration) {
		functionDecoration.dispose();
	}

	if (outputChannel) {
		outputChannel.dispose();
	}
}
