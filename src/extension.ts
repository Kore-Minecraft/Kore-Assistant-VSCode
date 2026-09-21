import * as vscode from 'vscode';
import { isFunctionKind, kindById } from './koreDeclarations';
import { KoreDiagnostics } from './koreDiagnostics';
import { koreElementManager, KoreElement, KoreFile, koreFileOf, parseKoreFile, RESCAN_DEBOUNCE_MS, ResolvedKoreElement } from './koreElements';
import { KoreProjectService } from './koreProject';
import { CopyableField, elementTooltip, KoreTreeDataProvider, KoreTreeItem } from './koreTreeView';

const KOTLIN_FILES_GLOB = '**/*.kt';
/** Gradle/IDE output folders can hold generated Kotlin that would show up as duplicates in the tree. */
const KOTLIN_FILES_EXCLUDE = '**/{build,.gradle,.idea,node_modules}/**';

const COPYABLE_FIELDS: CopyableField[] = ['name', 'namespace', 'resourceLocation', 'outputPath', 'command', 'filePath', 'declarationPath'];

let datapackDecoration: vscode.TextEditorDecorationType;
let functionDecoration: vscode.TextEditorDecorationType;
let jsonDecoration: vscode.TextEditorDecorationType;
let outputChannel: vscode.OutputChannel;
let treeDataProvider: KoreTreeDataProvider;

let groupByFile = false;
let sortByFile = true;

/** What `vscode.extensions.getExtension(...).exports` hands out, so tests can read the bundled element store. */
export interface KoreAssistantApi {
	koreElementManager: typeof koreElementManager;
	koreProjects: KoreProjectService;
}

export function activate(context: vscode.ExtensionContext): KoreAssistantApi {
	outputChannel = vscode.window.createOutputChannel('Kore Assistant');
	updateContextVariables();

	const koreProjects = new KoreProjectService();
	koreProjects.onDidChange(() => {
		for (const project of koreProjects.getProjects().values()) {
			outputChannel.appendLine(`Kore project: ${project.dir} (version ${project.version ?? 'unknown'}${project.fromSources ? ', from sources' : ''}${project.hasGradlePlugin ? ', Gradle plugin' : ''})`);
		}
	});
	koreProjects.refresh();

	// Gutter icons use the dark variants only, for better visibility in all themes.
	const gutterDecoration = (icon: string) => vscode.window.createTextEditorDecorationType({
		gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'dist', 'assets', `${icon}-dark.svg`),
		gutterIconSize: '100%',
	});
	datapackDecoration = gutterDecoration('datapack');
	functionDecoration = gutterDecoration('function');
	jsonDecoration = gutterDecoration('json');

	treeDataProvider = new KoreTreeDataProvider(context.extensionUri, groupByFile, sortByFile);
	const treeView = vscode.window.createTreeView('koreExplorer', { treeDataProvider, showCollapseAll: true });

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

	/** Context variables back the `when` clauses of the view/title toggle buttons. */
	function updateContextVariables() {
		vscode.commands.executeCommand('setContext', 'groupByFile', groupByFile);
		vscode.commands.executeCommand('setContext', 'sortByFile', sortByFile);
	}

	// One `kore-assistant.copy<Field>` command per copyable field: a context-menu entry can only pass the tree item,
	// so the field has to be baked into the command id. package.json gates each entry on the item's contextValue.
	const copyCommands = COPYABLE_FIELDS.map(field =>
		vscode.commands.registerCommand(`kore-assistant.copy${field[0].toUpperCase()}${field.slice(1)}`, async (item: KoreTreeItem) => {
			const value = item.values[field];
			if (value) {
				await vscode.env.clipboard.writeText(value);
			}
		})
	);

	let rescanTimeout: ReturnType<typeof setTimeout> | undefined;

	context.subscriptions.push(
		treeView,
		koreProjects,
		new KoreDiagnostics(koreElementManager),
		datapackDecoration,
		functionDecoration,
		jsonDecoration,
		outputChannel,
		vscode.commands.registerCommand('kore-assistant.refreshGutterIcons', () => {
			if (vscode.window.activeTextEditor) {
				updateDecorations(vscode.window.activeTextEditor);
			}
		}),
		vscode.commands.registerCommand('kore-assistant.toggleGrouping', toggleGroupingMode),
		vscode.commands.registerCommand('kore-assistant.toggleGroupingByFile', toggleGroupingMode),
		vscode.commands.registerCommand('kore-assistant.toggleSorting', toggleSortingMode),
		vscode.commands.registerCommand('kore-assistant.toggleSortingByName', toggleSortingMode),
		vscode.commands.registerCommand('kore-assistant.revealKoreElement', revealElement),
		vscode.commands.registerCommand('kore-assistant.openDeclaration', openDeclaration),
		...copyCommands,

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

	return { koreElementManager, koreProjects };
}

function decorationTypeFor(element: ResolvedKoreElement): vscode.TextEditorDecorationType {
	if (element.kindId === 'DATA_PACK') {
		return datapackDecoration;
	}
	return isFunctionKind(kindById(element.kindId)!) ? functionDecoration : jsonDecoration;
}

function isKotlinFile(uri: vscode.Uri): boolean {
	return uri.path.endsWith('.kt');
}

/** Datapack roots and file nodes have no click action (clicking toggles them), so the menu offers the jump instead. */
async function openDeclaration(item: KoreTreeItem) {
	if (item.element) {
		await revealElement(item.element);
	} else if (item.fileData) {
		await vscode.window.showTextDocument(vscode.Uri.file(item.fileData.filePath));
	}
}

async function revealElement(element: KoreElement) {
	const doc = await vscode.workspace.openTextDocument(element.uri);
	const editor = await vscode.window.showTextDocument(doc);
	editor.revealRange(element.range, vscode.TextEditorRevealType.InCenter);
	editor.selection = new vscode.Selection(element.range.start, element.range.start);
}

/**
 * Reads the files straight from disk instead of opening a TextDocument per file (which loads a full editor model),
 * in parallel, and commits the whole batch as one tree refresh.
 */
async function scanFiles(uris: readonly vscode.Uri[]) {
	if (uris.length === 0) {
		return;
	}

	const decoder = new TextDecoder();
	const entries = await Promise.all(uris.map(async (uri): Promise<[vscode.Uri, KoreFile]> => {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			return [uri, parseKoreFile(decoder.decode(bytes), uri)];
		} catch (error) {
			outputChannel.appendLine(`Error processing file ${uri.fsPath}: ${error}`);
			return [uri, koreFileOf([])];
		}
	}));

	koreElementManager.replaceElementsForUris(entries);
}

async function scanWorkspaceFiles() {
	const files = await vscode.workspace.findFiles(KOTLIN_FILES_GLOB, KOTLIN_FILES_EXCLUDE);
	outputChannel.appendLine(`Found ${files.length} Kotlin files`);
	await scanFiles(files);
}

function updateDecorations(editor: vscode.TextEditor) {
	const document = editor.document;
	if (document.languageId !== 'kotlin') {
		return;
	}

	koreElementManager.replaceElementsForUri(document.uri, parseKoreFile(document.getText(), document.uri));

	const optionsByDecoration = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>([
		[datapackDecoration, []],
		[functionDecoration, []],
		[jsonDecoration, []],
	]);

	for (const element of koreElementManager.getElementsForUri(document.uri)) {
		optionsByDecoration.get(decorationTypeFor(element))!.push({ range: element.range, hoverMessage: elementTooltip(element) });
	}

	for (const [decorationType, options] of optionsByDecoration) {
		editor.setDecorations(decorationType, options);
	}
}
