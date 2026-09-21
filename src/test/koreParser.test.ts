import * as assert from 'assert';
import { parseKotlinFile, RawKoreDeclaration } from '../koreParser';

const parse = (text: string): RawKoreDeclaration[] => parseKotlinFile(text).declarations;
const byName = (decls: RawKoreDeclaration[]) => new Map(decls.map(d => [d.name, d]));

suite('koreParser', () => {
	test('parses a plain dataPack + function pair', () => {
		const decls = parse(`
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

	test('reads namespace from a positional function argument and directory from a named one', () => {
		const [fn] = parse(`function("main", "custom_ns", directory = "sub") { }`);
		assert.strictEqual(fn.namespace, 'custom_ns');
		assert.strictEqual(fn.directory, 'sub');
	});

	test('reads namespace from a top-level `namespace = "..."` statement in the block, not a nested one', () => {
		assert.strictEqual(parse(`advancement("root") {\n namespace = "story"\n parent = null\n }`)[0].namespace, 'story');
		assert.strictEqual(parse(`advancement("root") { criteria { namespace = "nested" } }`)[0].namespace, undefined);
	});

	test('finds the enclosing dataPack even with unrelated calls in between', () => {
		const decls = parse(`
			dataPack("mypack") {
				group("a") {
					lootTable("chest") { }
				}
			}
		`);

		assert.strictEqual(decls.find(d => d.kindId === 'LOOT_TABLE')!.dataPackName, 'mypack');
	});

	test('finds declarations nested inside another call\'s argument list', () => {
		const decls = parse(`dataPack("mypack") { withAll(function("a") { }, function("b") { }) }`);
		assert.deepStrictEqual(decls.filter(d => d.kindId === 'FUNCTION').map(d => d.name).sort(), ['a', 'b']);
	});

	test('marks a dynamic name as a placeholder snippet', () => {
		const [fn] = parse(`function(generatedName()) { }`);
		assert.strictEqual(fn.isDynamic, true);
		assert.strictEqual(fn.name, 'generatedName()');
	});

	test('marks string-template interpolation as dynamic but keeps the source spelling', () => {
		const [fn] = parse(`function("leaf_$leafId") { }`);
		assert.strictEqual(fn.isDynamic, true);
		assert.strictEqual(fn.name, 'leaf_$leafId');
	});

	test('does not confuse braces inside string literals, comments or char literals with block boundaries', () => {
		const decls = parse(`
			dataPack("mypack") {
				// this { comment has a brace
				val a = '"'
				val b = '{'
				val c = '\\''
				function("main") {
					/* another { one */
					val weird = "{ not a real block }"
				}
			}
		`);

		assert.strictEqual(decls.length, 2);
	});

	test('returns nothing for empty, non-Kore or unknown-builder source', () => {
		assert.deepStrictEqual(parse(''), []);
		assert.deepStrictEqual(parse('class Foo { fun bar() = 1 }'), []);
		assert.deepStrictEqual(parse('if (condition) { doSomething("x") }'), []);
	});

	test('reports the offset of the builder identifier, with and without a block', () => {
		const source = 'val x = 1\ndataPack("p") {\n\tfunction("f") { }\n\trecipes { smelting("x") }\n}';
		const decls = byName(parse(source));

		assert.strictEqual(decls.get('p')!.offset, source.indexOf('dataPack'));
		assert.strictEqual(decls.get('f')!.offset, source.indexOf('function'));
		assert.strictEqual(decls.get('x')!.offset, source.indexOf('smelting'));
	});

	test('reports the name argument range and the body range', () => {
		const source = 'function(name = "f", directory = "d") {\n\tsay("x")\n}\nrecipes { smelting("x") }';
		const [fn, smelting] = parse(source);

		assert.strictEqual(source.slice(fn.nameArgRange.start, fn.nameArgRange.end), '"f"');
		assert.strictEqual(source.slice(fn.bodyRange!.start, fn.bodyRange!.end), '\n\tsay("x")\n');
		assert.strictEqual(source[fn.bodyRange!.end], '}');
		assert.strictEqual(source.slice(smelting.nameArgRange.start, smelting.nameArgRange.end), '"x"');
		assert.strictEqual(smelting.bodyRange, undefined);
	});

	test('emits declarations in closing order (inner before outer) and does not dedupe same names', () => {
		const decls = parse(`dataPack("p") { function("a") { }\n function("a") { } }`);
		assert.deepStrictEqual(decls.map(d => d.kindId), ['FUNCTION', 'FUNCTION', 'DATA_PACK']);
	});

	test('recognizes every function-family builder, with positional namespace and directory', () => {
		for (const builder of ['function', 'generatedFunction', 'load', 'tick']) {
			const decls = parse(`${builder}("n", "ns", "dir") { }`);
			assert.strictEqual(decls.length, 1, builder);
			assert.strictEqual(decls[0].namespace, 'ns', builder);
			assert.strictEqual(decls[0].directory, 'dir', builder);
			assert.strictEqual(decls[0].isDynamic, false, builder);
		}
	});

	test('only the function family reads positional namespace/directory', () => {
		const [decl] = parse(`advancement("root", "ns", "dir") { }`);
		assert.strictEqual(decl.namespace, undefined);
		assert.strictEqual(decl.directory, undefined);
	});

	test('a named `namespace =` argument beats a positional one and a body assignment', () => {
		assert.strictEqual(parse(`function("n", "positional", namespace = "named") { }`)[0].namespace, 'named');
		assert.strictEqual(parse(`advancement("root", namespace = "arg") { namespace = "body" }`)[0].namespace, 'arg');
	});

	test('the last top-level namespace assignment wins, `==` and strings are not assignments', () => {
		assert.strictEqual(parse(`advancement("root") {\n namespace = "first"\n parent = null; namespace = "second"\n }`)[0].namespace, 'second');
		assert.strictEqual(parse(`advancement("root") {\n val ok = namespace == "x"\n title = "namespace = \\"fake\\""\n }`)[0].namespace, undefined);
	});

	test('a trailing comment after a value does not make it dynamic', () => {
		const [decl] = parse(`advancement("root" /* the root */) { namespace = "ns" // story\n }`);
		assert.strictEqual(decl.name, 'root');
		assert.strictEqual(decl.namespace, 'ns');
		assert.strictEqual(decl.isDynamic, false);
	});

	test('reads the name from `name =` and `fileName =` named arguments', () => {
		assert.strictEqual(parse(`lootTable(name = "a") { }`)[0].name, 'a');
		assert.strictEqual(parse(`lootTable(fileName = "b") { }`)[0].name, 'b');
		assert.strictEqual(parse(`lootTable(name = "a", fileName = "b") { }`)[0].name, 'a');
	});

	test('skips a builder call with no name argument or without a trailing lambda', () => {
		assert.deepStrictEqual(parse(`function() { }`), []);
		assert.deepStrictEqual(parse(`function({ say("x") }) { }`), []);
		assert.deepStrictEqual(parse(`function("main")`), []);
		assert.deepStrictEqual(parse(`val f = function("main"); f.run()`), []);
	});

	test('a builder whose call and lambda are separated by comments still matches', () => {
		const decls = parse(`function /* a */ ("main") // b\n /* c */ { }`);
		assert.strictEqual(decls.length, 1);
		assert.strictEqual(decls[0].name, 'main');
	});

	test('unescapes Kotlin string escapes and unicode, reads triple-quoted strings verbatim', () => {
		const [escaped] = parse(String.raw`function("a\tb\"cA\$dA") { }`);
		assert.strictEqual(escaped.name, 'a\tb"cA$dA');
		assert.strictEqual(escaped.isDynamic, false);

		const [raw] = parse(`function("""raw\\name""") { }`);
		assert.strictEqual(raw.name, 'raw\\name');
		assert.strictEqual(raw.isDynamic, false);
	});

	test('keeps `${ }` templates as-is and marks them dynamic, even with braces inside', () => {
		const decls = parse('function("f_${if (x) { "a" } else { "b" }}_end") { }');
		assert.strictEqual(decls.length, 1);
		assert.strictEqual(decls[0].name, 'f_${if (x) { "a" } else { "b" }}_end');
		assert.strictEqual(decls[0].isDynamic, true);
	});

	test('a constant reference keeps its spelling, dot-qualified or not', () => {
		assert.deepStrictEqual(parse(`function(NAME) { }`)[0].name, 'NAME');
		assert.deepStrictEqual(parse(`function(Constants.NAME) { }`)[0].name, 'Constants.NAME');
		assert.strictEqual(parse(`function(Constants.NAME) { }`)[0].isDynamic, true);
	});

	test('string concatenation folds literals and turns the other sides into template entries', () => {
		assert.strictEqual(parse(`function("a" + "b") { }`)[0].name, 'ab');
		assert.strictEqual(parse(`function("blocks/" + NAME + "_x") { }`)[0].name, 'blocks/${NAME}_x');
		assert.strictEqual(parse(`function(Names.LEAF +\n\t"_$suffix") { }`)[0].name, '${Names.LEAF}_$suffix');
		assert.strictEqual(parse(`function("a" + build(\n\t"a",\n\t"b"\n)) { }`)[0].name, 'a${build( "a", "b" )}');
		assert.strictEqual(parse(`function("a" + "b") { }`)[0].isDynamic, false);
		assert.strictEqual(parse(`function("a" + NAME) { }`)[0].isDynamic, true);
	});

	test('anything else falls back to a collapsed placeholder clipped to 80 characters', () => {
		assert.strictEqual(parse(`function(build(\n\t"a",\n\t"b"\n)) { }`)[0].name, 'build( "a", "b" )');
		assert.strictEqual(parse(`function(build(${'x'.repeat(200)})) { }`)[0].name.length, 80);
	});

	test('a dynamic dataPack name, namespace or directory alone flags the declaration and lists the fields', () => {
		const decls = parse(`dataPack(NAME) { function("f_$suffix", namespace = "ns", directory = dir) { } }`);
		assert.deepStrictEqual(decls[0].dynamicFields, ['name', 'directory', 'dataPackName']);
		assert.strictEqual(decls[0].dataPackName, 'NAME');
		assert.strictEqual(decls[0].isDynamic, true);
		assert.deepStrictEqual(parse(`function("n", ns) { }`)[0].dynamicFields, ['namespace']);
		assert.deepStrictEqual(parse(`advancement("n") { namespace = NS }`)[0].dynamicFields, ['namespace']);
		assert.deepStrictEqual(parse(`function("f") { }`)[0].dynamicFields, []);
	});

	test('the innermost dataPack wins for nested dataPacks', () => {
		const decls = byName(parse(`
			dataPack("outer") {
				dataPack("inner") {
					function("f") { }
				}
				function("g") { }
			}
		`));
		assert.strictEqual(decls.get('f')!.dataPackName, 'inner');
		assert.strictEqual(decls.get('g')!.dataPackName, 'outer');
		assert.strictEqual(decls.get('inner')!.dataPackName, 'inner');
	});

	test('a dataPack does not leak into declarations after its block', () => {
		const decls = parse(`dataPack("p") { }\nfunction("f") { }`);
		assert.strictEqual(decls.find(d => d.kindId === 'FUNCTION')!.dataPackName, undefined);
	});

	test('a dataPack is still found through plain Kotlin blocks (if / lambda / class)', () => {
		const decls = parse(`dataPack("p") { if (debug) { listOf(1).forEach { function("f") { } } } }`);
		assert.strictEqual(decls.find(d => d.kindId === 'FUNCTION')!.dataPackName, 'p');
	});

	test('survives an unterminated string and unbalanced braces', () => {
		assert.doesNotThrow(() => parse(`function("main) {\n}`));
		assert.doesNotThrow(() => parse(`} } ) function("main") { }`));
		assert.strictEqual(parse(`} ) function("main") { }`).length, 1);
		assert.deepStrictEqual(parse(`function("main") {`), []);
	});

	test('ignores builder names used as property access or declaration', () => {
		assert.deepStrictEqual(parse(`val function = 1\nobj.function { }`), []);
	});

	test('a function declaration named like a builder is not a call, its body still is scanned', () => {
		assert.deepStrictEqual(parse(`fun DataPack.tick(name: String) { }`), []);
		assert.deepStrictEqual(parse(`fun <reified T : Foo> function(name: String) { }`), []);
		const decls = parse(`fun function(name: String) = advancement("a") { }\nfun DataPack.helper() { function("f") { } }`);
		assert.deepStrictEqual(decls.map(d => `${d.kindId}:${d.name}`), ['ADVANCEMENT:a', 'FUNCTION:f']);
	});

	test('ignores a lambda argument passed inline before the name', () => {
		const decls = parse(`function({ x }, "main") { }`);
		assert.strictEqual(decls.length, 1);
		assert.strictEqual(decls[0].name, 'main');
	});

	suite('scoped builders', () => {
		test('finds scoped builders inside their scope block, with or without a trailing lambda', () => {
			const decls = byName(parse(`
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
			`));
			assert.deepStrictEqual([...decls.keys()].sort(), ['ingot', 'mob_spawn_equipment', 'p', 'pillager_spawn_crossbow', 'sword']);
			assert.strictEqual(decls.get('sword')!.kindId, 'CRAFTING_SHAPED');
			assert.strictEqual(decls.get('ingot')!.kindId, 'SMELTING');
			assert.strictEqual(decls.get('pillager_spawn_crossbow')!.kindId, 'SINGLE_ENCHANTMENT_PROVIDER');
			assert.strictEqual(decls.get('mob_spawn_equipment')!.kindId, 'BY_COST_ENCHANTMENT_PROVIDER');
			assert.ok([...decls.values()].every(d => d.dataPackName === 'p'));
		});

		test('the scope block may be called with parentheses too', () => {
			const decls = parse(`structures() { shipwreck("wreck") { biomes(Biomes.OCEAN) } }`);
			assert.strictEqual(decls.length, 1);
			assert.strictEqual(decls[0].kindId, 'SHIPWRECK');
		});

		test('the xxxBuilder receiver property stands in for the scope block', () => {
			const decls = parse(`
				dp.configuredFeaturesBuilder.ore("ruby_ore", size = 8)
				dialogBuilder.notice("hello") { title("Hi") }
				dp?.densityFunctionsBuilder?.abs("flat", 2.0)
			`);
			assert.deepStrictEqual(decls.map(d => d.kindId), ['ORE_FEATURE', 'NOTICE', 'ABS_DENSITY_FUNCTION']);
			assert.deepStrictEqual(decls.map(d => d.name), ['ruby_ore', 'hello', 'flat']);
		});

		test('a scoped builder outside its scope is not a declaration, even with a lambda', () => {
			assert.deepStrictEqual(parse(`single("x") { }`), []);
			assert.deepStrictEqual(parse(`sequence("x") { }`), []);
			assert.deepStrictEqual(parse(`list.single("x")`), []);
			assert.deepStrictEqual(parse(`recipes { } smelting("x")`), []);
		});

		test('a scope decides between same-named top-level and scoped builders', () => {
			assert.strictEqual(parse(`noise("n") { }`)[0].kindId, 'NOISE');
			assert.strictEqual(parse(`densityFunctions { noise("n", Noises.CAVE_LAYER) }`)[0].kindId, 'NOISE_DENSITY_FUNCTION');
			assert.strictEqual(parse(`testEnvironments { function("env") { setup(f) } }`)[0].kindId, 'FUNCTION_TEST_ENVIRONMENT');
			assert.strictEqual(parse(`function("f") { }`)[0].kindId, 'FUNCTION');
		});

		test('unscoped builders still need their trailing lambda inside a scope', () => {
			assert.deepStrictEqual(parse(`recipes { advancement("a") }`), []);
		});
	});

	suite('tags and 26.2 builders', () => {
		test('typed tag builders are declarations', () => {
			const decls = byName(parse(`
				dataPack("p") {
					blockTag("ores") { this += Blocks.IRON_ORE }
					functionTag("ticks", namespace = "minecraft") { this += f }
				}
			`));
			assert.strictEqual(decls.get('ores')!.kindId, 'BLOCK_TAG');
			assert.strictEqual(decls.get('ticks')!.kindId, 'FUNCTION_TAG');
			assert.strictEqual(decls.get('ticks')!.namespace, 'minecraft');
		});

		test('sulfurCubeArchetype and structure are declarations', () => {
			const decls = parse(`
				sulfurCubeArchetype("regular", Tags.Item.SWORDS, horizontalKnockbackPower = 0.4f, verticalKnockbackPower = 0.2f) { buoyant = true }
				structure("custom", type) { namespace = "ns" }
			`);
			assert.deepStrictEqual(decls.map(d => d.kindId), ['SULFUR_CUBE_ARCHETYPE', 'STRUCTURE']);
			assert.strictEqual(decls[1].namespace, 'ns');
		});
	});

	suite('constants', () => {
		test('collects string literals, references and concatenations, skipping everything else', () => {
			const src = `
				const val NAMESPACE = "lifesteal"
				val typed: String = "typed"
				val escaped = "a\\"b" // trailing comment
				val dynamic = "x$y"
				val alias = NAMESPACE
				val qualified = Constants.NS
				val concat = "blocks/" +
					LEAF + "_x"
				val number = 3
				val f = function("x") { }
				val list = listOf("a")
				fun f() { val local = "inner"; val other = "after" }
			`;
			const { constants } = parseKotlinFile(src);

			assert.deepStrictEqual(constants.map(c => [c.name, c.text, c.isDynamic]), [
				['NAMESPACE', 'lifesteal', false],
				['typed', 'typed', false],
				['escaped', 'a"b', false],
				['dynamic', 'x$y', true],
				['alias', 'NAMESPACE', true],
				['qualified', 'Constants.NS', true],
				['concat', 'blocks/${LEAF}_x', true],
				['local', 'inner', false],
				['other', 'after', false],
			]);
			assert.strictEqual(constants[0].offset, src.indexOf('val NAMESPACE'));
			assert.deepStrictEqual(parseKotlinFile(src).declarations.map(d => d.name), ['x']);
		});

		test('keeps every binding of a shadowed name in source order, with the end of the block declaring a local', () => {
			const src = `val X = "a"\nfun f() { run { val X = "b" } }\nval X = "c"`;
			const { constants } = parseKotlinFile(src);
			assert.deepStrictEqual(constants.map(c => c.text), ['a', 'b', 'c']);
			assert.ok(constants[0].offset < constants[1].offset && constants[1].offset < constants[2].offset);
			assert.deepStrictEqual(constants.map(c => c.scopeEnd), [undefined, src.indexOf('}'), undefined]);
		});
	});

	suite('extension functions and calls', () => {
		test('tracks DataPack extension bodies, every declared function name, and the enclosing function of a declaration', () => {
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

		test('a datapack passed as a value parameter or a context parameter also makes an extension function', () => {
			const parsed = parseKotlinFile(`
				fun byParam(dp: DataPack, x: Int) { function("a") { } }
				fun qualified(dp: io.github.ayfri.kore.DataPack?) { function("b") { } }
				context(dp: DataPack) fun byContext() { function("c") { } }
				context(DataPack) fun byOldContext() { function("d") { } }
				fun byLambda(block: (DataPack) -> Unit) { function("e") { } }
				fun byBuilder(b: DataPack.Builder) { function("f") { } }
				fun plain() { function("g") { } }
			`);

			assert.deepStrictEqual(parsed.extensionFunctions.map(f => f.name), ['byParam', 'qualified', 'byContext', 'byOldContext']);
			assert.deepStrictEqual(parsed.declarations.map(d => d.enclosingFunction), ['byParam', 'qualified', 'byContext', 'byOldContext', undefined, undefined, undefined]);
			assert.deepStrictEqual(parsed.calls, []);
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
	});

	suite('function commands', () => {
		test('a block-less `function("x")` inside a function-family body is a command, nowhere else', () => {
			const src = `
				dataPack("p") {
					load("l") { function("a") }
					function("main") {
						execute { run { function("b", true) } }
						advancement("x") { function("not_inside_function") }
					}
					function("top")
					dp.function("receiver")
				}
				fun helper() { function("outside") }
			`;
			const { functionCommands } = parseKotlinFile(src);

			assert.deepStrictEqual(functionCommands.map(c => [c.name, c.group, c.isDynamic]), [['a', false, false], ['b', true, false]]);
			assert.strictEqual(functionCommands[0].offset, src.indexOf('function("a")'));
			assert.strictEqual(functionCommands[0].enclosingDeclarationOffset, src.indexOf('load("l")'));
			assert.strictEqual(functionCommands[1].enclosingDeclarationOffset, src.indexOf('function("main")'));
			assert.strictEqual(src.slice(functionCommands[1].argsRange.start, functionCommands[1].argsRange.end), '"b", true');
			assert.strictEqual(src.slice(functionCommands[1].nameArgRange.start, functionCommands[1].nameArgRange.end), '"b"');
		});

		test('an aliased import of the command is recognized under its alias', () => {
			const src = `import io.github.ayfri.kore.commands.function as callFunction
				function("main") {
					callFunction(NAMESPACE, "hearts/apply_health", arguments = storage(STORAGE, NAMESPACE))
				}`;
			const { functionCommands } = parseKotlinFile(src);
			assert.deepStrictEqual(functionCommands.map(c => [c.name, c.namespace, c.namespaceFirst]), [['hearts/apply_health', 'NAMESPACE', true]]);
		});

		test('two positional strings mean namespace first, named arguments are unambiguous', () => {
			const src = `function("main") {
				function("ns", "a")
				function("ns", "b", true)
				function(name = "c", namespace = "ns", group = true)
				function("d", group = true)
				function(namespace = NS, name = "e")
				function(helperRef)
			}`;
			const { functionCommands } = parseKotlinFile(src);

			assert.deepStrictEqual(functionCommands.map(c => [c.name, c.namespace, c.namespaceFirst, c.group, c.isDynamic]), [
				['a', 'ns', true, false, false],
				['b', 'ns', true, true, false],
				['c', 'ns', false, true, false],
				['d', undefined, false, true, false],
				['e', 'NS', false, false, true],
				['helperRef', undefined, false, false, true],
			]);
			assert.strictEqual(src.slice(functionCommands[0].namespaceArgRange!.start, functionCommands[0].namespaceArgRange!.end), '"ns"');
			assert.strictEqual(src.slice(functionCommands[4].nameArgRange.start, functionCommands[4].nameArgRange.end), '"e"');
			assert.strictEqual(functionCommands[3].namespaceArgRange, undefined);
		});
	});
});
