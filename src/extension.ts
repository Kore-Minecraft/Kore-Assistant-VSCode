import * as vscode from 'vscode';
import { isFunctionKind, kindById } from './koreDeclarations';
import { KoreDiagnostics } from './koreDiagnostics';
import { koreElementManager, KoreElement, KoreFile, koreFileOf, parseKoreFile, RESCAN_DEBOUNCE_MS, ResolvedKoreElement } from './koreElements';
import { gutterHover, KoreExplorer } from './koreExplorer';
import { KoreProjectService } from './koreProject';
import { CopyableField, KoreTreeItem } from './koreTreeView';

const KOTLIN_FILES_GLOB = '**/*.kt';
/** Gradle/IDE output folders can hold generated Kotlin that would show up as duplicates in the tree. */
const KOTLIN_FILES_EXCLUDE = '**/{build,.gradle,.idea,node_modules}/**';
const EXCLUDED_FOLDER = /[\\/](build|\.gradle|\.idea|node_modules)[\\/]/;

const COPYABLE_FIELDS: CopyableField[] = ['name', 'namespace', 'resourceLocation', 'outputPath', 'command', 'filePath', 'declarationPath', 'resourceLocations', 'outputPaths'];

let datapackDecoration: vscode.TextEditorDecorationType;
let functionDecoration: vscode.TextEditorDecorationType;
let jsonDecoration: vscode.TextEditorDecorationType;
let outputChannel: vscode.OutputChannel;

/** What `vscode.extensions.getExtension(...).exports` hands out, so tests can read the bundled element store. */
export interface KoreAssistantApi {
	koreElementManager: typeof koreElementManager;
	koreProjects: KoreProjectService;
}

export function activate(context: vscode.ExtensionContext): KoreAssistantApi {
	outputChannel = vscode.window.createOutputChannel('Kore Assistant');

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

	// One `kore-assistant.copy<Field>` command per copyable field: a context-menu entry can only pass the tree item,
	// so the field has to be baked into the command id. package.json gates each entry on the item's contextValue.
	// The hover copy links pass the value itself, since a command link only carries JSON.
	const copyCommands = COPYABLE_FIELDS.map(field =>
		vscode.commands.registerCommand(`kore-assistant.copy${field[0].toUpperCase()}${field.slice(1)}`, async (arg: KoreTreeItem | string) => {
			const value = typeof arg === 'string' ? arg : arg.values[field];
			if (value) {
				await vscode.env.clipboard.writeText(value);
			}
		})
	);

	let rescanTimeout: ReturnType<typeof setTimeout> | undefined;
	// The `onDid*Files` events only cover user gestures; the watcher also sees a git checkout or a build regenerating sources.
	const watcher = vscode.workspace.createFileSystemWatcher(KOTLIN_FILES_GLOB);

	context.subscriptions.push(
		new KoreExplorer(context, scanWorkspaceFiles),
		koreProjects,
		watcher,
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
		vscode.workspace.onDidCreateFiles(event => scanFiles(event.files.filter(isIndexedKotlinFile))),
		vscode.workspace.onDidDeleteFiles(event => koreElementManager.removeElementsForUris(event.files)),
		vscode.workspace.onDidRenameFiles(event => {
			koreElementManager.removeElementsForUris(event.files.map(f => f.oldUri));
			scanFiles(event.files.map(f => f.newUri).filter(isIndexedKotlinFile));
		}),
		watcher.onDidCreate(uri => scanFiles([uri].filter(isIndexedKotlinFile))),
		watcher.onDidDelete(uri => koreElementManager.removeElementsForUris([uri])),
		// A dirty editor already feeds the store from its buffer; reading the disk copy would override it with stale text.
		watcher.onDidChange(uri => {
			const open = vscode.workspace.textDocuments.find(document => document.uri.fsPath === uri.fsPath);
			if (isIndexedKotlinFile(uri) && !open?.isDirty) {
				scanFiles([uri]);
			}
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

function isIndexedKotlinFile(uri: vscode.Uri): boolean {
	return uri.path.endsWith('.kt') && !EXCLUDED_FOLDER.test(uri.fsPath);
}

/** Datapack roots and file nodes have no click action (clicking toggles them), so the menu offers the jump instead. */
async function openDeclaration(item: KoreTreeItem) {
	if (item.element) {
		await revealElement(item.element);
	} else if (item.filePath) {
		await vscode.window.showTextDocument(vscode.Uri.file(item.filePath));
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

/** Also drops files the store still holds but the workspace no longer has, which a refresh after an external delete relies on. */
async function scanWorkspaceFiles() {
	const files = await vscode.workspace.findFiles(KOTLIN_FILES_GLOB, KOTLIN_FILES_EXCLUDE);
	outputChannel.appendLine(`Found ${files.length} Kotlin files`);
	const found = new Set(files.map(file => file.fsPath));
	const stale = [...koreElementManager.getFiles().keys()].filter(fsPath => !found.has(fsPath));
	if (stale.length > 0) {
		koreElementManager.removeElementsForUris(stale.map(fsPath => vscode.Uri.file(fsPath)));
	}
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
		optionsByDecoration.get(decorationTypeFor(element))!.push({ range: element.range, hoverMessage: gutterHover(element) });
	}

	for (const [decorationType, options] of optionsByDecoration) {
		editor.setDecorations(decorationType, options);
	}
}
