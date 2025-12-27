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
	"default-scales": [
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

export const DEFAULT_WIN_OPTSIZE_CONFIG_STRING = JSON.stringify(
	DEFAULT_WIN_OPTSIZE_CONFIG,
);
