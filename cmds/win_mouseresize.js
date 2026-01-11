// cmds/win_mouseresize.js

import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { STATE_KEYS, STATE_MAP } from "./state.js";

function getFreshMouseResizeState() {
	let state = STATE_MAP.get(STATE_KEYS.WIN_MOUSE_RESIZE);
	if (state && state.active) {
		endMouseResize(state);
	}
	state = {
		active: false,
		tracker: null,
		win: null,
		winId: null,
		indicator: null,
		edges: null,
		startRect: null,
	};
	STATE_MAP.set(STATE_KEYS.WIN_MOUSE_RESIZE, state);
	return state;
}

function getCursorTracker() {
	// 1. GNOME 49+ often consolidates backend access
	if (typeof global.backend?.get_cursor_tracker === "function") {
		return global.backend.get_cursor_tracker();
	}

	// 2. Standard Mutter API (Stable across many versions)
	if (typeof Meta.CursorTracker?.get_for_display === "function") {
		return Meta.CursorTracker.get_for_display(global.display);
	}

	// 3. Fallback for older Shell versions or specific builds
	if (typeof global.display?.get_cursor_tracker === "function") {
		return global.display.get_cursor_tracker();
	}

	return null;
}

function getPointerData() {
	const seat =
		typeof Clutter.get_default_backend === "function"
			? Clutter.get_default_backend().get_default_seat()
			: null;

	// Try Seat API (GNOME 49+ preferred)
	if (seat && typeof seat.get_pointer_coords === "function") {
		const [x, y] = seat.get_pointer_coords();
		const modifiers = seat.get_key_modifiers();
		return { x, y, modifiers };
	}

	// Fallback to DeviceManager (GNOME 45-48)
	const deviceManager = Clutter.DeviceManager.get_default();
	const pointer = deviceManager.get_core_device(
		Clutter.InputDeviceType.POINTER_DEVICE,
	);
	if (pointer) {
		const [x, y] = pointer.get_coords();
		const modifiers = pointer.get_modifier_state();
		return { x, y, modifiers };
	}

	// Absolute fallback
	const [x, y, modifiers] = global.get_pointer();
	return { x, y, modifiers };
}

function endMouseResize(existingState) {
	const state = existingState || STATE_MAP.get(STATE_KEYS.WIN_MOUSE_RESIZE);
	if (!state) {
		return;
	}
	if (state.tracker) {
		state.tracker.disconnectObject(state);
	}
	if (state.indicator) {
		state.indicator.destroy();
	}
	state.active = false;
	state.tracker = null;
	state.win = null;
	state.winId = null;
	state.edges = null;
	state.indicator = null;
	state.startRect = null;
}

function isResizeGestureActive(state) {
	const modifiers = Clutter.ModifierType.MOD4_MASK;
	return (state & modifiers) === modifiers;
}

function ensureResizeIndicator(state) {
	if (state.indicator) {
		return;
	}
	const indicator = new St.Widget({
		reactive: false,
		style:
			"background-color: rgba(255, 255, 255, 0.06);" +
			"border: 2px solid rgba(255, 255, 255, 0.85);" +
			"border-radius: 6px;",
	});
	indicator.hide();
	Main.uiGroup.add_child(indicator);
	state.indicator = indicator;
}

function updateResizeIndicator(state, rect) {
	ensureResizeIndicator(state);
	const indicator = state.indicator;
	indicator.set_position(rect.x, rect.y);
	indicator.set_size(rect.width, rect.height);
	indicator.show();
}

function applyMouseResize(win, rect, edges, pointer, logger) {
	if (!edges.left && !edges.right && !edges.top && !edges.bottom) {
		logger.log("win_mouseresize: no edges enabled");
		return null;
	}
	const rightEdge = rect.x + rect.width;
	const bottomEdge = rect.y + rect.height;

	let x = rect.x;
	let y = rect.y;
	let width = rect.width;
	let height = rect.height;

	if (edges.left) {
		x = Math.min(pointer.x, rightEdge);
		width = rightEdge - x;
	} else if (edges.right) {
		width = Math.max(pointer.x - rect.x, 0);
	}

	if (edges.top) {
		y = Math.min(pointer.y, bottomEdge);
		height = bottomEdge - y;
	} else if (edges.bottom) {
		height = Math.max(pointer.y - rect.y, 0);
	}

	x = Math.round(x);
	y = Math.round(y);
	width = Math.round(width);
	height = Math.round(height);

	logger.log(
		`win_mouseresize: ${edges.left ? "left" : edges.right ? "right" : "-"},${
			edges.top ? "top" : edges.bottom ? "bottom" : "-"
		} -> ${width}x${height} @ ${x},${y}`,
	);
	win.move_resize_frame(true, x, y, width, height);
	return { x, y, width, height };
}

export function win_mouseresize(_config, logger) {
	const state = getFreshMouseResizeState();
	const win = global.display.get_focus_window
		? global.display.get_focus_window()
		: global.display.focus_window;
	if (!win) {
		logger.log("win_mouseresize: no focused window");
		return;
	}
	logger.log("win_mouseresize: enter resize mode");

	state.active = true;
	state.win = win;
	state.winId = win.get_id();
	state.edges = null;
	state.startRect = win.get_frame_rect();
	updateResizeIndicator(state, state.startRect);

	const handlePointerMove = () => {
		const { x, y, modifiers } = getPointerData();

		if (!isResizeGestureActive(modifiers)) {
			endMouseResize();
			logger.log("win_mouseresize: exit resize mode (meta released)");
			return false;
		}
		const point = { x, y };

		if (!state.edges) {
			state.edges = { left: false, right: false, top: false, bottom: false };
		}

		const rect = state.startRect;
		let enabledCount =
			(state.edges.left ? 1 : 0) +
			(state.edges.right ? 1 : 0) +
			(state.edges.top ? 1 : 0) +
			(state.edges.bottom ? 1 : 0);

		if (enabledCount < 2) {
			if (!state.edges.left && !state.edges.right) {
				if (point.x <= rect.x) {
					state.edges.left = true;
					enabledCount++;
				} else if (point.x >= rect.x + rect.width) {
					state.edges.right = true;
					enabledCount++;
				}
			}
			if (!state.edges.top && !state.edges.bottom) {
				if (point.y <= rect.y) {
					state.edges.top = true;
					enabledCount++;
				} else if (point.y >= rect.y + rect.height) {
					state.edges.bottom = true;
					enabledCount++;
				}
			}
		}

		if (enabledCount === 0) {
			logger.log("win_mouseresize: no edges enabled");
			return true;
		}

		const nextRect = applyMouseResize(
			win,
			state.startRect,
			state.edges,
			point,
			logger,
		);
		if (nextRect) {
			updateResizeIndicator(state, nextRect);
		}
		return true;
	};

	const tracker = getCursorTracker();
	if (!tracker) {
		logger.log("win_mouseresize: no cursor tracker");
		endMouseResize(state);
		return;
	}
	state.tracker = tracker;
	tracker.connectObject("position-changed", handlePointerMove, state);
}

export function cleanupWinMouseResize() {
	endMouseResize();
}
