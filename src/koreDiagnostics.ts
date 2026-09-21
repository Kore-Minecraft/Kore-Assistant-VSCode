import * as vscode from 'vscode';
import { KoreElementManager, KoreElement, KoreFunctionCommand, RESCAN_DEBOUNCE_MS, ResolvedKoreElement, UNKNOWN_DATA_PACK } from './koreElements';
import {
	checkFunctionReference,
	duplicateDeclarationMessage,
	findDuplicateDeclarations,
	FunctionReference,
	FunctionReferenceProblem,
	isStatementStart,
} from './koreInspections';
import { declarationPathOf } from './textPositions';

const DIAGNOSTIC_SOURCE = 'Kore';
export const DUPLICATE_DECLARATION_CODE = 'duplicate-declaration';
export const UNRESOLVED_FUNCTION_CODE = 'unresolved-function';
export const CRAFTING_SHAPED_CODE = 'crafting-shaped';
const ENABLED_SETTING = 'diagnostics.enabled';

/** What a quick fix needs beyond the diagnostic itself, kept per file and matched back by range. */
interface FunctionFix {
	command: KoreFunctionCommand;
	enclosing: KoreElement;
	problem: FunctionReferenceProblem;
	range: vscode.Range;
}

/**
 * Publishes the duplicate-declaration, unresolved-function and `craftingShaped` checks as `kore` diagnostics, rebuilt
 * for the whole workspace after every element store change (a duplicate in file A appears when file B changes), and
 * serves their quick fixes as code actions.
 */
export class KoreDiagnostics implements vscode.CodeActionProvider, vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection('kore');
	private readonly disposables: vscode.Disposable[] = [];
	private fixesByUri = new Map<string, FunctionFix[]>();
	private published = new Set<string>();
	private rebuildTimeout: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly manager: KoreElementManager) {
		this.disposables.push(
			this.collection,
			vscode.languages.registerCodeActionsProvider({ language: 'kotlin' }, this, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
			manager.onDidChangeElements(() => this.scheduleRebuild()),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration(`kore-assistant.${ENABLED_SETTING}`)) {
					this.rebuild();
				}
			}),
		);
	}

	/** Every file's diagnostics, computed from the element store without publishing them. */
	compute(): [vscode.Uri, vscode.Diagnostic[]][] {
		const byUri = new Map<string, { diagnostics: vscode.Diagnostic[]; uri: vscode.Uri }>();
		const push = (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
			let entry = byUri.get(uri.toString());
			if (!entry) {
				entry = { diagnostics: [], uri };
				byUri.set(uri.toString(), entry);
			}
			entry.diagnostics.push(diagnostic);
		};
		this.fixesByUri = new Map();

		const elements = this.manager.getElements();
		for (const group of findDuplicateDeclarations(elements, UNKNOWN_DATA_PACK)) {
			for (const element of group) {
				const others = group.filter(other => other !== element);
				const diagnostic = new vscode.Diagnostic(element.nameArgRange, duplicateDeclarationMessage(element, others.map(declarationPathOf)), vscode.DiagnosticSeverity.Warning);
				diagnostic.source = DIAGNOSTIC_SOURCE;
				diagnostic.code = DUPLICATE_DECLARATION_CODE;
				diagnostic.relatedInformation = others.map(other => new vscode.DiagnosticRelatedInformation(new vscode.Location(other.uri, other.nameArgRange), 'Also declared here'));
				push(element.uri, diagnostic);
			}
		}

		for (const file of this.manager.getFiles().values()) {
			for (const problem of file.problems) {
				const diagnostic = new vscode.Diagnostic(problem.range, problem.message, problem.unused ? vscode.DiagnosticSeverity.Hint : vscode.DiagnosticSeverity.Error);
				diagnostic.source = DIAGNOSTIC_SOURCE;
				diagnostic.code = CRAFTING_SHAPED_CODE;
				if (problem.unused) {
					diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
				}
				push(file.declarations[0].uri, diagnostic);
			}

			for (const command of file.functionCommands) {
				const fix = this.checkCommand(command, elements);
				if (!fix) {
					continue;
				}
				const diagnostic = new vscode.Diagnostic(fix.range, fix.problem.message, vscode.DiagnosticSeverity.Error);
				diagnostic.source = DIAGNOSTIC_SOURCE;
				diagnostic.code = UNRESOLVED_FUNCTION_CODE;
				push(command.uri, diagnostic);
				let fixes = this.fixesByUri.get(command.uri.toString());
				if (!fixes) {
					fixes = [];
					this.fixesByUri.set(command.uri.toString(), fixes);
				}
				fixes.push(fix);
			}
		}

		return [...byUri.values()].map(({ uri, diagnostics }) => [uri, diagnostics]);
	}

	dispose(): void {
		clearTimeout(this.rebuildTimeout);
		vscode.Disposable.from(...this.disposables).dispose();
	}

	provideCodeActions(document: vscode.TextDocument, _range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext): vscode.CodeAction[] {
		const fixes = this.fixesByUri.get(document.uri.toString());
		if (!fixes) {
			return [];
		}
		return context.diagnostics
			.filter(diagnostic => diagnostic.code === UNRESOLVED_FUNCTION_CODE)
			.flatMap(diagnostic => {
				const fix = fixes.find(candidate => candidate.range.isEqual(diagnostic.range));
				return fix ? this.actionsFor(document, fix, diagnostic) : [];
			});
	}

	/** Publishes [compute], clearing the files that had diagnostics last time and have none now. */
	rebuild(): void {
		clearTimeout(this.rebuildTimeout);
		const enabled = vscode.workspace.getConfiguration('kore-assistant').get<boolean>(ENABLED_SETTING, true);
		const entries = enabled ? this.compute() : [];
		const stale = [...this.published].filter(key => !entries.some(([uri]) => uri.toString() === key)).map(key => [vscode.Uri.parse(key), []] as [vscode.Uri, vscode.Diagnostic[]]);
		this.collection.set([...entries, ...stale]);
		this.published = new Set(entries.map(([uri]) => uri.toString()));
	}

	private actionsFor(document: vscode.TextDocument, { command, enclosing, problem }: FunctionFix, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		const action = (title: string, edits: [vscode.Range | vscode.Position, string][]) => {
			const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
			codeAction.diagnostics = [diagnostic];
			codeAction.edit = new vscode.WorkspaceEdit();
			for (const [target, text] of edits) {
				if (target instanceof vscode.Position) {
					codeAction.edit.insert(document.uri, target, text);
				} else {
					codeAction.edit.replace(document.uri, target, text);
				}
			}
			actions.push(codeAction);
		};

		for (const name of problem.rename) {
			action(`Change to '${name}'`, [[command.nameArgRange, `"${name}"`]]);
		}
		// The name-only overload always targets the datapack's namespace: switch to `function(namespace, name)`.
		const nameIsNamed = /\bname\s*=\s*$/.test(document.getText(new vscode.Range(command.argsRange.start, command.nameArgRange.start)));
		for (const namespace of problem.addNamespace) {
			const namespaceArg = nameIsNamed ? `namespace = "${namespace}"` : `"${namespace}"`;
			action(`Call '${namespace}:…' instead`, [[command.argsRange, `${namespaceArg}, ${document.getText(command.argsRange)}`]]);
		}
		if (problem.swap && command.namespaceArgRange) {
			action('Swap the namespace and name arguments', [
				[command.namespaceArgRange, document.getText(command.nameArgRange)],
				[command.nameArgRange, document.getText(command.namespaceArgRange)],
			]);
		}
		if (problem.create && enclosing.bodyRange && isStatementStart(document.getText(), document.offsetAt(enclosing.range.start))) {
			const name = command.name;
			const slash = name.lastIndexOf('/');
			const args = slash === -1 ? `"${name}"` : `"${name.slice(slash + 1)}", directory = "${name.slice(0, slash)}"`;
			const indent = document.lineAt(enclosing.range.start.line).text.match(/^\s*/)![0];
			action(`Create function '${name}'`, [[enclosing.bodyRange.end.translate(0, 1), `\n\n${indent}function(${args}) {\n${indent}}`]]);
		}
		return actions;
	}

	/** Resolves the call's strings and namespace, `undefined` when the target exists or nothing can be said. */
	private checkCommand(command: KoreFunctionCommand, elements: ResolvedKoreElement[]): FunctionFix | undefined {
		const resolve = (field: 'name' | 'namespace'): string | undefined => {
			const raw = command[field];
			return raw !== undefined && command.dynamicFields.includes(field) ? this.manager.resolveText(command.uri, raw, command.offset) : raw;
		};
		const name = resolve('name');
		if (name === undefined) {
			return undefined;
		}
		const enclosing = this.manager.getElementsForUri(command.uri).find(element => element.offset === command.enclosingDeclarationOffset);
		if (!enclosing) {
			return undefined;
		}
		const namespace = command.namespaceFirst || command.namespace !== undefined ? resolve('namespace') : enclosing.resolvedDataPackName;
		if (namespace === undefined || namespace === UNKNOWN_DATA_PACK) {
			return undefined;
		}

		const reference: FunctionReference = { group: command.group, name, namespace, namespaceFirst: command.namespaceFirst };
		const problem = checkFunctionReference(reference, elements);
		return problem && { command, enclosing, problem, range: command.nameArgRange };
	}

	private scheduleRebuild(): void {
		clearTimeout(this.rebuildTimeout);
		this.rebuildTimeout = setTimeout(() => this.rebuild(), RESCAN_DEBOUNCE_MS);
	}
}
