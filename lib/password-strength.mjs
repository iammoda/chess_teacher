// NIST SP 800-63B-style password quality checks: a hard length floor, a
// common-password blocklist, and a score-based strength meter instead of
// composition rules ("must contain a symbol" produces predictable passwords).
// Pure functions so both the auth UI and unit tests share one implementation.

export const MIN_PASSWORD_LENGTH = 8;

// Top common passwords (lowercased). Matching ignores case and trailing
// digits/symbols so "Password123!" is still caught.
const COMMON_PASSWORDS = new Set([
  "password", "passwort", "passw0rd", "p4ssword", "pa55word", "letmein",
  "welcome", "monkey", "dragon", "master", "shadow", "superman", "batman",
  "trustno1", "sunshine", "iloveyou", "princess", "flower", "hottie",
  "loveme", "zaq1zaq1", "qwerty", "qwertyuiop", "qwerty1", "asdfgh",
  "asdfghjkl", "zxcvbnm", "1q2w3e4r", "1qaz2wsx", "q1w2e3r4", "abc123",
  "abcd1234", "a1b2c3", "123123", "111111", "121212", "112233", "654321",
  "666666", "696969", "777777", "888888", "000000", "123321", "159753",
  "12345", "123456", "1234567", "12345678", "123456789", "1234567890",
  "football", "baseball", "soccer", "hockey", "jordan", "michael",
  "charlie", "andrew", "matthew", "daniel", "ashley", "jessica",
  "michelle", "nicole", "hunter", "tigger", "buster", "soccer1",
  "harley", "ranger", "george", "sexy", "pepper", "ginger", "cookie",
  "summer", "winter", "banana", "orange", "chocolate", "cheese",
  "computer", "internet", "samsung", "google", "facebook", "starwars",
  "pokemon", "naruto", "minecraft", "chess", "chessmaster", "checkmate",
  "admin", "administrator", "root", "login", "guest", "test", "temp",
  "changeme", "secret", "whatever", "nothing", "freedom", "ninja",
  "azerty", "fuckyou", "biteme", "killer", "mustang", "corvette",
  "ferrari", "porsche", "yamaha", "mercedes",
]);

// Match the raw value plus progressively normalized variants: symbols
// stripped, then trailing/leading digits stripped. Checking only the fully
// stripped form missed "12345678!" (stripping digits leaves "") and
// "2024password" (digits lead, not trail).
function blocklistVariants(password) {
  const lowered = String(password || "").toLowerCase();
  const alnum = lowered.replace(/[^a-z0-9]/g, "");
  return [
    lowered,
    alnum,
    alnum.replace(/[0-9]+$/, ""),
    alnum.replace(/^[0-9]+/, ""),
  ];
}

export function isCommonPassword(password) {
  return blocklistVariants(password).some((variant) => variant && COMMON_PASSWORDS.has(variant));
}

function characterClassCount(password) {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(password)) classes += 1;
  return classes;
}

// Detects 5+ character runs of keyboard/alphabet/numeric sequences in either
// direction (abcde, 54321, qwert).
function hasLongSequence(password) {
  const lowered = String(password || "").toLowerCase();
  const rows = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  for (let start = 0; start + 5 <= lowered.length; start += 1) {
    const chunk = lowered.slice(start, start + 5);
    const reversed = [...chunk].reverse().join("");
    if (rows.some((row) => row.includes(chunk) || row.includes(reversed))) return true;
  }
  return false;
}

function isRepeatedPattern(password) {
  return /^(.+?)\1+$/.test(password) && password.length >= 4;
}

function containsEmailName(password, email) {
  const localPart = String(email || "").split("@")[0].toLowerCase();
  if (localPart.length < 3) return false;
  return String(password || "").toLowerCase().includes(localPart);
}

// Returns { score: 0-4, label, acceptable, requirements, hint }.
// Acceptance: >= 8 chars, not a common password, score >= 2 ("fair").
export function scorePassword(password, { email = "" } = {}) {
  const value = String(password || "");
  const longEnough = value.length >= MIN_PASSWORD_LENGTH;
  const notCommon = value.length > 0 && !isCommonPassword(value);

  let score = 0;
  if (value.length >= 16) score = 4;
  else if (value.length >= 12) score = 3;
  else if (value.length >= 10) score = 2;
  else if (value.length >= MIN_PASSWORD_LENGTH) score = 1;

  const classes = characterClassCount(value);
  if (longEnough && classes >= 2) score += 0.5;
  if (longEnough && classes >= 3) score += 0.5;

  if (isRepeatedPattern(value)) score = Math.min(score, 1);
  if (hasLongSequence(value)) score -= 1;
  if (containsEmailName(value, email)) score -= 1;
  if (!notCommon) score = 0;

  score = Math.max(0, Math.min(4, Math.floor(score)));

  const label = score >= 3 ? "strong" : score >= 2 ? "fair" : "weak";
  const acceptable = longEnough && notCommon && score >= 2;

  let hint = "";
  if (!value.length) hint = `Use at least ${MIN_PASSWORD_LENGTH} characters. Longer is stronger.`;
  else if (!notCommon) hint = "That password is too common. Pick something more personal.";
  else if (!longEnough) hint = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (containsEmailName(value, email)) hint = "Avoid using your email name in the password.";
  else if (score < 2) hint = "Add length or mix in different characters.";
  else if (score < 3) hint = "Good. 12+ characters makes it strong.";

  return {
    score,
    label,
    acceptable,
    requirements: { length: longEnough, notCommon },
    hint,
  };
}
