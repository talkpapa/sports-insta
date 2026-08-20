/* collect.js — 스포츠 데이터를 받아 카드가 쓸 모양으로 바꾼다.
 *
 *   node scripts/collect.js            오늘 쓸 소재를 config 의 perDay 만큼 골라 요약
 *   node scripts/collect.js --all      리그별로 뭐가 잡히는지 전부 보기
 *
 * ── 왜 사실 데이터만 받는가 ──────────────────────────────
 * 스포츠 사진은 거의 전부 통신사(AP·게티·연합) 소유다. 기사 문장도 남의 글이다.
 * 무인으로 도는 계정이 그것을 가져다 쓰면 언젠가 반드시 사고가 난다.
 * 점수·순위·일정은 사실(fact)이라 저작권이 없다. 그래서 이 파이프라인은
 * 숫자만 받아 원장님 디자인의 카드로 직접 그린다.
 *
 * ── 하루 여러 개를 뽑을 때 ──────────────────────────────
 * 같은 리그로 하루를 채우면 피드가 단조롭다. 그래서 "리그를 가로로 훑는" 순서로 모은다.
 *   ① 리그마다 어제 결과   (가장 반응이 좋다)
 *   ② 리그마다 오늘 일정   (기대감 · 저장 유도)
 *   ③ 리그마다 순위표      (언제나 있다 — 빈손으로 끝나지 않는다)
 * 이렇게 하면 앞쪽 슬롯이 서로 다른 리그의 결과로 채워진다.
 */
const { config, env, tzDate, getJSON, sleep, log } = require('./lib/util.js');
const { ko } = require('./lib/teams-ko.js');

/* 유럽 축구는 8월에 새 시즌이 시작한다. 시즌 문자열을 손으로 고쳐 두면
 * 해가 바뀔 때 아무도 모르게 빈 데이터를 긁어오게 된다. 날짜로 정한다. */
function currentSeason(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/* ══ 제공처 1 · TheSportsDB ════════════════════════════
 * 키 없이도 돌지만 무료 키는 목록을 3~5건으로 잘라서 준다.
 * 하루 한 개면 몰라도 여러 개를 뽑기에는 턱없이 부족하다. */
const sportsdb = {
  name: 'TheSportsDB',
  pace: 400,
  base(key) { return `https://www.thesportsdb.com/api/v1/json/${key || '3'}`; },

  async results(lg, date, key) {
    const j = await getJSON(`${this.base(key)}/eventspastleague.php?id=${lg.sportsdbId}`);
    return (j.events || [])
      .filter(e => (e.dateEvent || '') === date)
      .filter(e => e.intHomeScore !== null && e.intHomeScore !== '')
      .map(e => ({
        home: ko(e.strHomeTeam), away: ko(e.strAwayTeam),
        homeScore: Number(e.intHomeScore), awayScore: Number(e.intAwayScore),
        kickoff: e.strTimestamp || '',
      }));
  },

  async fixtures(lg, date, key) {
    const j = await getJSON(`${this.base(key)}/eventsnextleague.php?id=${lg.sportsdbId}`);
    return (j.events || [])
      .filter(e => (e.dateEvent || '') === date)
      .map(e => ({ home: ko(e.strHomeTeam), away: ko(e.strAwayTeam), kickoff: e.strTimestamp || '' }));
  },

  async standings(lg, date, key) {
    const season = lg.season && lg.season !== 'auto' ? lg.season : currentSeason(date);
    const j = await getJSON(`${this.base(key)}/lookuptable.php?l=${lg.sportsdbId}&s=${season}`);
    return (j.table || []).map(t => ({
      rank: Number(t.intRank), team: ko(t.strTeam), played: Number(t.intPlayed),
      win: Number(t.intWin), draw: Number(t.intDraw), loss: Number(t.intLoss),
      gd: Number(t.intGoalDifference), points: Number(t.intPoints),
    }));
  },
};

/* ══ 제공처 2 · football-data.org ══════════════════════
 * 무료 키(이메일 등록만)로 주요 리그 전체 데이터가 온다. 하루 여러 개를 뽑으려면 이쪽이어야 한다.
 * 분당 10회 제한이 있어 호출 사이에 7초씩 쉰다 — 리그 10개를 훑어도 3분 남짓이다. */
const footballdata = {
  name: 'football-data.org',
  pace: 7000,
  base: 'https://api.football-data.org/v4',
  head(key) { return { headers: { 'X-Auth-Token': key } }; },

  async matches(lg, date, key, finished) {
    const u = `${this.base}/competitions/${lg.footballDataCode}/matches?dateFrom=${date}&dateTo=${date}`;
    const j = await getJSON(u, this.head(key));
    return (j.matches || []).filter(m =>
      finished ? m.status === 'FINISHED' : ['SCHEDULED', 'TIMED'].includes(m.status));
  },

  async results(lg, date, key) {
    return (await this.matches(lg, date, key, true)).map(m => ({
      home: ko(m.homeTeam?.shortName || m.homeTeam?.name),
      away: ko(m.awayTeam?.shortName || m.awayTeam?.name),
      homeScore: m.score?.fullTime?.home ?? 0,
      awayScore: m.score?.fullTime?.away ?? 0,
      kickoff: m.utcDate || '',
    }));
  },

  async fixtures(lg, date, key) {
    return (await this.matches(lg, date, key, false)).map(m => ({
      home: ko(m.homeTeam?.shortName || m.homeTeam?.name),
      away: ko(m.awayTeam?.shortName || m.awayTeam?.name),
      kickoff: m.utcDate || '',
    }));
  },

  async standings(lg, date, key) {
    const j = await getJSON(`${this.base}/competitions/${lg.footballDataCode}/standings`, this.head(key));
    /* 챔스처럼 표가 여러 벌 오는 대회가 있다. 전체 순위(TOTAL) 첫 벌만 쓴다. */
    const tbl = (j.standings || []).find(s => s.type === 'TOTAL');
    return (tbl?.table || []).map(t => ({
      rank: t.position, team: ko(t.team?.shortName || t.team?.name), played: t.playedGames,
      win: t.won, draw: t.draw, loss: t.lost, gd: t.goalDifference, points: t.points,
    }));
  },
};

const PROVIDERS = { thesportsdb: sportsdb, footballdata: footballdata };

/* 시즌 개막 전 순위표는 전부 0 이다. 0만 있는 표는 게시하면 창피하다. */
const standingsUsable = rows => rows.length >= 5 && rows.some(r => r.played > 0);

const RULES = {
  results:   { ok: r => r.length > 0, when: (t, y) => y },
  fixtures:  { ok: r => r.length > 0, when: (t, y) => t },
  standings: { ok: standingsUsable,   when: (t, y) => t },
};

/** 리그 하나에서 한 종류를 받아 본다. 없거나 실패하면 null. */
async function tryOne(P, lg, kind, key, today, yesterday, tz) {
  const rule = RULES[kind];
  const date = rule.when(today, yesterday);
  try {
    const items = await P[kind](lg, date, key);
    if (!rule.ok(items)) { log.info(`${lg.name} · ${kind} 없음`); return null; }
    log.ok(`${lg.name} · ${kind} ${items.length}건`);
    return { kind, league: lg, date, items, source: P.name, timezone: tz,
             fetchedAt: new Date().toISOString() };
  } catch (e) {
    log.warn(`${lg.name} · ${kind} 실패 — ${e.message}`);
    return null;
  }
}

function setup() {
  const cfg = config(), E = env();
  const P = PROVIDERS[cfg.provider];
  if (!P) throw new Error(`모르는 provider: ${cfg.provider} (thesportsdb 또는 footballdata)`);

  const key = cfg.provider === 'footballdata' ? E.FOOTBALL_DATA_KEY : E.SPORTSDB_KEY;
  if (cfg.provider === 'footballdata' && !key) {
    throw new Error('FOOTBALL_DATA_KEY 가 없습니다.\n' +
      '   https://www.football-data.org/client/register 에서 무료로 받아\n' +
      '   .env 또는 저장소 시크릿에 넣으십시오.');
  }
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  return { cfg, P, key, tz, today: tzDate(0, tz), yesterday: tzDate(-1, tz) };
}

/**
 * 하루치 소재를 여러 개 모은다.
 * @param {number} want    몇 개까지 (보통 config.publish.perDay)
 * @param {number} cursor  어느 리그부터 시작할지 — 날마다 앞자리가 바뀌게 한다
 * @returns {Promise<Array>} 소재 배열 (want 보다 적을 수 있다)
 */
async function collectMany(want, cursor = 0) {
  const { cfg, P, key, tz, today, yesterday } = setup();

  const leagues = cfg.leagues || [];
  if (!leagues.length) throw new Error('config.json 에 리그가 없습니다.');

  /* 시작 리그를 날마다 옮겨 같은 리그가 늘 첫 슬롯을 차지하지 않게 한다 */
  const c = ((cursor % leagues.length) + leagues.length) % leagues.length;
  const ordered = leagues.slice(c).concat(leagues.slice(0, c));

  log.step(`데이터 수집 (${P.name}) · 오늘 ${today} · 어제 ${yesterday} · 최대 ${want}개`);

  const out = [];

  /* 종류를 바깥 고리에 둔다 — 결과부터 리그를 가로로 훑어야 앞 슬롯이 다양해진다 */
  for (const kind of ['results', 'fixtures', 'standings']) {
    for (const lg of ordered) {
      if (out.length >= want) break;
      const got = await tryOne(P, lg, kind, key, today, yesterday, tz);
      if (got) out.push(got);
      await sleep(P.pace);              // 요청 한도를 넘지 않게 쉬어 간다
    }
    if (out.length >= want) break;
  }

  log.step(`소재 ${out.length}개 확보 (목표 ${want}개)`);
  if (out.length < want) {
    log.warn(`${want - out.length}개 부족합니다 — 있는 만큼만 게시합니다.`);
    if (cfg.provider === 'thesportsdb') {
      log.warn('무료 TheSportsDB 는 데이터를 잘라서 줍니다. footballdata 로 바꾸시는 것이 좋습니다.');
    }
  }
  return out;
}

/** 하나만 필요할 때 */
async function collect({ cursor = 0 } = {}) {
  const got = await collectMany(1, cursor);
  return got[0] || null;
}

/* ── 직접 실행 ─────────────────────────────────────── */
if (require.main === module) {
  (async () => {
    const cfg = config();
    if (process.argv.includes('--all')) {
      const { P, key, tz, today, yesterday } = setup();
      for (const lg of cfg.leagues) {
        log.step(lg.name);
        for (const kind of ['results', 'fixtures', 'standings']) {
          await tryOne(P, lg, kind, key, today, yesterday, tz);
          await sleep(P.pace);
        }
      }
      return;
    }
    const want = cfg.publish?.perDay || 1;
    const got = await collectMany(want);
    if (!got.length) { log.fail('쓸 소재를 하나도 찾지 못했습니다.'); process.exit(2); }
    console.log('');
    got.forEach((g, i) => console.log(
      `  ${String(i + 1).padStart(2, '0')}. ${g.league.name} · ${g.kind} · ${g.items.length}건 (${g.date})`));
  })().catch(e => { log.fail(e.message); process.exit(1); });
}

module.exports = { collect, collectMany, currentSeason, PROVIDERS };
