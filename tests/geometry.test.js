import { cloneRect, rectEquals } from "../common/window.js";
import { assertEquals, assertNotEquals } from "./testlib.js";

Deno.test("rect cloning rounds geometry and does not retain identity", () => {
  const source = { x: 1.4, y: 2.6, width: 300.2, height: 199.8 };
  const clone = cloneRect(source);
  assertEquals(clone, { x: 1, y: 3, width: 300, height: 200 });
  assertNotEquals(clone, source);
  assertEquals(rectEquals(clone, { ...clone }), true);
  assertEquals(rectEquals(clone, null), false);
});
