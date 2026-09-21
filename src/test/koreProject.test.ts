import * as assert from 'assert';
import { KoreVersion, parseBuildFile, parseVersionCatalog } from '../koreProject';

suite('KoreVersion', () => {
	test('splits on the last dash', () => {
		const version = KoreVersion.parse('2.14.0-26.2')!;
		assert.strictEqual(version.kore, '2.14.0');
		assert.strictEqual(version.minecraft, '26.2');
		assert.strictEqual(version.toString(), '2.14.0-26.2');
		assert.deepStrictEqual(KoreVersion.parse('2.8.0-26.1.2'), new KoreVersion('2.8.0', '26.1.2'));
	});

	test('rejects versions without both parts', () => {
		assert.strictEqual(KoreVersion.parse('2.14.0'), undefined);
		assert.strictEqual(KoreVersion.parse('-26.2'), undefined);
		assert.strictEqual(KoreVersion.parse('2.14.0-'), undefined);
	});
});

suite('parseBuildFile', () => {
	test('reads the version from a Gradle dependency, Kotlin or Groovy DSL', () => {
		const kts = parseBuildFile('plugins {\n\tkotlin("jvm") version "2.4.0"\n}\ndependencies {\n\timplementation("io.github.ayfri.kore:kore:2.14.0-26.2")\n}')!;
		assert.strictEqual(kts.version?.toString(), '2.14.0-26.2');
		assert.strictEqual(kts.hasGradlePlugin, false);

		const groovy = parseBuildFile("dependencies {\n\timplementation 'io.github.ayfri.kore:kore:2.13.0-26.1'\n}")!;
		assert.strictEqual(groovy.version?.toString(), '2.13.0-26.1');
	});

	test('detects the Gradle plugin inside plugins { } and takes its version', () => {
		const info = parseBuildFile('plugins {\n\tid("io.github.ayfri.kore") version "2.14.0-26.2"\n}\n')!;
		assert.strictEqual(info.hasGradlePlugin, true);
		assert.strictEqual(info.version?.toString(), '2.14.0-26.2');
		assert.strictEqual(parseBuildFile('// id("io.github.ayfri.kore")\nplugins { kotlin("jvm") }')!.hasGradlePlugin, false);
	});

	test('reads a Maven dependency', () => {
		const pom = '<dependency>\n\t<groupId>io.github.ayfri.kore</groupId>\n\t<artifactId>kore</artifactId>\n\t<version>2.14.0-26.2</version>\n</dependency>';
		assert.strictEqual(parseBuildFile(pom)!.version?.toString(), '2.14.0-26.2');
	});

	test('ignores build files that never mention Kore', () => {
		assert.strictEqual(parseBuildFile('plugins { kotlin("jvm") version "2.4.0" }\ndependencies { implementation("io.ktor:ktor-server-core:3.0.0") }'), undefined);
	});
});

suite('parseVersionCatalog', () => {
	const catalog = `[versions]
kore = "2.14.0-26.2"

[libraries]
kore = { module = "io.github.ayfri.kore:kore", version.ref = "kore" }
ktor-server = { module = "io.ktor:ktor-server-core", version = "3.0.0" }

[plugins]
kore-gradle = { id = "io.github.ayfri.kore", version.ref = "kore" }
`;

	test('follows version.ref and names the aliases a script uses', () => {
		const info = parseVersionCatalog(catalog);
		assert.strictEqual(info.version?.toString(), '2.14.0-26.2');
		assert.deepStrictEqual(info.libraryAliases, ['libs.kore']);
		assert.deepStrictEqual(info.pluginAliases, ['libs.plugins.kore.gradle']);
	});

	test('reads inline versions, group/name entries and the short form', () => {
		assert.strictEqual(parseVersionCatalog('[libraries]\nkore = { group = "io.github.ayfri.kore", name = "kore", version = "2.13.0-26.1" }').version?.toString(), '2.13.0-26.1');
		const short = parseVersionCatalog('[libraries]\nkore-lib = "io.github.ayfri.kore:kore:2.12.0-26.1"');
		assert.strictEqual(short.version?.toString(), '2.12.0-26.1');
		assert.deepStrictEqual(short.libraryAliases, ['libs.kore.lib']);
	});

	test('a build script using the catalog gets the catalog version and plugin', () => {
		const info = parseBuildFile('plugins {\n\talias(libs.plugins.kore.gradle)\n}\ndependencies {\n\timplementation(libs.kore)\n}', parseVersionCatalog(catalog))!;
		assert.strictEqual(info.version?.toString(), '2.14.0-26.2');
		assert.strictEqual(info.hasGradlePlugin, true);
		assert.strictEqual(parseBuildFile('dependencies { implementation(libs.ktor.server) }', parseVersionCatalog(catalog)), undefined);
	});
});
