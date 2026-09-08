import { describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasNode } from "../src/types/canvas-internal";
import { isCanvasBackgroundTarget, registerAutoResize } from "../src/ui/auto-resize";

function target(closestResult: unknown): HTMLElement {
	return {
		offsetHeight: 10,
		closest: () => closestResult,
	} as unknown as HTMLElement;
}

describe("isCanvasBackgroundTarget", () => {
	it("accepts empty Canvas surface elements", () => {
		const background = target(null);
		const wrapper = { contains: (value: unknown) => value === background } as HTMLElement;
		expect(isCanvasBackgroundTarget(wrapper, background)).toBe(true);
	});

	it("rejects nodes, controls, and elements outside the Canvas", () => {
		const interactive = target({});
		const outside = target(null);
		const wrapper = { contains: (value: unknown) => value !== outside } as HTMLElement;
		expect(isCanvasBackgroundTarget(wrapper, interactive)).toBe(false);
		expect(isCanvasBackgroundTarget(wrapper, outside)).toBe(false);
	});
});

describe("editing exit double-click guard", () => {
	it("prevents an editing-exit double-click from creating a background card", () => {
		vi.useFakeTimers();
		const listeners = new Map<string, Set<(event: Event) => void>>();
		const addEventListener = (type: string, listener: EventListenerOrEventListenerObject) => {
			const values = listeners.get(type) ?? new Set();
			values.add(listener as (event: Event) => void);
			listeners.set(type, values);
		};
		const removeEventListener = (type: string, listener: EventListenerOrEventListenerObject) => {
			listeners.get(type)?.delete(listener as (event: Event) => void);
		};
		const emit = (type: string, event: object) => {
			for (const listener of listeners.get(type) ?? []) listener(event as Event);
		};
		const nodeEl = { contains: () => false } as unknown as HTMLElement;
		const contentEl = {
			querySelector: () => null,
			addEventListener,
			removeEventListener,
			win: {
				MutationObserver: class {
					observe(): void {}
					disconnect(): void {}
				},
			},
		} as unknown as HTMLElement;
		const node = { id: "node", isEditing: true, nodeEl, contentEl } as CanvasNode;
		const background = target(null);
		const editorTarget = {
			offsetHeight: 10,
			closest: () => nodeEl,
		} as unknown as HTMLElement;
		const wrapper = {
			addEventListener,
			removeEventListener,
			contains: () => true,
			win: {
				setTimeout,
				clearTimeout,
			},
		} as unknown as HTMLElement;
		const canvas = {
			wrapperEl: wrapper,
			nodes: new Map([[node.id, node]]),
		} as unknown as Canvas;
		const handle = registerAutoResize(canvas, { minHeight: 60 });
		emit("focusin", { target: editorTarget });

		emit("pointerdown", {
			target: background,
			button: 0,
			isPrimary: true,
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			shiftKey: false,
		});
		const preventDefault = vi.fn();
		const stopImmediatePropagation = vi.fn();
		emit("dblclick", { target: background, preventDefault, stopImmediatePropagation });

		expect(preventDefault).toHaveBeenCalledOnce();
		expect(stopImmediatePropagation).toHaveBeenCalledOnce();
		handle.cleanup();
		vi.useRealTimers();
	});
});
