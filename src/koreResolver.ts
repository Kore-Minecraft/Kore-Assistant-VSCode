/**
 * Workspace-wide resolution of what the per-file scanner can't know: which `val` a `dataPack(NAMESPACE)` or
 * `"blocks/$leafId"` refers to, and which datapack a `fun DataPack.setup() { function("x") { } }` helper ends up in.
 * Text-only stand-in for the IntelliJ plugin's constant following and call-graph walk.
 */

import * as path from 'node:path';
import type { DataPackBlock, DataPackExtensionFunction, KoreStringField, KotlinCall, KotlinConstant, OffsetRange } from './koreParser';

/** `${Constants.X}` / `$X`: entries whose braced form may be dot-qualified, resolved on the last segment like IntelliJ. */
const TEMPLATE_ENTRY_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const REFERENCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
/** How many `val A = B` hops a reference may take, same bound as the IntelliJ plugin. */
const MAX_CONSTANT_DEPTH = 8;

export interface ResolvableDeclaration {
	dataPackName?: string;
	directory?: string;
	dynamicFields: KoreStringField[];
	enclosingFunction?: string;
	kindId: string;
	name: string;
	namespace?: string;
	/** Where the reference sits, so a local `val` declared before it shadows a later or file-level one. */
	offset: number;
}

/** One scanned file: its declarations plus the scanner's resolution inputs. */
export interface KoreSourceFile<T extends ResolvableDeclaration = ResolvableDeclaration> {
	calls: readonly KotlinCall[];
	constants: readonly KotlinConstant[];
	dataPackBlocks: readonly DataPackBlock[];
	declaredFunctions: ReadonlySet<string>;
	declarations: T[];
	extensionFunctions: readonly DataPackExtensionFunction[];
}

export interface ResolvedStrings {
	/** `undefined` when nothing in the workspace ties the declaration to a datapack. */
	dataPackName?: string;
	directory?: string;
	/** Still true when at least one field kept its source snippet. */
	isDynamic: boolean;
	name: string;
	namespace?: string;
}

interface ConstantBinding {
	constant: KotlinConstant;
	filePath: string;
}

export class KoreWorkspaceResolver {
	/** Per file, each constant name's bindings in source order. */
	private readonly constantsByFile = new Map<string, Map<string, KotlinConstant[]>>();
	/** `null` marks a name bound to different values in different files: only a same-file binding can use it then. */
	private readonly globalConstants = new Map<string, ConstantBinding | null>();
	/** Datapacks each extension function (keyed by [functionKey]) is transitively called from. */
	private readonly ownersByFunction = new Map<string, Set<string>>();
	/** Datapack names declared anywhere under each directory, for the "nearest single datapack" fallback. */
	private readonly packsUnderDirectory = new Map<string, Set<string>>();

	constructor(private readonly files: ReadonlyMap<string, KoreSourceFile>) {
		this.indexConstants();
		this.buildCallGraph();
		this.indexDeclaredDataPacks();
	}

	resolve(filePath: string, decl: ResolvableDeclaration): ResolvedStrings {
		const resolveField = (field: KoreStringField): [string | undefined, boolean] => {
			const raw = decl[field];
			if (raw === undefined || !decl.dynamicFields.includes(field)) {
				return [raw, false];
			}
			const resolved = this.resolveString(filePath, raw, decl.offset);
			return resolved === undefined ? [raw, true] : [resolved, false];
		};

		const [name, nameDynamic] = resolveField('name');
		const [namespace, namespaceDynamic] = resolveField('namespace');
		const [directory, directoryDynamic] = resolveField('directory');
		const [dataPackName, dataPackDynamic] = resolveField('dataPackName');

		return {
			dataPackName: decl.kindId === 'DATA_PACK' ? name : dataPackName ?? this.dataPackFallback(filePath, decl.enclosingFunction),
			directory,
			isDynamic: nameDynamic || namespaceDynamic || directoryDynamic || dataPackDynamic,
			name: name!,
			namespace,
		};
	}

	/**
	 * Calls made directly inside a `dataPack { }` block own the callee; calls made inside another extension function
	 * inherit its owners, propagated to a fixpoint so `dataPack { a() }` + `fun DataPack.a() { b() }` reaches `b`.
	 */
	private buildCallGraph(): void {
		const filesByExtensionName = new Map<string, Set<string>>();
		for (const [filePath, file] of this.files) {
			for (const fn of file.extensionFunctions) {
				addTo(filesByExtensionName, fn.name, filePath);
			}
		}

		// Kotlin picks a same-file declaration first (a `fun Function.x()` there shadows any `fun DataPack.x()`
		// elsewhere), otherwise the name has to be declared as a DataPack extension in exactly one file.
		const targetOf = (filePath: string, name: string): string | undefined => {
			const declaringFiles = filesByExtensionName.get(name);
			if (this.files.get(filePath)!.declaredFunctions.has(name)) {
				return declaringFiles?.has(filePath) ? functionKey(filePath, name) : undefined;
			}
			return declaringFiles?.size === 1 ? functionKey([...declaringFiles][0], name) : undefined;
		};

		const callersByFunction = new Map<string, Set<string>>();
		for (const [filePath, file] of this.files) {
			for (const call of file.calls) {
				const target = targetOf(filePath, call.name);
				if (target === undefined) {
					continue;
				}
				const block = innermost(file.dataPackBlocks, call.offset);
				if (block) {
					const owner = block.isDynamic ? this.resolveString(filePath, block.name, block.start) : block.name;
					if (owner !== undefined) {
						addTo(this.ownersByFunction, target, owner);
					}
					continue;
				}
				const caller = innermost(file.extensionFunctions, call.offset);
				if (caller && caller.name !== call.name) {
					addTo(callersByFunction, target, functionKey(filePath, caller.name));
				}
			}
		}

		let changed = true;
		while (changed) {
			changed = false;
			for (const [callee, callers] of callersByFunction) {
				for (const caller of callers) {
					for (const owner of this.ownersByFunction.get(caller) ?? []) {
						changed = addTo(this.ownersByFunction, callee, owner) || changed;
					}
				}
			}
		}
	}

	/**
	 * The call graph first, when it names exactly one datapack; else the closest directory holding exactly one declared
	 * datapack (a multi-project workspace resolves each project's helpers to its own pack), giving up once a level
	 * mixes several packs. At the filesystem root this is the old "sole datapack in the workspace" rule.
	 */
	private dataPackFallback(filePath: string, enclosingFunction: string | undefined): string | undefined {
		const owners = enclosingFunction ? this.ownersByFunction.get(functionKey(filePath, enclosingFunction)) : undefined;
		if (owners?.size === 1) {
			return [...owners][0];
		}

		for (let dir = path.dirname(filePath); ; dir = path.dirname(dir)) {
			const packs = this.packsUnderDirectory.get(dir);
			if (packs !== undefined) {
				return packs.size === 1 ? [...packs][0] : undefined;
			}
			if (path.dirname(dir) === dir) {
				return undefined;
			}
		}
	}

	private indexConstants(): void {
		for (const [filePath, file] of this.files) {
			const byName = new Map<string, KotlinConstant[]>();
			for (const constant of file.constants) {
				let bindings = byName.get(constant.name);
				if (!bindings) {
					bindings = [];
					byName.set(constant.name, bindings);
				}
				bindings.push(constant);

				const known = this.globalConstants.get(constant.name);
				const sameValue = known?.constant.text === constant.text && known.constant.isDynamic === constant.isDynamic;
				this.globalConstants.set(constant.name, known === undefined || sameValue ? { constant, filePath } : null);
			}
			this.constantsByFile.set(filePath, byName);
		}
	}

	private indexDeclaredDataPacks(): void {
		for (const [filePath, file] of this.files) {
			for (const decl of file.declarations) {
				if (decl.kindId !== 'DATA_PACK') {
					continue;
				}
				const name = decl.dynamicFields.includes('name') ? this.resolveString(filePath, decl.name, decl.offset) : decl.name;
				if (name === undefined) {
					continue;
				}
				for (let dir = path.dirname(filePath); ; dir = path.dirname(dir)) {
					addTo(this.packsUnderDirectory, dir, name);
					if (path.dirname(dir) === dir) {
						break;
					}
				}
			}
		}
	}

	/**
	 * The closest same-file binding declared before `offset` and still in scope, else a file-level one (visible before
	 * its line), else the workspace-global binding when every file agrees on it. A qualified `Obj.NAME` ignores scopes.
	 */
	private lookupConstant(filePath: string, reference: string, offset: number): ConstantBinding | undefined {
		const name = reference.slice(reference.lastIndexOf('.') + 1);
		const bindings = this.constantsByFile.get(filePath)?.get(name);
		const constant = name !== reference
			? bindings?.at(-1)
			: bindings?.findLast(b => b.offset < offset && (b.scopeEnd === undefined || offset < b.scopeEnd)) ?? bindings?.findLast(b => b.scopeEnd === undefined);
		return constant ? { constant, filePath } : this.globalConstants.get(name) ?? undefined;
	}

	/** A reference or a template whose every `$x` / `${x}` is a known constant, followed through `val A = B` chains. */
	private resolveString(filePath: string, text: string, offset: number, depth = 0): string | undefined {
		if (depth > MAX_CONSTANT_DEPTH) {
			return undefined;
		}
		const valueOf = (reference: string): string | undefined => {
			const binding = this.lookupConstant(filePath, reference, offset);
			if (!binding) {
				return undefined;
			}
			const { constant } = binding;
			return constant.isDynamic ? this.resolveString(binding.filePath, constant.text, constant.offset, depth + 1) : constant.text;
		};

		if (REFERENCE_PATTERN.test(text)) {
			return valueOf(text);
		}
		if (!text.includes('$')) {
			return undefined;
		}

		let complete = true;
		const resolved = text.replace(TEMPLATE_ENTRY_PATTERN, (_, braced: string | undefined, bare: string | undefined) => {
			const value = valueOf(braced ?? bare!);
			if (value === undefined) {
				complete = false;
				return '';
			}
			return value;
		});
		return complete ? resolved : undefined;
	}
}

/** Adds `value` under `key`, reporting whether the set grew. */
function addTo(map: Map<string, Set<string>>, key: string, value: string): boolean {
	let set = map.get(key);
	if (!set) {
		set = new Set();
		map.set(key, set);
	}
	if (set.has(value)) {
		return false;
	}
	set.add(value);
	return true;
}

/** Extension functions are keyed per file: two files can declare the same `fun DataPack.setup()` privately. */
function functionKey(filePath: string, name: string): string {
	return `${filePath}\0${name}`;
}

/** The narrowest range containing `offset`, i.e. the closest enclosing block or function body. */
function innermost<T extends OffsetRange>(ranges: readonly T[], offset: number): T | undefined {
	let best: T | undefined;
	for (const range of ranges) {
		if (offset >= range.start && offset < range.end && (!best || range.end - range.start < best.end - best.start)) {
			best = range;
		}
	}
	return best;
}
