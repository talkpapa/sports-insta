/* photo.js — 카드 배경에 깔 무료 사진을 구해 온다.
 *
 *   node scripts/photo.js "soccer stadium night"
 *
 * ── 왜 스톡 사진인가 ─────────────────────────────────────
 * 스포츠 보도 사진은 거의 전부 통신사(AP·게티·연합) 소유다. 선수 얼굴이 나온
 * 사진은 초상권까지 걸린다. 그래서 실제 인물이 아니라 "장면"을 쓴다 —
 * 밤의 경기장, 실루엣, 잔디, 관중석. 자유 라이선스만 받고, 만든 이를 캡션에 밝힌다.
 *
 * ── 두 곳을 지원한다 ─────────────────────────────────────
 *   Openverse — 키가 필요 없다. 기본값. CC0·CC BY 등 자유 라이선스만 걸러 받는다.
 *   Pexels    — 무료 키가 필요하지만 사진이 더 좋다. 키가 있으면 이쪽을 먼저 쓴다.
 */
const { env, getJSON, log } = require('./lib/util.js');

/* 세로 릴스(1080×1920)에 깔 사진이라 작으면 흐려진다.
 * 가로 사진을 세로로 잘라 쓰므로 세로 길이가 특히 중요하다. */
const MIN_W = 1000;
const MIN_H = 1000;

/* 위키미디어는 정체를 밝히지 않는 요청을 거절한다. 연락처를 담아 보낸다. */
const UA = 'sports-insta/1.0 (Instagram card pipeline; contact via GitHub talkpapa/sports-insta)';

/* 상업적 이용이 되는 라이선스만. NC(비상업)·ND(변경금지)는 받지 않는다 —
 * 우리는 사진 위에 글자를 얹으므로 ND 는 규정 위반이 된다. */
const OK_LICENSE = new Set(['cc0', 'pdm', 'by', 'by-sa']);

/* ══ Openverse (키 불필요) ═══════════════════════════ */
/* 검색을 한 번에 끝내지 않고 조건을 단계적으로 푼다.
 *
 * category=photograph 를 걸면 위키미디어의 잡동사니(문서 스캔·그림·도표) 대신
 * StockSnap·Rawpixel 같은 실제 스톡 사진이 나온다. 관련성이 확 좋아진다.
 * 다만 너무 빡빡해서 "baseball glove close up" 같은 검색어는 0건이 된다.
 *
 * 그래서 좋은 조건부터 시작해 결과가 없으면 하나씩 푼다. 마지막에는 검색어 자체를
 * 짧게 줄인다 — 스톡 라이브러리는 낱말이 적을수록 잘 찾는다. */
function searchLadder(query) {
  const words = query.trim().split(/\s+/);
  const short = words.slice(0, 2).join(' ');
  const steps = [
    { q: query, category: 'photograph', size: 'large' },
    { q: query, category: 'photograph' },
    { q: short, category: 'photograph', size: 'large' },
    { q: short, category: 'photograph' },
    { q: query, size: 'large' },
    { q: short, size: 'large' },
  ];
  /* 검색어가 이미 짧으면 같은 단계가 겹친다. 중복을 걷어낸다. */
  const seen = new Set();
  return steps.filter(s => {
    const k = `${s.q}|${s.category || ''}|${s.size || ''}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

const openverse = {
  name: 'Openverse',
  async search(query, key, want = 1) {
    /* 한 단계에서 멈추지 않고, "사진만" 조건이 붙은 단계들을 모아 후보를 쌓는다.
     * 카드마다 다른 사진을 깔려면 후보가 여러 장 필요하기 때문이다.
     * 다만 조건이 헐거워지는 단계로는 내려가지 않는다 — category=photograph 를
     * 놓는 순간 미술관 소장 회화가 섞여 들어온다. */
    const need = Math.max(8, want * 6);
    const out = [];
    const seenUrl = new Set();

    for (const step of searchLadder(query)) {
      if (out.length && !step.category) break;
      const u = new URL('https://api.openverse.org/v1/images/');
      u.searchParams.set('q', step.q);
      u.searchParams.set('license', [...OK_LICENSE].join(','));
      u.searchParams.set('page_size', '20');
      u.searchParams.set('mature', 'false');
      if (step.category) u.searchParams.set('category', step.category);
      /* size=large 를 빼면 1024px 짜리가 대부분이다. 9:16 으로 잘라 늘리면
       * 세 배 가까이 확대되어 뭉개지므로, 가능하면 붙인 채로 찾는다. */
      if (step.size) u.searchParams.set('size', step.size);

      let j;
      try { j = await getJSON(u.toString(), { headers: { 'user-agent': UA } }); }
      catch { continue; }

      const results = j.results || [];
      if (!results.length) continue;

      const how = [step.category ? '사진만' : null, step.size ? '고해상도' : null]
        .filter(Boolean).join('·') || '조건 없음';
      log.info(`"${step.q}" (${how}) — ${results.length}건`);

      /* 단계가 겹치면 같은 사진이 또 나온다. 주소로 걸러 담는다. */
      for (const r of this.shape(results)) {
        if (!r.url || seenUrl.has(r.url)) continue;
        seenUrl.add(r.url);
        out.push(r);
      }
      if (out.length >= need) break;
    }
    return out;
  },

  shape(results) {
    return results.map(r => ({
      /* 두 갈래를 다 들고 다닌다 — 제공처마다 되는 쪽이 다르기 때문이다.
       * wikimedia 는 직접 주소가 되고 프록시가 424 를 낸다.
       * flickr 는 그 반대인 환경이 있다. 하나가 막히면 다른 하나로 간다. */
      url: r.url,
      proxy: r.id ? `https://api.openverse.org/v1/images/${r.id}/thumb/?full_size=true` : '',
      width: r.width || 0,
      height: r.height || 0,
      license: (r.license || '').toLowerCase(),
      title: r.title || '',
      author: r.creator || '',
      source: 'Openverse',
      provider: r.provider || '',
      page: r.foreign_landing_url || '',
    }));
  },
  /** 캡션에 넣을 출처 한 줄 */
  credit(p) {
    const lic = p.license === 'cc0' || p.license === 'pdm'
      ? 'CC0' : `CC ${p.license.toUpperCase()}`;
    return `📷 ${p.author || 'Unknown'} (${lic})`;
  },
};

/* ══ Pexels (무료 키 필요, 사진 품질이 낫다) ═══════════ */
const pexels = {
  name: 'Pexels',
  async search(query, key, want = 1) {
    const u = new URL('https://api.pexels.com/v1/search');
    u.searchParams.set('query', query);
    u.searchParams.set('per_page', '20');
    u.searchParams.set('orientation', 'portrait');
    const j = await getJSON(u.toString(), { headers: { Authorization: key } });
    return (j.photos || []).map(p => ({
      url: p.src?.large2x || p.src?.original,
      width: p.width || 0,
      height: p.height || 0,
      license: 'pexels',
      title: p.alt || '',
      author: p.photographer || '',
      source: 'Pexels',
      page: p.url || '',
    }));
  },
  credit(p) { return `📷 ${p.author || 'Unknown'} / Pexels`; },
};

/* 박물관·도서관 계열은 걸러낸다.
 *
 * 현대 스포츠 사진은 통신사 소유라 자유 라이선스로 풀리지 않는다. 그래서
 * "크고 자유로운" 스포츠 사진을 찾으면 대부분 100년 된 기록사진이 걸려 나온다.
 * 실제로 "baseball dugout" 에 1920년대 흑백 사진이 와서 오늘 뉴스에 얹혔다.
 * 오늘 소식 옆에 그런 사진이 붙으면 계정이 통째로 이상해 보인다. */
const ARCHIVE = new Set([
  'libraryofcongress', 'thegetty', 'smithsonian', 'nypl', 'statensmuseum',
  'museumsvictoria', 'brooklynmuseum', 'clevelandmuseum', 'sciencemuseum',
  'digitaltmuseum', 'wikimedia_commons', 'floraon', 'biodiversity',
  /* 정부·군 자료실도 같다. 자유 라이선스로 풀려 있어 검색에 잘 걸리는데,
   * 대부분 수십 년 된 기록사진이라 오늘 이적 소식 배경으로는 어울리지 않는다. */
  'usdoe', 'usnavy', 'usarmy', 'usairforce', 'nasa', 'usforestservice',
  'nationalarchives', 'defenseimagery',
]);

/* 제목으로 걸러내야 하는 것들.
 *
 * category=photograph 는 "그림을 찍은 사진"을 걸러주지 못한다. rawpixel 같은 곳이
 * 미술관 소장 회화를 대량으로 올려두기 때문이다. 실제로 "cricket bat" 을 찾았을 때
 * "naked man stands, holding cricket" 이라는 누드 회화가 가장 큰 파일이라 뽑혔다.
 * 그대로 나갔으면 스포츠 계정에 누드가 올라가고 인스타 정책에 걸렸을 것이다.
 *
 * 그래서 제목을 본다. 예술 작품을 가리키는 말과, 어떤 경우에도 올리면 안 되는 말. */
const BAD_TITLE = [
  /* 올려서는 안 되는 것 — 계정이 제재된다 */
  'naked', 'nude', 'nudity', 'topless', 'erotic', 'lingerie',
  /* 사진이 아니라 그림·판화·소묘 */
  'painting', 'oil on canvas', 'watercolou', 'watercolor', 'engraving', 'etching',
  'lithograph', 'woodcut', 'illustration', 'drawing', 'sketch', 'portrait of',
  'still life', 'academy', 'museum', 'gallery', 'antique', 'vintage print',
  /* 사람이 아니라 문서·지도 */
  'map of', 'poster for', 'diagram', 'manuscript', 'newspaper',
  /* 사진이 아니라 그려낸 것. category=photograph 로도 안 걸러진다 —
   * 실제로 워드프레스 마스코트 그림(wapuu)이 축구 사진으로 뽑혔다. */
  'wallpaper', 'wapuu', 'clipart', 'clip art', 'cartoon', 'mascot',
  'vector', 'render', '3d model', 'template', 'mockup', 'seamless pattern',
];

function titleLooksBad(title) {
  const t = String(title || '').toLowerCase();
  if (BAD_TITLE.some(w => t.includes(w))) return true;

  /* 제목에 옛 연도가 박혀 있으면 기록사진이다. 실제로 "Oak Ridge Football 1947" 이
   * 오늘 NFL 소식의 배경으로 뽑혔다. 제공처 목록으로는 안 걸린다 — 정부기관·대학이
   * 자기 자료실을 자유 라이선스로 풀어두기 때문이다. 연도를 직접 본다. */
  const year = t.match(/(?:^|[^0-9])((?:18|19|20)[0-9]{2})(?:[^0-9]|$)/);
  if (year && Number(year[1]) < 1995) return true;

  return false;
}


/* 검색어의 낱말이 제목에 있는가.
 *
 * 이것이 가장 강한 안전장치다. 낱말 목록으로 미술품을 걸러내려 했지만 실패했다 —
 * "Seated female model Vilhelm Lundstrøm" 은 누드 회화인데 금지어가 하나도 없다.
 * 그림 제목은 자기가 그림이라고 말해주지 않는다.
 *
 * 대신 이렇게 본다: "cricket bat" 을 찾았으면 제목에 cricket 이나 bat 이 있어야 한다.
 * 없는 것은 검색 엔진이 엉뚱하게 물어온 것이다. 미술품이든 숲이든 한꺼번에 걸러진다. */
function titleMatches(title, query) {
  const t = String(title || '').toLowerCase();
  const words = String(query).toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return true;
  return words.some(w => t.includes(w));
}

/** 사진 하나를 가리키는 이름표.
 * 주소는 제공처마다 크기별로 여러 개라 믿을 수 없다. 작가와 제목으로 잡는다. */
function photoKey(p) {
  return `${p.author || ''}|${p.title || ''}`.toLowerCase().trim();
}

/** 세로 화면에 잘 맞는 순서로 줄 세운다 */
function rank(list, query = '') {
  const scored = list
    .filter(p => p.url && p.width >= MIN_W && p.height >= MIN_H)
    .filter(p => !titleLooksBad(p.title))
    /* 제공처만 봐서는 못 거른다 — rawpixel 같은 곳이 도서관 소장품을 다시 올리기
     * 때문이다. 그때 provider 는 rawpixel 이고 creator 가 libraryofcongress 다.
     * 그래서 둘 다 본다. */
    .filter(p => {
      const who = `${p.provider || ''} ${p.author || ''}`.toLowerCase().replace(/[^a-z]/g, '');
      return ![...ARCHIVE].some(a => who.includes(a.replace(/[^a-z]/g, '')));
    })
    .map(p => {
      const ratio = p.width / p.height;
      /* 9:16(0.5625)에 가까울수록 좋다. 가로 사진도 잘라 쓸 수 있지만
       * 너무 넓으면 가운데만 남아 장면이 사라진다. */
      const fit = ratio <= 1 ? 2 : ratio < 1.5 ? 1.4 : ratio < 2 ? 1 : 0.4;
      const size = Math.min(p.width, p.height) / 1000;
      return { ...p, relevant: titleMatches(p.title, query), score: fit * 2 + Math.min(size, 3) };
    });

  /* 제목이 검색어와 맞는 것만 쓴다. 하나도 없으면 빈손으로 돌려보낸다 —
   * 엉뚱한 사진을 올리느니 그 소재를 통째로 거르는 편이 낫다.
   * 실제로 이 규칙이 없을 때 누드 회화가 스포츠 카드로 나갈 뻔했다. */
  const relevant = scored.filter(p => p.relevant);
  return relevant.sort((a, b) => b.score - a.score);
}

/** 후보 하나를 실제로 받아 본다. 목록에 있어도 안 열리는 주소가 흔해서
 * 직접 주소와 Openverse 프록시를 차례로 시도한다. 못 받으면 null. */
async function download(c) {
  for (const link of [c.url, c.proxy].filter(Boolean)) {
    try {
      const r = await fetch(link, { headers: { 'user-agent': UA } });
      if (!r.ok) continue;
      const type = r.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      const buffer = Buffer.from(await r.arrayBuffer());
      if (buffer.length < 30000) continue;            // 너무 작으면 썸네일이다
      if (buffer.length > 20 * 1024 * 1024) continue; // 20MB 넘으면 받다가 시간을 다 쓴다
      return buffer;
    } catch { /* 다음 경로 */ }
  }
  return null;
}

/* 어느 소재에나 붙는 축구 장면들.
 *
 * 두 가지 일에 쓴다.
 *   ① 검색어가 통하지 않을 때 물러설 자리. 제목이 검색어와 겹쳐야 한다는 규칙이
 *      세서 없는 장면을 찾으면 빈손이 되는데, 원고는 이미 무료 한도를 치른 것이라
 *      통째로 버리기 아깝다.
 *   ② 검색어 하나로는 안 쓴 사진이 모자랄 때 더 긁어올 자리. "football pitch" 는
 *      쓸 만한 것이 세 장뿐이라, 그 셋을 쓰고 나면 같은 그림이 계속 돌아온다. */
const WIDE = [
  'football stadium crowd', 'soccer ball grass', 'football stadium seats',
  'soccer field lines', 'football grass texture', 'green football field',
  'soccer stadium aerial', 'stadium seats colourful', 'sports stadium architecture',
  'football players training', 'empty football stadium', 'football pitch',
  'goal net close up', 'soccer goal net', 'football goal post',
  'football boots grass', 'football training ground', 'stadium lights night',
];

/** 검색어 하나로 후보를 받아 순위대로 돌려준다 */
async function candidatesFor(query, want) {
  const E = env();
  const providers = E.PEXELS_KEY
    ? [{ p: pexels, key: E.PEXELS_KEY }, { p: openverse }]
    : [{ p: openverse }];

  const out = [];
  for (const { p, key } of providers) {
    try {
      const list = rank(await p.search(query, key, want), query);
      for (const c of list) out.push({ c, provider: p });
    } catch (e) {
      log.warn(`${p.name} 검색 실패 — ${e.message}`);
    }
  }
  return out;
}

/**
 * 검색어에 맞는 사진을 여러 장 받아 온다.
 *
 * 카드 석 장에 같은 사진을 깔면 넘길 이유가 없어진다. 배경이 바뀌어야 손가락이 움직인다.
 *
 * 검색어 하나에 매달리지 않는다. 순위를 매기는 방식이 완전히 결정적이라 같은 검색어는
 * 언제나 같은 사진을 같은 순서로 돌려주는데, 검색어를 통하는 것 몇 개로 못박은 뒤로는
 * 서로 다른 세 편이 2·3번 카드 배경을 통째로 공유하는 일이 실제로 일어났다.
 * 그래서 모자라면 다른 장면으로 넘어가며 채운다. 같은 사진을 되쓰는 것은 맨 마지막이다.
 *
 * @param {Set<string>} opts.exclude  최근에 쓴 사진 (build.js 가 state.json 에서 들고 온다)
 * @returns {Promise<Array<{buffer:Buffer, credit:string, meta:object}>>}
 */
async function findPhotos(query, want = 1, opts = {}) {
  const skip = opts.exclude instanceof Set ? opts.exclude : new Set();

  const got = [];
  /* 주소가 달라도 작가와 제목이 같으면 같은 사진이다. 제공처가 같은 것을
   * 크기별로 여러 번 올려두기 때문에 이것을 안 보면 똑같은 그림이 겹친다. */
  const seen = new Set();
  const tried = new Set();
  /* 안 쓴 것이 정말 하나도 없을 때를 대비해, 걸러낸 것도 모아 둔다. */
  const reserve = [];

  /* 원래 검색어부터, 그다음 넓은 장면들 */
  const queries = [query, ...WIDE.filter(q => q !== query)];

  for (const q of queries) {
    if (got.length >= want) break;
    if (tried.has(q)) continue;
    tried.add(q);

    const list = await candidatesFor(q, want);
    if (!list.length) continue;
    if (q !== query) log.info(`"${q}" 로 더 찾습니다 (${got.length}/${want}장)`);

    /* 필요한 장수의 네 배까지만 두드려 본다. 안 열리는 주소를 끝없이 붙들고
     * 있으면 빌드가 통째로 늦어진다. */
    for (const { c, provider } of list.slice(0, Math.max(6, want * 4))) {
      if (got.length >= want) break;
      const k = photoKey(c);
      if (seen.has(k)) continue;
      if (skip.has(k)) { reserve.push({ c, provider }); continue; }

      const buffer = await download(c);
      if (!buffer) continue;
      seen.add(k);
      log.ok(`${provider.name} · ${c.width}×${c.height} · ${c.license} · ${c.author || '작자미상'}`);
      got.push({ buffer, credit: provider.credit(c), meta: c });
    }
  }

  /* 그래도 모자라면 최근에 쓴 것을 도로 꺼낸다. 겹치는 그림이 보기 싫긴 해도,
   * 그것 때문에 다 쓴 원고를 버리는 것보다는 낫다. */
  for (const { c, provider } of reserve) {
    if (got.length >= want) break;
    const k = photoKey(c);
    if (seen.has(k)) continue;
    const buffer = await download(c);
    if (!buffer) continue;
    seen.add(k);
    log.info(`예전에 쓴 사진을 다시 씁니다 — ${c.author || '작자미상'}`);
    got.push({ buffer, credit: provider.credit(c), meta: c });
  }

  if (!got.length) log.info(`"${query}" — 쓸 만한 사진을 하나도 못 구했습니다.`);
  else if (got.length < want) log.info(`사진 ${got.length}장만 구했습니다 (원한 ${want}장) — 돌려 씁니다.`);
  return got;
}

/** 한 장만 필요할 때 */
async function findPhoto(query) {
  const got = await findPhotos(query, 1);
  return got[0] || null;
}

/** 여러 장을 썼으면 출처도 여러 줄이다. CC BY 는 표기가 의무라 하나도 빠뜨릴 수 없다.
 * 같은 사람이 두 장을 찍었으면 한 번만 적는다. */
function mergeCredits(photos) {
  const seen = new Set();
  const out = [];
  for (const p of photos) {
    const one = String(p.credit || '').replace(/^📷\s*/, '').trim();
    if (!one || seen.has(one)) continue;
    seen.add(one);
    out.push(one);
  }
  return out.length ? '📷 ' + out.join(' · ') : '';
}

/* ── 직접 실행 ─────────────────────────────────────── */
if (require.main === module) {
  (async () => {
    const query = process.argv.slice(2).join(' ') || 'soccer stadium night';
    log.step(`사진 찾기 · "${query}"`);
    const got = await findPhoto(query);
    if (!got) { log.fail('사진을 못 찾았습니다.'); process.exit(2); }

    const fs = require('fs');
    fs.writeFileSync('_photo.jpg', got.buffer);
    log.ok(`_photo.jpg 로 저장 (${(got.buffer.length / 1024).toFixed(0)}KB)`);
    log.info('캡션에 들어갈 출처: ' + got.credit);
    log.info('원본: ' + (got.meta.page || got.meta.url));
  })().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { findPhoto, findPhotos, mergeCredits, photoKey, MIN_W, MIN_H };
