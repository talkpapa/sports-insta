/* verify.js — 게시 직전 마지막 관문. 다음에 나갈 슬롯 하나를 검사한다.
 *
 *   node scripts/verify.js
 *
 * 사람이 보지 않고 나가는 게시물이다. 인스타는 API 로 삭제가 안 되므로,
 * 조금이라도 이상하면 게시하지 않고 멈춘다 — 한 개 거르는 것이
 * 이상한 게시물이 영구히 남는 것보다 훨씬 낫다.
 *
 * 종료코드
 *   0  통과 — 게시해도 된다
 *   1  뭔가 이상하다 — 게시 금지
 *   3  지금 나갈 것이 없다 — 정상 (오늘치를 다 썼거나 큐가 없음)
 */
const { config, tzDate, loadState, log } = require('./lib/util.js');
const { nextSlot, doneCount, pendingSlots } = require('./lib/queue.js');
const { MAX_LEN, MAX_TAGS } = require('./caption.js');

/** PNG 머리 24바이트에서 가로·세로를 읽는다 */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function main() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 1;

  const fails = [];
  const check = (ok, msg) => { if (ok) log.ok(msg); else { log.fail(msg); fails.push(msg); } };

  log.step(`게시 전 검사 · ${today}`);

  /* ── 오늘치를 이미 다 썼는가 ─────────────────── */
  const done = doneCount(today);
  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;

  if (postedToday >= perDay) {
    log.info(`오늘 ${postedToday}개 게시 완료 (목표 ${perDay}개) — 더 올리지 않습니다.`);
    process.exit(3);
  }

  const pend = pendingSlots(today);
  if (!pend.length) {
    log.info(`오늘 남은 큐가 없습니다 (나간 것 ${done}개) — 게시할 것이 없습니다.`);
    process.exit(3);
  }

  const s = nextSlot(today);
  log.info(`다음 슬롯 ${s.slot} · ${s.meta.league || '?'} · ${s.meta.kind || '?'} · 남은 ${pend.length}개`);

  /* ── 하루 한도를 넘지 않는가 ─────────────────── */
  check(postedToday < perDay, `오늘 게시 ${postedToday}개 / 한도 ${perDay}개`);

  /* ── 캡션 ────────────────────────────────────── */
  check(s.caption.length > 0 && s.caption.length <= MAX_LEN,
    `캡션 길이 ${s.caption.length}자 (한도 ${MAX_LEN})`);

  const tags = s.caption.match(/#[^\s#]+/g) || [];
  check(tags.length <= MAX_TAGS, `해시태그 ${tags.length}개 (한도 ${MAX_TAGS})`);

  /* 데이터가 비면 문장에 undefined·NaN 이 그대로 박힌다. 그 상태로 나가면 끝이다. */
  const junk = s.caption.match(/undefined|NaN|null|\[object/i);
  check(!junk, junk ? `캡션에 오류 흔적: "${junk[0]}"` : '캡션에 오류 흔적 없음');

  /* ── 그림 ────────────────────────────────────── */
  check(s.images.length >= 1 && s.images.length <= 10,
    `카드 ${s.images.length}장 (인스타 한도 10장)`);

  for (const url of s.images) {
    try {
      const r = await fetch(url);
      if (!r.ok) { check(false, `그림을 못 받음 (HTTP ${r.status}) ${url}`); continue; }

      const type = r.headers.get('content-type') || '';
      if (!type.startsWith('image/')) { check(false, `그림이 아님 (${type}) ${url}`); continue; }

      const buf = Buffer.from(await r.arrayBuffer());
      const mb = buf.length / 1024 / 1024;
      if (mb > 8) { check(false, `그림이 너무 큼 ${mb.toFixed(1)}MB (한도 8MB)`); continue; }

      const size = pngSize(buf);
      if (!size) { check(false, `PNG 를 읽을 수 없음 ${url}`); continue; }

      /* 인스타가 받는 비율은 4:5(0.8) ~ 1.91:1 이다. 벗어나면 컨테이너가 ERROR 로 죽는다. */
      const ratio = size.w / size.h;
      const ok = ratio >= 0.79 && ratio <= 1.92;
      check(ok, `${s.slot}/${url.split('/').pop()} ${size.w}×${size.h} 비율 ${ratio.toFixed(2)}` +
        (ok ? '' : ' — 허용 범위(0.80~1.91) 밖'));
    } catch (e) {
      check(false, `그림 확인 실패 ${url} — ${e.message}`);
    }
  }

  /* ── 자료가 묵지 않았는가 ─────────────────────── */
  const yesterday = tzDate(-1, tz);
  check([today, yesterday].includes(s.meta.date || ''),
    `자료 날짜 ${s.meta.date} (오늘 ${today} / 어제 ${yesterday} 중 하나여야 함)`);

  /* ── 판정 ────────────────────────────────────── */
  if (fails.length) {
    log.step(`❌ ${fails.length}건 걸렸습니다 — 이 슬롯은 게시하지 않습니다.`);
    process.exit(1);
  }
  log.step(`✅ 전부 통과 — 슬롯 ${s.slot} 게시해도 됩니다.`);
}

module.exports = { pngSize };

if (require.main === module) {
  main().catch(e => { log.fail(e.message); process.exit(1); });
}
