/**
 * collectAbsentCastNames の簡易検証（node scripts/verify-absence.mjs）
 */
import assert from "node:assert/strict";
import { collectAbsentCastNames } from "../api/absence-names.js";

const allowed = ["伊達さゆり", "坂倉花", "岬なこ", "Liyuu"];

{
  const text = "伊達さゆり(澁谷かのん役)は、収録時体調不良ためお休みとなります。";
  const absent = collectAbsentCastNames(text, allowed);
  assert.ok(absent.has("伊達さゆり"));
  assert.ok(!absent.has("岬なこ"));
}

{
  const text = "結那は本回、出演を見合わせます。";
  const absent = collectAbsentCastNames(text, allowed);
  assert.ok(absent.has("結那") === false); // allowed に結那が無いので検出されない
}

{
  const allowedWith = [...allowed, "結那"];
  const text = "結那は本回、出演を見合わせます。";
  const absent = collectAbsentCastNames(text, allowedWith);
  assert.ok(absent.has("結那"));
}

{
  const text = `坂倉花
リエラジ！への出演を見合わせることとなりました。`;
  const absent = collectAbsentCastNames(text, allowed);
  assert.ok(absent.has("坂倉花"));
}

{
  const text = "メインMC\n伊達さゆり\nLiyuu";
  const absent = collectAbsentCastNames(text, allowed);
  assert.equal(absent.size, 0);
}

{
  const text = "伊達さゆり(澁谷かのん役)\nは、収録時体調不良のためお休みとなります。";
  const absent = collectAbsentCastNames(text, allowed);
  assert.ok(absent.has("伊達さゆり"));
}

{
  const text = "本回\n伊達さゆりは欠席です。";
  const absent = collectAbsentCastNames(text, allowed);
  assert.ok(absent.has("伊達さゆり"));
}

{
  const text = `🎤メインMC
　伊達さゆり（澁谷かのん役）
　坂倉 花（鬼塚冬毬役）
※伊達さゆり(澁谷かのん役)は、収録時体調不良ためお休みとなります。`;
  const absent = collectAbsentCastNames(text, allowed);
  assert.ok(absent.has("伊達さゆり"));
  assert.ok(!absent.has("坂倉花"));
}

{
  const text =
    "※伊達さゆり(澁谷かのん役)は、収録時体調不良ためお休みとなります。\r";
  const absent = collectAbsentCastNames(text, allowed);
  assert.ok(absent.has("伊達さゆり"));
}

console.log("verify-absence: OK");
