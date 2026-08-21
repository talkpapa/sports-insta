/* render.js — 사진 위에 헤드라인을 얹어 세로 카드를 만든다.
 *
 *   node scripts/render.js        가짜 원고로 _demo/ 에 카드를 그려 눈으로 확인
 *
 * 1080×1920 (9:16) — 릴스와 스토리가 쓰는 세로 비율이다.
 *
 * ── 사진을 어떻게 다루는가 ───────────────────────────────
 * 받아온 사진은 가로일 때가 많다. 세로 화면에 맞추려고 억지로 늘이면 사람이
 * 홀쭉해져 바로 티가 난다. 그래서 늘이지 않고 **가운데를 잘라** 쓴다.
 * 잘린 사진 위에는 아래에서 위로 어두운 그늘을 깐다 — 글자를 얹기 위해서이기도 하고,
 * 사진이 흐릿해도 그늘이 덮어주기 때문이기도 하다.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { ROOT, log } = require('./lib/util.js');

/* ── 서체 ─────────────────────────────────────────── */
const FDIR = path.join(ROOT, 'assets', 'fonts');
let fontsLoaded = false;
function ensureFonts() {
  if (fontsLoaded) return;
  const need = [
    ['Anton-Regular.ttf', 'Anton'],
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

/* ── 규격 ─────────────────────────────────────────── */
const W = 1080, H = 1920;              // 9:16
const M = Math.round(W * 0.072);       // 바깥 여백
const C = {
  ink:    '#FFFFFF',
  dim:    'rgba(255,255,255,0.72)',
  accent: '#F7C63F',
  chipBg: 'rgba(0,0,0,0.55)',
};

const F = {
  head: s => s + 'px Anton',
  bold: s => s + 'px PretendardBold',
  body: s => s + 'px PretendardMedium',
};

/* ── 도구 ─────────────────────────────────────────── */
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

/** 사진을 늘이지 않고 가운데를 잘라 화면을 채운다 */
function coverDraw(ctx, img) {
  const scale = Math.max(W / img.width, H / img.height);
  const w = img.width * scale, h = img.height * scale;
  /* 세로로는 조금 위쪽을 남긴다 — 인물 사진에서 머리가 잘리는 것을 줄인다 */
  ctx.drawImage(img, (W - w) / 2, (H - h) * 0.38, w, h);
}

/** 글자를 상자 폭에 맞춰 줄바꿈한다 */
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width <= maxW || !line) line = test;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

/** 정해진 줄 수 안에 들어올 때까지 글자를 줄인다 */
function fitLines(ctx, text, fontFn, maxSize, minSize, maxW, maxLines) {
  let size = maxSize;
  let lines = [];
  while (size > minSize) {
    ctx.font = fontFn(size);
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) break;
    size -= 4;
  }
  ctx.font = fontFn(size);
  return { size, lines: lines.slice(0, maxLines) };
}

/* ── 카드 한 장 ───────────────────────────────────── */
/**
 * @param {object} o
 *   photo    사진 Buffer (없으면 어두운 배경만)
 *   tag      왼쪽 위 라벨
 *   date     오른쪽 위 날짜
 *   headline 큰 글자
 *   subhead  받쳐주는 한 줄
 *   handle   왼쪽 아래 계정명
 *   swipe    오른쪽 아래에 "SWIPE →" 를 넣을지
 *   no,total 오른쪽 아래 장수 표시
 */
async function renderCard(o) {
  ensureFonts();
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');

  /* 배경 — 사진이 없거나 깨져도 카드는 나와야 한다 */
  ctx.fillStyle = '#0B0E14';
  ctx.fillRect(0, 0, W, H);
  if (o.photo) {
    try { coverDraw(ctx, await loadImage(o.photo)); }
    catch { log.warn('사진을 읽지 못해 배경 없이 그립니다.'); }
  }

  /* 아래에서 위로 깔리는 그늘. 글자가 읽히게 하고, 흐린 사진도 덮어준다. */
  const g = ctx.createLinearGradient(0, H, 0, H * 0.28);
  g.addColorStop(0, 'rgba(0,0,0,0.92)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  /* 위쪽도 살짝 눌러준다 — 태그와 날짜가 밝은 하늘에 묻히지 않게 */
  const gt = ctx.createLinearGradient(0, 0, 0, H * 0.22);
  gt.addColorStop(0, 'rgba(0,0,0,0.55)');
  gt.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gt; ctx.fillRect(0, 0, W, H * 0.22);

  /* ── 위쪽 줄: 날짜(왼) · 태그(오) ── */
  const ts = Math.round(W * 0.026);
  ctx.textBaseline = 'middle';

  if (o.date) {
    ctx.font = F.bold(ts);
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'left';
    ctx.fillText(String(o.date).toUpperCase(), M, M + ts);
  }
  if (o.tag) {
    const label = String(o.tag).toUpperCase();
    ctx.font = F.bold(ts);
    const tw = ctx.measureText(label).width;
    const padX = ts * 0.8, padY = ts * 0.55;
    const bw = tw + padX * 2, bh = ts + padY * 2;
    const bx = W - M - bw, by = M + ts - bh / 2;
    ctx.fillStyle = C.chipBg;
    roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'left';
    ctx.fillText(label, bx + padX, M + ts + 1);
  }

  /* ── 아래쪽: 헤드라인 + 서브헤드 ── */
  const boxW = W - M * 2;
  const bottomLine = H - M - W * 0.055;       // 계정명이 놓이는 자리

  /* 셋째 카드는 답을 자세히 적는 자리라 본문이 길다. 제목을 그대로 크게 두면
   * 본문이 화면 밖으로 밀린다. 그래서 본문 길이를 보고 제목 크기를 먼저 정한다. */
  const subText = String(o.subhead || '').trim();
  const longBody = subText.length > 110;

  const hs = fitLines(ctx, String(o.headline || '').toUpperCase(),
    F.head,
    longBody ? W * 0.098 : W * 0.135,
    longBody ? W * 0.052 : W * 0.062,
    boxW,
    longBody ? 2 : 4);
  const lh = hs.size * 0.98;

  let subLines = [];
  let ss = 0;
  if (subText) {
    /* 짧은 줄은 크게, 긴 답은 줄여서 여섯 줄까지 담는다. */
    const fitted = fitLines(ctx, subText, F.body,
      Math.round(W * 0.032), Math.round(W * 0.024), boxW, longBody ? 6 : 3);
    ss = fitted.size;
    subLines = fitted.lines;
  }

  const subH = subLines.length ? subLines.length * ss * 1.38 + W * 0.028 : 0;
  const headH = hs.lines.length * lh;
  let y = bottomLine - W * 0.085 - subH - headH;

  /* 헤드라인 */
  ctx.font = F.head(hs.size);
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const line of hs.lines) { ctx.fillText(line, M, y); y += lh; }

  /* 서브헤드 */
  if (subLines.length) {
    y += W * 0.028;
    ctx.font = F.body(ss);
    ctx.fillStyle = C.dim;
    for (const line of subLines) { ctx.fillText(line, M, y); y += ss * 1.38; }
  }

  /* ── 맨 아래: 계정명 · 넘기기 표시 ── */
  const bs = Math.round(W * 0.026);
  ctx.textBaseline = 'middle';
  ctx.font = F.bold(bs);
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'left';
  ctx.fillText(o.handle || '', M, bottomLine);

  if (o.swipe) {
    ctx.font = F.bold(bs);
    ctx.fillStyle = C.accent;
    ctx.textAlign = 'right';
    ctx.fillText('SWIPE  →', W - M, bottomLine);
  } else if (o.no && o.total > 1) {
    ctx.font = F.head(Math.round(bs * 1.1));
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    ctx.fillText(`${o.no} / ${o.total}`, W - M, bottomLine);
  }

  return cv.toBuffer('image/png');
}

/**
 * 원고 한 편 → 카드 여러 장
 * @param {object} plan   write.js 가 만든 원고
 * @param {Buffer|Buffer[]} photo  배경 사진. 여러 장을 주면 카드마다 다른 것이 깔린다.
 * @param {object} opts   { handle, date }
 * @returns {Promise<Array<{buffer:Buffer,name:string}>>}
 */
async function renderCards(plan, photo, opts = {}) {
  const total = plan.slides.length;
  /* 한 장만 왔으면 그대로 돌려 쓴다 — 사진이 모자란 날에도 카드는 나와야 한다. */
  const photos = (Array.isArray(photo) ? photo : [photo]).filter(Boolean);
  const out = [];
  for (let i = 0; i < total; i++) {
    const s = plan.slides[i];
    const buffer = await renderCard({
      photo: photos.length ? photos[i % photos.length] : null,
      tag: i === 0 ? plan.tag : '',
      date: i === 0 ? opts.date : '',
      headline: s.headline,
      subhead: s.subhead,
      handle: opts.handle || '',
      swipe: i === 0 && total > 1,
      no: i + 1, total,
    });
    out.push({ buffer, name: String(i + 1).padStart(2, '0') + '.png' });
  }
  return out;
}

/* ── 직접 실행: 실제 사진 + 가짜 원고 ────────────────── */
if (require.main === module) {
  (async () => {
    const { findPhotos } = require('./photo.js');
    const demoDir = path.join(ROOT, '_demo');
    fs.mkdirSync(demoDir, { recursive: true });

    const plan = {
      tag: 'TRANSFER ALERT',
      slides: [
        { headline: 'Rodri Move Is On',
          subhead: 'The midfielder is closer to leaving than at any point this year' },
        { headline: 'So What Is Holding It Up?',
          subhead: 'Two clubs agree on the player but not on how the fee gets paid' },
        { headline: 'The Payment Structure',
          subhead: 'City want the full amount inside two seasons, while the buying club has offered five instalments. Both sides expect an answer before Friday, and talks continue at board level until then.' },
      ],
      photo_query: 'soccer stadium night',
    };

    log.step('사진 받는 중');
    const got = await findPhotos(plan.photo_query, plan.slides.length);
    if (!got.length) { log.fail('사진을 못 받았습니다.'); process.exit(2); }

    log.step('카드 그리는 중');
    const cards = await renderCards(plan, got.map(g => g.buffer), {
      handle: '@sportsnewsstation',
      date: 'August 21, 2026',
    });
    for (const c of cards) fs.writeFileSync(path.join(demoDir, c.name), c.buffer);
    log.ok(`_demo/ 에 ${cards.length}장 · 사진 ${got.length}종`);
  })().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { renderCard, renderCards, W, H };
