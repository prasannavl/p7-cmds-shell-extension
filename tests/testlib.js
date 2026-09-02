export function assert(condition, message = "Assertion failed") {
  if (!condition) throw new Error(message);
}

export function assertEquals(actual, expected) {
  const actualJson = JSON.stringify(sortObject(actual));
  const expectedJson = JSON.stringify(sortObject(expected));
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

export function assertNotEquals(actual, expected) {
  if (actual === expected) throw new Error(`Did not expect ${actual}`);
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortObject(value[key])]),
  );
}
