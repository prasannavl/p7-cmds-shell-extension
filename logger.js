// logger.js

export class Logger {
	constructor(settings, baseLogger) {
		this._settings = settings;
		this._logger = baseLogger;
		this._verboseEnabled = settings?.get_boolean?.("verbose-logging") ?? false;

		this._settings?.connectObject?.(
			"changed::verbose-logging",
			() => {
				this._verboseEnabled = this._settings.get_boolean("verbose-logging");
			},
			this,
		);
	}

	log(...args) {
		this._logger.log(...args);
	}

	verboseLog(...args) {
		if (this._verboseEnabled) {
			this._logger.log(...args);
		}
	}

	error(...args) {
		this._logger.error(...args);
	}

	destroy() {
		this._settings?.disconnectObject?.(this);
	}
}
