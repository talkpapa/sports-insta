/* util.js — 모든 스크립트가 함께 쓰는 것들.
 * 설정 읽기 · 자격증명 · 날짜(계정 시간대) · 상태파일 · 네트워크 · 로그.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/* ── 설정 ───────────────────────────────────────────── */
function config() {
  const p = path.join(ROOT, 'config.json');
  if (!fs.existsSync(p)) throw new Error('config.json 이 없습니다.');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* ── 자격증명 ────────────────────────────────────────
 * 환경변수(GitHub Actions) 가 먼저, 없으면 .env(로컬).
 * 로컬과 서버가 같은 코드로 돌게 하기 위함이다. */
function env() {
  const out = {};
  const p = path.join(ROOT, '.env');
  if (fs.existsSync(p)) {
    for (const ln of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = ln.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  /* 환경변수가 .env 를 이긴다. 서버에는 .env 가 없고 시크릿이 환경변수로 들어온다.
   *
   * 예전에는 여기에 읽을 키 이름을 적어두고 그것만 가져왔다. 그러다 파이프라인이
   * 바뀌면서 GEMINI_API_KEY 가 목록에 없는 채로 남았고, 서버 빌드가 여덟 건 내리
   * "키가 없습니다"로 넘어갔다. 로컬에는 .env 가 있어 잘 돌았으므로 하루가 지나서야
   * 알았다. 목록을 두면 키가 늘 때마다 여기를 고쳐야 하고, 잊으면 조용히 깨진다. */
  for (const [k, v] of Object.entries(process.env)) {
    if (v) out[k] = v;
  }
  return out;
}

/* ── 날짜 — 계정 기준 시간대(기본 한국) ────────────────
 * 서버는 UTC 로 돌기 때문에 날짜를 서버에 맡기면 하루가 어긋난다.
 * "오늘"이 무엇인지는 언제나 이 함수로만 정한다. */
function tzDate(offsetDays = 0, tz = 'Asia/Seoul') {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/* 카드에 찍을 한국식 날짜 — "8월 20일 (목)".
 * ymd 는 이미 계정 시간대로 계산된 날짜다. 여기서 시간대를 또 적용하면
 * 하루가 밀리므로 요일만 UTC 정오 기준으로 뽑는다. */
function prettyDate(ymd) {
  const wd = new Intl.DateTimeFormat('ko-KR', { timeZone: 'UTC', weekday: 'short' })
    .format(new Date(ymd + 'T12:00:00Z'));
  const [, m, dd] = ymd.split('-');
  return Number(m) + '월 ' + Number(dd) + '일 (' + wd + ')';
}


/* 카드에 찍을 영어 날짜 — "AUGUST 21, 2026".
 * 계정은 영어로 운영하므로 카드 위 날짜도 영어여야 한다. */
function prettyDateEn(ymd) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
  }).format(new Date(ymd + "T12:00:00Z"));
}
/* UTC 타임스탬프를 계정 시간대의 "HH:MM" 으로.
 * 데이터 제공처는 UTC 로 주는데 보는 사람은 한국 시간으로 읽는다. */
function tzTime(iso, tz = 'Asia/Seoul') {
  if (!iso) return '';
  const hasZone = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const d = new Date(hasZone ? iso : iso + 'Z');
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

/* ── 상태파일 ────────────────────────────────────────── */
const STATE = path.join(ROOT, 'state.json');
function loadState() {
  if (!fs.existsSync(STATE)) return { posted_log: [], league_cursor: 0, token_expires_around: null };
  return JSON.parse(fs.readFileSync(STATE, 'utf8'));
}
function saveState(s) {
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

/* ── 네트워크 — 실패하면 몇 번 다시 해본다 ──────────────
 * 무인 파이프라인이라 한 번 끊겼다고 그날을 통째로 거르면 안 된다. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, opt = {}, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opt);
      if (r.status === 429) { last = new Error('429 요청 한도'); await sleep(4000 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.split('?')[0]);
      return await r.json();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

/* ── 로그 — 서버 로그에서 눈에 띄게 ─────────────────── */
const log = {
  step: m => console.log('\n■ ' + m),
  ok:   m => console.log('  ✅ ' + m),
  info: m => console.log('  · ' + m),
  warn: m => console.log('  ⚠ ' + m),
  fail: m => console.error('  ❌ ' + m),
};

module.exports = { ROOT, config, env, tzDate, tzTime, prettyDate, prettyDateEn, loadState, saveState, getJSON, sleep, log };
