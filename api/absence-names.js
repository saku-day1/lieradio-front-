/**
 * 説明文の「欠席・見合わせ」っぽい行だけから ALLOWED メンバー名を拾い、cast から差し引く。
 */

function normalizeForSearch(text) {
  return String(text).replace(/\s+/g, "").toLowerCase();
}

// 欠席告知っぽい行の検出（出演見出しだけではヒットしない語を優先）
const ABSENCE_LINE_TRIGGER =
  /お休み|休みとな|欠席|体調不良|体調の都合|都合により|出演を見合わせ|見合わせることとなりました|リエラジ[!！]?への出演を見合わせ|出演見合わせ/;

/**
 * @param {string} description
 * @param {string[]} allowedMembers
 * @param {string} [title] タイトルにも欠席告知がある場合
 * @returns {Set<string>}
 */
function namesOfMembersInText(text, allowedMembers) {
  const norm = normalizeForSearch(text);
  const found = new Set();
  for (const name of allowedMembers) {
    if (norm.includes(normalizeForSearch(name))) {
      found.add(name);
    }
  }
  return found;
}

export function collectAbsentCastNames(description, allowedMembers, title = "") {
  const combined = [String(title || "").trim(), String(description || "").trim()]
    .filter(Boolean)
    .join("\n");
  const lines = combined.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const absent = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ABSENCE_LINE_TRIGGER.test(line)) {
      continue;
    }

    const onTriggerLine = namesOfMembersInText(line, allowedMembers);
    if (onTriggerLine.size > 0) {
      for (const name of onTriggerLine) {
        absent.add(name);
      }
      continue;
    }

    const span = [lines[i - 1], line, lines[i + 1]].filter((x) => x != null && x !== "").join("\n");
    for (const name of namesOfMembersInText(span, allowedMembers)) {
      absent.add(name);
    }
  }

  return absent;
}
