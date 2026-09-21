import * as assert from 'assert';
import { parseKoreDeclarations, parseKotlinFile } from '../koreParser';

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

	test('a function declaration named like a builder is not a call, its body still is scanned', () => {
		assert.deepStrictEqual(parseKoreDeclarations(`fun DataPack.tick(name: String) { }`), []);
		assert.deepStrictEqual(parseKoreDeclarations(`fun <reified T : Foo> function(name: String) { }`), []);
		const decls = parseKoreDeclarations(`fun function(name: String) = advancement("a") { }\nfun DataPack.helper() { function("f") { } }`);
		assert.deepStrictEqual(decls.map(d => `${d.kindId}:${d.name}`), ['ADVANCEMENT:a', 'FUNCTION:f']);
	});

	test('ignores a lambda argument passed inline before the name', () => {
		const decls = parseKoreDeclarations(`function({ x }, "main") { }`);
		assert.strictEqual(decls.length, 1);
		assert.strictEqual(decls[0].name, 'main');
	});

	suite('scoped builders', () => {
		test('finds scoped builders inside their scope block, with or without a trailing lambda', () => {
			const decls = parseKoreDeclarations(`
				dataPack("p") {
					recipes {
						craftingShaped("sword") { pattern("x") }
						smelting("ingot", Items.RAW_IRON, Items.IRON_INGOT)
					}
					enchantmentProviders {
						single("pillager_spawn_crossbow", Enchantments.PIERCING, uniform(1, 3))
						byCost("mob_spawn_equipment", Tags.Enchantment.ON_MOB_SPAWN_EQUIPMENT, cost = uniform(5, 25))
					}
				}
			`);
			const byName = new Map(decls.map(d => [d.name, d]));
			assert.deepStrictEqual([...byName.keys()].sort(), ['ingot', 'mob_spawn_equipment', 'p', 'pillager_spawn_crossbow', 'sword']);
			assert.strictEqual(byName.get('sword')!.kindId, 'CRAFTING_SHAPED');
			assert.strictEqual(byName.get('ingot')!.kindId, 'SMELTING');
			assert.strictEqual(byName.get('pillager_spawn_crossbow')!.kindId, 'SINGLE_ENCHANTMENT_PROVIDER');
			assert.strictEqual(byName.get('mob_spawn_equipment')!.kindId, 'BY_COST_ENCHANTMENT_PROVIDER');
			assert.ok(decls.every(d => d.dataPackName === 'p'));
		});

		test('the scope block may be called with parentheses too', () => {
			const decls = parseKoreDeclarations(`structures() { shipwreck("wreck") { biomes(Biomes.OCEAN) } }`);
			assert.strictEqual(decls.length, 1);
			assert.strictEqual(decls[0].kindId, 'SHIPWRECK');
		});

		test('the xxxBuilder receiver property stands in for the scope block', () => {
			const decls = parseKoreDeclarations(`
				dp.configuredFeaturesBuilder.ore("ruby_ore", size = 8)
				dialogBuilder.notice("hello") { title("Hi") }
				dp?.densityFunctionsBuilder?.abs("flat", 2.0)
			`);
			assert.deepStrictEqual(decls.map(d => d.kindId), ['ORE_FEATURE', 'NOTICE', 'ABS_DENSITY_FUNCTION']);
			assert.deepStrictEqual(decls.map(d => d.name), ['ruby_ore', 'hello', 'flat']);
		});

		test('a scoped builder outside its scope is not a declaration, even with a lambda', () => {
			assert.deepStrictEqual(parseKoreDeclarations(`single("x") { }`), []);
			assert.deepStrictEqual(parseKoreDeclarations(`sequence("x") { }`), []);
			assert.deepStrictEqual(parseKoreDeclarations(`list.single("x")`), []);
			assert.deepStrictEqual(parseKoreDeclarations(`recipes { } smelting("x")`), []);
		});

		test('a scope decides between same-named top-level and scoped builders', () => {
			assert.strictEqual(parseKoreDeclarations(`noise("n") { }`)[0].kindId, 'NOISE');
			assert.strictEqual(parseKoreDeclarations(`densityFunctions { noise("n", Noises.CAVE_LAYER) }`)[0].kindId, 'NOISE_DENSITY_FUNCTION');
			assert.strictEqual(parseKoreDeclarations(`testEnvironments { function("env") { setup(f) } }`)[0].kindId, 'FUNCTION_TEST_ENVIRONMENT');
			assert.strictEqual(parseKoreDeclarations(`function("f") { }`)[0].kindId, 'FUNCTION');
		});

		test('unscoped builders still need their trailing lambda inside a scope', () => {
			assert.deepStrictEqual(parseKoreDeclarations(`recipes { advancement("a") }`), []);
		});

		test('reports the builder identifier offset for block-less scoped calls', () => {
			const src = `recipes { smelting("x") }`;
			assert.strictEqual(parseKoreDeclarations(src)[0].offset, src.indexOf('smelting'));
		});
	});

	suite('tags and 26.2 builders', () => {
		test('typed tag builders are declarations', () => {
			const decls = parseKoreDeclarations(`
				dataPack("p") {
					blockTag("ores") { this += Blocks.IRON_ORE }
					functionTag("ticks", namespace = "minecraft") { this += f }
				}
			`);
			const byName = new Map(decls.map(d => [d.name, d]));
			assert.strictEqual(byName.get('ores')!.kindId, 'BLOCK_TAG');
			assert.strictEqual(byName.get('ticks')!.kindId, 'FUNCTION_TAG');
			assert.strictEqual(byName.get('ticks')!.namespace, 'minecraft');
		});

		test('sulfurCubeArchetype and structure are declarations', () => {
			const decls = parseKoreDeclarations(`
				sulfurCubeArchetype("regular", Tags.Item.SWORDS, horizontalKnockbackPower = 0.4f, verticalKnockbackPower = 0.2f) { buoyant = true }
				structure("custom", type) { namespace = "ns" }
			`);
			assert.deepStrictEqual(decls.map(d => d.kindId), ['SULFUR_CUBE_ARCHETYPE', 'STRUCTURE']);
			assert.strictEqual(decls[1].namespace, 'ns');
		});
	});

	suite('parseKotlinFile resolution inputs', () => {
		test('collects string constants, skipping templates and non-strings', () => {
			const { constants } = parseKotlinFile(`
				const val NAMESPACE = "lifesteal"
				val typed: String = "typed"
				val escaped = "a\\"b"
				val dynamic = "x$y"
				val number = 3
				fun f() { val local = "inner" }
			`);
			assert.deepStrictEqual([...constants], [['NAMESPACE', 'lifesteal'], ['typed', 'typed'], ['escaped', 'a"b'], ['local', 'inner']]);
		});

		test('tracks DataPack extension function bodies, every declared function name, and the enclosing function of a declaration', () => {
			const src = `
				fun DataPack.setup(): Unit {
					function("a") { }
					helper()
				}
				private fun <T> DataPack.generic(x: T) { function("b") { } }
				fun Function.other() { }
				fun DataPack.expressionBody() = function("c") { }
			`;
			const parsed = parseKotlinFile(src);

			assert.deepStrictEqual(parsed.extensionFunctions.map(f => f.name), ['setup', 'generic']);
			assert.strictEqual(src.slice(parsed.extensionFunctions[0].start, parsed.extensionFunctions[0].end).includes('helper()'), true);
			assert.deepStrictEqual([...parsed.declaredFunctions], ['setup', 'generic', 'other', 'expressionBody']);
			assert.deepStrictEqual(parsed.declarations.map(d => [d.name, d.enclosingFunction]), [['a', 'setup'], ['b', 'generic'], ['c', undefined]]);
			assert.deepStrictEqual(parsed.calls.map(c => c.name), ['helper']);
		});

		test('records dataPack block ranges and the candidate calls inside them, but not builders or constructors', () => {
			const src = `
				dataPack(NAME) {
					setup()
					load { tick() }
					Foo("x")
					function("f") { }
				}
			`;
			const parsed = parseKotlinFile(src);

			assert.strictEqual(parsed.dataPackBlocks.length, 1);
			assert.deepStrictEqual(parsed.dataPackBlocks[0], { name: 'NAME', isDynamic: true, start: src.indexOf('{') + 1, end: src.lastIndexOf('}') });
			assert.deepStrictEqual(parsed.calls.map(c => c.name), ['setup']);
		});

		test('an element inside a dataPack block has no enclosing function even when nested in an extension', () => {
			const parsed = parseKotlinFile(`fun DataPack.wrap() { dataPack("p") { function("f") { } } }`);
			assert.strictEqual(parsed.declarations[0].dataPackName, 'p');
			assert.strictEqual(parsed.declarations[0].enclosingFunction, undefined);
		});

		test('lists which fields are dynamic', () => {
			const [decl] = parseKoreDeclarations(`dataPack(NAME) { function("f_$suffix", namespace = "ns", directory = dir) { } }`);
			assert.deepStrictEqual(decl.dynamicFields, ['name', 'directory', 'dataPackName']);
			assert.deepStrictEqual(parseKoreDeclarations(`function("f") { }`)[0].dynamicFields, []);
		});
	});
});
