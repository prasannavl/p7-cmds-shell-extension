export let layoutManager = null;
export const overview = null;
export const uiGroup = null;
export const wm = {
  added: [],
  removed: [],
  addResult: 1,
  addResults: [],
  addError: null,
  addKeybinding(...args) {
    this.added.push(args);
    if (this.addError) throw this.addError;
    return this.addResults.length > 0
      ? this.addResults.shift()
      : this.addResult;
  },
  removeKeybinding(...args) {
    this.removed.push(args);
  },
  reset() {
    this.added.length = 0;
    this.removed.length = 0;
    this.addResult = 1;
    this.addResults.length = 0;
    this.addError = null;
  },
};

export function pushModal() {
  return null;
}

export function popModal() {}

export function setLayoutManager(value) {
  layoutManager = value;
}
