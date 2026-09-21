/**
 * The checks behind the `kore` diagnostics, as pure data transforms over the parser's output and the element store:
 * no `vscode` import, so they run in plain unit tests. Ports of the IntelliJ plugin's `inspections/*.kt`, see
 * docs/feature-parity-plan.md section 2.
 */

import { isFunctionKind, kindById } from './koreDeclarations';
import { koreStringValueOf, type KoreStringValue, type OffsetRange, parseArgs, scanTopLevel, splitTopLevel } from './koreParser';

const MAX_GRID_SIZE = 3;
/** How far a declared function's path may be from the misspelled one to be offered as a replacement. */
const MAX_SUGGESTION_DISTANCE = 2;
const FUNCTION_TAG_FOLDER = 'tags/function';

/** `pattern(`, `patternLine(`, `key(` or `keys {` opening a `craftingShaped` body statement. */
const CRAFTING_STATEMENT_PATTERN = /^(pattern|patternLine|key|keys)\s*([({])/;
/** `"X" to Items.X` inside `keys { }`: the left side is a literal or a reference. */
const KEYS_PAIR_PATTERN = /^("(?:[^"\\]|\\.)*"|[A-Za-z_][A-Za-z0-9_.]*)\s+to\s/;
/** What may precede a statement: a block opener/closer or a separator, else the call is an argument or an initializer. */
const STATEMENT_BOUNDARY_PATTERN = /(?:^|[{};])\s*$/;
/** A line ending in an operator continues the previous statement: `val x =\n    function("a") { }`. */
const OPERATOR_END_PATTERN = /[=.,(+\-*/&|?:!<>]\s*$/;

/** A problem found in one file, on a source range; `unused` marks the weak "declared but not used" case. */
export interface RawProblem<R = OffsetRange> {
	message: string;
	range: R;
	unused?: boolean;
}

interface ScannedString {
	range: OffsetRange;
	value: KoreStringValue;
}

/**
 * Checks a `craftingShaped("x") { pattern(...); key(...) }` body statically: grid size, uniform row width, every
 * pattern character mapped by a `key(...)` / `keys { "X" to ... }` entry, and no key left unused. Minecraft rejects
 * the first three at load time and drops the recipe, Kore writes them all without complaint. Only depth-0
 * statements of the body count; a runtime-built row or key disables the key checks, the grid checks still run.
 */
export function scanCraftingShapedBody(bodyText: string, bodyStart: number): RawProblem[] {
	const rows: ScannedString[] = [];
	const keys: ScannedString[] = [];

	for (const statement of splitTopLevel(bodyText, c => c === '\n' || c === ';')) {
		const m = CRAFTING_STATEMENT_PATTERN.exec(statement.text);
		if (!m) {
			continue;
		}
		const openIndex = m[0].length - 1;
		const closeIndex = scanTopLevel(statement.text, openIndex + 1, () => false);
		const innerStart = bodyStart + statement.start + openIndex + 1;
		const inner = statement.text.slice(openIndex + 1, closeIndex);

		if (m[1] === 'keys') {
			if (m[2] !== '{') {
				continue;
			}
			for (const pair of splitTopLevel(inner, c => c === '\n' || c === ';')) {
				const key = KEYS_PAIR_PATTERN.exec(pair.text);
				if (key) {
					keys.push(scannedString(key[1], innerStart + pair.start));
				}
			}
			continue;
		}
		if (m[2] !== '(') {
			continue;
		}
		const args = parseArgs(inner, innerStart).positional;
		const strings = m[1] === 'pattern' ? args : args.slice(0, 1);
		(m[1] === 'key' ? keys : rows).push(...strings.map(arg => scannedString(arg.text, arg.start)));
	}

	const problems = checkGrid(rows);
	if (rows.every(row => !row.value.isDynamic) && keys.every(key => !key.value.isDynamic)) {
		problems.push(...checkKeys(rows, keys));
	}
	return problems;
}

function scannedString(text: string, start: number): ScannedString {
	return { range: { start, end: start + text.length }, value: koreStringValueOf(text) };
}

function checkGrid(rows: ScannedString[]): RawProblem[] {
	const problems: RawProblem[] = [];
	const first = rows[0]?.value;
	const width = first && !first.isDynamic ? first.text.length : undefined;

	rows.forEach(({ range, value }, index) => {
		const report = (message: string) => problems.push({ message, range });
		if (index >= MAX_GRID_SIZE) {
			report(`A shaped recipe has at most ${MAX_GRID_SIZE} rows`);
		} else if (value.isDynamic) {
			return;
		} else if (value.text.length > MAX_GRID_SIZE) {
			report(`A pattern row has at most ${MAX_GRID_SIZE} characters`);
		} else if (value.text.length === 0) {
			report('A pattern row cannot be empty');
		} else if (width !== undefined && value.text.length !== width) {
			report(`Every row must be as wide as the first one (${width})`);
		}
	});
	return problems;
}

function checkKeys(rows: ScannedString[], keys: ScannedString[]): RawProblem[] {
	const problems: RawProblem[] = [];
	const declaredKeys = new Set(keys.map(key => key.value.text));
	const usedChars = new Set(rows.flatMap(row => [...row.value.text]).filter(c => c !== ' '));

	for (const { range, value } of rows) {
		const missing = [...new Set(value.text)].filter(c => c !== ' ' && !declaredKeys.has(c));
		if (missing.length > 0) {
			problems.push({ message: `No key defined for ${missing.map(c => `'${c}'`).join(', ')}`, range });
		}
	}

	for (const { range, value } of keys) {
		if (value.text.length !== 1) {
			problems.push({ message: 'A key is a single character', range });
		} else if (value.text === ' ') {
			problems.push({ message: 'A space is an empty slot and cannot be a key', range });
		} else if (rows.length > 0 && !usedChars.has(value.text)) {
			problems.push({ message: `Key '${value.text}' is not used in the pattern`, range, unused: true });
		}
	}
	return problems;
}

/** The subset of a resolved element the cross-file checks read. */
export interface InspectableElement {
	isDynamic: boolean;
	kindId: string;
	outputPath: string;
	resolvedDataPackName: string;
	resolvedNamespace: string;
	resourceLocation?: string;
}

/**
 * Two declarations writing the same file (`function("foo")` twice in one datapack, the same `predicate` in two
 * `DataPack.xxx()` extensions): Kore writes both and the last one generated silently wins. Dynamic names are
 * templates, and declarations whose datapack could not be attributed may live in different packs, so neither is
 * ever reported. `unknownDataPack` is the placeholder name those unattributed declarations carry.
 */
export function findDuplicateDeclarations<T extends InspectableElement>(elements: readonly T[], unknownDataPack: string): T[][] {
	const groups = Map.groupBy(
		elements.filter(e => !e.isDynamic && e.resolvedDataPackName !== unknownDataPack),
		e => `${e.resolvedDataPackName}\0${e.outputPath}`,
	);
	return [...groups.values()].filter(group => group.length > 1);
}

export function duplicateDeclarationMessage(element: InspectableElement, others: string[]): string {
	return `'${element.resourceLocation ?? element.outputPath}' is also declared at ${others.join(', ')}, the last one generated overwrites the others`;
}

/** A `function("x")` command call with its strings resolved: what `/function` will look up at runtime. */
export interface FunctionReference {
	group: boolean;
	name: string;
	namespace: string;
	/** The `function(namespace, name)` overload: the namespace was spelled in the call, not inherited. */
	namespaceFirst: boolean;
}

/** An unresolved reference and which quick fixes apply to it. */
export interface FunctionReferenceProblem {
	/** Namespaces declaring a same-kind target under exactly this name, for the "call `ns:...` instead" fix. */
	addNamespace: string[];
	/** Offer to insert an empty declaration of the missing function next to the caller's (never for a tag). */
	create: boolean;
	location: string;
	message: string;
	/** Declared paths within [MAX_SUGGESTION_DISTANCE] edits of the name, for the "change to" fix. */
	rename: string[];
	/** The call reads `function("tick", "minecraft")` but the overload is `(namespace, name)`. */
	swap: boolean;
}

export function functionLocationOf({ group, namespace, name }: FunctionReference): string {
	return `${group ? '#' : ''}${namespace}:${name}`;
}

/**
 * `function("helper")` inside a function body emits `/function <datapack>:helper` and nothing checks that such a
 * function exists: a typo, or a helper declared under another namespace, is a dead command at runtime. Nothing is
 * reported when the namespace is unknown to the project (another pack on the server) or holds a runtime-built
 * declaration (`function("gen_$i")`), which could be the target.
 */
export function checkFunctionReference(reference: FunctionReference, elements: readonly InspectableElement[]): FunctionReferenceProblem | undefined {
	const location = functionLocationOf(reference);
	const targets = elements.filter(e => isFunctionElement(e) || isFunctionTagElement(e));
	if (targets.some(t => t.resourceLocation === location)) {
		return undefined;
	}
	const sameKind = targets.filter(t => isFunctionTagElement(t) === reference.group);
	const message = `Function '${location}' is not declared in this project`;
	const none: FunctionReferenceProblem = { addNamespace: [], create: false, location, message, rename: [], swap: false };

	// `function("tick", "minecraft")`: the namespace is unknown to the project precisely because it is the name.
	if (reference.namespaceFirst && sameKind.some(t => t.resolvedNamespace === reference.name && pathOf(t) === reference.namespace)) {
		return { ...none, swap: true };
	}
	if (targets.some(t => t.resolvedNamespace === reference.namespace && t.isDynamic)) {
		return undefined;
	}
	if (!elements.some(e => e.resolvedNamespace === reference.namespace || e.resolvedDataPackName === reference.namespace)) {
		return undefined;
	}

	const rename = [...new Set(sameKind.filter(t => t.resolvedNamespace === reference.namespace).map(pathOf))]
		.filter(candidate => editDistance(candidate, reference.name) <= MAX_SUGGESTION_DISTANCE);
	const addNamespace = reference.namespaceFirst ? [] : [...new Set(sameKind.filter(t => pathOf(t) === reference.name).map(t => t.resolvedNamespace))];
	return { ...none, addNamespace, create: !reference.group, rename };
}

export function isFunctionElement(element: { kindId: string }): boolean {
	const kind = kindById(element.kindId);
	return kind !== undefined && isFunctionKind(kind);
}

export function isFunctionTagElement(element: { kindId: string }): boolean {
	return kindById(element.kindId)?.resourceFolder === FUNCTION_TAG_FOLDER;
}

/** The part after `ns:` (and `#`), i.e. what a call spells as its name, directory included. */
function pathOf(element: InspectableElement): string {
	const location = element.resourceLocation ?? '';
	return location.slice(location.indexOf(':') + 1);
}

/** Levenshtein distance, two rows at a time. */
export function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		previous = current;
	}
	return previous[b.length];
}

/**
 * Whether the call starting at `offset` is a statement of its block (IntelliJ: `parent is KtBlockExpression`) rather
 * than an argument or an initializer, so a sibling declaration can be inserted after it.
 */
export function isStatementStart(text: string, offset: number): boolean {
	const before = text.slice(Math.max(0, offset - 200), offset);
	if (STATEMENT_BOUNDARY_PATTERN.test(before)) {
		return true;
	}
	return before.includes('\n') && !OPERATOR_END_PATTERN.test(before);
}
