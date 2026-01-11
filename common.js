// common.js

export const KEYBINDING_FLAG_NAMES = [
	"IGNORE_AUTOREPEAT",
	"NONE",
	"PER_WINDOW",
	"BUILTIN",
	"IS_REVERSED",
	"NON_MASKABLE",
];

export const ACTION_MODE_NAMES = [
	"NORMAL",
	"ALL",
	"NONE",
	"OVERVIEW",
	"LOCK_SCREEN",
	"UNLOCK_SCREEN",
	"LOGIN_SCREEN",
	"SYSTEM_MODAL",
	"LOOKING_GLASS",
	"POPUP",
	"PANEL",
];

export const DEFAULT_WIN_OPTSIZE_CONFIG = {
	scales: [
		[0.8, null],
		[0.7, 0.8],
		[0.6, 0.8],
	],
	breakpoints: [
		{
			maxWidth: 1920,
			scales: [[0.8, null]],
		},
		{
			maxWidth: 2560,
			scales: [
				[0.8, 0.8],
				[0.7, 0.8],
			],
		},
	],
};

export function cloneWinOptsizeConfig() {
	return JSON.parse(JSON.stringify(DEFAULT_WIN_OPTSIZE_CONFIG));
}

export function normalizeWinOptsizeConfig(rawConfig) {
	const defaults = cloneWinOptsizeConfig();
	const config =
		rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
			? rawConfig
			: {};
	return {
		scales: Array.isArray(config.scales) ? config.scales : defaults.scales,
		breakpoints: Array.isArray(config.breakpoints)
			? config.breakpoints
			: defaults.breakpoints,
		aspectBasedInversion:
			typeof config.aspectBasedInversion === "boolean"
				? config.aspectBasedInversion
				: defaults.aspectBasedInversion,
	};
}

export function parseWinOptsizeConfig(rawValue, options = {}) {
	const strict = options?.strict === true;
	const defaults = cloneWinOptsizeConfig();
	if (typeof rawValue !== "string") {
		return strict ? { ok: false, error: "Expected a JSON string." } : defaults;
	}
	const trimmed = rawValue.trim();
	if (!trimmed) {
		return strict ? { ok: false, error: "JSON is empty." } : defaults;
	}
	try {
		const parsed = JSON.parse(trimmed);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return strict
				? { ok: false, error: "JSON must be an object." }
				: defaults;
		}
		const normalized = normalizeWinOptsizeConfig(parsed);
		return strict ? { ok: true, value: normalized } : normalized;
	} catch (_error) {
		if (strict) {
			return { ok: false, error: _error?.message ?? "Invalid JSON." };
		}
		return defaults;
	}
}

export const COMMAND_DEFINITIONS = [
	{
		id: "cmd-win-optsize",
		title: "cmd:win-optsize",
		icon: "window-maximize-symbolic",
		description:
			"Resize the focused window to a size based on the monitor work area and center it.",
	},
	{
		id: "cmd-win-mouseresize",
		title: "cmd:win-mouseresize",
		icon: "transform-move-symbolic",
		description:
			"Resize the focused window by moving the mouse beyond the window edges; press Esc or the keybinding again to stop.",
	},
];
