import assert from "node:assert/strict";
import test from "node:test";

import { SLIDE_TYPES, codexChatSchema, codexDeckSchema, codexNotesSchema, codexOutlineSchema, codexSlideSchema, codexVariantsSchema } from "../server/schemas.mjs";

// Codex structured output uses strict JSON Schema: every object must forbid extra
// keys and list every property as required, and array items must be one schema.
function auditStrict(schema, path = "$") {
  const problems = [];
  const visit = (node, at) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((child, i) => visit(child, `${at}[${i}]`));
    if (node.type === "object" || node.properties) {
      const keys = Object.keys(node.properties ?? {});
      if (node.additionalProperties !== false) problems.push(`${at}: additionalProperties must be false`);
      const required = new Set(node.required ?? []);
      for (const key of keys) if (!required.has(key)) problems.push(`${at}.${key}: must be required (nullable if optional)`);
    }
    if (Array.isArray(node.items)) problems.push(`${at}: tuple items are not supported`);
    if ("prefixItems" in node) problems.push(`${at}: prefixItems are not supported`);
    for (const [key, child] of Object.entries(node)) if (key !== "required") visit(child, `${at}.${key}`);
  };
  visit(schema, path);
  return problems;
}

test("Codex output schemas satisfy strict structured-output rules", () => {
  assert.deepEqual(auditStrict(codexDeckSchema), []);
  assert.deepEqual(auditStrict(codexSlideSchema), []);
  assert.deepEqual(auditStrict(codexNotesSchema), []);
  assert.deepEqual(auditStrict(codexChatSchema), []);
  assert.deepEqual(auditStrict(codexOutlineSchema), []);
  assert.deepEqual(auditStrict(codexVariantsSchema), []);
  // Uploaded photos, videos and hand placement are the user's; the AI may set builds, photo motion and details.
  for (const schema of [codexDeckSchema, codexChatSchema, codexSlideSchema, codexVariantsSchema]) {
    assert.doesNotMatch(JSON.stringify(schema), /customImage|imagePlacement|"media"/);
  }
  const chat = JSON.stringify(codexChatSchema);
  assert.match(chat, /"animation"/);
  assert.match(chat, /"photoMotion"/);
  assert.match(chat, /"details"/);
  assert.match(chat, /"theme"/);
  // Motion graphics: the AI may choose kinetic type and backdrops per slide, and change the deck's defaults in chat.
  for (const schema of [codexDeckSchema, codexChatSchema, codexSlideSchema, codexVariantsSchema]) {
    const text = JSON.stringify(schema);
    assert.match(text, /"kinetic"/);
    assert.match(text, /"backdrop"/);
    assert.match(text, /"orbits"/);
    assert.match(text, /"scramble"/);
  }
  assert.match(chat, /"motion"/);
  assert.match(chat, /"wipe"/);
  assert.match(chat, /"circle"/);
  assert.equal(codexSlideSchema.type, "object");
  assert.equal(SLIDE_TYPES.length, 42);
  assert.ok(SLIDE_TYPES.includes("hero") && SLIDE_TYPES.includes("statement"));
});
