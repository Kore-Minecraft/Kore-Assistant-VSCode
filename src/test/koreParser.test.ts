import * as assert from 'assert';
import { parseKoreDeclarations } from '../koreParser';

suite('koreParser', () => {
	test('parses a plain dataPack + function pair', () => {
		const decls = parseKoreDeclarations(`
			dataPack("test") {
				function("main") {
					say("hello")
				}
			}
		`);

		assert.strictEqual(decls.length, 2);

		const dataPack = decls.find(d => d.kindId === 'DATA_PACK')!;
		assert.strictEqual(dataPack.name, 'test');
		assert.strictEqual(dataPack.dataPackName, 'test');
		assert.strictEqual(dataPack.isDynamic, false);

		const fn = decls.find(d => d.kindId === 'FUNCTION')!;
		assert.strictEqual(fn.name, 'main');
		assert.strictEqual(fn.dataPackName, 'test');
		assert.strictEqual(fn.namespace, undefined);
		assert.strictEqual(fn.isDynamic, false);
	});

	test('reads namespace from a positional function argument', () => {
		const decls = parseKoreDeclarations(`
			dataPack("test") {
				function("main", "custom_ns") { }
			}
		`);

		const fn = decls.find(d => d.kindId === 'FUNCTION')!;
		assert.strictEqual(fn.namespace, 'custom_ns');
	});

	test('reads namespace from a directory-family named argument', () => {
		const decls = parseKoreDeclarations(`
			function(name = "main", directory = "sub") { }
		`);

		const fn = decls.find(d => d.kindId === 'FUNCTION')!;
		assert.strictEqual(fn.name, 'main');
		assert.strictEqual(fn.directory, 'sub');
	});

	test('reads namespace from a `namespace = "..."` statement in the block', () => {
		const decls = parseKoreDeclarations(`
			advancement("root") {
				namespace = "story"
				parent = null
			}
		`);

		const decl = decls[0];
		assert.strictEqual(decl.kindId, 'ADVANCEMENT');
		assert.strictEqual(decl.namespace, 'story');
	});

	test('ignores a nested namespace assignment (not at the block top level)', () => {
		const decls = parseKoreDeclarations(`
			advancement("root") {
				criteria {
					namespace = "nested"
				}
			}
		`);

		assert.strictEqual(decls[0].namespace, undefined);
	});

	test('finds the enclosing dataPack even with unrelated calls in between', () => {
		const decls = parseKoreDeclarations(`
			dataPack("mypack") {
				group("a") {
					lootTable("chest") { }
				}
			}
		`);

		const decl = decls.find(d => d.kindId === 'LOOT_TABLE')!;
		assert.strictEqual(decl.dataPackName, 'mypack');
	});

	test('finds declarations nested inside another call\'s argument list', () => {
		const decls = parseKoreDeclarations(`
			dataPack("mypack") {
				withAll(function("a") { }, function("b") { })
			}
		`);

		const names = decls.filter(d => d.kindId === 'FUNCTION').map(d => d.name).sort();
		assert.deepStrictEqual(names, ['a', 'b']);
	});

	test('marks a dynamic name as a placeholder snippet', () => {
		const decls = parseKoreDeclarations(`
			dataPack("mypack") {
				function(generatedName()) { }
			}
		`);

		const fn = decls.find(d => d.kindId === 'FUNCTION')!;
		assert.strictEqual(fn.isDynamic, true);
		assert.strictEqual(fn.name, 'generatedName()');
	});

	test('marks string-template interpolation as dynamic but keeps the source spelling', () => {
		const decls = parseKoreDeclarations(`
			dataPack("mypack") {
				function("leaf_$leafId") { }
			}
		`);

		const fn = decls.find(d => d.kindId === 'FUNCTION')!;
		assert.strictEqual(fn.isDynamic, true);
		assert.strictEqual(fn.name, 'leaf_$leafId');
	});

	test('does not confuse braces inside string literals with block boundaries', () => {
		const decls = parseKoreDeclarations(`
			dataPack("mypack") {
				function("main") {
					val weird = "{ not a real block }"
				}
			}
		`);

		assert.strictEqual(decls.length, 2);
	});

	test('does not confuse braces inside comments with block boundaries', () => {
		const decls = parseKoreDeclarations(`
			dataPack("mypack") {
				// this { comment has a brace
				function("main") {
					/* another { one */
				}
			}
		`);

		assert.strictEqual(decls.length, 2);
	});

	test('ignores calls that are not known Kore builders', () => {
		const decls = parseKoreDeclarations(`
			if (condition) {
				doSomething("x")
			}
		`);

		assert.strictEqual(decls.length, 0);
	});

	test('returns nothing for empty or non-Kore source', () => {
		assert.deepStrictEqual(parseKoreDeclarations(''), []);
		assert.deepStrictEqual(parseKoreDeclarations('class Foo { fun bar() = 1 }'), []);
	});
});
