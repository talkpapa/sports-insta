/* render.js — 데이터를 카드 그림으로 그린다. 브라우저 없이 서버에서 바로 돈다.
 *
 *   node scripts/render.js        가짜 데이터로 _demo/ 에 카드를 그려 눈으로 확인
 *
 * 포스터 메이커와 같은 디자인 언어를 쓴다 —
 * 4:5 비율, 여백 5.8%, 위쪽에 태그칩과 날짜가 마주 보고, 아래에 계정명과 출처.
 * 다른 점은 사진을 깔지 않는다는 것이다. 스포츠 사진은 남의 것이라 쓸 수 없고,
 * 숫자만으로 꽉 찬 카드가 오히려 저장이 잘 눌린다.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { ROOT, prettyDate, tzTime, log } = require('./lib/util.js');

/* ── 서체 ─────────────────────────────────────────── */
const FDIR = path.join(ROOT, 'assets', 'fonts');
let fontsLoaded = false;
function ensureFonts() {
  if (fontsLoaded) return;
  const need = [
    ['Anton-Regular.ttf', 'Anton'],
    ['BlackHanSans-Regular.ttf', 'BlackHanSans'],
    ['Pretendard-Bold.otf', 'PretendardBold'],
    ['Pretendard-Medium.otf', 'PretendardMedium'],
  ];
  for (const [file, name] of need) {
    const p = path.join(FDIR, file);
    if (!fs.existsSync(p)) throw new Error('서체가 없습니다: ' + file + ' — 먼저 "npm run fonts" 를 돌리십시오.');
    GlobalFonts.registerFromPath(p, name);
  }
  fontsLoaded = true;
}

/* ── 규격과 색 ───────────────────────────────────── */
const W = 1080, H = 1350;              // 4:5 — 인스타 세로 한도
const M = Math.round(W * 0.058);       // 바깥 여백
const C = {
  bg1:    '#0B0E14',
  bg2:    '#161C28',
  ink:    '#FFFFFF',
  dim:    '#9AA6B8',
  accent: '#F7C63F',                   // 포스터 메이커의 amber
  line:   'rgba(255,255,255,0.10)',
  row:    'rgba(255,255,255,0.05)',
};

const F = {
  head: s => s + 'px BlackHanSans',
  num:  s => s + 'px Anton',
  bold: s => s + 'px PretendardBold',
  body: s => s + 'px PretendardMedium',
};

/* ── 그리기 도구 ──────────────────────────────────── */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}

/** 칸에 안 들어가면 글자를 줄인다. 긴 팀 이름이 카드 밖으로 나가는 걸 막는다. */
function fitFont(ctx, text, fontFn, maxSize, minSize, maxW) {
  let s = Math.round(maxSize);
  while (s > minSize) {
    ctx.font = fontFn(s);
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  }
  ctx.font = fontFn(s);
  return s;
}

function bg(ctx) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.bg1); g.addColorStop(1, C.bg2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  /* 위쪽 모서리에 은은한 빛 — 판판한 배경보다 카드가 살아 보인다 */
  const r = ctx.createRadialGradient(W * 0.85, H * 0.06, 0, W * 0.85, H * 0.06, W * 0.9);
  r.addColorStop(0, 'rgba(247,198,63,0.14)'); r.addColorStop(1, 'rgba(247,198,63,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
}

/** 위쪽 줄 — 왼쪽에 리그 태그칩, 오른쪽에 날짜. 뉴스 그래픽의 기본 배치다. */
function header(ctx, tagText, dateText) {
  const ts = Math.round(W * 0.023), padX = ts * 0.85, padY = ts * 0.6;
  const y = M;
  ctx.font = F.bold(ts);
  const tw = ctx.measureText(tagText).width;
  const h = ts + padY * 2;

  ctx.fillStyle = C.accent;
  roundRect(ctx, M, y, tw + padX * 2, h, h / 2); ctx.fill();
  ctx.fillStyle = '#12151B';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(tagText, M + padX, y + h / 2 + 1);

  if (dateText) {
    ctx.font = F.body(ts);
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    ctx.fillText(dateText, W - M, y + h / 2 + 1);
  }
  return y + h;                       // 다음 내용이 시작할 수 있는 y
}

/** 아래쪽 — 계정 아이디와 자료 출처. 출처는 반드시 남긴다. */
function footer(ctx, handle, source) {
  const bs = Math.round(W * 0.020);
  const y = H - M;
  ctx.textBaseline = 'alphabetic';

  ctx.font = F.bold(bs);
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'left';
  ctx.fillText(handle || '', M, y);

  if (source) {
    ctx.font = F.body(Math.round(bs * 0.85));
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    ctx.fillText('자료 ' + source, W - M, y);
  }
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(M, y - bs * 1.9); ctx.lineTo(W - M, y - bs * 1.9); ctx.stroke();
  return y - bs * 2.6;                // 내용이 침범하면 안 되는 선
}

/** 오른쪽 아래 장수 표시 — 몇 장 남았는지 알려주면 끝까지 넘긴다 */
function numberBadge(ctx, no, total) {
  if (!no || total < 2) return;
  ctx.font = F.num(Math.round(W * 0.026));
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(no).padStart(2, '0') + ' / ' + String(total).padStart(2, '0'),
    W - M, H - M - W * 0.058);
}

/* ══ 카드 1 · 표지 ═══════════════════════════════════ */
const COVER_TITLE = { results: '어제의 결과', fixtures: '오늘의 경기', standings: '순위표' };

function drawCover(ctx, d) {
  bg(ctx);
  const top = header(ctx, d.league.name, prettyDate(d.date));
  footer(ctx, d.handle, d.source);

  const boxW = W - M * 2;
  let y = top + H * 0.10;

  ctx.textAlign = 'left'; ctx.textBaseline = 'top';

  ctx.font = F.body(Math.round(W * 0.030));
  ctx.fillStyle = C.accent;
  ctx.fillText(d.league.sport + ' · ' + d.league.short, M, y);
  y += W * 0.055;

  const title = COVER_TITLE[d.kind] || '오늘의 소식';
  fitFont(ctx, title, F.head, W * 0.135, W * 0.08, boxW);
  ctx.fillStyle = C.ink;
  ctx.fillText(title, M, y);
  y += W * 0.155;

  ctx.font = F.body(Math.round(W * 0.038));
  ctx.fillStyle = C.dim;
  ctx.fillText(d.items.length + '경기', M, y);
  y += W * 0.085;

  /* 어떤 경기가 들어 있는지 표지에서 미리 보여준다.
   * 제목만 있는 표지는 아래가 텅 비어 허전하고, 무엇보다
   * 내 팀 경기가 있는지 몰라서 넘기지 않고 지나가 버린다. */
  ctx.strokeStyle = C.line; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  y += W * 0.035;

  const listBottom = H - M - W * 0.14;          // '밀어서 보기' 자리를 비워둔다
  const gap = Math.min(W * 0.075, Math.max(W * 0.05, (listBottom - y) / Math.max(d.items.length, 1)));
  const ls = Math.round(W * 0.036);

  for (const m of d.items) {
    if (y > listBottom) break;
    const matchup = m.home + '  vs  ' + m.away;
    fitFont(ctx, matchup, F.bold, ls, Math.round(ls * 0.7), boxW * 0.74);
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'left';
    ctx.fillText(matchup, M, y);

    /* 결과 카드에서는 점수를 가리고 시각만 — 넘겨야 알 수 있게 해서 체류를 늘린다 */
    const t = tzTime(m.kickoff, d.timezone);
    if (t) {
      ctx.font = F.body(Math.round(ls * 0.72));
      ctx.fillStyle = C.dim;
      ctx.textAlign = 'right';
      ctx.fillText(t, W - M, y + ls * 0.16);
    }
    y += gap;
  }

  /* 캐러셀이면 넘겨 보라는 표시 — 첫 장에서 이탈을 줄인다 */
  if (d.slides > 1) {
    ctx.font = F.bold(Math.round(W * 0.030));
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('밀어서 보기  →', W - M, H - M - W * 0.075);
  }
}

/* ══ 카드 2 · 경기 결과 ═══════════════════════════════ */
function drawResult(ctx, d, m, no, total) {
  bg(ctx);
  header(ctx, d.league.name, prettyDate(d.date));
  const limit = footer(ctx, d.handle, d.source);

  const boxW = W - M * 2;
  const cy = H * 0.44;

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  /* 두 팀 이름을 같은 크기로 맞춘다 — 한쪽만 크면 편들어 보인다 */
  const nameSize = Math.min(
    fitFont(ctx, m.home, F.head, W * 0.085, W * 0.045, boxW),
    fitFont(ctx, m.away, F.head, W * 0.085, W * 0.045, boxW));

  const win = m.homeScore > m.awayScore ? 'home' : m.awayScore > m.homeScore ? 'away' : null;

  ctx.font = F.head(nameSize);
  ctx.fillStyle = win === 'home' ? C.ink : C.dim;
  ctx.fillText(m.home, W / 2, cy - W * 0.175);
  ctx.fillStyle = win === 'away' ? C.ink : C.dim;
  ctx.fillText(m.away, W / 2, cy + W * 0.175);

  const score = m.homeScore + ' : ' + m.awayScore;
  fitFont(ctx, score, F.num, W * 0.20, W * 0.11, boxW * 0.9);
  ctx.fillStyle = C.accent;
  ctx.fillText(score, W / 2, cy);

  /* 무승부는 글자로 적어준다. 아무 표시가 없으면 데이터가 빠진 것처럼 보인다 */
  if (!win) {
    ctx.font = F.body(Math.round(W * 0.026));
    ctx.fillStyle = C.dim;
    ctx.fillText('무승부', W / 2, cy + W * 0.088);
  }

  const t = tzTime(m.kickoff, d.timezone);
  if (t) {
    ctx.font = F.body(Math.round(W * 0.026));
    ctx.fillStyle = C.dim;
    ctx.fillText('킥오프 ' + t + ' (한국시간)', W / 2, Math.min(cy + W * 0.30, limit - W * 0.03));
  }

  numberBadge(ctx, no, total);
}

/* ══ 카드 3 · 예정 경기 ═══════════════════════════════ */
function drawFixture(ctx, d, m, no, total) {
  bg(ctx);
  header(ctx, d.league.name, prettyDate(d.date));
  footer(ctx, d.handle, d.source);

  const boxW = W - M * 2;
  const cy = H * 0.42;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  const nameSize = Math.min(
    fitFont(ctx, m.home, F.head, W * 0.085, W * 0.045, boxW),
    fitFont(ctx, m.away, F.head, W * 0.085, W * 0.045, boxW));

  ctx.font = F.head(nameSize);
  ctx.fillStyle = C.ink;
  ctx.fillText(m.home, W / 2, cy - W * 0.165);
  ctx.fillText(m.away, W / 2, cy + W * 0.165);

  ctx.font = F.num(Math.round(W * 0.055));
  ctx.fillStyle = C.dim;
  ctx.fillText('VS', W / 2, cy);

  const t = tzTime(m.kickoff, d.timezone);
  if (t) {
    fitFont(ctx, t, F.num, W * 0.13, W * 0.08, boxW * 0.8);
    ctx.fillStyle = C.accent;
    ctx.fillText(t, W / 2, cy + W * 0.31);
    ctx.font = F.body(Math.round(W * 0.024));
    ctx.fillStyle = C.dim;
    ctx.fillText('한국시간', W / 2, cy + W * 0.385);
  }

  numberBadge(ctx, no, total);
}

/* ══ 카드 4 · 순위표 ═════════════════════════════════ */
function drawStandings(ctx, d, rows, no, total) {
  bg(ctx);
  const top = header(ctx, d.league.name, prettyDate(d.date));
  const limit = footer(ctx, d.handle, d.source);

  let y = top + H * 0.05;
  ctx.textBaseline = 'middle';

  ctx.font = F.head(Math.round(W * 0.072));
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'left';
  ctx.fillText('순위표', M, y);
  y += W * 0.070;

  /* 오른쪽 숫자들은 오른쪽 정렬해야 자릿수가 흔들리지 않는다 */
  const colPt = W - M, colGd = colPt - W * 0.085, colPl = colGd - W * 0.085;
  const hs = Math.round(W * 0.021);

  ctx.font = F.body(hs);
  ctx.fillStyle = C.dim;
  ctx.textAlign = 'left';  ctx.fillText('팀', M + W * 0.075, y);
  ctx.textAlign = 'right';
  ctx.fillText('경기', colPl, y); ctx.fillText('득실', colGd, y); ctx.fillText('승점', colPt, y);
  y += W * 0.026;

  ctx.strokeStyle = C.line; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  y += W * 0.016;

  /* 남은 자리를 줄 수로 나눠 카드를 꽉 채운다. 고정 간격을 쓰면
   * 팀이 적을 때 아래가 텅 비어 만들다 만 카드처럼 보인다. */
  const avail = limit - y - W * 0.02;
  const rowH = Math.min(W * 0.105, avail / Math.max(rows.length, 1));
  const fs = Math.round(Math.min(W * 0.030, rowH * 0.46));

  for (const r of rows) {
    const cyy = y + rowH / 2;

    /* 상위 4팀은 배경을 살짝 밝게 — 챔피언스리그 진출권이라 눈이 먼저 간다 */
    if (r.rank <= 4) { ctx.fillStyle = C.row; roundRect(ctx, M - 8, y + 2, W - M * 2 + 16, rowH - 4, 10); ctx.fill(); }

    ctx.font = F.num(Math.round(fs * 1.15));
    ctx.fillStyle = r.rank <= 4 ? C.accent : C.dim;
    ctx.textAlign = 'left';
    ctx.fillText(String(r.rank), M + 4, cyy);

    const nameW = colPl - (M + W * 0.075) - W * 0.03;
    fitFont(ctx, r.team, F.bold, fs, Math.round(fs * 0.62), nameW);
    ctx.fillStyle = C.ink;
    ctx.fillText(r.team, M + W * 0.075, cyy);

    ctx.font = F.body(Math.round(fs * 0.9));
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    ctx.fillText(String(r.played), colPl, cyy);
    ctx.fillText((r.gd > 0 ? '+' : '') + r.gd, colGd, cyy);

    ctx.font = F.num(Math.round(fs * 1.1));
    ctx.fillStyle = C.ink;
    ctx.fillText(String(r.points), colPt, cyy);

    y += rowH;
  }

  numberBadge(ctx, no, total);
}

/* ══ 묶어서 그리기 ═══════════════════════════════════ */
/**
 * 소재 하나를 카드 여러 장으로. 첫 장은 표지, 나머지는 내용.
 * @returns [{ buffer, name }]
 */
function renderCards(data, opts = {}) {
  ensureFonts();
  const maxSlides = Math.max(2, Math.min(10, opts.maxSlides || 8));
  const d = { ...data, handle: opts.handle || '', slides: 1 };

  const out = [];
  const draw = fn => {
    const cv = createCanvas(W, H);
    fn(cv.getContext('2d'));
    out.push({ buffer: cv.toBuffer('image/png') });
  };

  if (d.kind === 'standings') {
    /* 순위표는 한 장에 다 들어간다 — 넘길 필요가 없다 */
    const rows = d.items.slice(0, 12);
    d.slides = 1;
    draw(ctx => drawStandings(ctx, d, rows, 0, 1));
  } else {
    const items = d.items.slice(0, maxSlides - 1);
    d.slides = items.length + 1;
    draw(ctx => drawCover(ctx, { ...d, items }));
    const fn = d.kind === 'results' ? drawResult : drawFixture;
    items.forEach((m, i) => draw(ctx => fn(ctx, d, m, i + 2, d.slides)));
  }

  return out.map((o, i) => ({ ...o, name: String(i + 1).padStart(2, '0') + '.png' }));
}

/* ── 직접 실행: 가짜 데이터로 눈 확인 ────────────────── */
if (require.main === module) {
  const demoDir = path.join(ROOT, '_demo');
  fs.mkdirSync(demoDir, { recursive: true });

  const samples = [
    { kind: 'results', league: { name: '라리가', short: 'LALIGA', sport: '축구' },
      date: '2026-08-19', source: 'TheSportsDB', timezone: 'Asia/Seoul',
      items: [
        { home: '레알 마드리드', away: '바르셀로나', homeScore: 3, awayScore: 1, kickoff: '2026-08-19T19:00:00' },
        { home: '아틀레티코',   away: '세비야',     homeScore: 2, awayScore: 2, kickoff: '2026-08-19T17:30:00' },
      ] },
    { kind: 'fixtures', league: { name: '프리미어리그', short: 'EPL', sport: '축구' },
      date: '2026-08-20', source: 'TheSportsDB', timezone: 'Asia/Seoul',
      items: [{ home: '맨시티', away: '토트넘', kickoff: '2026-08-20T11:30:00' }] },
    { kind: 'standings', league: { name: '프리미어리그', short: 'EPL', sport: '축구' },
      date: '2026-08-20', source: 'TheSportsDB', timezone: 'Asia/Seoul',
      items: [
        { rank: 1, team: '아스널',   played: 3, win: 3, draw: 0, loss: 0, gd: 7,  points: 9 },
        { rank: 2, team: '리버풀',   played: 3, win: 2, draw: 1, loss: 0, gd: 4,  points: 7 },
        { rank: 3, team: '맨시티',   played: 3, win: 2, draw: 0, loss: 1, gd: 3,  points: 6 },
        { rank: 4, team: '토트넘',   played: 3, win: 2, draw: 0, loss: 1, gd: 2,  points: 6 },
        { rank: 5, team: '첼시',     played: 3, win: 1, draw: 2, loss: 0, gd: 1,  points: 5 },
        { rank: 6, team: '뉴캐슬',   played: 3, win: 1, draw: 1, loss: 1, gd: 0,  points: 4 },
        { rank: 7, team: '브라이턴', played: 3, win: 1, draw: 0, loss: 2, gd: -2, points: 3 },
        { rank: 8, team: '웨스트햄', played: 3, win: 0, draw: 1, loss: 2, gd: -4, points: 1 },
      ] },
  ];

  let n = 0;
  for (const s of samples) {
    for (const c of renderCards(s, { handle: '@sports.daily', maxSlides: 8 })) {
      fs.writeFileSync(path.join(demoDir, s.kind + '-' + c.name), c.buffer);
      n++;
    }
  }
  log.ok('_demo/ 에 ' + n + '장 그렸습니다.');
}

module.exports = { renderCards, W, H };
