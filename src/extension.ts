import * as vscode from 'vscode';
import { displayNameFor, isFunctionKind, kindById } from './koreDeclarations';
import { koreElementManager, KoreElement, ResolvedKoreElement } from './koreElements';
import { parseKoreDeclarations } from './koreParser';
import { KoreTreeDataProvider, KoreTreeItem } from './koreTreeView';

// Delay before rescanning a document after an edit, to avoid a full rescan on every keystroke
const RESCAN_DEBOUNCE_MS = 300;

const KOTLIN_FILES_GLOB = '**/*.kt';
// Gradle/IDE output folders can hold generated Kotlin that would show up as duplicates in the tree.
const KOTLIN_FILES_EXCLUDE = '**/{build,.gradle,.idea,node_modules}/**';

// Decoration types for gutter icons: function-family kinds keep the function icon, DATA_PACK keeps the Kore
// logo mark, and every other (JSON-backed) kind gets a generic json icon.
let datapackDecoration: vscode.TextEditorDecorationType;
let functionDecoration: vscode.TextEditorDecorationType;
let jsonDecoration: vscode.TextEditorDecorationType;

let outputChannel: vscode.OutputChannel;
let treeDataProvider: KoreTreeDataProvider;

// View options
let groupByFile = false;
let sortByFile = true;

export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel("Kore Assistant");
	outputChannel.appendLine("Kore Assistant is now active");

	// Set the initial context values for button visibility
	updateContextVariables();

	// Gutter icons use the dark variants only, for better visibility in all themes
	const gutterDecoration = (icon: string) => vscode.window.createTextEditorDecorationType({
		gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'dist', 'assets', `${icon}-dark.svg`),
		gutterIconSize: '100%',
	});
	datapackDecoration = gutterDecoration('datapack');
	functionDecoration = gutterDecoration('function');
	jsonDecoration = gutterDecoration('json');

	treeDataProvider = new KoreTreeDataProvider(context.extensionUri, groupByFile, sortByFile);
	const treeView = vscode.window.createTreeView('koreExplorer', {
		treeDataProvider,
		showCollapseAll: true
	});

	function toggleGroupingMode() {
		groupByFile = !groupByFile;
		treeDataProvider.setGroupByFile(groupByFile);
		treeDataProvider.refresh();
		updateContextVariables();
	}

	function toggleSortingMode() {
		sortByFile = !sortByFile;
		treeDataProvider.setSortByFile(sortByFile);
		treeDataProvider.refresh();
		updateContextVariables();
	}

	// Context variables back the `when` clauses of the view/title toggle buttons
	function updateContextVariables() {
		vscode.commands.executeCommand('setContext', 'groupByFile', groupByFile);
		vscode.commands.executeCommand('setContext', 'sortByFile', sortByFile);
	}

	async function revealElement(element: KoreElement) {
		const doc = await vscode.workspace.openTextDocument(element.uri);
		const editor = await vscode.window.showTextDocument(doc);

		editor.revealRange(element.range, vscode.TextEditorRevealType.InCenter);
		editor.selection = new vscode.Selection(element.range.start, element.range.start);
	}

	// Right-click "Copy..." opens a QuickPick so each field's real value is visible (grayed, right-aligned)
	// before copying - a plain context-menu entry can't show that, its title is a static string from package.json.
	async function copyValue(item: KoreTreeItem) {
		const element = item.element;
		if (!element) {
			return;
		}

		const fields: vscode.QuickPickItem[] = [];
		if (element.kindId !== 'DATA_PACK') {
			fields.push({ label: 'Namespace', description: element.resolvedNamespace });
		}
		if (element.resourceLocation) {
			fields.push({ label: 'Resource Location', description: element.resourceLocation });
		}
		fields.push({ label: 'Output Path', description: element.outputPath });
		if (element.command) {
			fields.push({ label: 'Command', description: element.command });
		}

		const picked = await vscode.window.showQuickPick(fields, { placeHolder: 'Select a value to copy' });
		if (picked) {
			await vscode.env.clipboard.writeText(picked.description!);
		}
	}

	// Debounce rescans so a full-document scan doesn't run on every keystroke
	let rescanTimeout: ReturnType<typeof setTimeout> | undefined;

	context.subscriptions.push(
		treeView,
		datapackDecoration,
		functionDecoration,
		jsonDecoration,
		outputChannel,
		vscode.commands.registerCommand('kore-assistant.refreshGutterIcons', () => {
			if (vscode.window.activeTextEditor) {
				updateDecorations(vscode.window.activeTextEditor);
			}
		}),
		vscode.commands.registerCommand('kore-assistant.testExtension', () => {
			vscode.window.showInformationMessage('Kore Assistant test command executed successfully!');
		}),
		vscode.commands.registerCommand('kore-assistant.toggleGrouping', toggleGroupingMode),
		vscode.commands.registerCommand('kore-assistant.toggleGroupingByFile', toggleGroupingMode),
		vscode.commands.registerCommand('kore-assistant.toggleSorting', toggleSortingMode),
		vscode.commands.registerCommand('kore-assistant.toggleSortingByName', toggleSortingMode),
		vscode.commands.registerCommand('kore-assistant.revealKoreElement', revealElement),
		vscode.commands.registerCommand('kore-assistant.copyValue', copyValue),

		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				updateDecorations(editor);
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || event.document !== editor.document) {
				return;
			}

			clearTimeout(rescanTimeout);
			rescanTimeout = setTimeout(() => updateDecorations(editor), RESCAN_DEBOUNCE_MS);
		}),
		vscode.workspace.onDidCreateFiles(event => scanFiles(event.files.filter(isKotlinFile))),
		vscode.workspace.onDidDeleteFiles(event => koreElementManager.removeElementsForUris(event.files)),
		vscode.workspace.onDidRenameFiles(event => {
			koreElementManager.removeElementsForUris(event.files.map(f => f.oldUri));
			scanFiles(event.files.map(f => f.newUri).filter(isKotlinFile));
		}),
	);

	scanWorkspaceFiles();

	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}
}

function isKotlinFile(uri: vscode.Uri): boolean {
	return uri.path.endsWith('.kt');
}

async function scanWorkspaceFiles() {
	outputChannel.appendLine("Scanning workspace for Kotlin files...");
	const files = await vscode.workspace.findFiles(KOTLIN_FILES_GLOB, KOTLIN_FILES_EXCLUDE);
	outputChannel.appendLine(`Found ${files.length} Kotlin files`);
	await scanFiles(files);
}

// Reads the files straight from disk instead of opening a TextDocument per file (which loads a full editor
// model), in parallel, and commits the whole batch as one tree refresh.
async function scanFiles(uris: readonly vscode.Uri[]) {
	if (uris.length === 0) {
		return;
	}

	const decoder = new TextDecoder();
	const entries = await Promise.all(uris.map(async (uri): Promise<[vscode.Uri, KoreElement[]]> => {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			return [uri, parseKoreElements(decoder.decode(bytes), uri)];
		} catch (error) {
			outputChannel.appendLine(`Error processing file ${uri.fsPath}: ${error}`);
			return [uri, []];
		}
	}));

	koreElementManager.replaceElementsForUris(entries);
}

/** Offset -> Position without a TextDocument: binary search over the line start offsets of the text. */
function positionResolver(text: string): (offset: number) => vscode.Position {
	const lineStarts = [0];
	for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
		lineStarts.push(i + 1);
	}

	return offset => {
		let low = 0;
		let high = lineStarts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (lineStarts[mid] <= offset) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		return new vscode.Position(low, offset - lineStarts[low]);
	};
}

// Scans a file's text for Kore DSL declarations, without touching the shared element store
function parseKoreElements(text: string, uri: vscode.Uri): KoreElement[] {
	const positionAt = positionResolver(text);

	return parseKoreDeclarations(text).flatMap(decl => {
		const kind = kindById(decl.kindId);
		if (!kind) {
			return [];
		}

		return [{
			kindId: decl.kindId,
			name: decl.name,
			namespace: decl.namespace,
			dataPackName: decl.dataPackName,
			directory: decl.directory,
			isDynamic: decl.isDynamic,
			range: new vscode.Range(positionAt(decl.offset), positionAt(decl.offset + kind.builderName.length)),
			uri,
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

// Markdown (not a plain string) so paths render as code and the kind name is bold, matching the tree tooltip.
function hoverMessageFor(element: ResolvedKoreElement): vscode.MarkdownString {
	const kind = kindById(element.kindId)!;
	const title = kind.id === 'DATA_PACK' ? 'Datapack' : displayNameFor(kind);

	const md = new vscode.MarkdownString();
	md.appendMarkdown(`**${title}**: ${element.name}\n\n`);

	if (kind.id !== 'DATA_PACK') {
		md.appendMarkdown(`Namespace: \`${element.resolvedNamespace}\`  \nData Pack: ${element.resolvedDataPackName}\n\n`);
	}
	if (element.resourceLocation) {
		md.appendMarkdown(`Resource Location: \`${element.resourceLocation}\`\n\n`);
	}
	md.appendMarkdown(`Output Path: \`${element.outputPath}\``);
	if (element.command) {
		md.appendMarkdown(`\n\nCommand: \`${element.command}\``);
	}

	return md;
}

function updateDecorations(editor: vscode.TextEditor) {
	const document = editor.document;
	if (document.languageId !== 'kotlin') {
		return;
	}

	koreElementManager.replaceElementsForUri(document.uri, parseKoreElements(document.getText(), document.uri));

	const optionsByDecoration = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>([
		[datapackDecoration, []],
		[functionDecoration, []],
		[jsonDecoration, []],
	]);

	for (const element of koreElementManager.getElementsForUri(document.uri)) {
		const decorationType = decorationTypeFor(element);
		if (decorationType) {
			optionsByDecoration.get(decorationType)!.push({ range: element.range, hoverMessage: hoverMessageFor(element) });
		}
	}

	for (const [decorationType, options] of optionsByDecoration) {
		editor.setDecorations(decorationType, options);
	}

	// The tree view refresh happens automatically via the onDidChangeElements event
}

export function deactivate() {
	// Everything is disposed through context.subscriptions
}
