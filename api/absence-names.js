/**
 * 説明文の「欠席・見合わせ」っぽい行だけから ALLOWED メンバー名を拾い、cast から差し引く。
 */

function normalizeForSearch(text) {
  return String(text)
    .normalize("NFKC")
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeAbsenceLine(line) {
  return String(line)
    .normalize("NFKC")
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, "")
    .trim();
}

// 欠席告知っぽい行の検出（出演見出しだけではヒットしない語を優先）
const ABSENCE_LINE_TRIGGER =
  /お休み|休みとな|欠席|体調不良|体調の都合|都合により|ためお休み|によりお休み|出演を見合わせ|見合わせることとなりました|リエラジ[!！]?への出演を見合わせ|出演見合わせ/;

/**
 * メイン／ゲスト欄で、この行からキャスト名を拾わない（欠席注釈行）
 */
export function isAbsenceAnnouncementLine(rawLine) {
  const line = normalizeAbsenceLine(rawLine);
  if (!line) {
    return false;
  }
  return ABSENCE_LINE_TRIGGER.test(line.replace(/^[※＊*・\s　]+/, ""));
}

/**
 * 「氏名（役）のあと同じ行内で欠席理由がある」公式定型も拾う（トリガー行分割ずれ対策）
 */
function collectAbsentFromInlineNameThenReason(description, allowedMembers) {
  const text = String(description || "").replace(/\r/g, "").normalize("NFKC");
  const absent = new Set();

  for (const name of allowedMembers) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?:^[※＊*・\\s　]*)${escaped}(?:[（(][^）)]*[）)])?[^\\n]{0,120}?(?:お休み|休みとな|欠席|体調不良|出演を見合わせ|見合わせ|見合わせることとなりました)`,
      "mu"
    );
    if (re.test(text)) {
      absent.add(name);
    }
  }

  return absent;
}

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
  const combined = [
    String(title || "").trim(),
    String(description || "").trim().replace(/\r/g, "")
  ]
    .filter(Boolean)
    .join("\n");
  const lines = combined.split(/\r?\n/).map((l) => normalizeAbsenceLine(l)).filter(Boolean);
  const absent = new Set();

  for (const name of collectAbsentFromInlineNameThenReason(combined, allowedMembers)) {
    absent.add(name);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineForTrigger = line.replace(/^[※＊*・\s　]+/, "");
    if (!ABSENCE_LINE_TRIGGER.test(lineForTrigger)) {
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
