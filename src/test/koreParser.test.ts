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

	test('reports the offset of the builder identifier', () => {
		const source = 'val x = 1\ndataPack("p") {\n\tfunction("f") { }\n}';
		const decls = parseKoreDeclarations(source);

		const dataPack = decls.find(d => d.kindId === 'DATA_PACK')!;
		const fn = decls.find(d => d.kindId === 'FUNCTION')!;
		assert.strictEqual(source.slice(dataPack.offset, dataPack.offset + 'dataPack'.length), 'dataPack');
		assert.strictEqual(source.slice(fn.offset, fn.offset + 'function'.length), 'function');
	});

	test('emits declarations in closing order (inner before outer) and does not dedupe same names', () => {
		const decls = parseKoreDeclarations(`
			dataPack("p") {
				function("a") { }
				function("a") { }
			}
		`);

		assert.deepStrictEqual(decls.map(d => d.kindId), ['FUNCTION', 'FUNCTION', 'DATA_PACK']);
	});

	test('recognizes every function-family builder, with positional namespace and directory', () => {
		for (const builder of ['function', 'generatedFunction', 'load', 'tick']) {
			const decls = parseKoreDeclarations(`${builder}("n", "ns", "dir") { }`);
			assert.strictEqual(decls.length, 1, builder);
			assert.strictEqual(decls[0].namespace, 'ns', builder);
			assert.strictEqual(decls[0].directory, 'dir', builder);
			assert.strictEqual(decls[0].isDynamic, false, builder);
		}
	});

	test('only the function family reads positional namespace/directory', () => {
		const decls = parseKoreDeclarations(`advancement("root", "ns", "dir") { }`);
		assert.strictEqual(decls[0].namespace, undefined);
		assert.strictEqual(decls[0].directory, undefined);
	});

	test('a named `namespace =` argument beats a positional one', () => {
		const decls = parseKoreDeclarations(`function("n", "positional", namespace = "named") { }`);
		assert.strictEqual(decls[0].namespace, 'named');
	});

	test('a named namespace argument beats a namespace assignment in the body', () => {
		const decls = parseKoreDeclarations(`
			advancement("root", namespace = "arg") {
				namespace = "body"
			}
		`);
		assert.strictEqual(decls[0].namespace, 'arg');
	});

	test('the last top-level namespace assignment wins', () => {
		const decls = parseKoreDeclarations(`
			advancement("root") {
				namespace = "first"
				parent = null; namespace = "second"
			}
		`);
		assert.strictEqual(decls[0].namespace, 'second');
	});

	test('does not treat `namespace == x` or a `namespace` inside a string as an assignment', () => {
		const decls = parseKoreDeclarations(`
			advancement("root") {
				val ok = namespace == "x"
				title = "namespace = \\"fake\\""
			}
		`);
		assert.strictEqual(decls[0].namespace, undefined);
	});

	test('reads the name from `name =` and `fileName =` named arguments', () => {
		assert.strictEqual(parseKoreDeclarations(`lootTable(name = "a") { }`)[0].name, 'a');
		assert.strictEqual(parseKoreDeclarations(`lootTable(fileName = "b") { }`)[0].name, 'b');
		assert.strictEqual(parseKoreDeclarations(`lootTable(name = "a", fileName = "b") { }`)[0].name, 'a');
	});

	test('skips a builder call with no name argument', () => {
		assert.deepStrictEqual(parseKoreDeclarations(`function() { }`), []);
		assert.deepStrictEqual(parseKoreDeclarations(`function({ say("x") }) { }`), []);
	});

	test('skips a builder call without a trailing lambda', () => {
		assert.deepStrictEqual(parseKoreDeclarations(`function("main")`), []);
		assert.deepStrictEqual(parseKoreDeclarations(`val f = function("main"); f.run()`), []);
	});

	test('a builder whose call and lambda are separated by comments still matches', () => {
		const decls = parseKoreDeclarations(`function /* a */ ("main") // b\n /* c */ { }`);
		assert.strictEqual(decls.length, 1);
		assert.strictEqual(decls[0].name, 'main');
	});

	test('unescapes Kotlin string escapes and unicode', () => {
		const decls = parseKoreDeclarations(String.raw`function("a\tb\"cA\$d") { }`);
		assert.strictEqual(decls[0].name, 'a\tb"cA$d');
		assert.strictEqual(decls[0].isDynamic, false);
	});

	test('reads triple-quoted strings verbatim, without escape processing', () => {
		const decls = parseKoreDeclarations(`function("""raw\\name""") { }`);
		assert.strictEqual(decls[0].name, 'raw\\name');
		assert.strictEqual(decls[0].isDynamic, false);
	});

	test('keeps `${ }` templates as-is and marks them dynamic, even with braces inside', () => {
		const decls = parseKoreDeclarations('function("f_${if (x) { "a" } else { "b" }}_end") { }');
		assert.strictEqual(decls.length, 1);
		assert.strictEqual(decls[0].name, 'f_${if (x) { "a" } else { "b" }}_end');
		assert.strictEqual(decls[0].isDynamic, true);
	});

	test('string concatenation and constants fall back to a collapsed placeholder', () => {
		const concat = parseKoreDeclarations(`function("a" + suffix) { }`)[0];
		assert.strictEqual(concat.name, '"a" + suffix');
		assert.strictEqual(concat.isDynamic, true);

		const constant = parseKoreDeclarations(`function(NAME) { }`)[0];
		assert.strictEqual(constant.name, 'NAME');
		assert.strictEqual(constant.isDynamic, true);

		const multiline = parseKoreDeclarations(`function(build(\n\t"a",\n\t"b"\n)) { }`)[0];
		assert.strictEqual(multiline.name, 'build( "a", "b" )');
	});

	test('clips a long placeholder to 80 characters', () => {
		const decls = parseKoreDeclarations(`function(${'x'.repeat(200)}) { }`);
		assert.strictEqual(decls[0].name.length, 80);
	});

	test('a dynamic dataPack name makes every nested element dynamic', () => {
		const decls = parseKoreDeclarations(`
			dataPack(packName) {
				function("main") { }
			}
		`);
		const fn = decls.find(d => d.kindId === 'FUNCTION')!;
		assert.strictEqual(fn.dataPackName, 'packName');
		assert.strictEqual(fn.isDynamic, true);
	});

	test('a dynamic namespace or directory alone flags the declaration', () => {
		assert.strictEqual(parseKoreDeclarations(`function("n", ns) { }`)[0].isDynamic, true);
		assert.strictEqual(parseKoreDeclarations(`function("n", "ns", dir) { }`)[0].isDynamic, true);
		assert.strictEqual(parseKoreDeclarations(`advancement("n") { namespace = NS }`)[0].isDynamic, true);
	});

	test('the innermost dataPack wins for nested dataPacks', () => {
		const decls = parseKoreDeclarations(`
			dataPack("outer") {
				dataPack("inner") {
					function("f") { }
				}
				function("g") { }
			}
		`);
		const byName = new Map(decls.map(d => [d.name, d]));
		assert.strictEqual(byName.get('f')!.dataPackName, 'inner');
		assert.strictEqual(byName.get('g')!.dataPackName, 'outer');
		assert.strictEqual(byName.get('inner')!.dataPackName, 'inner');
	});

	test('a dataPack does not leak into declarations after its block', () => {
		const decls = parseKoreDeclarations(`
			dataPack("p") { }
			function("f") { }
		`);
		assert.strictEqual(decls.find(d => d.kindId === 'FUNCTION')!.dataPackName, undefined);
	});

	test('a dataPack is still found through plain Kotlin blocks (if / lambda / class)', () => {
		const decls = parseKoreDeclarations(`
			dataPack("p") {
				if (debug) {
					listOf(1).forEach { function("f") { } }
				}
			}
		`);
		assert.strictEqual(decls.find(d => d.kindId === 'FUNCTION')!.dataPackName, 'p');
	});

	test('survives an unterminated string and unbalanced braces', () => {
		assert.doesNotThrow(() => parseKoreDeclarations(`function("main) {\n}`));
		assert.doesNotThrow(() => parseKoreDeclarations(`} } ) function("main") { }`));
		assert.strictEqual(parseKoreDeclarations(`} ) function("main") { }`).length, 1);
		assert.deepStrictEqual(parseKoreDeclarations(`function("main") {`), []);
	});

	test('does not confuse char literals holding quotes or braces', () => {
		const decls = parseKoreDeclarations(`
			dataPack("p") {
				val a = '"'
				val b = '{'
				val c = '\\''
				function("f") { }
			}
		`);
		assert.strictEqual(decls.length, 2);
	});

	test('ignores builder names used as property access or declaration', () => {
		assert.deepStrictEqual(parseKoreDeclarations(`val function = 1\nobj.function { }`), []);
	});

	test('ignores a lambda argument passed inline before the name', () => {
		const decls = parseKoreDeclarations(`function({ x }, "main") { }`);
		assert.strictEqual(decls.length, 1);
		assert.strictEqual(decls[0].name, 'main');
	});
});
