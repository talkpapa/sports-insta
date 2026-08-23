/* verify.js — 게시 직전 마지막 관문. 다음에 나갈 슬롯 하나를 검사한다.
 *
 *   node scripts/verify.js
 *
 * 사람이 보지 않고 나가는 게시물이다. 인스타는 API 로 삭제가 안 되므로,
 * 조금이라도 이상하면 게시하지 않고 멈춘다 — 한 편 거르는 것이
 * 이상한 영상이 영구히 남는 것보다 훨씬 낫다.
 *
 * 종료코드
 *   0  통과 — 게시해도 된다
 *   1  뭔가 이상하다 — 게시 금지
 *   3  지금 나갈 것이 없다 — 정상
 */
const { config, tzDate, loadState, log } = require('./lib/util.js');
const { nextSlot, doneCount, pendingSlots } = require('./lib/queue.js');

const MAX_CAPTION = 2200;
const MAX_TAGS = 30;

/* 인스타 릴스가 받는 범위. 벗어나면 컨테이너가 ERROR 로 죽는다. */
const MIN_SECONDS = 3;
const MAX_SECONDS = 900;          // 15분
const MAX_BYTES = 1024 * 1024 * 1024;

async function main() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 3;

  const fails = [];
  const check = (ok, msg) => { if (ok) log.ok(msg); else { log.fail(msg); fails.push(msg); } };

  log.step(`게시 전 검사 · ${today}`);

  /* ── 오늘치를 다 썼는가 ──────────────────────── */
  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  if (postedToday >= perDay) {
    log.info(`오늘 ${postedToday}/${perDay}편 완료 — 더 올리지 않습니다.`);
    process.exit(3);
  }

  const pend = pendingSlots(today);
  if (!pend.length) {
    log.info(`오늘 남은 큐가 없습니다 (나간 것 ${doneCount(today)}편).`);
    process.exit(3);
  }

  const s = nextSlot(today);
  log.info(`다음 슬롯 ${s.slot} · ${s.meta.seconds}초 · 남은 ${pend.length}편`);

  check(postedToday < perDay, `오늘 게시 ${postedToday}편 / 한도 ${perDay}편`);

  /* ── 캡션 ────────────────────────────────────── */
  check(s.caption.length > 0 && s.caption.length <= MAX_CAPTION,
    `캡션 ${s.caption.length}자 (한도 ${MAX_CAPTION})`);

  const tags = s.caption.match(/#[^\s#]+/g) || [];
  check(tags.length <= MAX_TAGS, `해시태그 ${tags.length}개 (한도 ${MAX_TAGS})`);

  /* 데이터가 비면 문장에 undefined 가 그대로 박힌다. 그대로 나가면 끝이다.
   *
   * 다만 낱말 경계를 봐야 한다. 대소문자를 무시하고 그냥 찾으면 평범한 영어 낱말
   * 안에 걸린다 — 실제로 선수 이름 "Fernandes"(Fer-nan-des)가 NaN 으로 잡혀
   * 멀쩡한 게시물 두 편이 하루 종일 나가지 못했다. "financial", "annulled",
   * "tenant" 도 같은 이유로 걸렸을 것이다.
   * NaN 은 대소문자까지 그대로 본다 — 소문자 nan 은 사람 이름에 흔하다. */
  const junk = s.caption.match(/\bundefined\b|\bnull\b|\[object [A-Z]/)
            || s.caption.match(/\bNaN\b/);
  check(!junk, junk ? `캡션에 오류 흔적: "${junk[0]}"` : '캡션에 오류 흔적 없음');

  /* 사진 출처가 빠지면 라이선스 위반이다 (CC BY 계열은 표기가 의무다) */
  check(/📷/.test(s.caption), '사진 출처 표기 있음');

  /* ── 자료가 묵지 않았는가 ─────────────────────── */
  const yesterday = tzDate(-1, tz);
  check([today, yesterday].includes(s.meta.date || ''),
    `자료 날짜 ${s.meta.date} (오늘 ${today} / 어제 ${yesterday})`);

  /* ── 영상 ────────────────────────────────────── */
  if (!s.meta.video) {
    check(false, '큐에 영상 주소가 없습니다');
  } else {
    try {
      /* HEAD 로 먼저 물어본다 — 6MB 영상을 통째로 받을 필요는 없다 */
      let r = await fetch(s.meta.video, { method: 'HEAD' });
      if (!r.ok) r = await fetch(s.meta.video, { headers: { range: 'bytes=0-1023' } });

      if (!r.ok) {
        check(false, `영상을 못 받음 (HTTP ${r.status}) — Pages 반영이 아직일 수 있습니다`);
      } else {
        const type = r.headers.get('content-type') || '';
        check(/video\/mp4|application\/octet-stream/.test(type), `content-type ${type || '(없음)'}`);

        const len = Number(r.headers.get('content-length') || 0);
        if (len) {
          check(len > 100000 && len < MAX_BYTES,
            `영상 크기 ${(len / 1024 / 1024).toFixed(1)}MB`);
        }
      }
    } catch (e) {
      check(false, `영상 확인 실패 — ${e.message}`);
    }
  }

  const secs = Number(s.meta.seconds || 0);
  check(secs >= MIN_SECONDS && secs <= MAX_SECONDS,
    `길이 ${secs}초 (${MIN_SECONDS}~${MAX_SECONDS}초)`);

  /* 표지는 없어도 게시는 되지만, 있으면 릴스 목록에서 훨씬 낫다 */
  if (s.meta.cover) {
    try {
      const r = await fetch(s.meta.cover, { method: 'HEAD' });
      check(r.ok, `표지 이미지 ${r.ok ? '있음' : 'HTTP ' + r.status}`);
    } catch { check(false, '표지 이미지 확인 실패'); }
  }

  /* ── 판정 ────────────────────────────────────── */
  if (fails.length) {
    log.step(`❌ ${fails.length}건 걸렸습니다 — 이 슬롯은 게시하지 않습니다.`);
    process.exit(1);
  }
  log.step(`✅ 전부 통과 — 슬롯 ${s.slot} 게시해도 됩니다.`);
}

if (require.main === module) {
  main().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { MAX_CAPTION, MAX_TAGS, MIN_SECONDS, MAX_SECONDS };
