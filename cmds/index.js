import { COMMAND_DEFINITIONS } from "../common/config.js";
import { createWinMouseResizeCommand } from "./win_mouseresize.js";
import { createWinOptsizeCommand } from "./win_optsize.js";

const COMMAND_FACTORIES = Object.freeze({
  "cmd-win-optsize": createWinOptsizeCommand,
  "cmd-win-mouseresize": createWinMouseResizeCommand,
});

export function createCommands() {
  const state = new Map(
    Object.entries(COMMAND_FACTORIES).map(([id, create]) => [id, create()]),
  );
  const list = COMMAND_DEFINITIONS.map((definition) => ({
    ...definition,
    handler: (config, logger, ...args) =>
      state.get(definition.id).run(config, logger, ...args),
  }));

  return {
    list,
    destroy() {
      for (const command of state.values()) command.destroy();
      state.clear();
    },
  };
}
