/* build.js — 하루치 게시물을 통째로 만든다. 하루 여러 개를 "슬롯"으로 나눠 만든다.
 *
 *   node scripts/build.js            오늘 것을 만든다 (config.publish.perDay 개)
 *   node scripts/build.js --dry      만들되 파일을 쓰지 않고 보여만 준다
 *   node scripts/build.js --force    이미 만들어 둔 것이 있어도 다시 만든다
 *
 * 하는 일
 *   ① 데이터를 perDay 개만큼 받고   (collect.js)
 *   ② 슬롯마다 카드를 그리고        (render.js)  → docs/cards/<날짜>/<슬롯>/01.png ...
 *   ③ 슬롯마다 캡션을 짓고          (caption.js)
 *   ④ 슬롯마다 큐 파일을 남긴다                  → queue/<날짜>/01.md ... 06.md
 *
 * 슬롯으로 나누는 이유
 *   하루 6개를 한 파일에 몰아 넣으면, 3번째에서 실패했을 때 무엇이 나갔고
 *   무엇이 안 나갔는지 알 수 없다. 슬롯을 파일 하나씩으로 쪼개 두면
 *   나간 것은 _done 으로 옮겨지고 남은 것은 그대로 남아, 다음 시각에 이어서 나간다.
 *
 * 카드를 docs/ 아래에 두는 이유
 *   인스타 API 는 로컬 파일을 받지 않고 공개 주소만 받는다. docs/ 를 GitHub Pages 로
 *   열어두면 커밋하는 순간 그 카드가 주소를 갖는다. 별도 서버도 결제도 필요 없다.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, config, tzDate, loadState, saveState, log } = require('./lib/util.js');
const { collectMany } = require('./collect.js');
const { renderCards } = require('./render.js');
const { buildCaption } = require('./caption.js');

const DRY   = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

const pad2 = n => String(n).padStart(2, '0');

async function main() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = Math.max(1, Math.min(20, cfg.publish?.perDay || 1));
  const st = loadState();

  const queueDir = path.join(ROOT, 'queue', today);
  const doneDir  = path.join(ROOT, 'queue', '_done', today);

  /* ── 이미 만들어 뒀으면 다시 만들지 않는다 ────────────
   * 하루에 두 번 도는 일이 생겨도, 이미 나간 것을 되살리거나
   * 남은 슬롯을 다른 소재로 바꿔치기하면 안 된다. */
  const already = (fs.existsSync(queueDir) && fs.readdirSync(queueDir).length)
               || (fs.existsSync(doneDir)  && fs.readdirSync(doneDir).length);
  if (!FORCE && !DRY && already) {
    log.info(`${today} 은 이미 준비돼 있습니다 — 그대로 둡니다. (다시 만들려면 --force)`);
    return;
  }

  /* ── 호스팅 주소가 없으면 시작도 하지 않는다 ──────────
   * 카드를 다 그린 뒤에 주소가 없다고 멈추면 헛일이 된다. */
  const base = (cfg.hosting?.pagesBase || '').replace(/\/+$/, '');
  if (!base && !DRY) {
    throw new Error('config.json 의 hosting.pagesBase 가 비어 있습니다.\n' +
      '   예: "https://내아이디.github.io/sports-insta"');
  }

  /* ── ① 데이터 ─────────────────────────────────── */
  const materials = await collectMany(perDay, st.league_cursor || 0);
  if (!materials.length) {
    log.warn('오늘 쓸 소재가 하나도 없습니다 — 큐를 만들지 않고 끝냅니다(실패 아님).');
    return;
  }

  if (!DRY) {
    fs.rmSync(queueDir, { recursive: true, force: true });
    fs.mkdirSync(queueDir, { recursive: true });
  }

  /* ── ②③④ 슬롯마다 카드·캡션·큐 ───────────────── */
  const made = [];
  for (let i = 0; i < materials.length; i++) {
    const slot = pad2(i + 1);
    const data = materials[i];

    log.step(`슬롯 ${slot} · ${data.league.name} · ${data.kind}`);

    const cards = renderCards(data, {
      handle: cfg.account?.handle || '',
      maxSlides: cfg.publish?.maxSlides || 8,
    });
    const caption = buildCaption(data, cfg);
    log.info(`카드 ${cards.length}장 · 캡션 ${caption.length}자 · 첫 줄 "${caption.split('\n')[0].slice(0, 40)}"`);

    if (DRY) { made.push({ slot, data, cards: cards.length }); continue; }

    const cardDir = path.join(ROOT, 'docs', 'cards', today, slot);
    fs.rmSync(cardDir, { recursive: true, force: true });
    fs.mkdirSync(cardDir, { recursive: true });

    const urls = [];
    for (const c of cards) {
      fs.writeFileSync(path.join(cardDir, c.name), c.buffer);
      urls.push(`${base}/cards/${today}/${slot}/${c.name}`);
    }

    fs.writeFileSync(path.join(queueDir, slot + '.md'),
      queueMarkdown(data, urls, caption, slot), 'utf8');
    made.push({ slot, data, cards: cards.length });
  }

  if (DRY) {
    log.step(`--dry — ${made.length}개를 만들 수 있습니다. 파일은 쓰지 않았습니다.`);
    made.forEach(m => console.log(`  ${m.slot}. ${m.data.league.name} · ${m.data.kind} · 카드 ${m.cards}장`));
    return;
  }

  log.step(`완성 — 슬롯 ${made.length}개`);
  made.forEach(m => console.log(`  ${m.slot}. ${m.data.league.name} · ${m.data.kind} · 카드 ${m.cards}장`));

  /* 다음 날에는 다른 리그가 앞자리에 오도록 순번을 민다 */
  const leagues = cfg.leagues || [];
  st.league_cursor = ((st.league_cursor || 0) + materials.length) % Math.max(leagues.length, 1);
  saveState(st);

  writeIndex(cfg);
  log.step('이제 커밋하면 Pages 에 카드가 올라가고, 슬롯 시각마다 하나씩 나갑니다.');
}

/** 큐 파일 — 사람이 열어봐도 무엇이 나갈지 한눈에 보이게 쓴다 */
function queueMarkdown(d, urls, caption, slot) {
  return [
    '---',
    'slot: ' + slot,
    'kind: ' + d.kind,
    'league: ' + d.league.key,
    'date: ' + d.date,
    'source: ' + d.source,
    'images:',
    ...urls.map(u => '  - ' + u),
    '---',
  ].join('\n') + '\n' + caption + '\n';
}

/** docs/index.html — Pages 첫 화면. 만든 카드를 눈으로 확인할 수 있게 한다. */
function writeIndex(cfg) {
  const dir = path.join(ROOT, 'docs', 'cards');
  const days = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort().reverse().slice(0, 14)
    : [];

  const blocks = days.map(day => {
    const dayDir = path.join(dir, day);
    const slots = fs.readdirSync(dayDir).filter(s => fs.statSync(path.join(dayDir, s)).isDirectory()).sort();
    const rows = slots.map(slot => {
      const imgs = fs.readdirSync(path.join(dayDir, slot)).filter(f => f.endsWith('.png')).sort();
      const thumbs = imgs.map(f =>
        `<a href="cards/${day}/${slot}/${f}"><img src="cards/${day}/${slot}/${f}" loading="lazy" alt="${day} ${slot} ${f}"></a>`
      ).join('');
      return `<div class="slot"><b>${slot}</b><div class="row">${thumbs}</div></div>`;
    }).join('');
    return `<section><h2>${day} <span>${slots.length}개</span></h2>${rows}</section>`;
  }).join('\n');

  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${cfg.account?.brand || '카드 보관함'}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#0B0E14; color:#E7ECF3;
         font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; }
  p.note { color:#9AA6B8; margin:0 0 28px; }
  section { margin-bottom:34px; }
  h2 { font-size:15px; margin:0 0 12px; font-weight:600; }
  h2 span { color:#9AA6B8; font-weight:400; }
  .slot { margin-bottom:14px; }
  .slot b { color:#F7C63F; font-size:13px; }
  .row { display:flex; gap:10px; overflow-x:auto; padding:6px 0; }
  .row img { height:200px; border-radius:10px; display:block; }
</style>
<h1>${cfg.account?.brand || '카드 보관함'}</h1>
<p class="note">인스타에 나가는 카드입니다. 이 주소는 인스타 서버가 그림을 가져가는 데 쓰입니다.</p>
${blocks || '<p class="note">아직 만든 카드가 없습니다.</p>'}
`;
  fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), html, 'utf8');
}

main().catch(e => { log.fail(e.message); process.exit(1); });
