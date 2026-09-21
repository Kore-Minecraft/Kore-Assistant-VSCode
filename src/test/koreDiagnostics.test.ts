import * as assert from 'assert';
import * as vscode from 'vscode';
import { CRAFTING_SHAPED_CODE, DUPLICATE_DECLARATION_CODE, KoreDiagnostics, UNRESOLVED_FUNCTION_CODE } from '../koreDiagnostics';
import { KoreElementManager, parseKoreFile } from '../koreElements';

const fileA = vscode.Uri.file('/ws/A.kt');
const fileB = vscode.Uri.file('/ws/B.kt');

suite('KoreDiagnostics', () => {
	let manager: KoreElementManager;
	let diagnostics: KoreDiagnostics;

	setup(() => {
		manager = new KoreElementManager();
		diagnostics = new KoreDiagnostics(manager);
	});

	teardown(() => {
		diagnostics.dispose();
	});

	function seed(...entries: [vscode.Uri, string][]): void {
		manager.replaceElementsForUris(entries.map(([uri, text]) => [uri, parseKoreFile(text, uri)]));
	}

	function diagnosticsOf(uri: vscode.Uri): vscode.Diagnostic[] {
		return diagnostics.compute().find(([u]) => u.toString() === uri.toString())?.[1] ?? [];
	}

	/** Opens `text` as an untitled Kotlin document (the code action provider needs a real document) and seeds it. */
	async function openAndSeed(text: string): Promise<vscode.TextDocument> {
		const document = await vscode.workspace.openTextDocument({ language: 'kotlin', content: text });
		manager.replaceElementsForUri(document.uri, parseKoreFile(text, document.uri));
		return document;
	}

	function actionsFor(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction[] {
		return diagnostics.provideCodeActions(document, diagnostic.range, { diagnostics: [diagnostic], only: undefined, triggerKind: vscode.CodeActionTriggerKind.Invoke });
	}

	/** Applies the action's edit to a copy of the document text. */
	function apply(document: vscode.TextDocument, action: vscode.CodeAction): string {
		const edits = action.edit!.get(document.uri).sort((a, b) => b.range.start.compareTo(a.range.start));
		let text = document.getText();
		for (const edit of edits) {
			text = text.slice(0, document.offsetAt(edit.range.start)) + edit.newText + text.slice(document.offsetAt(edit.range.end));
		}
		return text;
	}

	test('warns on both sides of a duplicate declaration, across files', () => {
		seed([fileA, 'dataPack("p") {\n\tfunction("a") { }\n}'], [fileB, 'fun DataPack.more() {\n\tfunction("a") { }\n}']);
		const [a] = diagnosticsOf(fileA);
		const [b] = diagnosticsOf(fileB);
		assert.strictEqual(a.code, DUPLICATE_DECLARATION_CODE);
		assert.strictEqual(a.severity, vscode.DiagnosticSeverity.Warning);
		assert.ok(a.message.startsWith("'p:a' is also declared at "), a.message);
		assert.deepStrictEqual(a.range, new vscode.Range(1, 10, 1, 13));
		assert.strictEqual(a.relatedInformation![0].location.uri.toString(), fileB.toString());
		assert.strictEqual(b.relatedInformation![0].location.uri.toString(), fileA.toString());
	});

	test('publishes craftingShaped problems with the weak-warning tag on unused keys', () => {
		seed([fileA, 'dataPack("p") {\n\trecipes {\n\t\tcraftingShaped("r") {\n\t\t\tpattern("AB")\n\t\t\tkey("A") { }\n\t\t\tkey("Z") { }\n\t\t}\n\t}\n}']);
		const found = diagnosticsOf(fileA);
		assert.deepStrictEqual(found.map(d => [d.code, d.message, d.severity, d.tags]), [
			[CRAFTING_SHAPED_CODE, "No key defined for 'B'", vscode.DiagnosticSeverity.Error, undefined],
			[CRAFTING_SHAPED_CODE, "Key 'Z' is not used in the pattern", vscode.DiagnosticSeverity.Hint, [vscode.DiagnosticTag.Unnecessary]],
		]);
		assert.deepStrictEqual(found[1].range, new vscode.Range(5, 7, 5, 10));
	});

	test('reports an unresolved function command and fixes it by renaming', async () => {
		const document = await openAndSeed('dataPack("p") {\n\tfunction("main") {\n\t\tfunction("helpre")\n\t}\n\tfunction("helper") { }\n}');
		const [diagnostic] = diagnosticsOf(document.uri);
		assert.strictEqual(diagnostic.code, UNRESOLVED_FUNCTION_CODE);
		assert.strictEqual(diagnostic.message, "Function 'p:helpre' is not declared in this project");
		assert.strictEqual(document.getText(diagnostic.range), '"helpre"');

		const actions = actionsFor(document, diagnostic);
		assert.deepStrictEqual(actions.map(a => a.title), ["Change to 'helper'", "Create function 'helpre'"]);
		assert.ok(apply(document, actions[0]).includes('function("helper")\n'));
		assert.ok(apply(document, actions[1]).includes('\t}\n\n\tfunction("helpre") {\n\t}\n\tfunction("helper") { }'), apply(document, actions[1]));
	});

	test('offers the other namespace, with the named form when the name was named', async () => {
		const document = await openAndSeed('dataPack("p") {\n\tfunction("main") {\n\t\tfunction(name = "util")\n\t}\n}\ndataPack("lib") {\n\tfunction("util") { }\n}');
		const [diagnostic] = diagnosticsOf(document.uri);
		const action = actionsFor(document, diagnostic).find(a => a.title === "Call 'lib:…' instead")!;
		assert.ok(apply(document, action).includes('function(namespace = "lib", name = "util")'));
	});

	test('offers only the swap when namespace and name are inverted, and the create fix splits the directory', async () => {
		const document = await openAndSeed('dataPack("p") {\n\tfunction("main") {\n\t\tfunction("tick", "p")\n\t\tfunction("dir/sub/leaf")\n\t}\n\tfunction("tick") { }\n}');
		const [swap, create] = diagnosticsOf(document.uri);
		const swapActions = actionsFor(document, swap);
		assert.deepStrictEqual(swapActions.map(a => a.title), ['Swap the namespace and name arguments']);
		assert.ok(apply(document, swapActions[0]).includes('function("p", "tick")'));

		const createAction = actionsFor(document, create).find(a => a.title === "Create function 'dir/sub/leaf'")!;
		assert.ok(apply(document, createAction).includes('\tfunction("leaf", directory = "dir/sub") {\n\t}'));
	});

	test('stays quiet when the target is dynamic, foreign, or declared as a tag', () => {
		seed([fileA, [
			'dataPack("p") {',
			'\tfunction("main") {',
			'\t\tfunction("gen_1")',
			'\t\tfunction("other", "x")',
			'\t\tfunction("all", true)',
			'\t\tfunction(NAME)',
			'\t}',
			'\tfunction("gen_$i") { }',
			'\tfunctionTag("all") { }',
			'}',
		].join('\n')]);
		assert.deepStrictEqual(diagnosticsOf(fileA), []);
	});

	test('resolves a constant name before checking it', () => {
		seed([fileA, 'const val HELPER = "helper"\ndataPack("p") {\n\tfunction("main") { function(HELPER) }\n\tfunction("helper") { }\n}'], [fileB, 'val MISSING = "nope"\ndataPack("q") {\n\tfunction("main") { function(MISSING) }\n}']);
		assert.deepStrictEqual(diagnosticsOf(fileA), []);
		assert.strictEqual(diagnosticsOf(fileB)[0]?.message, "Function 'q:nope' is not declared in this project");
	});

	test('publishes to the collection and clears files that no longer have problems', async () => {
		seed([fileA, 'dataPack("p") {\n\tfunction("a") { }\n\tfunction("a") { }\n}']);
		diagnostics.rebuild();
		assert.strictEqual(vscode.languages.getDiagnostics(fileA).length, 2);
		seed([fileA, 'dataPack("p") {\n\tfunction("a") { }\n}']);
		diagnostics.rebuild();
		assert.strictEqual(vscode.languages.getDiagnostics(fileA).length, 0);
	});
});
