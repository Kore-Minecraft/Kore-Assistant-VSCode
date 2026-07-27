// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { isFunctionKind, kindById } from './koreDeclarations';
import { koreElementManager, KoreElement, ResolvedKoreElement } from './koreElements';
import { parseKoreDeclarations } from './koreParser';
import { KoreTreeDataProvider } from './koreTreeView';

// Delay before rescanning a document after an edit, to avoid a full rescan on every keystroke
const RESCAN_DEBOUNCE_MS = 300;

// Decoration types for gutter icons: function-family kinds keep the function icon, DATA_PACK keeps the
// datapack icon, and every other (JSON-backed) kind gets a generic json icon.
let datapackDecoration: vscode.TextEditorDecorationType;
let functionDecoration: vscode.TextEditorDecorationType;
let jsonDecoration: vscode.TextEditorDecorationType;

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
	const jsonIconUri = vscode.Uri.joinPath(context.extensionUri, 'dist', 'assets', 'json-dark.svg');

	// Create decorations
	datapackDecoration = vscode.window.createTextEditorDecorationType({
		gutterIconPath: datapackIconUri,
		gutterIconSize: '100%'
	});

	functionDecoration = vscode.window.createTextEditorDecorationType({
		gutterIconPath: functionIconUri,
		gutterIconSize: '100%'
	});

	jsonDecoration = vscode.window.createTextEditorDecorationType({
		gutterIconPath: jsonIconUri,
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

	// Register commands to copy the resource location / output path of a tree item to the clipboard
	const copyResourceLocationCommand = vscode.commands.registerCommand(
		'kore-assistant.copyResourceLocation',
		async (element: ResolvedKoreElement) => {
			if (element.resourceLocation) {
				await vscode.env.clipboard.writeText(element.resourceLocation);
			}
		}
	);

	const copyOutputPathCommand = vscode.commands.registerCommand(
		'kore-assistant.copyOutputPath',
		async (element: ResolvedKoreElement) => {
			await vscode.env.clipboard.writeText(element.outputPath);
		}
	);

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
	context.subscriptions.push(copyResourceLocationCommand);
	context.subscriptions.push(copyOutputPathCommand);
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

	return parseKoreDeclarations(text).flatMap(decl => {
		const kind = kindById(decl.kindId);
		if (!kind) {
			return [];
		}

		const startPos = document.positionAt(decl.offset);
		const endPos = document.positionAt(decl.offset + kind.builderName.length);

		return [{
			kindId: decl.kindId,
			name: decl.name,
			namespace: decl.namespace,
			dataPackName: decl.dataPackName,
			directory: decl.directory,
			isDynamic: decl.isDynamic,
			range: new vscode.Range(startPos, endPos),
			uri: documentUri,
		}];
	});
}

function decorationTypeFor(element: ResolvedKoreElement): vscode.TextEditorDecorationType | undefined {
	const kind = kindById(element.kindId);
	if (!kind) {
		return undefined;
	}

	if (kind.id === 'DATA_PACK') {
		return datapackDecoration;
	}

	return isFunctionKind(kind) ? functionDecoration : jsonDecoration;
}

function hoverMessageFor(element: ResolvedKoreElement): string {
	const kind = kindById(element.kindId)!;
	const lines = [`${kind.id === 'DATA_PACK' ? 'Datapack' : 'Resource'}: ${element.name}`];

	if (element.resourceLocation) {
		lines.push(`Resource Location: ${element.resourceLocation}`);
	}
	lines.push(`Output Path: ${element.outputPath}`);

	return lines.join('\n');
}

function updateDecorations(editor: vscode.TextEditor) {
	if (!editor || editor.document.languageId !== 'kotlin') {
		return;
	}

	const document = editor.document;
	const elements = parseKoreElements(document);
	koreElementManager.replaceElementsForUri(document.uri, elements);

	const resolved = koreElementManager.getElements().filter(e => e.uri.fsPath === document.uri.fsPath);

	const datapackOptions: vscode.DecorationOptions[] = [];
	const functionOptions: vscode.DecorationOptions[] = [];
	const jsonOptions: vscode.DecorationOptions[] = [];

	for (const element of resolved) {
		const decorationType = decorationTypeFor(element);
		const option: vscode.DecorationOptions = { range: element.range, hoverMessage: hoverMessageFor(element) };

		if (decorationType === datapackDecoration) {
			datapackOptions.push(option);
		} else if (decorationType === functionDecoration) {
			functionOptions.push(option);
		} else if (decorationType === jsonDecoration) {
			jsonOptions.push(option);
		}
	}

	editor.setDecorations(datapackDecoration, datapackOptions);
	editor.setDecorations(functionDecoration, functionOptions);
	editor.setDecorations(jsonDecoration, jsonOptions);

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
	if (jsonDecoration) {
		jsonDecoration.dispose();
	}

	if (outputChannel) {
		outputChannel.dispose();
	}
}
