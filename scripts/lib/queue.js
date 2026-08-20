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
 * 다음에 나갈 슬롯 하나를 읽어 준다. 없으면 null.
 * @returns {{file:string, slot:string, meta:object, images:string[], caption:string}|null}
 */
function nextSlot(today) {
  const files = pendingSlots(today);
  if (!files.length) return null;
  const file = path.join(dayDir(today), files[0]);
  const parsed = parseQueue(fs.readFileSync(file, 'utf8'));
  return { file, slot: files[0].replace('.md', ''), ...parsed };
}

/** 나간 슬롯을 _done 으로 옮겨 이력을 남긴다 */
function markDone(today, file) {
  const d = doneDir(today);
  fs.mkdirSync(d, { recursive: true });
  fs.renameSync(file, path.join(d, path.basename(file)));
  return path.join(d, path.basename(file));
}

module.exports = { parseQueue, pendingSlots, doneCount, nextSlot, markDone, dayDir, doneDir };
