/* avatar.js — 프로필 사진 후보를 만든다. (일회용 도구, 매일 도는 파이프라인과 무관)
 *
 *   node scripts/avatar.js        _avatar/ 에 후보와 미리보기를 만든다
 *
 * ── 무엇을 신경 썼나 ─────────────────────────────────────
 * 프로필 사진은 피드에서 40픽셀쯤으로 보인다. 1080픽셀에서 멋있어도 그 크기에서
 * 뭉개지면 아무 소용이 없다. 그래서 글자는 세 자를 넘기지 않고, 그림은 형태
 * 하나로 알아볼 수 있는 것만 쓴다.
 *
 * 인스타는 정사각형을 원으로 잘라낸다. 모서리에 있는 것은 잘려 나가므로
 * 중요한 것은 안쪽 원 안에 둔다.
 *
 * 색과 서체는 카드와 같은 것을 쓴다. 프로필과 게시물이 한 덩어리로 보여야 한다.
 */
const fs = require('fs');
const path = require('path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { ROOT, log } = require('./lib/util.js');

const S = 1080;                       // 만드는 크기
const C = {
  dark:   '#0B0E14',
  accent: '#F7C63F',
  ink:    '#FFFFFF',
};

function fonts() {
  const dir = path.join(ROOT, 'assets', 'fonts');
  for (const [file, name] of [['Anton-Regular.ttf', 'Anton'], ['Pretendard-Bold.otf', 'PretendardBold']]) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) throw new Error('서체가 없습니다: ' + file);
    GlobalFonts.registerFromPath(p, name);
  }
}

/** 정사각형 안에 원을 그려 배경을 채운다 (인스타가 어차피 원으로 자른다) */
function base(ctx, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, S, S);
}

/** 오각형 하나 */
function pentagon(ctx, cx, cy, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + i * (Math.PI * 2 / 5);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** 축구공.
 *
 * 처음에는 가운데 오각형에서 가장자리로 선을 뻗었는데, 축구공이 아니라 수레바퀴로
 * 보였다. 진짜 축구공이 눈에 그렇게 남는 이유는 선이 아니라 "흰 바탕에 검은 오각형"
 * 이라는 얼룩 때문이다. 그래서 가운데 오각형 하나와, 가장자리에서 반쯤 잘려 보이는
 * 오각형 다섯 개를 놓는다. 40픽셀로 줄여도 그 얼룩은 남는다. */
function ball(ctx, cx, cy, r, body, spot) {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = body; ctx.fill();
  ctx.clip();                                  // 가장자리 오각형이 공 밖으로 나가지 않게

  ctx.fillStyle = spot;
  const up = -Math.PI / 2;
  pentagon(ctx, cx, cy, r * 0.34, up);

  /* 가운데 오각형의 각 변 바깥쪽에 하나씩. 변의 방향은 꼭짓점에서 36도 돌아간 자리다. */
  for (let i = 0; i < 5; i++) {
    const a = up + (i + 0.5) * (Math.PI * 2 / 5);
    pentagon(ctx,
      cx + Math.cos(a) * r * 0.86,
      cy + Math.sin(a) * r * 0.86,
      r * 0.34,
      a + Math.PI / 2);
  }
  ctx.restore();
}

/* ── 후보 A — 이니셜 ───────────────────────────────────
 * 40픽셀에서도 글자 셋은 읽힌다. 계정 이름과 곧바로 이어진다. */
function monogram() {
  const cv = createCanvas(S, S);
  const ctx = cv.getContext('2d');
  base(ctx, C.dark);

  ctx.strokeStyle = C.accent;
  ctx.lineWidth = S * 0.022;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.455, 0, Math.PI * 2); ctx.stroke();

  ctx.fillStyle = C.ink;
  ctx.font = `${Math.round(S * 0.40)}px Anton`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FTN', S / 2, S * 0.455);

  /* 이름 아래 노란 막대 — 작게 줄어도 색이 남아 눈에 띈다 */
  ctx.fillStyle = C.accent;
  ctx.fillRect(S * 0.30, S * 0.665, S * 0.40, S * 0.045);

  return cv.toBuffer('image/png');
}

/* ── 후보 B — 공 하나 ──────────────────────────────────
 * 글자가 없으니 어느 크기에서도 뭉개지지 않는다. 노란 바탕이라
 * 사진이 늘어선 피드에서 눈에 걸린다. */
function ballOnly() {
  const cv = createCanvas(S, S);
  const ctx = cv.getContext('2d');
  base(ctx, C.accent);
  ball(ctx, S / 2, S / 2, S * 0.33, C.ink, C.dark);
  return cv.toBuffer('image/png');
}

/* ── 후보 C — 공과 화살표 ──────────────────────────────
 * 이적은 "옮겨 간다"는 뜻이다. 화살표가 그것을 한 형태로 말해준다. */
function ballArrow() {
  const cv = createCanvas(S, S);
  const ctx = cv.getContext('2d');
  base(ctx, C.dark);

  /* 화살표를 크게 잡는다. 작게 줄이면 두 형태가 서로를 갉아먹으므로
   * 하나가 확실히 주인공이어야 한다. 여기서는 화살표다. */
  const y = S / 2;
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.moveTo(S * 0.20, y - S * 0.085);
  ctx.lineTo(S * 0.60, y - S * 0.085);
  ctx.lineTo(S * 0.60, y - S * 0.20);
  ctx.lineTo(S * 0.85, y);
  ctx.lineTo(S * 0.60, y + S * 0.20);
  ctx.lineTo(S * 0.60, y + S * 0.085);
  ctx.lineTo(S * 0.20, y + S * 0.085);
  ctx.closePath();
  ctx.fill();

  /* 공은 화살표 꼬리에 걸터앉는다. 배경색 테두리로 화살표와 떼어놓는다. */
  ctx.fillStyle = C.dark;
  ctx.beginPath(); ctx.arc(S * 0.30, y, S * 0.235, 0, Math.PI * 2); ctx.fill();
  ball(ctx, S * 0.30, y, S * 0.205, C.ink, C.dark);

  return cv.toBuffer('image/png');
}

/** 후보들을 실제 크기(작게)로 나란히 붙여 보여준다 — 이게 판단 기준이다 */
function preview(items) {
  const sizes = [160, 96, 48];          // 프로필 · 스토리 링 · 피드
  const pad = 40;
  const w = pad + items.length * (200 + pad);
  const h = 150 + sizes.reduce((a, s) => a + s + 34, 0);

  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#111';
  ctx.font = '26px PretendardBold';
  ctx.textAlign = 'center';
  items.forEach((it, i) => ctx.fillText(it.name, pad + i * (200 + pad) + 100, 44));

  let y = 80;
  for (const s of sizes) {
    ctx.fillStyle = '#888';
    ctx.font = '20px PretendardBold';
    ctx.textAlign = 'left';
    ctx.fillText(s + 'px', 8, y + s / 2);

    items.forEach((it, i) => {
      const cx = pad + i * (200 + pad) + 100;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, y + s / 2, s / 2, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(it.img, cx - s / 2, y, s, s);
      ctx.restore();
    });
    y += s + 34;
  }
  return cv.toBuffer('image/png');
}

if (require.main === module) {
  fonts();
  const dir = path.join(ROOT, '_avatar');
  fs.mkdirSync(dir, { recursive: true });

  const made = [
    { name: 'A · 이니셜', file: 'A-monogram.png', buf: monogram() },
    { name: 'B · 공',     file: 'B-ball.png',     buf: ballOnly() },
    { name: 'C · 공+화살표', file: 'C-arrow.png',  buf: ballArrow() },
  ];

  const { loadImage } = require('@napi-rs/canvas');
  (async () => {
    for (const m of made) fs.writeFileSync(path.join(dir, m.file), m.buf);
    const items = [];
    for (const m of made) items.push({ name: m.name, img: await loadImage(m.buf) });
    fs.writeFileSync(path.join(dir, '_preview.png'), preview(items));
    log.ok(`_avatar/ 에 후보 ${made.length}개와 미리보기 저장`);
  })().catch(e => { log.fail(e.message); process.exit(1); });
}
