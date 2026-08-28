/* queue.js — 큐 슬롯을 읽는다. verify 와 ig 가 똑같은 눈으로 큐를 보게 하려고 따로 뺐다.
 *
 * 하루치가 queue/<날짜>/01.md ... 06.md 로 들어 있고,
 * 나간 것은 queue/_done/<날짜>/ 로 옮겨진다.
 * 그래서 "queue/<날짜>/ 에 남아 있는 것 중 첫 번째" 가 언제나 다음에 나갈 슬롯이다.
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./util.js');

/** 큐 파일을 머리말과 캡션으로 가른다 */
function parseQueue(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('큐 파일 형식이 잘못됐습니다 (--- 머리말이 필요합니다)');
  const meta = {};
  const images = [];
  let inImages = false;
  for (const ln of m[1].split(/\r?\n/)) {
    if (/^images:\s*$/.test(ln)) { inImages = true; continue; }
    if (inImages && /^\s*-\s*/.test(ln)) { images.push(ln.replace(/^\s*-\s*/, '').trim()); continue; }
    inImages = false;
    const i = ln.indexOf(':');
    if (i > 0) meta[ln.slice(0, i).trim()] = ln.slice(i + 1).trim();
  }
  return { meta, images, caption: m[2].trim() };
}

const dayDir  = today => path.join(ROOT, 'queue', today);
const doneDir = today => path.join(ROOT, 'queue', '_done', today);

/** 오늘 아직 안 나간 슬롯 파일 이름들 (01.md, 02.md ...) */
function pendingSlots(today) {
  const d = dayDir(today);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => /^\d+\.md$/.test(f)).sort();
}

/** 오늘 이미 나간 슬롯 수 */
function doneCount(today) {
  const d = doneDir(today);
  if (!fs.existsSync(d)) return 0;
  return fs.readdirSync(d).filter(f => /^\d+\.md$/.test(f)).length;
}

/**
 * 다음에 나갈 것이 어느 날짜의 큐에 있는지 찾는다.
 *
 * 오래된 날짜부터 본다. 오늘 것보다 어제 남은 것이 먼저다.
 *
 * 왜 그런가: 예약 실행이 한 자리를 건너뛰거나 자정을 넘겨 돌면 그날 몫이 큐에
 * 남는다. 오늘 것만 보면 그 남은 편은 영영 아무도 안 가져가고, 다음 날 새 큐가
 * 생기면서 그대로 묻힌다. 실제로 8월 25일과 27일에 한 편씩 그렇게 버려졌다.
 *
 * 너무 묵은 것까지 올리지는 않는다 — verify 가 자료 날짜를 따로 검사해서
 * 오늘·어제가 아니면 막고, build 가 그보다 오래된 큐 폴더를 지운다.
 *
 * @returns {{day:string, files:string[]}}  없으면 files 가 빈 배열
 */
function nextPendingDay(today) {
  const root = path.join(ROOT, 'queue');
  if (!fs.existsSync(root)) return { day: today, files: [] };

  /* 오늘 것이 먼저다. 이적 소식은 하루만 지나도 김이 빠지므로, 남은 것을
   * 치우자고 어제 소식을 오늘 것보다 앞세우지는 않는다.
   * 오늘 것을 다 쓴 뒤에야 남은 날을 최근 순으로 본다. */
  const mine = pendingSlots(today);
  if (mine.length) return { day: today, files: mine };

  const older = fs.readdirSync(root)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today)
    .sort().reverse();                         // 최근 것부터

  for (const d of older) {
    const files = pendingSlots(d);
    if (files.length) return { day: d, files };
  }
  return { day: today, files: [] };
}

/** 어제보다 오래된 큐 폴더를 지운다. 그 소식은 이미 묵었다. */
function pruneOldQueues(yesterday) {
  const root = path.join(ROOT, 'queue');
  if (!fs.existsSync(root)) return [];
  const dropped = [];
  for (const d of fs.readdirSync(root)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= yesterday) continue;
    const left = pendingSlots(d);
    if (left.length) dropped.push(`${d} ${left.length}편`);
    fs.rmSync(path.join(root, d), { recursive: true, force: true });
  }
  return dropped;
}

/**
 * 다음에 나갈 슬롯 하나를 읽어 준다. 없으면 null.
 * @param {string} today
 * @returns {{file:string, day:string, slot:string, meta:object, images:string[], caption:string}|null}
 */
function nextSlot(today) {
  const { day, files } = nextPendingDay(today);
  if (!files.length) return null;
  const file = path.join(dayDir(day), files[0]);
  const parsed = parseQueue(fs.readFileSync(file, 'utf8'));
  return { file, day, slot: files[0].replace('.md', ''), ...parsed };
}

/** 나간 슬롯을 _done 으로 옮겨 이력을 남긴다 */
function markDone(today, file) {
  const d = doneDir(today);
  fs.mkdirSync(d, { recursive: true });
  fs.renameSync(file, path.join(d, path.basename(file)));
  return path.join(d, path.basename(file));
}

module.exports = { parseQueue, pendingSlots, nextPendingDay, pruneOldQueues, doneCount, nextSlot, markDone, dayDir, doneDir };
