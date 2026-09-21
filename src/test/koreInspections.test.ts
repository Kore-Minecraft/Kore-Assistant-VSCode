import * as assert from 'assert';
import {
	checkFunctionReference,
	editDistance,
	findDuplicateDeclarations,
	FunctionReference,
	InspectableElement,
	isStatementStart,
	scanCraftingShapedBody,
} from '../koreInspections';

const UNKNOWN = '<unknown datapack>';

function target(kindId: string, namespace: string, path: string, extra: Partial<InspectableElement> = {}): InspectableElement {
	const tag = kindId === 'FUNCTION_TAG';
	return {
		isDynamic: false,
		kindId,
		outputPath: `data/${namespace}/${tag ? 'tags/function' : 'function'}/${path}.${tag ? 'json' : 'mcfunction'}`,
		resolvedDataPackName: namespace,
		resolvedNamespace: namespace,
		resourceLocation: `${tag ? '#' : ''}${namespace}:${path}`,
		...extra,
	};
}

function reference(name: string, extra: Partial<FunctionReference> = {}): FunctionReference {
	return { group: false, name, namespace: 'pack', namespaceFirst: false, ...extra };
}

suite('scanCraftingShapedBody', () => {
	/** Scans a body and returns `[message, highlighted source]` pairs, in report order. */
	function scan(body: string, offset = 10): [string, string][] {
		return scanCraftingShapedBody(body, offset).map(p => [p.message, body.slice(p.range.start - offset, p.range.end - offset)]);
	}

	test('accepts a valid recipe', () => {
		assert.deepStrictEqual(scan(`
			pattern("AAA", "B B", " C ")
			key("A") { item(Items.STONE) }
			key("B") { item(Items.STICK) }
			keys { "C" to Items.DIRT }
		`), []);
	});

	test('reports grid problems on the offending row', () => {
		assert.deepStrictEqual(scan(`
			pattern("AAAA", "", "AA", "A")
			patternLine("AAA")
			key("A") { }
		`), [
			['A pattern row has at most 3 characters', '"AAAA"'],
			['A pattern row cannot be empty', '""'],
			['Every row must be as wide as the first one (4)', '"AA"'],
			['A shaped recipe has at most 3 rows', '"A"'],
			['A shaped recipe has at most 3 rows', '"AAA"'],
		]);
	});

	test('reports rows narrower than the first one', () => {
		assert.deepStrictEqual(scan('pattern("AA", "A")\nkey("A") { }'), [['Every row must be as wide as the first one (2)', '"A"']]);
	});

	test('reports missing, malformed and unused keys', () => {
		const problems = scanCraftingShapedBody('pattern("AB")\nkey("A") { }\nkey("CD") { }\nkeys {\n\t" " to Items.AIR\n\t"E" to Items.DIRT\n}', 0);
		assert.deepStrictEqual(problems.map(p => [p.message, p.unused ?? false]), [
			['No key defined for \'B\'', false],
			['A key is a single character', false],
			['A space is an empty slot and cannot be a key', false],
			['Key \'E\' is not used in the pattern', true],
		]);
		assert.strictEqual(problems[3].range.start, 'pattern("AB")\nkey("A") { }\nkey("CD") { }\nkeys {\n\t" " to Items.AIR\n\t'.length);
	});

	test('a dynamic row or key disables the key checks but not the grid checks', () => {
		assert.deepStrictEqual(scan('pattern(ROW, "AAAA")\nkey("Z") { }'), [['A pattern row has at most 3 characters', '"AAAA"']]);
		assert.deepStrictEqual(scan('pattern("AB")\nkey(KEY) { }'), []);
	});

	test('ignores nested statements and unrelated calls', () => {
		assert.deepStrictEqual(scan('pattern("A")\nkey("A") { pattern("ZZZZ") }\nresult(Items.STONE)'), []);
	});
});

suite('findDuplicateDeclarations', () => {
	test('groups static elements sharing a datapack and an output path', () => {
		const a = target('FUNCTION', 'pack', 'a');
		const b = target('FUNCTION', 'pack', 'a');
		const other = target('FUNCTION', 'other', 'a');
		const dynamic = target('FUNCTION', 'pack', 'a', { isDynamic: true });
		const unknown = target('FUNCTION', 'pack', 'a', { resolvedDataPackName: UNKNOWN });
		assert.deepStrictEqual(findDuplicateDeclarations([a, b, other, dynamic, unknown], UNKNOWN), [[a, b]]);
	});
});

suite('checkFunctionReference', () => {
	const elements = [
		target('DATA_PACK', 'pack', 'pack', { outputPath: 'pack/pack.mcmeta', resourceLocation: undefined }),
		target('FUNCTION', 'pack', 'main'),
		target('FUNCTION', 'pack', 'helpers/setup'),
		target('FUNCTION', 'lib', 'util'),
		target('FUNCTION_TAG', 'pack', 'tick'),
		target('FUNCTION', 'minecraft', 'tick'),
	];

	test('accepts declared functions and tags', () => {
		assert.strictEqual(checkFunctionReference(reference('main'), elements), undefined);
		assert.strictEqual(checkFunctionReference(reference('helpers/setup'), elements), undefined);
		assert.strictEqual(checkFunctionReference(reference('tick', { group: true }), elements), undefined);
		assert.strictEqual(checkFunctionReference(reference('util', { namespace: 'lib', namespaceFirst: true }), elements), undefined);
	});

	test('suggests close names, other namespaces and creation', () => {
		const problem = checkFunctionReference(reference('mian'), elements)!;
		assert.strictEqual(problem.message, "Function 'pack:mian' is not declared in this project");
		assert.deepStrictEqual(problem.rename, ['main']);
		assert.strictEqual(problem.create, true);
		assert.strictEqual(problem.swap, false);

		assert.deepStrictEqual(checkFunctionReference(reference('util'), elements)!.addNamespace, ['lib']);
		assert.deepStrictEqual(checkFunctionReference(reference('util', { namespace: 'pack', namespaceFirst: true }), elements)!.addNamespace, []);
		assert.strictEqual(checkFunctionReference(reference('tick', { group: true, name: 'tikc' }), elements)!.create, false);
	});

	test('offers only the swap when the namespace and name are inverted', () => {
		const problem = checkFunctionReference(reference('minecraft', { namespace: 'tick', namespaceFirst: true }), elements)!;
		assert.strictEqual(problem.swap, true);
		assert.deepStrictEqual(problem.rename, []);
		assert.strictEqual(problem.create, false);
	});

	test('stays quiet for foreign namespaces and namespaces holding dynamic functions', () => {
		assert.strictEqual(checkFunctionReference(reference('x', { namespace: 'vanilla_tweaks', namespaceFirst: true }), elements), undefined);
		const withDynamic = [...elements, target('FUNCTION', 'pack', 'gen_$i', { isDynamic: true })];
		assert.strictEqual(checkFunctionReference(reference('missing'), withDynamic), undefined);
	});
});

suite('editDistance', () => {
	test('counts insertions, deletions and substitutions', () => {
		assert.strictEqual(editDistance('', 'abc'), 3);
		assert.strictEqual(editDistance('kitten', 'sitting'), 3);
		assert.strictEqual(editDistance('main', 'mian'), 2);
		assert.strictEqual(editDistance('same', 'same'), 0);
	});
});

suite('isStatementStart', () => {
	test('tells statements from arguments and initializers', () => {
		const text = 'dataPack("p") {\n\tfunction("a") {\n\t}\n\tfunction("b") { }\n\tval x = function("c") { }\n\tuse(function("d") { })\n}\n';
		assert.strictEqual(isStatementStart(text, text.indexOf('function("a")')), true);
		assert.strictEqual(isStatementStart(text, text.indexOf('function("b")')), true);
		assert.strictEqual(isStatementStart(text, text.indexOf('function("c")')), false);
		assert.strictEqual(isStatementStart(text, text.indexOf('function("d")')), false);
		assert.strictEqual(isStatementStart('function("e") { }', 0), true);
	});
});
