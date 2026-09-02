import { COMMAND_DEFINITIONS } from "../common/config.js";
import { win_mouseresize, win_mouseresize_destroy } from "./win_mouseresize.js";
import { win_optsize, win_optsize_destroy } from "./win_optsize.js";

const COMMAND_HANDLERS = {
  "cmd-win-optsize": win_optsize,
  "cmd-win-mouseresize": win_mouseresize,
};

export function createCommands() {
  const state = new Map();
  const list = COMMAND_DEFINITIONS.map((command) => ({
    ...command,
    handler: (config, logger, ...args) =>
      COMMAND_HANDLERS[command.id](state, config, logger, ...args),
  }));

  return {
    list,
    destroy() {
      win_mouseresize_destroy(state);
      win_optsize_destroy(state);
      state.clear();
    },
  };
}
