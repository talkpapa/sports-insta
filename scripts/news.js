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

/* 언론사가 공개한 RSS. 여기서 받는 것은 제목·요약·링크뿐이다.
 *
 * ── 왜 이적시장만 보는가 ─────────────────────────────────
 * 처음에는 종합 스포츠 피드를 썼다. 그런데 "BBC 가 쓴 것을 카드로 옮긴 것"은
 * ESPN 공식 계정과 같은 자리에서 겨루는 일이라 볼 이유가 남과 다르지 않다.
 *
 * 이적 소식은 다르다. 협상은 며칠에서 몇 주에 걸쳐 이어지므로 경기 결과처럼
 * 하루 만에 죽지 않고, 사람들이 저장하고 친구에게 보낸다. */
const FEEDS = [
  { name: 'Sky Sports',  url: 'https://www.skysports.com/rss/11095' },             // 이적센터
  { name: 'Guardian',    url: 'https://www.theguardian.com/football/transfer-window/rss' },
  { name: 'BBC Sport',   url: 'https://feeds.bbci.co.uk/sport/football/rss.xml' },
  { name: 'Guardian FC', url: 'https://www.theguardian.com/football/rss' },
  { name: 'ESPN',        url: 'https://www.espn.com/espn/rss/soccer/news' },
];

/* ── XML 을 최소한으로 읽는다 ────────────────────────────
 * RSS 는 모양이 단순해서 정규식으로 충분하다. 파서를 하나 더 끌어오면
 * 그것이 깨질 때 파이프라인 전체가 멈춘다. 의존성은 적을수록 좋다. */
/* 실체(&lt; 등)를 먼저 풀고 나서 태그를 지운다.
 * 순서가 반대면 &lt;p&gt; 로 실려 온 태그가 살아남아 원고에 <p> 가 박힌다.
 * 실제로 가디언 요약이 그렇게 들어왔다. */
const entities = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;/g, '’')
  .replace(/&amp;/g, '&');                 // & 는 마지막에 — 이중 인코딩을 한 겹씩 푼다

const strip = s => entities(entities(String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')))
  .replace(/<[^>]+>/g, ' ')
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
      /* Álvarez 와 Alvarez 가 다른 낱말로 잡히면 같은 이적 소식을 두 번 올리게 된다.
       * 악센트를 떼어 같은 글자로 만든다. */
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
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

/* 축구 기사라면 어디에나 나오는 말. 이런 낱말이 겹치는 것은 아무 뜻이 없다.
 * 구단 이름과 선수 이름만 남기려는 것이다. */
const COMMON = new Set(`transfer transfers deal deals sign signs signed signing signings
  move moves joins join joined exit leave sold sell buy bid bids fee fees offer offers
  agree agreed agrees talks agreement contract contracts wages clause loan swap medical
  club clubs side team squad player players star signing target linked interest
  season seasons league premier championship football soccer window summer winter
  manager boss coach head striker forward winger midfielder defender keeper goalkeeper
  goal goals match game win loss draw price value worth million billion record
  right left back front new old big massive huge major latest sources report reports
  explained rise fall thrive actually still first next last another among amid ahead
  /* 구단 이름을 이루는 조각들. 이것을 빼지 않으면 "Man City" 하나가 이름 둘로 세어져,
   * 선수가 서로 다른 두 소식이 같은 이야기로 묶인다. */
  man city united utd fc afc town wanderers rovers albion athletic county
  liverpool arsenal chelsea tottenham spurs everton newcastle villa palace forest
  brighton fulham brentford bournemouth wolves burnley leeds sunderland
  madrid barcelona atletico sevilla valencia bayern dortmund leipzig
  juventus milan inter napoli roma lazio psg marseille lyon monaco
  ajax feyenoord porto benfica sporting celtic rangers`.split(/\s+/));

/** 지문에서 곁가지를 걷어낸 것 — 구단·선수 이름만 남는다 */
function distinctive(fp) {
  const out = new Set();
  for (const w of fp) {
    if (COMMON.has(w)) continue;
    if (/^[0-9]/.test(w)) continue;        // 120m, 50m 같은 금액
    out.add(w);
  }
  return out;
}

/**
 * 같은 이야기인가.
 *
 * 겹치는 비율만 보면 안 된다. "Liverpool agree £120m deal in principle for Barcola" 와
 * "Barcola's rise explained but is he actually right for Liverpool?" 는 겹침이 0.33 이라
 * 기준(0.6)에 안 걸렸는데, 하필 겹친 둘이 liverpool 과 barcola 였다. 같은 이적을
 * 두 각도에서 쓴 것이고, 그날 세 편 중 두 편이 같은 선수 이야기로 나갔다.
 *
 * 그래서 흔한 말과 구단 이름을 걷어낸다. 남는 것은 대개 선수 이름이고,
 * 그것이 하나라도 겹치면 같은 이적 이야기다.
 *
 * 구단 이름을 빼는 것이 중요하다. 빼지 않으면 "Man City" 가 이름 둘로 세어져
 * 선수가 서로 다른 두 소식이 한 이야기로 묶인다.
 */
function sameStory(a, b) {
  if (overlap(a, b) >= 0.6) return true;
  const da = distinctive(a), db = distinctive(b);
  for (const w of da) if (db.has(w)) return true;
  return false;
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

  /* 관심 낱말로 거르기. 비어 있으면 거르지 않는다.
   *
   * 낱말 경계를 본다. 그냥 포함 여부로 보면 "deal" 이 "dealing" 에, "sign" 이
   * "designs" 에 걸려 엉뚱한 기사가 이적 소식으로 들어온다. 좁히려고 거르는
   * 것이니 여기서 새면 좁힌 뜻이 없다.
   * 다만 "£" 나 "€" 같은 기호는 낱말 경계가 없으므로 그대로 찾는다. */
  const keywords = (cfg.news?.keywords || []).map(k => k.toLowerCase()).filter(Boolean);
  const tests = keywords.map(k => {
    if (!/^[a-z]/.test(k)) return { plain: k };
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { re: new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, 'i') };
  });
  const matches = it => {
    if (!tests.length) return true;
    const text = (it.title + ' ' + it.summary).toLowerCase();
    return tests.some(t => (t.re ? t.re.test(text) : text.includes(t.plain)));
  };

  /* 카드로 만들 수 없는 글을 걸러낸다.
   *
   * 이적 피드의 상당수는 하루 종일 갱신되는 실시간 블로그와 소문 모음이다
   * ("Transfer Centre LIVE!", "transfer rumours: A to B? C to D?").
   * 하나의 사실이 없어서 "제목 → 질문 → 답" 구조를 채울 수 없고, 억지로 쓰면
   * 모델이 없는 내용을 지어내게 된다. 실제로 이것들만 후보로 올라온 적이 있다. */
  const NOT_A_STORY = [
    'live!', ' live blog', '– live', '- live', 'as it happened', 'clockwatch',
    'rumours:', 'gossip', 'transfer talk:', 'round-up', 'roundup',
    'quiz', 'podcast', 'newsletter', 'sign up', 'what to watch', 'best of',
    /* 아래는 8월 24일에 여섯 건을 건너뛰게 만든 것들이다. 설명형으로 바꾼 뒤로는
     * "무슨 일이 있었다"만 있고 왜인지가 없는 글이 쓸모없어졌는데, 이 꼴들이
     * 정확히 그렇다. 원고를 시켜보고 버리면 무료 한도만 태우므로 미리 뺀다. */
    'papers:',            // 조간 신문 소문 모음
    'latest:',            // "Man Utd latest: Baleba passes medical" — 제목이 전부다
    'european football:', // 주간 경기 정리
    'all deals',          // 이적 창구 목록 페이지
    'transfer window summer', 'transfer window winter',
    'ratings', 'player ratings', 'talking points', 'things we learned',
  ];
  const isStory = it => {
    const t = (it.title || '').toLowerCase();
    if (NOT_A_STORY.some(w => t.includes(w))) return false;
    /* 제목에 물음표가 둘 이상이면 여러 소문을 이어붙인 모음이다 */
    if ((t.match(/\?/g) || []).length >= 2) return false;
    return true;
  };

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
    if (!isStory(it)) continue;                       // 실시간 블로그·소문 모음
    if (it.title.length < 15) continue;               // 너무 짧으면 이야기가 없다

    const fp = fingerprint(it.title);
    if (fp.size < 2) continue;                        // 알맹이가 없는 제목
    if (posted.some(p => sameStory(fp, p))) continue;        // 전에 나간 이야기
    if (seen.some(p => sameStory(fp, p))) continue;          // 오늘 이미 고른 이야기

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


/* ── 원문 본문 받아오기 ──────────────────────────────────
 * RSS 요약은 한두 문장뿐이다. "무슨 일이 있었나"는 알 수 있어도 "왜 그런가"는
 * 담기지 않는다. 설명형 카드로 바꾼 뒤 여섯 건 중 넷이 "설명할 재료가 없다"며
 * 건너뛰어졌다. 그래서 기사 본문을 읽어 원고 쓰는 쪽에 같이 넘긴다.
 *
 * 본문은 사실을 파악하는 데만 쓴다. 문장은 write.js 가 처음부터 새로 쓴다 —
 * 사실은 남의 것이 아니지만 문장은 남의 것이다.
 *
 * 실패해도 그냥 빈 문자열을 돌려준다. 원문을 못 읽는 것은 흔한 일이고,
 * 그때는 요약만 가지고 쓰다가 모자라면 그 소재를 건너뛰면 된다. */

/* 기사가 아니라 사이트 껍데기인 문단을 가려내는 말들 */
const CHROME = /sign in|skip to content|newsletter|cookie|subscription|follow us|©|all rights reserved|toggle caption|search jobs|edition|advertisement|share this|download the app/i;

const MAX_BODY = 4000;      // 이보다 길면 앞부분만. 뒤로 갈수록 곁가지다.

function articleText(html) {
  let h = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')      // 사진 설명은 본문이 아니다
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  /* 본문 영역이 표시돼 있으면 그 안만 본다. 없으면 문서 전체에서 걸러낸다. */
  const main = h.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
            || h.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main) h = main[1];

  const paras = [...h.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => strip(m[1]))
    .filter(t => t.length > 80)          // 짧은 것은 대개 링크나 라벨
    .filter(t => /[.!?]/.test(t))        // 문장이 아니면 메뉴다
    .filter(t => !CHROME.test(t))
    /* 메뉴는 낱말마다 대문자로 시작한다 (Home News Sport Weather...).
     * 진짜 문장은 그렇지 않다. */
    .filter(t => {
      const w = t.split(/\s+/);
      return w.filter(x => /^[A-Z]/.test(x)).length / w.length < 0.45;
    });

  return paras.join('\n').slice(0, MAX_BODY);
}

/**
 * 기사 본문을 받아 온다. 못 받으면 빈 문자열.
 * @param {string} url
 */
async function fetchArticle(url) {
  if (!url) return '';
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; sports-insta/1.0; +https://github.com/talkpapa/sports-insta)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return '';
    const type = r.headers.get('content-type') || '';
    if (!/text\/html/.test(type)) return '';
    return articleText(await r.text());
  } catch {
    return '';
  }
}

module.exports = { collectNews, fetchArticle, articleText, fingerprint, overlap, sameStory, distinctive, FEEDS };
