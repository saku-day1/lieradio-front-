/**
 * 説明文の「欠席・見合わせ」っぽい行だけから ALLOWED メンバー名を拾い、cast から差し引く。
 */

function normalizeForSearch(text) {
  return String(text).replace(/\s+/g, "").toLowerCase();
}

// 欠席告知っぽい行の検出（ノーマルな出演見出しだけではヒットしない語を優先）
const ABSENCE_LINE_TRIGGER =
  /お休み|休みとな|体調不良|出演を見合わせ|見合わせることとなりました|リエラジ[!！]?への出演を見合わせ|出演見合わせ/;

const LIELARAJ_ABSENCE_PHRASE =
  /リエラジ[!！]?への出演を見合わせることとなりました[。.]?/;

/**
 * @param {string} description
 * @param {string[]} allowedMembers
 * @returns {Set<string>}
 */
export function collectAbsentCastNames(description, allowedMembers) {
  const lines = description.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const absent = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!ABSENCE_LINE_TRIGGER.test(line)) {
      continue;
    }

    let span = line;
    if (LIELARAJ_ABSENCE_PHRASE.test(line)) {
      span = [lines[i - 1], line, lines[i + 1]].filter((x) => x != null && x !== "").join("\n");
    }

    const normSpan = normalizeForSearch(span);
    for (const name of allowedMembers) {
      if (normSpan.includes(normalizeForSearch(name))) {
        absent.add(name);
      }
    }
  }

  return absent;
}
