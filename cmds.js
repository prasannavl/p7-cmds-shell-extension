// cmds.js

import { COMMAND_DEFINITIONS } from "./common.js";
import { STATE_MAP } from "./cmds/state.js";
import {
	win_mouseresize,
	cleanupWinMouseResize,
} from "./cmds/win_mouseresize.js";
import { win_optsize } from "./cmds/win_optsize.js";

const COMMAND_HANDLERS = {
	"cmd-win-optsize": win_optsize,
	"cmd-win-mouseresize": win_mouseresize,
};

export const COMMANDS = COMMAND_DEFINITIONS.map((command) => ({
	...command,
	handler: COMMAND_HANDLERS[command.id],
}));

export { STATE_MAP };

export function cleanupCommands() {
	cleanupWinMouseResize();
}
