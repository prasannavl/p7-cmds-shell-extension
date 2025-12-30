// cmds.js

import Meta from "gi://Meta";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { DEFAULT_WIN_OPTSIZE_CONFIG } from "./common.js";

let winOptsizeCycleState = null;

function resolveWinOptsizeScales(config, workArea) {
	const winConfig = config?.winOptsize ?? DEFAULT_WIN_OPTSIZE_CONFIG;
	let scales =
		winConfig["default-scales"] ?? DEFAULT_WIN_OPTSIZE_CONFIG["default-scales"];
	if (Array.isArray(winConfig.breakpoints)) {
		for (const breakpoint of winConfig.breakpoints) {
			if (!breakpoint || typeof breakpoint.maxWidth !== "number") {
				continue;
			}
			if (
				workArea.width <= breakpoint.maxWidth &&
				(typeof breakpoint.maxHeight !== "number" ||
					workArea.height <= breakpoint.maxHeight)
			) {
				if (Array.isArray(breakpoint.scales) && breakpoint.scales.length > 0) {
					scales = breakpoint.scales;
				}
				break;
			}
		}
	}
	if (!Array.isArray(scales) || scales.length === 0) {
		scales = DEFAULT_WIN_OPTSIZE_CONFIG["default-scales"];
	}
	return scales;
}

function win_optsize(config) {
	const win = global.display.get_focus_window();
	if (!win) {
		return;
	}

	if (win.get_maximized() !== Meta.MaximizeFlags.NONE) {
		win.unmaximize(Meta.MaximizeFlags.BOTH);
	}

	const monitor = win.get_monitor();
	const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);

	const winConfig = config?.winOptsize ?? DEFAULT_WIN_OPTSIZE_CONFIG;
	const scales = resolveWinOptsizeScales(config, workArea);

	const winId = win.get_id();
	let cycleState = winOptsizeCycleState;
	if (!cycleState || cycleState.winId !== winId) {
		const frameRect = win.get_frame_rect();
		cycleState = {
			winId,
			index: -1,
			originalRect: frameRect,
		};
	}

	const cycleLength = scales.length + 1;
	const nextIndex = (cycleState.index + 1) % cycleLength;
	cycleState.index = nextIndex;
	winOptsizeCycleState = cycleState;

	let targetWidth;
	let targetHeight;
	if (nextIndex === scales.length) {
		const original = cycleState.originalRect;
		targetWidth = Math.round(original.width);
		targetHeight = Math.round(original.height);
	} else {
		let [widthScale, heightScale] = scales[nextIndex];
		const w = workArea.width;
		const h = workArea.height;
		// Aspect-based inversion logic
		if (winConfig.aspectBasedInversion && h > w) {
			// Invert width/height for portrait screens
			[widthScale, heightScale] = [heightScale, widthScale];
		}
		const aspect = w / h;
		targetWidth = Math.round(w * widthScale);
		targetHeight =
			typeof heightScale === "number"
				? Math.round(h * heightScale)
				: Math.round(targetWidth / aspect);
	}

	const targetX = Math.round(workArea.x + (workArea.width - targetWidth) / 2);
	const targetY = Math.round(workArea.y + (workArea.height - targetHeight) / 2);

	win.move_resize_frame(true, targetX, targetY, targetWidth, targetHeight);
}

export const COMMANDS = [
	{
		key: "cmd-win-optsize",
		title: "Optimal size focused window",
		description:
			"Resize the focused window to a size based on the monitor work area and center it.",
		handler: win_optsize,
	},
];
