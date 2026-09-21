import * as assert from 'assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { KoreAssistantApi } from '../extension';

// The extension runs from the dist bundle, with its own module instances: its element store is only reachable
// through the activate() exports, not by importing ../koreElements from the out/ build.
function extension(): vscode.Extension<KoreAssistantApi> {
	const found = vscode.extensions.getExtension<KoreAssistantApi>('Ayfri.kore-assistant');
	assert.ok(found, 'extension not found');
	return found;
}

async function activatedApi(): Promise<KoreAssistantApi> {
	return extension().activate();
}

function nextChange(api: KoreAssistantApi): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('no element change within 5s')), 5000);
		const sub = api.koreElementManager.onDidChangeElements(() => {
			clearTimeout(timer);
			sub.dispose();
			resolve();
		});
	});
}

suite('extension', () => {
	test('activates and registers every command contributed in package.json', async () => {
		await activatedApi();

		const contributed: { command: string }[] = extension().packageJSON.contributes.commands;
		const registered = new Set(await vscode.commands.getCommands(true));
		assert.ok(contributed.length > 0);
		for (const { command } of contributed) {
			assert.ok(registered.has(command), `${command} not registered`);
		}
	});

	test('copy commands take the value itself, as the hover copy links pass it', async () => {
		await activatedApi();
		await vscode.commands.executeCommand('kore-assistant.copyCommand', '/function p:main');
		assert.strictEqual(await vscode.env.clipboard.readText(), '/function p:main');
	});

	// No Kotlin extension is installed in the test host, so `openTextDocument({ language: 'kotlin' })` falls back
	// to plaintext: go through the file watchers with a real .kt file instead.
	test('indexes a created Kotlin file with line-accurate ranges and drops it on delete', async () => {
		const api = await activatedApi();
		const uri = vscode.Uri.file(path.join(os.tmpdir(), `kore-assistant-test-${Date.now()}.kt`));

		const create = new vscode.WorkspaceEdit();
		create.createFile(uri, { contents: Buffer.from('package x\n\ndataPack("pack") {\n\tfunction("main") { }\n}\n') });
		const created = nextChange(api);
		assert.ok(await vscode.workspace.applyEdit(create));
		await created;

		const elements = api.koreElementManager.getElementsForUri(uri);
		assert.deepStrictEqual(elements.map(e => e.name).sort(), ['main', 'pack']);

		const fn = elements.find(e => e.kindId === 'FUNCTION')!;
		assert.strictEqual(fn.range.start.line, 3);
		assert.strictEqual(fn.range.start.character, 1);
		assert.strictEqual(fn.range.end.character, 1 + 'function'.length);
		assert.strictEqual(fn.resolvedDataPackName, 'pack');
		assert.strictEqual(fn.outputPath, 'data/pack/function/main.mcfunction');

		const remove = new vscode.WorkspaceEdit();
		remove.deleteFile(uri);
		const removed = nextChange(api);
		assert.ok(await vscode.workspace.applyEdit(remove));
		await removed;

		assert.deepStrictEqual(api.koreElementManager.getElementsForUri(uri), []);
	});

	test('ignores documents that are not Kotlin', async () => {
		const { koreElementManager } = await activatedApi();
		const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'function("main") { }' });
		await vscode.window.showTextDocument(doc);

		assert.deepStrictEqual(koreElementManager.getElementsForUri(doc.uri), []);
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
});
