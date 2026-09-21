import * as vscode from 'vscode';
import type { OffsetRange } from './koreParser';

export type PositionResolver = (offset: number) => vscode.Position;

/** `path/from/workspace.kt:line`, the form terminals and most editors open directly. */
export function declarationPathOf(element: { range: vscode.Range; uri: vscode.Uri }): string {
	return `${vscode.workspace.asRelativePath(element.uri, false)}:${element.range.start.line + 1}`;
}

/** Offset -> Position without a TextDocument: binary search over the line start offsets of the text. */
export function positionResolver(text: string): PositionResolver {
	const lineStarts = [0];
	for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
		lineStarts.push(i + 1);
	}

	return offset => {
		let low = 0;
		let high = lineStarts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (lineStarts[mid] <= offset) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		return new vscode.Position(low, offset - lineStarts[low]);
	};
}

export function rangeOf(positionAt: PositionResolver, range: OffsetRange): vscode.Range {
	return new vscode.Range(positionAt(range.start), positionAt(range.end));
}
