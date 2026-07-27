// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { koreElementManager, KoreElement } from './koreElements';
import { KoreTreeDataProvider } from './koreTreeView';

// Kore DSL builders to detect in Kotlin files, and the element type they represent
const KORE_PATTERNS: { type: KoreElement['type']; regex: RegExp }[] = [
	{ type: 'datapack', regex: /dataPack\s*\(\s*["']([^"']+)["']\s*\)\s*\{/g },
	{ type: 'function', regex: /function\s*\(\s*["']([^"']+)["']\s*\)\s*\{/g },
];

// Delay before rescanning a document after an edit, to avoid a full rescan on every keystroke
const RESCAN_DEBOUNCE_MS = 300;

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
	treeDataProvider = new KoreTreeDataProvider(context.extensionUri, groupByFile, sortByFile);
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
	const revealElementCommand = vscode.commands.registerCommand('kore-assistant.revealKoreElement', async (element: KoreElement) => {
		const doc = await vscode.workspace.openTextDocument(element.uri);
		const editor = await vscode.window.showTextDocument(doc);

		editor.revealRange(element.range, vscode.TextEditorRevealType.InCenter);
		editor.selection = new vscode.Selection(element.range.start, element.range.start);
	});

	// Update decorations when opening, changing or saving documents
	vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) {
			updateDecorations(editor);
		}
	}, null, context.subscriptions);

	// Debounce rescans so a full-document regex scan doesn't run on every keystroke
	let rescanTimeout: ReturnType<typeof setTimeout> | undefined;
	vscode.workspace.onDidChangeTextDocument(event => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || event.document !== editor.document) {
			return;
		}

		clearTimeout(rescanTimeout);
		rescanTimeout = setTimeout(() => updateDecorations(editor), RESCAN_DEBOUNCE_MS);
	}, null, context.subscriptions);

	// Scan all Kotlin files in the workspace when the extension activates
	scanWorkspaceFiles();

	// Rescan when files are created or deleted
	vscode.workspace.onDidCreateFiles(event => {
		for (const uri of event.files) {
			if (uri.path.endsWith('.kt')) {
				vscode.workspace.openTextDocument(uri).then(doc => {
					koreElementManager.replaceElementsForUri(uri, parseKoreElements(doc));
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
			koreElementManager.replaceElementsForUri(uri, parseKoreElements(doc));
		} catch (error) {
			outputChannel.appendLine(`Error processing file ${uri.fsPath}: ${error}`);
		}
	}
}

// Scans a document's text for Kore DSL declarations, without touching the shared element store
function parseKoreElements(document: vscode.TextDocument): KoreElement[] {
	if (document.languageId !== 'kotlin') {
		return [];
	}

	const documentUri = document.uri;
	const text = document.getText();
	const elements: KoreElement[] = [];

	for (const { type, regex } of KORE_PATTERNS) {
		regex.lastIndex = 0; // Reset shared regex index before each scan
		let match;
		while ((match = regex.exec(text)) !== null) {
			const startPos = document.positionAt(match.index);
			const endPos = document.positionAt(match.index + match[0].length);

			elements.push({
				name: match[1],
				type,
				range: new vscode.Range(startPos, endPos),
				uri: documentUri
			});
		}
	}

	return elements;
}

function decorationOptionsFor(elements: KoreElement[], type: KoreElement['type'], label: string): vscode.DecorationOptions[] {
	return elements
		.filter(e => e.type === type)
		.map(e => ({ range: e.range, hoverMessage: `${label}: ${e.name}` }));
}

function updateDecorations(editor: vscode.TextEditor) {
	if (!editor || editor.document.languageId !== 'kotlin') {
		return;
	}

	const document = editor.document;
	const elements = parseKoreElements(document);
	koreElementManager.replaceElementsForUri(document.uri, elements);

	editor.setDecorations(datapackDecoration, decorationOptionsFor(elements, 'datapack', 'Datapack'));
	editor.setDecorations(functionDecoration, decorationOptionsFor(elements, 'function', 'Function'));

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
