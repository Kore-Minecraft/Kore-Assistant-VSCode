// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs-extra';
import { koreElementManager, KoreElement } from './koreElements';
import { KoreTreeDataProvider } from './koreTreeView';

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

// Tree data provider
let treeDataProvider: KoreTreeDataProvider;

// View options
let groupByFile = false;
let sortByFile = true;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Create output channel
	outputChannel = vscode.window.createOutputChannel("Kore Assistant");
	outputChannel.appendLine("Kore Assistant is now active");

	// Set the initial context values for button visibility
	updateContextVariables();

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

	// Setup TreeView
	treeDataProvider = new KoreTreeDataProvider(groupByFile, sortByFile);
	const treeView = vscode.window.createTreeView('koreExplorer', {
		treeDataProvider: treeDataProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(treeView);

	// Register commands to toggle grouping mode
	const toggleGroupingCommand = vscode.commands.registerCommand('kore-assistant.toggleGrouping', () => {
		toggleGroupingMode();
	});

	const toggleGroupingByFileCommand = vscode.commands.registerCommand('kore-assistant.toggleGroupingByFile', () => {
		toggleGroupingMode();
	});

	// Function to toggle grouping mode
	function toggleGroupingMode() {
		groupByFile = !groupByFile;
		treeDataProvider.setGroupByFile(groupByFile);
		treeDataProvider.refresh();
		updateContextVariables();
	}

	// Register commands to toggle sorting mode
	const toggleSortingCommand = vscode.commands.registerCommand('kore-assistant.toggleSorting', () => {
		toggleSortingMode();
	});

	const toggleSortingByNameCommand = vscode.commands.registerCommand('kore-assistant.toggleSortingByName', () => {
		toggleSortingMode();
	});

	// Function to toggle sorting mode
	function toggleSortingMode() {
		sortByFile = !sortByFile;
		treeDataProvider.setSortByFile(sortByFile);
		treeDataProvider.refresh();
		updateContextVariables();
	}

	// Function to update context variables for the when clauses
	function updateContextVariables() {
		vscode.commands.executeCommand('setContext', 'groupByFile', groupByFile);
		vscode.commands.executeCommand('setContext', 'sortByFile', sortByFile);
	}

	// Register command to reveal element in editor
	const revealElementCommand = vscode.commands.registerCommand('kore-assistant.revealKoreElement', (element: KoreElement) => {
		// First, open the document if it's not already open
		vscode.workspace.openTextDocument(element.uri).then(doc => {
			vscode.window.showTextDocument(doc).then(editor => {
				// Get the position from the element's range
				const position = element.range.start;

				// Reveal the position in the editor
				editor.revealRange(
					element.range,
					vscode.TextEditorRevealType.InCenter
				);

				// Set cursor position
				editor.selection = new vscode.Selection(position, position);
			});
		});
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

	// Scan all Kotlin files in the workspace when the extension activates
	scanWorkspaceFiles();

	// Rescan when files are created or deleted
	vscode.workspace.onDidCreateFiles(event => {
		for (const uri of event.files) {
			if (uri.path.endsWith('.kt')) {
				vscode.workspace.openTextDocument(uri).then(doc => {
					processDocument(doc);
				});
			}
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidDeleteFiles(event => {
		// Just refresh tree view since files are gone
		treeDataProvider.refresh();
	}, null, context.subscriptions);

	// Initial update for current editor
	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}

	context.subscriptions.push(refreshCommand);
	context.subscriptions.push(testCommand);
	context.subscriptions.push(revealElementCommand);
	context.subscriptions.push(toggleGroupingCommand);
	context.subscriptions.push(toggleGroupingByFileCommand);
	context.subscriptions.push(toggleSortingCommand);
	context.subscriptions.push(toggleSortingByNameCommand);
}

async function scanWorkspaceFiles() {
	outputChannel.appendLine("Scanning workspace for Kotlin files...");

	// Find all Kotlin files
	const files = await vscode.workspace.findFiles('**/*.kt');
	outputChannel.appendLine(`Found ${files.length} Kotlin files`);

	// Process each file
	for (const uri of files) {
		try {
			const doc = await vscode.workspace.openTextDocument(uri);
			processDocument(doc);
		} catch (error) {
			outputChannel.appendLine(`Error processing file ${uri.fsPath}: ${error}`);
		}
	}
}

function processDocument(document: vscode.TextDocument) {
	if (document.languageId !== 'kotlin') {
		return;
	}

	const documentUri = document.uri;
	const text = document.getText();

	// Find datapack patterns
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
	}

	// Find function patterns
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
	}
}

function updateDecorations(editor: vscode.TextEditor) {
	if (!editor || editor.document.languageId !== 'kotlin') {
		return;
	}

	const document = editor.document;
	const documentUri = document.uri;

	// Get current elements for this document
	const elementsForDocument = koreElementManager.getElementsByUri(documentUri);

	// Remove elements for this document
	for (const element of elementsForDocument) {
		koreElementManager.removeElement(element);
	}

	// Process the document to find new elements
	processDocument(document);

	// Get updated decorations
	const updatedElements = koreElementManager.getElementsByUri(documentUri);

	const datapackRanges = updatedElements
		.filter(e => e.type === 'datapack')
		.map(e => ({
			range: e.range,
			hoverMessage: `Datapack: ${e.name}`
		}));

	const functionRanges = updatedElements
		.filter(e => e.type === 'function')
		.map(e => ({
			range: e.range,
			hoverMessage: `Function: ${e.name}`
		}));

	// Apply decorations
	editor.setDecorations(datapackDecoration, datapackRanges);
	editor.setDecorations(functionDecoration, functionRanges);

	// The tree view refresh happens automatically via the onDidChangeElements event
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
