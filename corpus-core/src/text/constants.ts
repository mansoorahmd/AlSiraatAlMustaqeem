// Buckwalter ⇄ Arabic transliteration table — ported verbatim from the Python
// project's constants.py (BUCKWALTER2UNICODE). Single source of truth for the
// text layer; do not edit without a matching round-trip test.

export const BUCKWALTER2UNICODE: Record<string, string> = {
  "'": "ء", // hamza-on-the-line ء
  "|": "آ", // آ
  ">": "أ", // أ
  "&": "ؤ", // ؤ
  "<": "إ", // إ
  "}": "ئ", // ئ
  A: "ا", // ا
  b: "ب", // ب
  p: "ة", // ة
  t: "ت", // ت
  v: "ث", // ث
  j: "ج", // ج
  H: "ح", // ح
  x: "خ", // خ
  d: "د", // د
  "*": "ذ", // ذ
  r: "ر", // ر
  z: "ز", // ز
  s: "س", // س
  $: "ش", // ش
  S: "ص", // ص
  D: "ض", // ض
  T: "ط", // ط
  Z: "ظ", // ظ
  E: "ع", // ع
  g: "غ", // غ
  _: "ـ", // ـ tatweel
  f: "ف", // ف
  q: "ق", // ق
  k: "ك", // ك
  l: "ل", // ل
  m: "م", // م
  n: "ن", // ن
  h: "ه", // ه
  w: "و", // و
  Y: "ى", // ى
  y: "ي", // ي
  F: "ً", // ً
  N: "ٌ", // ٌ
  K: "ٍ", // ٍ
  a: "َ", // َ
  u: "ُ", // ُ
  i: "ِ", // ِ
  "~": "ّ", // ّ
  o: "ْ", // ْ
  "`": "ٰ", // ٰ dagger alif
  "{": "ٱ", // ٱ wasla
  "^": "ٓ", // ٓ madda above
  "#": "ٔ", // ٔ hamza above
  ":": "ۜ", // ۜ
  "@": "۟", // ۟
  '"': "۠", // ۠
  "[": "ۢ", // ۢ
  ";": "ۣ", // ۣ
  ",": "ۥ", // ۥ
  ".": "ۦ", // ۦ
  "!": "ۨ", // ۨ
  "-": "۪", // ۪
  "+": "۫", // ۫
  "%": "۬", // ۬
  "]": "ۭ", // ۭ
};

export const UNICODE2BUCKWALTER: Record<string, string> = Object.fromEntries(
  Object.entries(BUCKWALTER2UNICODE).map(([bw, ar]) => [ar, bw]),
);
