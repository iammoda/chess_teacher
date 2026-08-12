import test from "node:test";
import assert from "node:assert/strict";
import { scorePassword, isCommonPassword, MIN_PASSWORD_LENGTH } from "../lib/password-strength.mjs";

test("short passwords are weak and unacceptable", () => {
  for (const pw of ["", "a", "chess12", "1234567"]) {
    const result = scorePassword(pw);
    assert.equal(result.acceptable, false, pw);
    assert.equal(result.label, "weak", pw);
    assert.equal(result.requirements.length, false, pw);
  }
});

test("common passwords are rejected regardless of length or casing", () => {
  for (const pw of ["password", "Password123", "qwertyuiop", "iloveyou1", "CHESSMASTER", "letmein99"]) {
    assert.equal(isCommonPassword(pw), true, pw);
    const result = scorePassword(pw);
    assert.equal(result.score, 0, pw);
    assert.equal(result.acceptable, false, pw);
    assert.match(result.hint, /common/i);
  }
});

test("keyboard and numeric sequences are penalized", () => {
  const sequential = scorePassword("abcdefgh12");
  const comparable = scorePassword("kmtrwqzp12");
  assert.ok(sequential.score < comparable.score, "sequence should score below random of same length");
});

test("repeated patterns cap the score", () => {
  const repeated = scorePassword("abababababab");
  assert.equal(repeated.acceptable, false);
  assert.equal(repeated.label, "weak");
});

test("using the email name weakens the password", () => {
  const withEmail = scorePassword("magnus-rocks1", { email: "magnus@example.com" });
  const without = scorePassword("magnus-rocks1", { email: "other@example.com" });
  assert.ok(withEmail.score < without.score);
  assert.match(withEmail.hint, /email/i);
});

test("a 10+ character varied password is fair and acceptable", () => {
  const result = scorePassword("purple-tree7");
  assert.equal(result.acceptable, true);
  assert.ok(result.score >= 2);
});

test("long passphrases score strong", () => {
  const result = scorePassword("horse battery staple chess");
  assert.equal(result.label, "strong");
  assert.equal(result.acceptable, true);
});

test("exports a sane minimum length", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  const atFloor = scorePassword("Zk4!mQ9x");
  assert.equal(atFloor.requirements.length, true);
});

test("blocklist catches digit passwords with symbols and leading digits", () => {
  assert.equal(isCommonPassword("12345678!"), true);
  assert.equal(isCommonPassword("123456789!!"), true);
  assert.equal(isCommonPassword("2024password"), true);
  assert.equal(isCommonPassword("correct-horse-battery"), false);
});
