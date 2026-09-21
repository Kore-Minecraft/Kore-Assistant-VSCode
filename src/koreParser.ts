/**
 * Pure text scanner turning Kotlin source into Kore DSL declarations, with no `vscode` dependency and no PSI: one
 * left-to-right pass tracking string/char/comment state (so braces inside `"{"` or `//` never confuse brace
 * matching) plus a stack of open `(` / `{` groups. Mirrors KoreCallUtils.kt / KoreDeclarationData.kt from the
 * IntelliJ plugin, minus the semantic `analyze { }` confirmation, see docs/feature-parity-plan.md.
 */

import { isFunctionKind, kindByBuilderName, KORE_SCOPES, type KoreDeclarationKind, type KoreScope } from './koreDeclarations';

const MAX_PLACEHOLDER_LENGTH = 80;

const NAME_PARAMETER_NAME = 'name';
const FILE_NAME_PARAMETER_NAME = 'fileName';
const NAMESPACE_PARAMETER_NAME = 'namespace';
const DIRECTORY_PARAMETER_NAME = 'directory';
const GROUP_PARAMETER_NAME = 'group';

/** `function(name, namespace, directory) { }`, the only family passing them positionally rather than in the block. */
const NAMESPACE_PARAMETER_INDEX = 1;
const DIRECTORY_PARAMETER_INDEX = 2;

const CONTEXT_KEYWORD = 'context';
const DATA_PACK_BUILDER_NAME = 'dataPack';
const FUNCTION_BUILDER_NAME = 'function';
const FUN_KEYWORD = 'fun';
const VAL_KEYWORD = 'val';

const NAMESPACE_STATEMENT_PATTERN = /^namespace\s*=(?!=)\s*([\s\S]+)$/;
/** `import io.github.ayfri.kore.commands.function as callFunction`: the command called under another name in this file. */
const FUNCTION_COMMAND_ALIAS_PATTERN = /^[ \t]*import\s+io\.github\.ayfri\.kore\.commands\.function\s+as\s+([A-Za-z_][A-Za-z0-9_]*)/m;
const NAMED_ARG_PATTERN = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)\s*([\s\S]*)$/;
/** `fun DataPack.setup(` or `fun <T> DataPack.setup(`: the receiver form of a datapack extension function. */
const DATA_PACK_RECEIVER_PATTERN = /^fun\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][A-Za-z0-9_.]*\.)?DataPack\.[A-Za-z_][A-Za-z0-9_]*\s*\(/;
/** A `x: DataPack` value parameter, matched on the type's last segment like IntelliJ. */
const DATA_PACK_PARAMETER_PATTERN = /:\s*(?:[A-Za-z_][A-Za-z0-9_.]*\.)?DataPack\b(?!\.)/;
/** `context(dp: DataPack)` or the older `context(DataPack)` receiver form. */
const DATA_PACK_CONTEXT_PATTERN = /(?:^|[,:])\s*(?:[A-Za-z_][A-Za-z0-9_.]*\.)?DataPack\b(?!\.)/;
/** `val NAME = ` / `const val NAME: String = `, whatever the initializer, up to and including the `=`. */
const VAL_DECLARATION_PATTERN = /^val\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[A-Za-z_][A-Za-z0-9_.]*\??)?\s*=(?!=)/;
/** A bare or dot-qualified reference such as `NAME` or `Constants.NAMESPACE`. */
const REFERENCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/;
/** How far past a `fun` / `val` keyword the declaration patterns look. */
const DECLARATION_LOOKAHEAD = 240;

export type KoreStringField = 'dataPackName' | 'directory' | 'name' | 'namespace';

export interface OffsetRange {
	end: number;
	start: number;
}

/** A string read from source: either a literal's value, or a snippet still holding references (`$X`, `NAME`). */
export interface KoreStringValue {
	isDynamic: boolean;
	text: string;
}

/** `R` is the range type: source offsets straight out of the scanner, editor ranges once a file is stored. */
export interface RawKoreDeclaration<R = OffsetRange> {
	/** The trailing lambda's body, `undefined` for a block-less scoped builder call. */
	bodyRange?: R;
	dataPackName?: string;
	directory?: string;
	/** Which fields hold a source snippet instead of a literal, so the resolver knows what to try constants on. */
	dynamicFields: KoreStringField[];
	/** The `fun DataPack.xxx()` body the call sits in when no `dataPack { }` block encloses it, for the call graph. */
	enclosingFunction?: string;
	/** At least one of name/namespace/directory/dataPackName could not be read as a plain string literal. */
	isDynamic: boolean;
	kindId: string;
	name: string;
	/** The name argument's expression text, for diagnostics. */
	nameArgRange: R;
	namespace?: string;
	/** Offset of the builder identifier. */
	offset: number;
}

/** A `fun DataPack.name() { }` (or `fun name(dp: DataPack)`, `context(dp: DataPack) fun name()`) declaration, spanning its body. */
export interface DataPackExtensionFunction extends OffsetRange {
	name: string;
}

/** A `dataPack(name) { }` block, spanning its body. `isDynamic` when the name isn't a literal. */
export interface DataPackBlock extends OffsetRange {
	isDynamic: boolean;
	name: string;
}

/** A `val NAME = <expr>` binding whose initializer is a string literal, a reference, or a concatenation of those. */
export interface KotlinConstant extends KoreStringValue {
	name: string;
	/** Offset of the `val` keyword, so a reference picks the closest binding declared before it. */
	offset: number;
	/** Offset of the `}` closing the block declaring it, `undefined` at file level, so a local stops shadowing past it. */
	scopeEnd?: number;
}

/** A plain `name(...)` / `name { }` call that isn't a Kore builder: a candidate extension-function call. */
export interface KotlinCall {
	name: string;
	offset: number;
}

/**
 * A `function("x")` command call (no trailing lambda) inside a function-family declaration body. Kore's command
 * overloads are `function(name, group = false)` and `function(namespace, name, group = false)`, namespace FIRST,
 * the reverse of the declaration's `function(name, namespace, directory)`.
 */
export interface RawFunctionCommand<R = OffsetRange> {
	/** The whole argument list, between the parentheses. */
	argsRange: R;
	/** Which of name/namespace hold a reference rather than a literal, for the resolver. */
	dynamicFields: KoreStringField[];
	/** Offset of the enclosing function-family declaration's builder identifier. */
	enclosingDeclarationOffset: number;
	/** `true` only when the group argument is literally `true`. */
	group: boolean;
	isDynamic: boolean;
	name: string;
	nameArgRange: R;
	namespace?: string;
	namespaceArgRange?: R;
	/** The call passes two positional strings, so the first one is the namespace. */
	namespaceFirst: boolean;
	offset: number;
}

/** Everything the workspace resolver and the inspections need from one Kotlin file. */
export interface ParsedKotlinFile {
	calls: KotlinCall[];
	/** In source order; a reference resolves to the closest binding declared before it. */
	constants: KotlinConstant[];
	dataPackBlocks: DataPackBlock[];
	/** Every `fun` name declared in the file, whatever its receiver: a call to one of them never leaves the file. */
	declaredFunctions: Set<string>;
	declarations: RawKoreDeclaration[];
	extensionFunctions: DataPackExtensionFunction[];
	functionCommands: RawFunctionCommand[];
}

export interface RawArg {
	start: number;
	text: string;
}

export interface ParsedArgs {
	named: Map<string, RawArg>;
	positional: RawArg[];
}

const SCOPES_BY_BUILDER_NAME = new Map(KORE_SCOPES.map(scope => [scope.builderName, scope]));
const SCOPES_BY_RECEIVER_NAME = new Map(KORE_SCOPES.map(scope => [scope.receiverName, scope]));

type ParenFrame = {
	argStart: number;
	calleeName?: string;
	/** Set on the parameter list of a `fun <name>(` declaration, with whether it takes the datapack as receiver/context. */
	declaresFunction?: { isDataPackExtension: boolean; name: string };
	identStart: number;
	kind: 'paren';
	/** The identifier before `.callee(`, e.g. `recipesBuilder` in `dp.recipesBuilder.smelting("x")`. */
	receiverName?: string;
};

type BraceFrame = {
	args?: ParsedArgs;
	bodyStart: number;
	calleeName?: string;
	callOffset: number;
	dataPackName?: KoreStringValue;
	declarationKind?: KoreDeclarationKind;
	/** The body of a datapack extension function. */
	extensionFunction?: string;
	kind: 'brace';
};

type GroupFrame = BraceFrame | ParenFrame;

/** Scans Kotlin source text for every Kore DSL builder call in koreDeclarations.ts, syntactically only. */
export function parseKotlinFile(text: string): ParsedKotlinFile {
	const parsed: ParsedKotlinFile = {
		calls: [],
		constants: [],
		dataPackBlocks: [],
		declaredFunctions: new Set(),
		declarations: [],
		extensionFunctions: [],
		functionCommands: [],
	};
	const stack: GroupFrame[] = [];
	const len = text.length;
	const commandAlias = FUNCTION_COMMAND_ALIAS_PATTERN.exec(text)?.[1];
	let i = 0;
	let declaringFunction = false;
	let pendingDataPackExtension = false;

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
				pendingDataPackExtension ||= DATA_PACK_RECEIVER_PATTERN.test(text.slice(identStart, identStart + DECLARATION_LOOKAHEAD));
				continue;
			}

			if (ident === VAL_KEYWORD) {
				const m = VAL_DECLARATION_PATTERN.exec(text.slice(identStart, identStart + DECLARATION_LOOKAHEAD));
				if (m) {
					const initializerStart = identStart + m[0].length;
					const value = evaluateStringExpression(text.slice(initializerStart, initializerEnd(text, initializerStart)));
					if (value) {
						parsed.constants.push({ name: m[1], offset: identStart, ...value });
					}
				}
				continue;
			}

			const k = skipWhitespaceAndComments(text, i);
			if (text[k] === '(') {
				// `fun DataPack.tick(name: String) {` declares a builder, it does not call one: keep the callee anonymous.
				const declaresFunction = declaringFunction ? { isDataPackExtension: pendingDataPackExtension, name: ident } : undefined;
				if (declaresFunction) {
					parsed.declaredFunctions.add(ident);
					pendingDataPackExtension = false;
				}
				declaringFunction = false;
				stack.push({ kind: 'paren', calleeName: declaresFunction ? undefined : ident, declaresFunction, receiverName: receiverBefore(text, identStart), argStart: k + 1, identStart });
				i = k + 1;
			} else if (text[k] === '{') {
				// `recipes { }`, a lambda-only call, kept on the stack so scoped builders inside can see their scope.
				stack.push({ kind: 'brace', calleeName: ident, bodyStart: k + 1, callOffset: identStart });
				if (isCandidateCall(ident)) {
					parsed.calls.push({ name: ident, offset: identStart });
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
			const argsEnd = i;
			i++;
			if (frame?.kind !== 'paren') {
				continue;
			}
			const argsText = text.slice(frame.argStart, argsEnd);

			if (frame.declaresFunction) {
				// Past the parameter list: an optional `: ReturnType`, then the body. `= expr` bodies declare nothing.
				const k = skipReturnType(text, skipWhitespaceAndComments(text, i));
				const extensionFunction = frame.declaresFunction.isDataPackExtension || DATA_PACK_PARAMETER_PATTERN.test(argsText) ? frame.declaresFunction.name : undefined;
				if (text[k] === '{') {
					stack.push({ kind: 'brace', bodyStart: k + 1, callOffset: frame.identStart, extensionFunction });
					i = k + 1;
				}
				continue;
			}

			// `context(dp: DataPack) fun setup()`: a context parameter makes the next function a datapack extension.
			if (frame.calleeName === CONTEXT_KEYWORD && !frame.receiverName) {
				pendingDataPackExtension = DATA_PACK_CONTEXT_PATTERN.test(argsText);
				continue;
			}

			if (!frame.calleeName) {
				continue;
			}

			const k = skipWhitespaceAndComments(text, i);
			const declarationKind = kindByBuilderName(frame.calleeName, activeScopes(stack, frame.receiverName));
			const hasBlock = text[k] === '{';

			if (isCandidateCall(frame.calleeName)) {
				parsed.calls.push({ name: frame.calleeName, offset: frame.identStart });
			}

			if (hasBlock) {
				const args = parseArgs(argsText, frame.argStart);
				const braceFrame: BraceFrame = { kind: 'brace', calleeName: frame.calleeName, declarationKind, args, bodyStart: k + 1, callOffset: frame.identStart };
				if (frame.calleeName === DATA_PACK_BUILDER_NAME) {
					const nameArg = declarationNameArgument(args);
					braceFrame.dataPackName = nameArg && koreStringValueOf(nameArg.text);
				}
				stack.push(braceFrame);
				i = k + 1;
				continue;
			}

			if (declarationKind?.scope) {
				// Scoped builders default their lambda (`single("x", Enchantments.PIERCING)`), the scope is proof enough.
				const decl = buildDeclaration(frame.identStart, declarationKind, parseArgs(argsText, frame.argStart), '', stack);
				if (decl) {
					parsed.declarations.push(decl);
				}
			} else if ((frame.calleeName === FUNCTION_BUILDER_NAME || frame.calleeName === commandAlias) && !frame.receiverName) {
				const enclosing = nearestDeclarationFrame(stack);
				if (enclosing?.declarationKind && isFunctionKind(enclosing.declarationKind)) {
					const command = functionCommandOf(parseArgs(argsText, frame.argStart), frame.identStart, { start: frame.argStart, end: argsEnd }, enclosing.callOffset);
					if (command) {
						parsed.functionCommands.push(command);
					}
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
			const bodyEnd = i;
			i++;
			if (frame?.kind !== 'brace') {
				continue;
			}
			const bodyRange = { start: frame.bodyStart, end: bodyEnd };

			for (let idx = parsed.constants.length - 1; idx >= 0 && parsed.constants[idx].offset > frame.bodyStart; idx--) {
				parsed.constants[idx].scopeEnd ??= bodyEnd;
			}
			if (frame.declarationKind && frame.args) {
				const decl = buildDeclaration(frame.callOffset, frame.declarationKind, frame.args, text.slice(bodyRange.start, bodyRange.end), stack, bodyRange);
				if (decl) {
					parsed.declarations.push(decl);
				}
			}
			if (frame.extensionFunction) {
				parsed.extensionFunctions.push({ name: frame.extensionFunction, ...bodyRange });
			}
			if (frame.calleeName === DATA_PACK_BUILDER_NAME && frame.dataPackName) {
				parsed.dataPackBlocks.push({ name: frame.dataPackName.text, isDynamic: frame.dataPackName.isDynamic, ...bodyRange });
			}
			continue;
		}

		i++;
	}

	return parsed;
}

/** Where a `val` initializer ends: the first `;` or newline at depth 0, unless the line ends with a `+` continuation. */
function initializerEnd(text: string, start: number): number {
	return scanTopLevel(text, start, (c, i) => c === ';' || (c === '\n' && text[lastNonWhitespaceBefore(text, i)] !== '+'));
}

function lastNonWhitespaceBefore(text: string, i: number): number {
	let j = i - 1;
	while (j >= 0 && isWhitespace(text[j])) {
		j--;
	}
	return j;
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

function declarationNameArgument(args: ParsedArgs): RawArg | undefined {
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

function rangeOf(arg: RawArg): OffsetRange {
	return { start: arg.start, end: arg.start + arg.text.length };
}

function buildDeclaration(
	callOffset: number,
	kind: KoreDeclarationKind,
	args: ParsedArgs,
	bodyText: string,
	ancestors: GroupFrame[],
	bodyRange?: OffsetRange,
): RawKoreDeclaration | undefined {
	const nameArg = declarationNameArgument(args);
	if (nameArg === undefined) {
		return undefined;
	}
	const nameValue = koreStringValueOf(nameArg.text);

	const namespaceArg = args.named.get(NAMESPACE_PARAMETER_NAME)
		?? (isFunctionKind(kind) ? args.positional[NAMESPACE_PARAMETER_INDEX] : undefined);
	const namespaceValue = namespaceArg ? koreStringValueOf(namespaceArg.text) : namespaceAssignmentInBody(bodyText);

	let directoryValue: KoreStringValue | undefined;
	if (isFunctionKind(kind)) {
		const directoryArg = args.named.get(DIRECTORY_PARAMETER_NAME) ?? args.positional[DIRECTORY_PARAMETER_INDEX];
		directoryValue = directoryArg && koreStringValueOf(directoryArg.text);
	}

	const dataPackValue = kind.id === 'DATA_PACK' ? nameValue : nearestEnclosingDataPackName(ancestors);
	const enclosingFunction = dataPackValue ? undefined : nearestEnclosingExtensionFunction(ancestors);

	const fields: [KoreStringField, KoreStringValue | undefined][] = [
		['name', nameValue], ['namespace', namespaceValue], ['directory', directoryValue], ['dataPackName', dataPackValue],
	];
	const dynamicFields = fields.filter(([, value]) => value?.isDynamic).map(([field]) => field);

	return {
		bodyRange,
		dataPackName: dataPackValue?.text,
		directory: directoryValue?.text,
		dynamicFields,
		enclosingFunction,
		isDynamic: dynamicFields.length > 0,
		kindId: kind.id,
		name: nameValue.text,
		nameArgRange: rangeOf(nameArg),
		namespace: namespaceValue?.text,
		offset: callOffset,
	};
}

/** Guesses the command overload from the argument shapes: two positional strings mean namespace first. */
function functionCommandOf(args: ParsedArgs, offset: number, argsRange: OffsetRange, enclosingDeclarationOffset: number): RawFunctionCommand | undefined {
	const { named, positional } = args;
	const namespaceFirst = !named.has(NAME_PARAMETER_NAME) && !named.has(NAMESPACE_PARAMETER_NAME)
		&& positional.length >= 2 && !isBooleanLiteral(positional[1].text);
	const nameArg = named.get(NAME_PARAMETER_NAME) ?? positional[namespaceFirst ? 1 : 0];
	if (nameArg === undefined) {
		return undefined;
	}
	const namespaceArg = named.get(NAMESPACE_PARAMETER_NAME) ?? (namespaceFirst ? positional[0] : undefined);
	const groupArg = named.get(GROUP_PARAMETER_NAME) ?? positional[namespaceFirst ? 2 : 1];
	const name = koreStringValueOf(nameArg.text);
	const namespace = namespaceArg && koreStringValueOf(namespaceArg.text);
	const dynamicFields: KoreStringField[] = [];
	if (name.isDynamic) {
		dynamicFields.push('name');
	}
	if (namespace?.isDynamic) {
		dynamicFields.push('namespace');
	}

	return {
		argsRange,
		dynamicFields,
		enclosingDeclarationOffset,
		group: groupArg?.text === 'true',
		isDynamic: dynamicFields.length > 0,
		name: name.text,
		nameArgRange: rangeOf(nameArg),
		namespace: namespace?.text,
		namespaceArgRange: namespaceArg && rangeOf(namespaceArg),
		namespaceFirst,
		offset,
	};
}

function isBooleanLiteral(text: string): boolean {
	return text === 'true' || text === 'false';
}

function nearestDeclarationFrame(ancestors: GroupFrame[]): BraceFrame | undefined {
	for (let idx = ancestors.length - 1; idx >= 0; idx--) {
		const ancestor = ancestors[idx];
		if (ancestor.kind === 'brace' && ancestor.declarationKind) {
			return ancestor;
		}
	}
	return undefined;
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
 * `namespace = "..."` assigned at the top level of a block's body (depth 0, not inside a nested block/call), how
 * every generator outside the function family sets its namespace. The last one wins, like `namespaceAssignmentInBlock`.
 */
function namespaceAssignmentInBody(bodyText: string): KoreStringValue | undefined {
	let lastMatch: KoreStringValue | undefined;
	for (const statement of splitTopLevel(bodyText, c => c === '\n' || c === ';')) {
		const m = NAMESPACE_STATEMENT_PATTERN.exec(statement.text);
		if (m) {
			lastMatch = koreStringValueOf(m[1].trim());
		}
	}
	return lastMatch;
}

/** Splits a call's raw argument-list text into positional args and `name = value` named args, with absolute offsets. */
export function parseArgs(argsText: string, argsStart: number): ParsedArgs {
	const positional: RawArg[] = [];
	const named = new Map<string, RawArg>();
	for (const part of splitTopLevel(argsText, c => c === ',')) {
		// A lambda passed inline (not as the trailing block) is never a name/namespace/directory value.
		if (part.text.startsWith('{')) {
			continue;
		}
		const m = NAMED_ARG_PATTERN.exec(part.text);
		if (m) {
			named.set(m[1], { text: m[2], start: argsStart + part.start + part.text.length - m[2].length });
		} else {
			positional.push({ text: part.text, start: argsStart + part.start });
		}
	}
	return { positional, named };
}

/** Splits `text` on separator characters found outside strings, comments and nested brackets, trimming each part. */
export function splitTopLevel(text: string, isSeparator: (c: string) => boolean): RawArg[] {
	const parts: RawArg[] = [];
	let start = 0;
	while (start <= text.length) {
		const end = scanTopLevel(text, start, isSeparator);
		let s = start;
		while (s < end && isWhitespace(text[s])) {
			s++;
		}
		let e = end;
		while (e > s && isWhitespace(text[e - 1])) {
			e--;
		}
		if (s < e) {
			parts.push({ text: text.slice(s, e), start: s });
		}
		start = end + 1;
	}
	return parts;
}

/**
 * Walks `text` from `start` skipping strings, chars, comments and bracketed groups, and returns the index of the first
 * depth-0 character `stop` accepts, or of an unbalanced closing bracket, or `text.length`.
 */
export function scanTopLevel(text: string, start: number, stop: (c: string, i: number) => boolean): number {
	let depth = 0;
	let i = start;
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
		} else if (c === ')' || c === ']' || c === '}') {
			if (depth === 0) {
				return i;
			}
			depth--;
		} else if (depth === 0 && stop(c, i)) {
			return i;
		}
		i++;
	}
	return len;
}

/**
 * Reads a raw argument's text as a string: a literal (following Kotlin escapes and templates), a reference, or a
 * `+` concatenation of those. Falls back to a clipped, whitespace-collapsed source snippet (marked dynamic) for
 * anything else, same fallback the reference plugin uses.
 */
export function koreStringValueOf(raw: string): KoreStringValue {
	return evaluateStringExpression(raw) ?? placeholder(raw);
}

function placeholder(raw: string): KoreStringValue {
	return { text: raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PLACEHOLDER_LENGTH), isDynamic: true };
}

/**
 * A string literal, a bare/dot-qualified reference (kept as its spelling, dynamic), or a `+` concatenation whose
 * non-literal sides become `${...}` template entries so the resolver treats the whole thing as one template.
 */
function evaluateStringExpression(raw: string): KoreStringValue | undefined {
	if (!raw.includes('+')) {
		const trimmed = raw.trim();
		return trimmed === '' ? undefined : evaluateStringLiteral(trimmed) ?? evaluateReference(trimmed);
	}
	const parts = splitTopLevel(raw, c => c === '+');
	if (parts.length === 0) {
		return undefined;
	}
	if (parts.length === 1) {
		return evaluateStringLiteral(parts[0].text) ?? evaluateReference(parts[0].text);
	}

	let text = '';
	let dynamic = false;
	for (const part of parts) {
		const value = evaluateStringLiteral(part.text) ?? { text: `\${${placeholder(part.text).text}}`, isDynamic: true };
		text += value.text;
		dynamic ||= value.isDynamic;
	}
	return { text, isDynamic: dynamic };
}

/** Whether only whitespace and comments follow the token ending at `end`, so `text` is that single token. */
function tokenEnd(text: string, end: number): boolean {
	return skipWhitespaceAndComments(text, end) === text.length;
}

function evaluateReference(text: string): KoreStringValue | undefined {
	const m = REFERENCE_PATTERN.exec(text);
	return m && tokenEnd(text, m[0].length) ? { text: m[0], isDynamic: true } : undefined;
}

function evaluateStringLiteral(raw: string): KoreStringValue | undefined {
	const trimmed = raw.trim();
	if (!trimmed.startsWith('"')) {
		return undefined;
	}
	const literalEnd = skipStringLiteral(trimmed, 0);
	if (!tokenEnd(trimmed, literalEnd)) {
		return undefined;
	}

	const triple = trimmed.startsWith('"""');
	const quoteLen = triple ? 3 : 1;
	const content = trimmed.slice(quoteLen, literalEnd - quoteLen);

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

function unescapeChar(content: string, i: number): { length: number; text: string } {
	const c = content[i + 1];
	if (c === 'u') {
		const code = parseInt(content.slice(i + 2, i + 6), 16);
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
	const triple = text.startsWith('"""', i);
	let j = i + (triple ? 3 : 1);
	const len = text.length;

	while (j < len) {
		const c = text[j];

		if (triple) {
			if (c === '"' && text.startsWith('""', j + 1)) {
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
				// Unterminated single-line string: bail out at the line end rather than swallowing the file.
				return j;
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
	const end = text.indexOf('\n', i);
	return end === -1 ? text.length : end;
}

function skipBlockComment(text: string, i: number): number {
	const end = text.indexOf('*/', i + 2);
	return end === -1 ? text.length : end + 2;
}

function skipWhitespaceAndComments(text: string, i: number): number {
	let j = i;
	while (j < text.length) {
		if (isWhitespace(text[j])) {
			j++;
		} else if (text[j] === '/' && text[j + 1] === '/') {
			j = skipToLineEnd(text, j);
		} else if (text[j] === '/' && text[j + 1] === '*') {
			j = skipBlockComment(text, j);
		} else {
			break;
		}
	}
	return j;
}

/** Char-code tests rather than one-char regexes: these run once per character of every scanned file. */
function isWhitespace(c: string): boolean {
	return c <= ' ' || (c > '\x7f' && /\s/.test(c));
}

function isIdentifierStart(c: string): boolean {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$';
}

function isIdentifierPart(c: string): boolean {
	return isIdentifierStart(c) || (c >= '0' && c <= '9');
}
