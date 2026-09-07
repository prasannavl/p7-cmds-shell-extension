export const noopLogger = {
  log() {},
  verboseLog() {},
  error() {},
};

export function installConnectObject(prototype) {
  if (prototype.connectObject) return;
  const connections = new WeakMap();
  prototype.connectObject = function (...args) {
    const owner = args.pop();
    const ids = connections.get(this) ?? new Map();
    const owned = ids.get(owner) ?? [];
    for (let index = 0; index < args.length; index += 2) {
      owned.push(this.connect(args[index], args[index + 1]));
    }
    ids.set(owner, owned);
    connections.set(this, ids);
  };
  prototype.disconnectObject = function (owner) {
    const ids = connections.get(this);
    for (const id of ids?.get(owner) ?? []) this.disconnect(id);
    ids?.delete(owner);
  };
}

export function createTestSuite(cleanup = () => {}) {
  let passed = 0;
  return {
    test(name, callback) {
      cleanup();
      try {
        callback();
        passed += 1;
        print(`ok - ${name}`);
      } finally {
        cleanup();
      }
    },
    done(label) {
      print(`${passed} ${label} passed`);
    },
  };
}
