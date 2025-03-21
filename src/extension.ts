// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Kore Assistant is now active');

	// Determine the correct path for assets
	const extensionPath = context.extensionPath;
	const assetPath = getAssetPath(extensionPath);

	// Initialize decorations
	const datapackIconPath = {
		light: path.join(assetPath, 'datapack-light.svg'),
		dark: path.join(assetPath, 'datapack-dark.svg')
	};

	const functionIconPath = {
		light: path.join(assetPath, 'function-light.svg'),
		dark: path.join(assetPath, 'function-dark.svg')
	};

	datapackDecoration = vscode.window.createTextEditorDecorationType({
		gutterIconPath: vscode.Uri.file(datapackIconPath.dark),
		gutterIconSize: 'contain'
	});

	functionDecoration = vscode.window.createTextEditorDecorationType({
		gutterIconPath: vscode.Uri.file(functionIconPath.dark),
		gutterIconSize: 'contain'
	});

	// Register the command to refresh gutter icons
	const refreshCommand = vscode.commands.registerCommand('kore-assistant.refreshGutterIcons', () => {
		const editor = vscode.window.activeTextEditor;
		if (editor) {
			updateDecorations(editor);
		}
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
}

/**
 * Determine the correct asset path based on the environment
 */
function getAssetPath(extensionPath: string): string {
	const srcAssetsPath = path.join(extensionPath, 'src', 'assets');
	const distAssetsPath = path.join(extensionPath, 'dist', 'assets');
	
	// Check if we're in development or production
	if (fs.existsSync(srcAssetsPath)) {
		return srcAssetsPath;
	} else {
		return distAssetsPath;
	}
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
}
