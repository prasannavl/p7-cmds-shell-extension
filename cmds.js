// cmds.js

import { COMMAND_DEFINITIONS } from "./common.js";
import {
  win_mouseresize,
  win_mouseresize_destroy,
} from "./cmds/win_mouseresize.js";
import { win_optsize, win_optsize_destroy } from "./cmds/win_optsize.js";

export const STATE_MAP = new Map();
export const STATE_KEYS = {
  WIN_OPTSIZE: "cmd-win-optsize",
  WIN_MOUSE_RESIZE: "cmd-win-mouseresize",
  WIN_MOUSE_RESIZE_CONFLICT_INDEX: "cmd-win-mouseresize-conflict-index",
};

const COMMAND_HANDLERS = {
  "cmd-win-optsize": win_optsize,
  "cmd-win-mouseresize": win_mouseresize,
};

export const COMMANDS = COMMAND_DEFINITIONS.map((command) => ({
  ...command,
  handler: COMMAND_HANDLERS[command.id],
}));

export function destroyCommands() {
  win_mouseresize_destroy();
  win_optsize_destroy();
}
