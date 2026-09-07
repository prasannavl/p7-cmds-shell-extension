export let layoutManager = null;
export const overview = null;
export let uiGroup = null;
let modalGrab = null;
export let poppedModal = null;
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
  return modalGrab;
}

export function popModal(grab) {
  poppedModal = grab;
}

export function setLayoutManager(value) {
  layoutManager = value;
}

export function setModalEnvironment(group, grab) {
  uiGroup = group;
  modalGrab = grab;
  poppedModal = null;
}
