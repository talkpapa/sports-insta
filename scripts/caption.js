/* caption.js — 카드에 붙일 인스타 캡션을 만든다.
 *
 * 남의 기사 문장을 옮기지 않는다. 우리가 받은 숫자만으로 문장을 짓는다.
 * 그래야 무인으로 돌려도 저작권 사고가 나지 않는다.
 *
 * 캡션의 첫 줄이 전부다. 인스타는 125자쯤에서 "더 보기"로 접히기 때문에,
 * 접히기 전 한 줄에 오늘 무슨 일이 있었는지가 들어가야 한다.
 * 리그 이름만 적힌 첫 줄은 아무도 펼치지 않는다.
 */
const { prettyDate, tzTime } = require('./lib/util.js');
const { j } = require('./lib/josa.js');

const MAX_LEN = 2200;        // 인스타 캡션 한도
const MAX_TAGS = 30;         // 인스타 해시태그 한도

/* ── 첫 줄 훅 ────────────────────────────────────── */

/** 점수 차가 클수록 강한 말을 쓴다. 2:1 을 "대파"라고 하면 거짓말이 된다. */
function resultHook(items, leagueName) {
  /* 가장 점수 차가 큰 경기를 훅으로 — 그날 제일 할 말이 많은 경기다 */
  const sorted = [...items].sort((a, b) =>
    Math.abs(b.homeScore - b.awayScore) - Math.abs(a.homeScore - a.awayScore));
  const m = sorted[0];
  const diff = Math.abs(m.homeScore - m.awayScore);
  const winner = m.homeScore > m.awayScore ? m.home : m.away;
  const loser  = m.homeScore > m.awayScore ? m.away : m.home;
  const score  = m.homeScore + '-' + m.awayScore;

  if (diff === 0) return `${m.home} ${score} ${m.away}. 승점 1점씩 나눠 가졌습니다.`;
  if (diff >= 4)  return `${j(winner, '가')} ${j(loser, '를')} ${j(score, '로')} 완파했습니다.`;
  if (diff >= 2)  return `${j(winner, '가')} ${loser}에 ${score} 승리했습니다.`;
  return `${j(winner, '가')} ${j(loser, '를')} ${score} 한 골 차로 눌렀습니다.`;
}

function fixtureHook(items, leagueName, tz) {
  const m = items[0];
  const t = tzTime(m.kickoff, tz);
  if (items.length === 1) {
    return `오늘 ${j(leagueName, '는')} ${m.home} vs ${m.away} 한 경기.${t ? ` 한국시간 ${t} 킥오프입니다.` : ''}`;
  }
  return `오늘 ${leagueName} ${items.length}경기.${t ? ` 첫 경기는 ${m.home} vs ${m.away}, 한국시간 ${t}입니다.` : ''}`;
}

function standingsHook(rows, leagueName) {
  const top = rows[0];
  const second = rows[1];
  if (!second) return `${leagueName} 선두는 ${top.team}, 승점 ${top.points}점입니다.`;
  const gap = top.points - second.points;
  if (gap === 0) {
    return `${leagueName} 선두 ${j(top.team, '와')} ${j(second.team, '가')} 승점 ${top.points}점으로 동률입니다.`;
  }
  return `${leagueName} 선두는 ${top.team}. 2위 ${j(second.team, '와')} 승점 ${gap}점 차입니다.`;
}

/* ── 본문 ────────────────────────────────────────── */

function resultBody(items, tz) {
  const lines = items.map(m => {
    const mark = m.homeScore === m.awayScore ? '무' : '';
    return `· ${m.home} ${m.homeScore} : ${m.awayScore} ${m.away}${mark ? '  (무승부)' : ''}`;
  });
  return lines.join('\n');
}

function fixtureBody(items, tz) {
  return items.map(m => {
    const t = tzTime(m.kickoff, tz);
    return `· ${t ? t + '  ' : ''}${m.home} vs ${m.away}`;
  }).join('\n');
}

function standingsBody(rows) {
  return rows.slice(0, 5).map(r =>
    `${r.rank}. ${r.team}  ${r.points}점 (${r.played}경기, 득실 ${r.gd > 0 ? '+' : ''}${r.gd})`
  ).join('\n');
}

/* ── 마무리 한 줄 — 저장·댓글을 유도한다 ───────────── */
const CLOSERS = {
  results:   '오늘 제일 놀란 결과는 어느 경기였습니까? 댓글로 남겨 주세요.',
  fixtures:  '놓치지 않으시려면 저장해 두세요 📌',
  standings: '내 팀은 지금 몇 위입니까? 댓글로 알려 주세요.',
};

/* ── 해시태그 ────────────────────────────────────── */
function hashtags(cfg, leagueKey) {
  const h = cfg.hashtags || {};
  const list = [...(h['공통'] || []), ...(h[leagueKey] || [])];
  /* 같은 태그가 두 번 들어가면 스팸으로 읽힌다 */
  return [...new Set(list)].slice(0, MAX_TAGS);
}

/* ── 조립 ────────────────────────────────────────── */
/**
 * @param {object} d   collect() 가 준 소재
 * @param {object} cfg config.json
 * @returns {string}   완성된 캡션
 */
function buildCaption(d, cfg) {
  const tz = d.timezone || 'Asia/Seoul';
  const lg = d.league;
  const when = prettyDate(d.date);

  let hook, body;
  if (d.kind === 'results') {
    hook = resultHook(d.items, lg.name);
    body = resultBody(d.items, tz);
  } else if (d.kind === 'fixtures') {
    hook = fixtureHook(d.items, lg.name, tz);
    body = fixtureBody(d.items, tz);
  } else {
    hook = standingsHook(d.items, lg.name);
    body = standingsBody(d.items);
  }

  const head = `${lg.name} · ${when}`;
  const tags = hashtags(cfg, lg.key).join(' ');
  const closer = CLOSERS[d.kind] || '';

  /* 시각을 적는 캡션에만 한국시간이라고 밝힌다.
   * 유럽 경기는 새벽이라 시간만 적어두면 반드시 오해가 생긴다.
   * 반대로 시각이 없는 캡션(결과·순위)에 이 줄이 붙으면 군더더기가 된다. */
  const tzNote = d.kind === 'fixtures' ? '※ 시각은 한국시간 기준입니다.' : '';

  let caption = [
    hook,
    '',
    head,
    body,
    tzNote,
    '',
    closer,
    '',
    `자료 ${d.source}`,
    '',
    tags,
  ].filter(l => l !== null && l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  /* 한도를 넘으면 본문 줄부터 줄인다. 해시태그와 훅은 지킨다. */
  if (caption.length > MAX_LEN) {
    const keep = body.split('\n');
    while (caption.length > MAX_LEN && keep.length > 1) {
      keep.pop();
      caption = caption.replace(body, keep.join('\n') + '\n· …');
    }
  }
  return caption.slice(0, MAX_LEN);
}

module.exports = { buildCaption, hashtags, MAX_LEN, MAX_TAGS };

/* ── 직접 실행: 눈으로 확인 ──────────────────────── */
if (require.main === module) {
  const { config } = require('./lib/util.js');
  const cfg = config();
  const demo = {
    kind: 'results', date: '2026-08-19', source: 'TheSportsDB', timezone: 'Asia/Seoul',
    league: { key: 'laliga', name: '라리가', short: 'LALIGA', sport: '축구' },
    items: [
      { home: '레알 마드리드', away: '바르셀로나', homeScore: 3, awayScore: 1, kickoff: '2026-08-19T19:00:00' },
      { home: '아틀레티코', away: '세비야', homeScore: 2, awayScore: 2, kickoff: '2026-08-19T17:30:00' },
    ],
  };
  const cap = buildCaption(demo, cfg);
  console.log('─'.repeat(52));
  console.log(cap);
  console.log('─'.repeat(52));
  console.log(`${cap.length}자 · 첫 줄 ${cap.split('\n')[0].length}자`);
}
