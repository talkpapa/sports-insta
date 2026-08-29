/* page.js — docs/index.html 을 만든다. 폰에서 열어 보는 상태판이다.
 *
 * ── 왜 페이지인가 ────────────────────────────────────────
 * "오늘 잘 올라갔나"를 확인하려고 Claude 를 열고 명령을 돌리는 것은 번거롭다.
 * 주소 하나를 즐겨찾기에 두고 열면 끝나는 편이 낫다.
 *
 * 빌드가 끝날 때와 게시가 끝날 때 둘 다 다시 쓴다. 게시 뒤에 안 고치면
 * 하루 종일 "0/3편"으로 남아 있어 오히려 헷갈린다.
 *
 * 자료는 저장소 안에 이미 다 있다 — state.json 이 나간 것, queue/ 가 남은 것.
 * 그래서 이 페이지를 만드는 데는 인스타 토큰이 필요 없다.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, tzDate } = require('./util.js');
const { pendingSlots } = require('./queue.js');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** 한국시간 시:분 */
function hhmm(iso, tz) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch { return ''; }
}

/** 하루치 상태를 모은다 */
function dayStatus(day, st, perDay, tz) {
  const posted = (st.posted_log || [])
    .filter(p => p.date === day && !p.deleted)
    .sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
  const waiting = pendingSlots(day).map(f => f.replace('.md', ''));
  return { day, posted, waiting, perDay };
}

function dayBlock(s, tz, isToday) {
  const done = s.posted.length;
  const short = done < s.perDay && !s.waiting.length;

  const rows = [
    ...s.posted.map(p => `
      <li class="ok">
        <span class="slot">${esc(p.slot)}</span>
        <span class="time">${esc(hhmm(p.at, tz))}</span>
        <a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc((p.title || '').slice(0, 60) || '보기')}</a>
      </li>`),
    ...s.waiting.map(w => `
      <li class="wait">
        <span class="slot">${esc(w)}</span>
        <span class="time">대기</span>
        <span class="muted">아직 안 나갔습니다</span>
      </li>`),
  ].join('');

  const mark = done >= s.perDay ? 'full' : done ? 'part' : 'none';

  return `
  <section class="${isToday ? 'today' : ''}">
    <h2>
      <span class="date">${esc(s.day)}${isToday ? ' <em>오늘</em>' : ''}</span>
      <span class="count ${mark}">${done} / ${s.perDay}</span>
    </h2>
    <ul>${rows || '<li class="wait"><span class="muted">아직 만들어진 것이 없습니다</span></li>'}</ul>
    ${short ? '<p class="short">이날은 소재가 모자라 다 채우지 못했습니다.</p>' : ''}
  </section>`;
}

/**
 * docs/index.html 을 다시 쓴다.
 * @param {object} cfg  config.json
 */
function writeIndex(cfg) {
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const perDay = cfg.publish?.perDay || 3;
  const today = tzDate(0, tz);

  let st = {};
  try { st = JSON.parse(fs.readFileSync(path.join(ROOT, 'state.json'), 'utf8')); } catch {}

  /* 최근 7일. 게시 기록과 큐 어느 쪽에든 흔적이 있는 날을 모은다. */
  const days = [];
  for (let i = 0; i < 7; i++) days.push(tzDate(-i, tz));

  const blocks = days.map(d => dayBlock(dayStatus(d, st, perDay, tz), tz, d === today)).join('\n');

  /* 영상 미리보기는 아래로 내린다 — 폰에서 먼저 보고 싶은 것은 숫자다. */
  const reelDir = path.join(ROOT, 'docs', 'reels');
  const reelDays = fs.existsSync(reelDir)
    ? fs.readdirSync(reelDir).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort().reverse().slice(0, 3)
    : [];
  const reels = reelDays.map(day => {
    const dd = path.join(reelDir, day);
    const slots = fs.readdirSync(dd).filter(s => fs.statSync(path.join(dd, s)).isDirectory()).sort();
    const cells = slots.map(s =>
      `<figure><video src="reels/${day}/${s}/reel.mp4" poster="reels/${day}/${s}/cover.png" controls preload="none" playsinline></video><figcaption>${esc(s)}</figcaption></figure>`
    ).join('');
    return `<h3>${esc(day)}</h3><div class="row">${cells}</div>`;
  }).join('');

  const stamp = new Intl.DateTimeFormat('ko-KR', {
    timeZone: tz, month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());

  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(cfg.account?.brand || '릴스')} 상태</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:18px 16px 48px; background:#0B0E14; color:#E7ECF3;
         font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;
         -webkit-text-size-adjust:100%; }
  header { margin-bottom:20px; }
  h1 { font-size:19px; margin:0 0 2px; }
  .stamp { color:#7C8798; font-size:13px; }

  section { border-top:1px solid #1E2531; padding:14px 0 4px; }
  section.today { border-top:2px solid #F7C63F; }
  h2 { display:flex; align-items:baseline; justify-content:space-between;
       gap:10px; font-size:14px; margin:0 0 10px; font-weight:600; }
  .date { color:#C4CDDA; }
  .date em { color:#F7C63F; font-style:normal; font-size:12px; margin-left:4px; }
  .count { font-size:15px; font-variant-numeric:tabular-nums; }
  .count.full { color:#57C98A; }
  .count.part { color:#F7C63F; }
  .count.none { color:#7C8798; }

  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; align-items:baseline; gap:10px; padding:6px 0;
       border-bottom:1px solid #141A24; font-size:14px; }
  li:last-child { border-bottom:0; }
  .slot { color:#7C8798; font-variant-numeric:tabular-nums; min-width:22px; }
  .time { color:#9AA6B8; font-variant-numeric:tabular-nums; min-width:44px; }
  li.ok .time { color:#57C98A; }
  li a { color:#E7ECF3; text-decoration:none; border-bottom:1px solid #2A3342;
         overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .muted { color:#7C8798; }
  .short { color:#7C8798; font-size:13px; margin:6px 0 0; }

  h3 { font-size:13px; color:#9AA6B8; margin:20px 0 8px; font-weight:600; }
  .row { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px;
         scroll-snap-type:x mandatory; }
  figure { margin:0; scroll-snap-align:start; }
  video { height:300px; border-radius:12px; display:block; background:#000; }
  figcaption { color:#7C8798; font-size:12px; margin-top:5px; }
  .reels-title { border-top:1px solid #1E2531; padding-top:18px; margin-top:24px; }
</style>

<header>
  <h1>${esc(cfg.account?.handle || '')} 릴스</h1>
  <div class="stamp">${esc(stamp)} 기준 · 하루 ${perDay}편</div>
</header>

${blocks}

<div class="reels-title"><h3 style="margin-top:0">최근 영상</h3></div>
${reels || '<p class="muted">아직 만든 영상이 없습니다.</p>'}
`;

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), html, 'utf8');
}

module.exports = { writeIndex };
