/* news.js — 스포츠 뉴스를 모아 오늘 쓸 후보를 고른다.
 *
 *   node scripts/news.js            오늘 후보 목록을 보여준다
 *   node scripts/news.js --json     기계가 읽을 형태로
 *
 * ── 왜 RSS 인가 ───────────────────────────────────────────
 * 키가 필요 없고, 언론사가 공개하라고 내놓은 창구라 긁어도 문제가 없다.
 * 다만 RSS 로 받는 것은 제목과 두어 줄 요약뿐이다. 그것으로 충분하다 —
 * 우리는 기사를 옮기는 것이 아니라, 무슨 일이 있었는지만 알면 되기 때문이다.
 * 실제 문장은 write.js 가 처음부터 새로 쓴다.
 *
 * ── 같은 이야기를 두 번 올리지 않는다 ─────────────────────
 * 여러 매체가 같은 사건을 동시에 낸다. 제목에서 핵심 낱말만 뽑아 견주고,
 * 이미 나간 것과 겹치면 버린다. 같은 소식을 이틀 연속 올리면 신뢰를 잃는다.
 */
const { config, loadState, getJSON, log } = require('./lib/util.js');

/* 언론사가 공개한 RSS. 여기서 받는 것은 제목·요약·링크뿐이다. */
const FEEDS = [
  { name: 'ESPN',       url: 'https://www.espn.com/espn/rss/news' },
  { name: 'BBC Sport',  url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  { name: 'Sky Sports', url: 'https://www.skysports.com/rss/12040' },
  { name: 'Yahoo',      url: 'https://sports.yahoo.com/rss/' },
];

/* ── XML 을 최소한으로 읽는다 ────────────────────────────
 * RSS 는 모양이 단순해서 정규식으로 충분하다. 파서를 하나 더 끌어오면
 * 그것이 깨질 때 파이프라인 전체가 멈춘다. 의존성은 적을수록 좋다. */
const strip = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? strip(m[1]) : '';
};

async function fetchFeed(feed) {
  const r = await fetch(feed.url, { headers: { 'user-agent': 'Mozilla/5.0 (sports-insta)' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const xml = await r.text();
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map(b => ({
    source: feed.name,
    title: tag(b, 'title'),
    summary: tag(b, 'description').slice(0, 400),
    link: (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]?.trim() || '',
    published: tag(b, 'pubDate'),
  })).filter(x => x.title);
}

/* ── 같은 이야기인지 견주기 ──────────────────────────────
 * 제목에서 흔한 낱말을 걷어내고 남은 것으로 지문을 만든다.
 * "Arsenal beat Chelsea 3-1" 과 "Chelsea lose to Arsenal" 은
 * {arsenal, chelsea} 가 겹치므로 같은 이야기로 본다. */
const STOP = new Set(`the a an and or but of to in on at for with from by as is are was were be been
  his her its their this that these those he she they it we you i not no vs v after before over under
  new news says said say will would can could has have had do does did what why how who when where`.split(/\s+/));

function fingerprint(title) {
  return new Set(
    String(title).toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP.has(w))
  );
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / Math.min(a.size, b.size);
}

/**
 * 오늘 쓸 후보를 모은다.
 * @param {number} want  몇 개까지
 * @returns {Promise<Array>} [{source,title,summary,link,published}]
 */
async function collectNews(want = 5) {
  const cfg = config();
  const st = loadState();

  log.step(`뉴스 수집 · ${FEEDS.length}개 매체`);

  const all = [];
  for (const f of FEEDS) {
    try {
      const items = await fetchFeed(f);
      log.ok(`${f.name} ${items.length}건`);
      all.push(...items);
    } catch (e) {
      log.warn(`${f.name} 실패 — ${e.message}`);
    }
  }
  if (!all.length) return [];

  /* 이미 나간 이야기의 지문 (최근 30건이면 충분하다) */
  /* 나간 이야기의 지문. 두 곳을 다 본다 —
   * posted_log 는 실제로 게시된 것, recent_titles 는 만들어 둔 것.
   * 만들어 두고 아직 안 나간 것도 중복으로 쳐야 같은 소식이 두 번 실리지 않는다. */
  const posted = [
    ...(st.posted_log || []).slice(-30).map(p => p.title || ''),
    ...(st.recent_titles || []).slice(-60),
  ].filter(Boolean).map(fingerprint);

  /* 관심 종목으로 거르기. 비어 있으면 거르지 않는다. */
  const keywords = (cfg.news?.keywords || []).map(k => k.toLowerCase());
  const matches = it => !keywords.length ||
    keywords.some(k => (it.title + ' ' + it.summary).toLowerCase().includes(k));

  /* 매체를 번갈아 본다. 그냥 순서대로 훑으면 첫 매체가 후보를 다 차지해서
   * 하루치가 한 곳의 시각으로만 채워진다. 매체가 섞여야 소재도 섞인다. */
  const bySource = new Map();
  for (const it of all) {
    if (!bySource.has(it.source)) bySource.set(it.source, []);
    bySource.get(it.source).push(it);
  }
  const queues = [...bySource.values()];
  const interleaved = [];
  for (let i = 0; interleaved.length < all.length; i++) {
    let added = false;
    for (const q of queues) if (q[i]) { interleaved.push(q[i]); added = true; }
    if (!added) break;
  }

  const picked = [];
  const seen = [];

  for (const it of interleaved) {
    if (picked.length >= want) break;
    if (!matches(it)) continue;
    if (it.title.length < 15) continue;               // 너무 짧으면 이야기가 없다

    const fp = fingerprint(it.title);
    if (fp.size < 2) continue;                        // 알맹이가 없는 제목
    if (posted.some(p => overlap(fp, p) >= 0.6)) continue;   // 전에 나간 이야기
    if (seen.some(p => overlap(fp, p) >= 0.6)) continue;     // 오늘 이미 고른 이야기

    seen.push(fp);
    picked.push(it);
  }

  log.step(`후보 ${picked.length}건 (전체 ${all.length}건 중)`);
  return picked;
}

/* ── 직접 실행 ─────────────────────────────────────── */
if (require.main === module) {
  (async () => {
    const cfg = config();
    const items = await collectNews(cfg.publish?.perDay || 3);
    if (process.argv.includes('--json')) { console.log(JSON.stringify(items, null, 2)); return; }
    console.log('');
    items.forEach((it, i) => {
      console.log(`${String(i + 1).padStart(2, '0')}. [${it.source}] ${it.title}`);
      if (it.summary) console.log(`    ${it.summary.slice(0, 110)}`);
      console.log('');
    });
  })().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { collectNews, fingerprint, overlap, FEEDS };
