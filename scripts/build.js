/* build.js — 하루치 릴스를 통째로 만든다.
 *
 *   node scripts/build.js            오늘 것을 만든다 (config.publish.perDay 개)
 *   node scripts/build.js --dry      만들되 파일을 쓰지 않는다
 *   node scripts/build.js --force    이미 만들어 뒀어도 다시 만든다
 *   node scripts/build.js --one      한 개만 (시험용)
 *
 * 하는 일
 *   ① 뉴스를 모으고            (news.js)
 *   ② 원고를 쓰고              (write.js)   — Gemini
 *   ③ 사진을 구하고            (photo.js)   — Openverse / Pexels
 *   ④ 카드를 그리고            (render.js)  → 1080×1920 세 장
 *   ⑤ 영상으로 잇고            (video.js)   → reel.mp4
 *   ⑥ 큐 파일을 남긴다                      → queue/<날짜>/<슬롯>.md
 *
 * 영상을 docs/ 아래에 두는 이유: 인스타 API 는 로컬 파일을 받지 않고 공개 주소만
 * 받는다. docs/ 를 GitHub Pages 로 열어두면 커밋하는 순간 주소가 생긴다.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, config, env, tzDate, prettyDateEn, loadState, saveState, log } = require('./lib/util.js');
const { collectNews, fetchArticle } = require('./news.js');
const { writeScript } = require('./write.js');
const { findPhotos, mergeCredits, photoKey } = require('./photo.js');
const { renderCards } = require('./render.js');
const { makeVideo, hasFfmpeg, pickAudio } = require('./video.js');

const DRY   = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const ONE   = process.argv.includes('--one');

const pad2 = n => String(n).padStart(2, '0');

/* 영상은 한 편에 6~8MB 다. 하루 3편이면 한 달에 600MB —
 * 저장소가 금세 무거워지고 clone 이 느려진다. 나간 지 오래된 것은 지운다.
 * 인스타는 게시할 때 영상을 자기 서버로 복사해 가므로 원본이 없어도 게시물은 남는다. */
function pruneOldReels(keepDays) {
  const dir = path.join(ROOT, 'docs', 'reels');
  if (!fs.existsSync(dir)) return 0;
  const days = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort();
  const drop = days.slice(0, Math.max(0, days.length - keepDays));
  for (const d of drop) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  return drop.length;
}

async function main() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = Math.max(1, Math.min(10, cfg.publish?.perDay || 3));
  const st = loadState();

  /* 오늘 몇 편을 더 만들면 되는가.
   *
   * 하루 중간에 --force 로 다시 만들면 예전에는 언제나 perDay 편을 새로 만들었다.
   * 이미 한 편이 나간 뒤였으므로 그날 몫이 네 편이 되고, 게시 쪽은 세 편에서
   * 멈추므로 마지막 하나는 만들어만 놓고 아무도 안 가져가는 신세가 된다. */
  const postedToday = (st.posted_log || []).filter(p => p.date === today && !p.deleted).length;
  const target = ONE ? 1 : Math.max(0, perDay - postedToday);

  const queueDir = path.join(ROOT, 'queue', today);
  const doneDir  = path.join(ROOT, 'queue', '_done', today);

  /* 이미 만들어 뒀으면 다시 만들지 않는다 — 하루에 두 번 돌아도
   * 나간 것을 되살리거나 남은 슬롯을 다른 소재로 바꿔치지 않게. */
  const already = (fs.existsSync(queueDir) && fs.readdirSync(queueDir).length)
               || (fs.existsSync(doneDir)  && fs.readdirSync(doneDir).length);
  if (!FORCE && !DRY && already) {
    log.info(`${today} 은 이미 준비돼 있습니다 — 그대로 둡니다. (다시 만들려면 --force)`);
    return;
  }

  const base = (cfg.hosting?.pagesBase || '').replace(/\/+$/, '');
  if (!base && !DRY) {
    throw new Error('config.json 의 hosting.pagesBase 가 비어 있습니다.');
  }

  if (!DRY && !await hasFfmpeg()) {
    throw new Error('ffmpeg 이 없습니다. GitHub Actions 에는 기본으로 있고,\n' +
      '   이 컴퓨터에서 돌리시려면: winget install Gyan.FFmpeg');
  }

  /* 키가 없으면 여기서 멈춘다. 예전에는 소재마다 원고를 쓰다가 하나씩 터졌고,
   * 기사 여덟 건을 다 받아온 뒤에야 같은 이유로 다 실패했다는 것이 드러났다. */
  if (!env().GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY 가 없습니다.\n' +
      '   로컬: .env 파일에 넣으십시오\n' +
      '   서버: 저장소 Settings → Secrets → Actions 에 넣고, 워크플로가 env 로 넘기는지 보십시오');
  }

  /* ── ① 뉴스 ───────────────────────────────────── */
  /* 원고가 "이 소재는 쓰면 안 된다"고 되돌려 보내는 일이 있다(사망·사고 등).
   * 그래서 필요한 개수보다 넉넉히 받아 둔다. */
  if (!target) {
    log.info(`오늘 ${postedToday}/${perDay}편이 이미 나갔습니다 — 더 만들지 않습니다.`);
    return;
  }

  const news = await collectNews(target + 5);
  if (!news.length) { log.warn('뉴스를 하나도 못 받았습니다 — 오늘은 넘어갑니다(실패 아님).'); return; }

  if (!DRY) {
    fs.rmSync(queueDir, { recursive: true, force: true });
    fs.mkdirSync(queueDir, { recursive: true });
  }

  const made = [];

  /* 슬롯 번호는 1 부터가 아니라, 오늘 이미 나간 것 다음부터 매긴다.
   *
   * 하루 중간에 --force 로 다시 만들면 예전에는 또 01 이 붙었다. 그런데 게시하는
   * 쪽은 "같은 날 같은 슬롯"을 두 번 올리지 않도록 막고 있어서, 새로 만든 것이
   * 조용히 게시되지 않는 상태가 된다. */
  let slot = (st.posted_log || [])
    .filter(p => p.date === today)
    .reduce((max, p) => Math.max(max, Number(p.slot) || 0), 0);

  /* 최근에 쓴 사진. 같은 그림이 며칠 사이에 또 깔리지 않게 한다.
   * 창고가 42장 남짓이라 다 기억하면 금세 바닥나므로, 최근 것만 들고 간다. */
  const usedPhotos = new Set(st.recent_photos || []);

  /* 원고를 쓰다 던진 오류의 수. 모델이 "이 소재는 쓰지 말자"고 한 것과는 다르다.
   * 앞의 것은 고장이고 뒤의 것은 정상 판단이라, 끝에서 둘을 갈라 다뤄야 한다. */
  let errors = 0;

  for (const item of news) {
    if (made.length >= target) break;

    log.step(`[${made.length + 1}/${target}] ${item.title.slice(0, 64)}`);

    /* ── ② 원고 ── */
    /* 기사 본문을 먼저 읽어 온다. 못 읽으면 요약만 가지고 쓴다. */
    item.body = await fetchArticle(item.link);
    if (item.body) log.info(`원문 ${item.body.length}자`);

    let plan;
    try { plan = await writeScript(item); }
    catch (e) { errors++; log.warn(`원고 실패 — ${e.message.split('\n')[0]}`); continue; }

    if (plan.skip) { log.info(`건너뜀 — ${plan.skip_reason}`); continue; }
    log.ok(`원고 · ${plan.slides.map(s => s.headline).join(' / ')}`);

    /* ── ③ 사진 ── */
    /* 카드 수만큼 받는다. 배경이 장마다 바뀌어야 넘길 이유가 생긴다.
     * 모자라면 있는 것을 돌려 쓴다 — 한 장이라도 있으면 카드는 나온다. */
    const photos = await findPhotos(plan.photo_query, plan.slides.length, { exclude: usedPhotos });
    if (!photos.length) { log.warn(`사진을 못 찾음 ("${plan.photo_query}") — 이 소재는 넘깁니다`); continue; }
    const credit = mergeCredits(photos);

    if (DRY) { made.push({ item, plan, credit }); continue; }

    slot++;
    const id = pad2(slot);
    const outDir = path.join(ROOT, 'docs', 'reels', today, id);
    fs.mkdirSync(outDir, { recursive: true });

    /* ── ④ 카드 ── */
    const cards = await renderCards(plan, photos.map(p => p.buffer), {
      handle: cfg.account?.handle || '',
      date: prettyDateEn(today),
    });
    const cardPaths = [];
    for (const c of cards) {
      const p = path.join(outDir, c.name);
      fs.writeFileSync(p, c.buffer);
      cardPaths.push(p);
    }
    /* 첫 장은 표지로도 쓴다 — 릴스 목록에 보이는 그림이다 */
    fs.copyFileSync(cardPaths[0], path.join(outDir, 'cover.png'));

    /* ── ⑤ 영상 ── */
    const video = await makeVideo(cardPaths, path.join(outDir, 'reel.mp4'), {
      secondsPerCard: cfg.video?.secondsPerCard,
      secondsLastCard: cfg.video?.secondsLastCard,
      fade: cfg.video?.fade,
      motion: cfg.video?.motion,
      audio: pickAudio(Number(today.replace(/-/g, '')) + slot),
      seed: Number(today.replace(/-/g, '')) + slot,
    });
    log.ok(`영상 ${video.seconds.toFixed(1)}초 · ${(video.bytes / 1024 / 1024).toFixed(1)}MB · 소리 ${video.hasAudio ? '있음' : '무음'}`);

    /* ── ⑥ 큐 ── */
    const videoUrl = `${base}/reels/${today}/${id}/reel.mp4`;
    const coverUrl = `${base}/reels/${today}/${id}/cover.png`;
    fs.writeFileSync(path.join(queueDir, id + '.md'),
      queueMarkdown({ id, today, plan, item, credit, video, videoUrl, coverUrl }), 'utf8');

    /* 이번에 쓴 것을 바로 기억한다 — 같은 빌드 안의 다음 편이 또 고르지 않게. */
    for (const ph of photos) usedPhotos.add(photoKey(ph.meta));

    made.push({ item, plan, credit, photos: photos.length, seconds: video.seconds });
  }

  if (DRY) {
    log.step(`--dry — ${made.length}개를 만들 수 있습니다. 파일은 쓰지 않았습니다.`);
    made.forEach((m, i) => console.log(`  ${pad2(i + 1)}. ${m.plan.slides[0].headline} — ${m.item.source}`));
    return;
  }

  if (!made.length) {
    /* 소재가 없어서 못 만든 것과, 고장이 나서 못 만든 것을 갈라야 한다.
     *
     * 전에는 둘 다 "실패 아님"으로 끝냈다. 그래서 서버에 GEMINI_API_KEY 가 전달되지
     * 않아 여덟 건이 내리 터진 날에도 워크플로가 초록불로 끝났고, 아무도 몰랐다.
     * 무인으로 도는 파이프라인에서 조용한 성공은 조용한 실패보다 나쁘다. */
    if (errors) {
      throw new Error(`${errors}건이 모두 오류로 끝났습니다 — 위 메시지를 보십시오.\n` +
        '   (소재가 없어서가 아니라 무언가 고장난 것입니다. 시크릿·키를 먼저 확인하십시오.)');
    }
    log.warn('쓸 만한 소재가 없었습니다 — 큐를 만들지 않고 끝냅니다(실패 아님).');
    return;
  }
  if (errors) log.warn(`${errors}건은 오류로 건너뛰었습니다 (만든 것 ${made.length}편).`);

  /* 나간 이야기를 기억해 둔다 — 내일 같은 소식을 또 올리지 않기 위해 */
  st.recent_titles = [...(st.recent_titles || []), ...made.map(m => m.item.title)].slice(-60);
  /* 쓴 사진도 마찬가지. 창고가 40장 남짓이라 30장만 들고 간다 —
   * 다 기억하면 며칠 만에 "안 쓴 사진이 없음"이 되어 규칙이 무의미해진다. */
  st.recent_photos = [...usedPhotos].slice(-30);
  saveState(st);

  const pruned = pruneOldReels(cfg.hosting?.keepDays ?? 14);
  if (pruned) log.info(`오래된 영상 ${pruned}일치 정리`);

  writeIndex(cfg);

  log.step(`완성 — ${made.length}편`);
  made.forEach((m, i) => console.log(`  ${pad2(i + 1)}. ${m.plan.slides[0].headline} · ${m.seconds.toFixed(0)}초 · 사진 ${m.photos}종 · ${m.credit}`));
  log.info('커밋하면 Pages 에 올라가고, 게시 시각에 나갑니다.');
}

/** 큐 파일 — 사람이 열어봐도 무엇이 나갈지 한눈에 보이게 */
function queueMarkdown({ id, today, plan, item, credit, video, videoUrl, coverUrl }) {
  const caption = [
    plan.caption.trim(),
    '',
    credit,
    '',
    '#' + plan.hashtags.join(' #'),
  ].join('\n');

  return [
    '---',
    'slot: ' + id,
    'date: ' + today,
    'seconds: ' + video.seconds.toFixed(1),
    'video: ' + videoUrl,
    'cover: ' + coverUrl,
    'source: ' + item.source,
    'source_title: ' + item.title.replace(/\n/g, ' '),
    'photo_query: ' + plan.photo_query,
    'alt_text: ' + (plan.alt_text || '').replace(/\n/g, ' '),
    '---',
  ].join('\n') + '\n' + caption + '\n';
}

/** docs/index.html — 만든 릴스를 눈으로 확인하는 보관함 */
function writeIndex(cfg) {
  const dir = path.join(ROOT, 'docs', 'reels');
  const days = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).sort().reverse()
    : [];

  const blocks = days.map(day => {
    const dayDir = path.join(dir, day);
    const slots = fs.readdirSync(dayDir).filter(s => fs.statSync(path.join(dayDir, s)).isDirectory()).sort();
    const cells = slots.map(s =>
      `<figure><video src="reels/${day}/${s}/reel.mp4" poster="reels/${day}/${s}/cover.png" controls preload="none" playsinline></video><figcaption>${s}</figcaption></figure>`
    ).join('');
    return `<section><h2>${day} <span>${slots.length}편</span></h2><div class="row">${cells}</div></section>`;
  }).join('\n');

  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${cfg.account?.brand || '릴스 보관함'}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:24px; background:#0B0E14; color:#E7ECF3;
         font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; }
  p.note { color:#9AA6B8; margin:0 0 28px; }
  section { margin-bottom:34px; }
  h2 { font-size:15px; margin:0 0 12px; font-weight:600; }
  h2 span { color:#9AA6B8; font-weight:400; }
  .row { display:flex; gap:14px; overflow-x:auto; padding-bottom:8px; }
  figure { margin:0; }
  video { height:420px; border-radius:12px; display:block; background:#000; }
  figcaption { color:#9AA6B8; font-size:12px; margin-top:6px; }
</style>
<h1>${cfg.account?.brand || '릴스 보관함'}</h1>
<p class="note">인스타에 나가는 릴스입니다. 이 주소는 인스타 서버가 영상을 가져가는 데 쓰입니다.</p>
${blocks || '<p class="note">아직 만든 릴스가 없습니다.</p>'}
`;
  fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), html, 'utf8');
}

main().catch(e => { log.fail(e.message); process.exit(1); });
