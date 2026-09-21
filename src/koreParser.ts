// Pure text scanner turning Kotlin source into Kore DSL declarations. No `vscode` dependency, no PSI: a
// single left-to-right pass tracking string/char/comment state (so braces inside `"{"` or `//` never confuse
// brace matching) plus a stack of open `(` / `{` groups, generalizing the old 2-pattern regex scan to every
// builder in koreDeclarations.ts. Mirrors KoreCallUtils.kt / KoreDeclarationData.kt from the IntelliJ plugin,
// minus the semantic `analyze { }` confirmation - see docs/feature-parity-plan.md for what that drops.

import { isFunctionKind, kindByBuilderName, KORE_SCOPES, type KoreDeclarationKind, type KoreScope } from './koreDeclarations';

const MAX_PLACEHOLDER_LENGTH = 80;

const NAME_PARAMETER_NAME = 'name';
const FILE_NAME_PARAMETER_NAME = 'fileName';
const NAMESPACE_PARAMETER_NAME = 'namespace';
const DIRECTORY_PARAMETER_NAME = 'directory';

// `function(name, namespace, directory) { }` - the only family passing them positionally rather than in the block.
const NAMESPACE_PARAMETER_INDEX = 1;
const DIRECTORY_PARAMETER_INDEX = 2;

const DATA_PACK_BUILDER_NAME = 'dataPack';
const FUN_KEYWORD = 'fun';

const NAMESPACE_STATEMENT_PATTERN = /^namespace\s*=(?!=)\s*([\s\S]+)$/;
const NAMED_ARG_PATTERN = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)\s*([\s\S]*)$/;
/** `fun DataPack.setup(` or `fun <T> DataPack.setup(`: the extension functions the call graph follows. */
const DATA_PACK_EXTENSION_PATTERN = /^fun\s+(?:<[^>]*>\s*)?DataPack\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
/** `val NAME = "..."` / `const val NAME: String = "..."`: the constants a dynamic name or namespace can resolve to. */
const STRING_CONSTANT_PATTERN = /^val\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*String)?\s*=\s*("(?:[^"\\\n]|\\.)*")/;
const VAL_KEYWORD = 'val';
/** How far past a `fun` / `val` keyword the declaration patterns look. */
const DECLARATION_LOOKAHEAD = 240;

export type KoreStringField = 'name' | 'namespace' | 'directory' | 'dataPackName';

export interface RawKoreDeclaration {
	kindId: string;
	name: string;
	namespace?: string;
	directory?: string;
	dataPackName?: string;
	/** The `fun DataPack.xxx()` body the call sits in when no `dataPack { }` block encloses it, for the call graph. */
	enclosingFunction?: string;
	/** At least one of name/namespace/directory/dataPackName could not be read as a plain string literal. */
	isDynamic: boolean;
	/** Which fields hold a source snippet instead of a literal, so the resolver knows what to try constants on. */
	dynamicFields: KoreStringField[];
	offset: number;
}

export interface OffsetRange {
	start: number;
	end: number;
}

/** A `fun DataPack.name() { }` declaration, spanning its body. */
export interface DataPackExtensionFunction extends OffsetRange {
	name: string;
}

/** A `dataPack(name) { }` block, spanning its body. `isDynamic` when the name isn't a literal. */
export interface DataPackBlock extends OffsetRange {
	name: string;
	isDynamic: boolean;
}

/** A plain `name(...)` / `name { }` call that isn't a Kore builder: a candidate extension-function call. */
export interface KotlinCall {
	name: string;
	offset: number;
}

/** Everything the workspace resolver needs from one Kotlin file. */
export interface ParsedKotlinFile {
	declarations: RawKoreDeclaration[];
	/** `val X = "literal"` bindings, last one wins on a duplicate name within the file. */
	constants: Map<string, string>;
	extensionFunctions: DataPackExtensionFunction[];
	/** Every `fun` name declared in the file, whatever its receiver: a call to one of them never leaves the file. */
	declaredFunctions: Set<string>;
	dataPackBlocks: DataPackBlock[];
	calls: KotlinCall[];
}

interface KoreStringValue {
	text: string;
	isDynamic: boolean;
}

interface ParsedArgs {
	positional: string[];
	named: Map<string, string>;
}

const SCOPES_BY_BUILDER_NAME = new Map(KORE_SCOPES.map(scope => [scope.builderName, scope]));
const SCOPES_BY_RECEIVER_NAME = new Map(KORE_SCOPES.map(scope => [scope.receiverName, scope]));

type ParenFrame = {
	kind: 'paren';
	calleeName?: string;
	/** The identifier before `.callee(`, e.g. `recipesBuilder` in `dp.recipesBuilder.smelting("x")`. */
	receiverName?: string;
	argStart: number;
	identStart: number;
	/** Set on the parameter list of a `fun DataPack.<name>(` declaration, so its body can be tracked. */
	declaresExtension?: string;
};

type BraceFrame = {
	kind: 'brace';
	calleeName?: string;
	declarationKind?: KoreDeclarationKind;
	args?: ParsedArgs;
	bodyStart: number;
	callOffset: number;
	dataPackName?: KoreStringValue;
	/** The body of a `fun DataPack.<name>() { }`. */
	extensionFunction?: string;
};

type GroupFrame = ParenFrame | BraceFrame;

/** Scans Kotlin source text for every Kore DSL builder call in koreDeclarations.ts, syntactically only. */
export function parseKoreDeclarations(text: string): RawKoreDeclaration[] {
	return parseKotlinFile(text).declarations;
}

/** [parseKoreDeclarations] plus the constants, `DataPack.` extension functions, `dataPack { }` blocks and calls. */
export function parseKotlinFile(text: string): ParsedKotlinFile {
	const results: RawKoreDeclaration[] = [];
	const constants = new Map<string, string>();
	const extensionFunctions: DataPackExtensionFunction[] = [];
	const declaredFunctions = new Set<string>();
	const dataPackBlocks: DataPackBlock[] = [];
	const calls: KotlinCall[] = [];
	const stack: GroupFrame[] = [];
	const len = text.length;
	let i = 0;
	let declaringFunction = false;
	let pendingExtension: string | undefined;

	while (i < len) {
		const c = text[i];

		if (isWhitespace(c)) {
			i++;
			continue;
		}

		if (c === '"') {
			i = skipStringLiteral(text, i);
			continue;
		}

		if (c === "'") {
			i = skipCharLiteral(text, i);
			continue;
		}

		if (c === '/' && text[i + 1] === '/') {
			i = skipToLineEnd(text, i);
			continue;
		}

		if (c === '/' && text[i + 1] === '*') {
			i = skipBlockComment(text, i);
			continue;
		}

		if (isIdentifierStart(c)) {
			const identStart = i;
			let j = i + 1;
			while (j < len && isIdentifierPart(text[j])) {
				j++;
			}
			const ident = text.slice(identStart, j);
			i = j;

			if (ident === FUN_KEYWORD) {
				declaringFunction = true;
				pendingExtension = DATA_PACK_EXTENSION_PATTERN.exec(text.slice(identStart, identStart + DECLARATION_LOOKAHEAD))?.[1];
				continue;
			}

			if (ident === VAL_KEYWORD) {
				const m = STRING_CONSTANT_PATTERN.exec(text.slice(identStart, identStart + DECLARATION_LOOKAHEAD));
				const value = m ? evaluateStringLiteral(m[2]) : undefined;
				if (m && value && !value.isDynamic) {
					constants.set(m[1], value.text);
				}
				continue;
			}

			const k = skipWhitespaceAndComments(text, i);
			if (text[k] === '(') {
				// `fun DataPack.tick(name: String) {` declares a builder, it does not call one: keep the callee anonymous.
				const calleeName = declaringFunction ? undefined : ident;
				const declaresExtension = declaringFunction ? pendingExtension : undefined;
				if (declaringFunction) {
					declaredFunctions.add(ident);
				}
				declaringFunction = false;
				pendingExtension = undefined;
				stack.push({ kind: 'paren', calleeName, declaresExtension, receiverName: receiverBefore(text, identStart), argStart: k + 1, identStart });
				i = k + 1;
			} else if (text[k] === '{') {
				// `recipes { }` - a lambda-only call, kept on the stack so scoped builders inside can see their scope.
				stack.push({ kind: 'brace', calleeName: ident, bodyStart: k + 1, callOffset: identStart });
				if (isCandidateCall(ident)) {
					calls.push({ name: ident, offset: identStart });
				}
				i = k + 1;
			}
			continue;
		}

		if (c === '(') {
			stack.push({ kind: 'paren', argStart: i + 1, identStart: i });
			i++;
			continue;
		}

		if (c === ')') {
			const frame = stack.pop();
			const argsText = frame?.kind === 'paren' ? text.slice(frame.argStart, i) : undefined;
			i++;

			if (frame?.kind === 'paren' && frame.declaresExtension) {
				// Past the parameter list: an optional `: ReturnType`, then the body. `= expr` bodies declare nothing.
				const k = skipReturnType(text, skipWhitespaceAndComments(text, i));
				if (text[k] === '{') {
					stack.push({ kind: 'brace', bodyStart: k + 1, callOffset: frame.identStart, extensionFunction: frame.declaresExtension });
					i = k + 1;
				}
				continue;
			}

			if (frame?.kind === 'paren' && frame.calleeName) {
				const k = skipWhitespaceAndComments(text, i);
				const declarationKind = kindByBuilderName(frame.calleeName, activeScopes(stack, frame.receiverName));
				const hasBlock = text[k] === '{';

				if (isCandidateCall(frame.calleeName)) {
					calls.push({ name: frame.calleeName, offset: frame.identStart });
				}

				if (!hasBlock && declarationKind?.scope) {
					// Scoped builders default their lambda (`single("x", Enchantments.PIERCING)`), the scope is proof enough.
					const decl = buildDeclaration(frame.identStart, declarationKind, parseArgs(argsText ?? ''), '', stack);
					if (decl) {
						results.push(decl);
					}
				}

				if (hasBlock) {
					const args = parseArgs(argsText ?? '');
					const braceFrame: BraceFrame = {
						kind: 'brace',
						calleeName: frame.calleeName,
						declarationKind,
						args,
						bodyStart: k + 1,
						callOffset: frame.identStart,
					};

					if (frame.calleeName === DATA_PACK_BUILDER_NAME) {
						const nameArg = declarationNameArgument(args);
						braceFrame.dataPackName = nameArg !== undefined ? koreStringValueOf(nameArg) : undefined;
					}

					stack.push(braceFrame);
					i = k + 1;
				}
			}
			continue;
		}

		if (c === '{') {
			stack.push({ kind: 'brace', bodyStart: i + 1, callOffset: -1 });
			i++;
			continue;
		}

		if (c === '}') {
			const frame = stack.pop();
			const bodyText = frame?.kind === 'brace' ? text.slice(frame.bodyStart, i) : undefined;
			i++;

			if (frame?.kind === 'brace' && frame.declarationKind && frame.args && bodyText !== undefined) {
				const decl = buildDeclaration(frame.callOffset, frame.declarationKind, frame.args, bodyText, stack);
				if (decl) {
					results.push(decl);
				}
			}
			if (frame?.kind === 'brace' && frame.extensionFunction) {
				extensionFunctions.push({ name: frame.extensionFunction, start: frame.bodyStart, end: i - 1 });
			}
			if (frame?.kind === 'brace' && frame.calleeName === DATA_PACK_BUILDER_NAME && frame.dataPackName) {
				dataPackBlocks.push({ name: frame.dataPackName.text, isDynamic: frame.dataPackName.isDynamic, start: frame.bodyStart, end: i - 1 });
			}
			continue;
		}

		i++;
	}

	return { declarations: results, constants, extensionFunctions, declaredFunctions, dataPackBlocks, calls };
}

/** Skips a `: ReturnType` (generics, nullable, qualified names included) after a parameter list. */
function skipReturnType(text: string, i: number): number {
	if (text[i] !== ':') {
		return i;
	}
	let j = i + 1;
	let depth = 0;
	while (j < text.length) {
		const c = text[j];
		if (c === '<') {
			depth++;
		} else if (c === '>') {
			depth--;
		} else if (depth === 0 && (c === '{' || c === '=' || c === '\n')) {
			break;
		}
		j++;
	}
	return skipWhitespaceAndComments(text, j);
}

/** Constructors and Kore builders are never extension-function calls; lowercase, non-builder names might be. */
function isCandidateCall(name: string): boolean {
	return name[0] >= 'a' && name[0] <= 'z' && name !== DATA_PACK_BUILDER_NAME && kindByBuilderName(name) === undefined;
}

function declarationNameArgument(args: ParsedArgs): string | undefined {
	return args.named.get(NAME_PARAMETER_NAME) ?? args.named.get(FILE_NAME_PARAMETER_NAME) ?? args.positional[0];
}

/** The scopes a call at the top of `stack` sits in: every enclosing `recipes { }` block plus a `recipesBuilder.` receiver. */
function activeScopes(stack: GroupFrame[], receiverName: string | undefined): Set<KoreScope> {
	const scopes = new Set<KoreScope>();
	for (const frame of stack) {
		const scope = frame.kind === 'brace' && frame.calleeName ? SCOPES_BY_BUILDER_NAME.get(frame.calleeName) : undefined;
		if (scope) {
			scopes.add(scope);
		}
	}
	const receiverScope = receiverName ? SCOPES_BY_RECEIVER_NAME.get(receiverName) : undefined;
	if (receiverScope) {
		scopes.add(receiverScope);
	}
	return scopes;
}

/** The identifier ending right before `.` at `identStart - 1`, so `a.b(` yields `a`. Safe-call `?.` counts too. */
function receiverBefore(text: string, identStart: number): string | undefined {
	let end = identStart - 1;
	if (text[end] !== '.') {
		return undefined;
	}
	if (text[end - 1] === '?') {
		end--;
	}
	let start = end;
	while (start > 0 && isIdentifierPart(text[start - 1])) {
		start--;
	}
	return start < end ? text.slice(start, end) : undefined;
}

function buildDeclaration(
	callOffset: number,
	kind: KoreDeclarationKind,
	args: ParsedArgs,
	bodyText: string,
	ancestors: GroupFrame[],
): RawKoreDeclaration | undefined {
	const nameArg = declarationNameArgument(args);
	if (nameArg === undefined) {
		return undefined;
	}
	const nameValue = koreStringValueOf(nameArg);

	const namespaceArg = args.named.get(NAMESPACE_PARAMETER_NAME)
		?? (isFunctionKind(kind) ? args.positional[NAMESPACE_PARAMETER_INDEX] : undefined);
	const namespaceValue = namespaceArg !== undefined ? koreStringValueOf(namespaceArg) : namespaceAssignmentInBody(bodyText);

	let directoryValue: KoreStringValue | undefined;
	if (isFunctionKind(kind)) {
		const directoryArg = args.named.get(DIRECTORY_PARAMETER_NAME) ?? args.positional[DIRECTORY_PARAMETER_INDEX];
		directoryValue = directoryArg !== undefined ? koreStringValueOf(directoryArg) : undefined;
	}

	const dataPackValue = kind.id === 'DATA_PACK' ? nameValue : nearestEnclosingDataPackName(ancestors);
	const enclosingFunction = dataPackValue ? undefined : nearestEnclosingExtensionFunction(ancestors);

	const fields: [KoreStringField, KoreStringValue | undefined][] = [
		['name', nameValue], ['namespace', namespaceValue], ['directory', directoryValue], ['dataPackName', dataPackValue],
	];
	const dynamicFields = fields.filter(([, value]) => value?.isDynamic).map(([field]) => field);

	return {
		kindId: kind.id,
		name: nameValue.text,
		namespace: namespaceValue?.text,
		directory: directoryValue?.text,
		dataPackName: dataPackValue?.text,
		enclosingFunction,
		isDynamic: dynamicFields.length > 0,
		dynamicFields,
		offset: callOffset,
	};
}

function nearestEnclosingDataPackName(ancestors: GroupFrame[]): KoreStringValue | undefined {
	for (let idx = ancestors.length - 1; idx >= 0; idx--) {
		const ancestor = ancestors[idx];
		if (ancestor.kind === 'brace' && ancestor.calleeName === DATA_PACK_BUILDER_NAME && ancestor.dataPackName) {
			return ancestor.dataPackName;
		}
	}
	return undefined;
}

function nearestEnclosingExtensionFunction(ancestors: GroupFrame[]): string | undefined {
	for (let idx = ancestors.length - 1; idx >= 0; idx--) {
		const ancestor = ancestors[idx];
		if (ancestor.kind === 'brace' && ancestor.extensionFunction) {
			return ancestor.extensionFunction;
		}
	}
	return undefined;
}

/**
 * `namespace = "..."` assigned at the top level of a block's body (depth 0, not inside a nested block/call) -
 * how every generator outside the function family sets its namespace. Takes the last match, same as the
 * reference plugin's `namespaceAssignmentInBlock`.
 */
function namespaceAssignmentInBody(bodyText: string): KoreStringValue | undefined {
	let depth = 0;
	let stmtStart = 0;
	let lastMatch: KoreStringValue | undefined;
	const len = bodyText.length;
	let i = 0;

	const checkStatement = (raw: string) => {
		const m = NAMESPACE_STATEMENT_PATTERN.exec(raw.trim());
		if (m) {
			lastMatch = koreStringValueOf(m[1].trim());
		}
	};

	while (i < len) {
		const c = bodyText[i];

		if (c === '"') {
			i = skipStringLiteral(bodyText, i);
			continue;
		}
		if (c === "'") {
			i = skipCharLiteral(bodyText, i);
			continue;
		}
		if (c === '/' && bodyText[i + 1] === '/') {
			i = skipToLineEnd(bodyText, i);
			continue;
		}
		if (c === '/' && bodyText[i + 1] === '*') {
			i = skipBlockComment(bodyText, i);
			continue;
		}
		if (c === '(' || c === '[' || c === '{') {
			depth++;
			i++;
			continue;
		}
		if (c === ')' || c === ']' || c === '}') {
			depth--;
			i++;
			continue;
		}
		if (depth === 0 && (c === '\n' || c === ';')) {
			checkStatement(bodyText.slice(stmtStart, i));
			i++;
			stmtStart = i;
			continue;
		}
		i++;
	}
	checkStatement(bodyText.slice(stmtStart));

	return lastMatch;
}

/** Splits a call's raw argument-list text into positional args and `name = value` named args. */
function parseArgs(argsText: string): ParsedArgs {
	const positional: string[] = [];
	const named = new Map<string, string>();
	for (const part of splitTopLevelArgs(argsText)) {
		if (part.startsWith('{')) {
			// A lambda passed inline (not as the trailing block) - never a name/namespace/directory value.
			continue;
		}

		const m = NAMED_ARG_PATTERN.exec(part);
		if (m) {
			named.set(m[1], m[2].trim());
		} else {
			positional.push(part);
		}
	}

	return { positional, named };
}

function splitTopLevelArgs(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	let i = 0;
	const len = text.length;

	while (i < len) {
		const c = text[i];

		if (c === '"') {
			i = skipStringLiteral(text, i);
			continue;
		}
		if (c === "'") {
			i = skipCharLiteral(text, i);
			continue;
		}
		if (c === '/' && text[i + 1] === '/') {
			i = skipToLineEnd(text, i);
			continue;
		}
		if (c === '/' && text[i + 1] === '*') {
			i = skipBlockComment(text, i);
			continue;
		}
		if (c === '(' || c === '[' || c === '{') {
			depth++;
			i++;
			continue;
		}
		if (c === ')' || c === ']' || c === '}') {
			depth--;
			i++;
			continue;
		}
		if (c === ',' && depth === 0) {
			parts.push(text.slice(start, i));
			i++;
			start = i;
			continue;
		}
		i++;
	}

	const last = text.slice(start);
	if (last.trim() !== '' || parts.length > 0) {
		parts.push(last);
	}

	return parts.map(p => p.trim()).filter(p => p !== '');
}

/**
 * Reads a raw argument's text as a string, following Kotlin string-template escapes/interpolation. Falls back
 * to a clipped, whitespace-collapsed source snippet (marked dynamic) for anything that isn't a bare literal -
 * a call, a constant reference, string concatenation - same fallback the reference plugin uses.
 */
function koreStringValueOf(raw: string): KoreStringValue {
	return evaluateStringLiteral(raw) ?? placeholder(raw);
}

function placeholder(raw: string): KoreStringValue {
	return { text: raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PLACEHOLDER_LENGTH), isDynamic: true };
}

function evaluateStringLiteral(raw: string): KoreStringValue | undefined {
	const trimmed = raw.trim();
	if (!trimmed.startsWith('"')) {
		return undefined;
	}

	// Not a bare literal (string concatenation, trailing content, ...) - caller falls back to a placeholder.
	if (skipStringLiteral(trimmed, 0) !== trimmed.length) {
		return undefined;
	}

	const triple = trimmed.startsWith('"""');
	const quoteLen = triple ? 3 : 1;
	const content = trimmed.slice(quoteLen, trimmed.length - quoteLen);

	let output = '';
	let dynamic = false;
	let i = 0;
	while (i < content.length) {
		const c = content[i];

		if (!triple && c === '\\') {
			const { text: unescaped, length } = unescapeChar(content, i);
			output += unescaped;
			i += length;
			continue;
		}

		if (c === '$' && content[i + 1] === '{') {
			const entryEnd = skipInterpolationBraces(content, i + 1);
			output += content.slice(i, entryEnd);
			dynamic = true;
			i = entryEnd;
			continue;
		}

		if (c === '$' && isIdentifierStart(content[i + 1] ?? '')) {
			let j = i + 1;
			while (j < content.length && isIdentifierPart(content[j])) {
				j++;
			}
			output += content.slice(i, j);
			dynamic = true;
			i = j;
			continue;
		}

		output += c;
		i++;
	}

	return { text: output, isDynamic: dynamic };
}

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', '\\': '\\', '"': '"', "'": "'", $: '$' };

function unescapeChar(content: string, i: number): { text: string; length: number } {
	const c = content[i + 1];
	if (c === 'u') {
		const hex = content.slice(i + 2, i + 6);
		const code = parseInt(hex, 16);
		return { text: Number.isNaN(code) ? '' : String.fromCharCode(code), length: 6 };
	}
	if (c !== undefined && c in SIMPLE_ESCAPES) {
		return { text: SIMPLE_ESCAPES[c], length: 2 };
	}
	return { text: c ?? '', length: 2 };
}

function skipInterpolationBraces(text: string, openBraceIndex: number): number {
	let depth = 1;
	let j = openBraceIndex + 1;
	const len = text.length;
	while (j < len && depth > 0) {
		const c = text[j];
		if (c === '"') {
			j = skipStringLiteral(text, j);
			continue;
		}
		if (c === "'") {
			j = skipCharLiteral(text, j);
			continue;
		}
		if (c === '{') {
			depth++;
		} else if (c === '}') {
			depth--;
		}
		j++;
	}
	return j;
}

function skipStringLiteral(text: string, i: number): number {
	const triple = text.slice(i, i + 3) === '"""';
	let j = i + (triple ? 3 : 1);
	const len = text.length;

	while (j < len) {
		const c = text[j];

		if (triple) {
			if (c === '"' && text[j + 1] === '"' && text[j + 2] === '"') {
				return j + 3;
			}
		} else {
			if (c === '\\') {
				j += 2;
				continue;
			}
			if (c === '"') {
				return j + 1;
			}
			if (c === '\n') {
				return j; // unterminated single-line string, bail out safely
			}
		}

		if (c === '$' && text[j + 1] === '{') {
			j = skipInterpolationBraces(text, j + 1);
			continue;
		}
		j++;
	}

	return len;
}

function skipCharLiteral(text: string, i: number): number {
	let j = i + 1;
	if (text[j] === '\\') {
		j += text[j + 1] === 'u' ? 6 : 2;
	} else {
		j += 1;
	}
	return text[j] === "'" ? j + 1 : i + 1;
}

function skipToLineEnd(text: string, i: number): number {
	let j = i;
	while (j < text.length && text[j] !== '\n') {
		j++;
	}
	return j;
}

function skipBlockComment(text: string, i: number): number {
	let j = i + 2;
	while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) {
		j++;
	}
	return Math.min(j + 2, text.length);
}

function skipWhitespaceAndComments(text: string, i: number): number {
	let j = i;
	for (;;) {
		if (j >= text.length) {
			return j;
		}
		if (isWhitespace(text[j])) {
			j++;
			continue;
		}
		if (text[j] === '/' && text[j + 1] === '/') {
			j = skipToLineEnd(text, j);
			continue;
		}
		if (text[j] === '/' && text[j + 1] === '*') {
			j = skipBlockComment(text, j);
			continue;
		}
		return j;
	}
}

// Char-code tests rather than one-char regexes: these run once per character of every scanned file.
function isWhitespace(c: string): boolean {
	return c <= ' ' || (c > '\x7f' && /\s/.test(c));
}

function isIdentifierStart(c: string): boolean {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}

function isIdentifierPart(c: string): boolean {
	return isIdentifierStart(c) || (c >= '0' && c <= '9');
}
