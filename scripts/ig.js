/* ig.js — 인스타그램에 실제로 올린다. (Instagram API with Instagram Login v23.0)
 *
 *   node scripts/ig.js status     계정·최근 게시·오늘 진행 상황
 *   node scripts/ig.js queue      다음 슬롯 하나를 게시한다 (자동 운전용)
 *   node scripts/ig.js refresh    토큰 60일 연장
 *
 * 원칙
 *  - 본인 계정에 올리는 것만 한다. 남의 계정 자동 좋아요·팔로우는 정책 위반이라
 *    계정이 정지된다. 이 파일에는 그런 기능이 아예 없다.
 *  - 게시는 API 로 삭제할 수 없다. 그래서 올리기 전에 스스로 멈출 이유를 먼저 찾는다.
 *  - 한 번 돌 때 한 개만 올린다. 여섯 개를 한꺼번에 쏟으면 서로의 도달을 깎아먹고,
 *    무엇보다 스팸으로 보인다. 시각을 나눠 하나씩 나가게 한다.
 */
const fs = require('fs');
const { config, env, tzDate, loadState, saveState, sleep, log } = require('./lib/util.js');
const { nextSlot, doneCount, pendingSlots, markDone } = require('./lib/queue.js');

const API = 'https://graph.instagram.com/v23.0';

function token() {
  const t = env().IG_TOKEN;
  if (!t) {
    log.fail('IG_TOKEN 이 없습니다.');
    console.error('   로컬: .env 파일에 IG_TOKEN=... 을 넣으십시오');
    console.error('   서버: 저장소 Settings → Secrets → Actions 에 IG_TOKEN 을 넣으십시오');
    process.exit(1);
  }
  return t;
}

async function api(pathname, params = {}, method = 'GET') {
  const TOKEN = token();
  const u = new URL(API + pathname);
  const opt = { method };
  if (method === 'GET') {
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    u.searchParams.set('access_token', TOKEN);
  } else {
    opt.body = new URLSearchParams({ ...params, access_token: TOKEN });
    opt.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  }
  const r = await fetch(u, opt);
  const j = await r.json();
  if (j.error) throw new Error(`${j.error.code || ''} ${j.error.message}`);
  return j;
}

/* ── 상태 보기 ───────────────────────────────────── */
async function cmdStatus() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 1;

  const me = await api('/me', { fields: 'username,account_type,media_count' });
  log.step(`계정 ${me.username} (${me.account_type}) · 게시물 ${me.media_count}개`);

  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  log.info(`오늘 ${today} · 게시 ${postedToday}/${perDay}개 · 남은 큐 ${pendingSlots(today).length}개`);

  const media = await api('/me/media', { fields: 'id,permalink,timestamp', limit: 1 });
  const last = media.data?.[0];
  if (last) {
    const h = (Date.now() - new Date(last.timestamp).getTime()) / 3600000;
    const gap = cfg.publish?.minGapHours ?? 2;
    log.info(`최근 게시 ${last.timestamp.slice(0, 16).replace('T', ' ')} (${h.toFixed(1)}시간 전)`);
    log.info(last.permalink);
    console.log(h < gap ? `  ⛔ ${gap}시간 규칙에 걸린다` : `  ✅ ${gap}시간 규칙 통과`);
  }
  if (st.token_expires_around) log.info(`토큰 만료 예상 ${st.token_expires_around}`);
}

/* ── 컨테이너가 다 익을 때까지 기다린다 ──────────── */
async function waitFinished(id, what) {
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const s = await api(`/${id}`, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR') throw new Error(`${what} 실패: ${s.status || ''}`);
  }
  throw new Error(`${what} 이 끝나지 않았습니다 (그림 비율 4:5~1.91:1 을 확인하십시오)`);
}

/* ── 게시 ────────────────────────────────────────── */
async function publish(urls, caption, meta) {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 1;
  const minGap = cfg.publish?.minGapHours ?? 2;
  const st = loadState();

  /* 안전장치 ① 오늘 몫을 이미 다 썼으면 중단 */
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  if (postedToday >= perDay) {
    log.fail(`오늘 이미 ${postedToday}개 올렸습니다 (한도 ${perDay}개). 중단합니다.`);
    process.exit(1);
  }

  /* 안전장치 ② 같은 슬롯을 두 번 올리지 않는다 */
  if ((st.posted_log || []).some(p => p.date === today && p.slot === meta.slot)) {
    log.fail(`슬롯 ${meta.slot} 은 이미 올라갔습니다. 중단합니다.`);
    process.exit(1);
  }

  /* 안전장치 ③ 직전 게시와 너무 붙어 있으면 중단.
   * 연달아 올리면 두 게시물이 서로의 도달을 깎아먹는다. */
  const recent = await api('/me/media', { fields: 'timestamp', limit: 1 });
  const last = recent.data?.[0];
  if (last) {
    const h = (Date.now() - new Date(last.timestamp).getTime()) / 3600000;
    if (h < minGap) {
      log.fail(`최근 게시가 ${h.toFixed(1)}시간 전입니다 (${minGap}시간 규칙). 중단합니다.`);
      process.exit(1);
    }
  }

  log.step(`게시 · 슬롯 ${meta.slot} · ${urls.length}장${urls.length > 1 ? ' (캐러셀)' : ''} · 캡션 ${caption.length}자`);

  const single = async url => {
    const c = await api('/me/media', { image_url: url, caption }, 'POST');
    await waitFinished(c.id, '단일 카드');
    return c.id;
  };

  const carousel = async () => {
    const kids = [];
    for (const url of urls) {
      const c = await api('/me/media', { image_url: url, is_carousel_item: 'true' }, 'POST');
      await waitFinished(c.id, `${kids.length + 1}번째 카드`);
      kids.push(c.id);
    }
    const parent = await api('/me/media', { media_type: 'CAROUSEL', children: kids.join(','), caption }, 'POST');
    await waitFinished(parent.id, '캐러셀 묶음');
    return parent.id;
  };

  let creationId, mode = urls.length > 1 ? '캐러셀' : '단일';
  if (urls.length > 1) {
    try { creationId = await carousel(); }
    catch (e) {
      /* 한 장이라도 나가는 것이 이 슬롯을 통째로 거르는 것보다 낫다 */
      log.warn(`캐러셀 실패(${e.message}) → 첫 장만 단일 게시로 돌립니다`);
      mode = '단일(폴백)';
      creationId = await single(urls[0]);
    }
  } else {
    creationId = await single(urls[0]);
  }

  const pub = await api('/me/media_publish', { creation_id: creationId }, 'POST');
  const info = await api(`/${pub.id}`, { fields: 'permalink' });
  log.ok(`게시 완료 (${mode}) ${info.permalink}`);

  st.posted_log = st.posted_log || [];
  st.posted_log.push({
    date: today, slot: meta.slot || '', kind: meta.kind || '', league: meta.league || '',
    media_id: pub.id, permalink: info.permalink,
    slides: urls.length, source: meta.source || '',
    at: new Date().toISOString(),
  });
  saveState(st);
  return info.permalink;
}

/* ── 다음 슬롯 하나를 게시 ───────────────────────── */
async function cmdQueue() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 1;

  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  if (postedToday >= perDay) {
    log.info(`오늘 ${postedToday}/${perDay}개 완료 — 게시 생략.`);
    return;
  }

  const s = nextSlot(today);
  if (!s) { log.info(`오늘(${today}) 남은 큐가 없습니다 — 게시 생략.`); return; }
  if (!s.images.length || !s.caption) throw new Error(`슬롯 ${s.slot} 에 그림 또는 캡션이 없습니다.`);

  await publish(s.images, s.caption, { ...s.meta, slot: s.slot });

  markDone(today, s.file);
  log.ok(`queue/_done/${today}/${s.slot}.md 로 옮겼습니다.`);
  log.info(`오늘 진행 ${postedToday + 1}/${perDay}개 · 남은 큐 ${pendingSlots(today).length}개`);
}

/* ── 토큰 연장 ───────────────────────────────────── */
async function cmdRefresh() {
  const path = require('path');
  const { ROOT } = require('./lib/util.js');

  const r = await fetch(`${API}/refresh_access_token?grant_type=ig_refresh_token&access_token=${token()}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);

  const days = Math.round((j.expires_in || 0) / 86400);
  const until = new Date(Date.now() + (j.expires_in || 0) * 1000).toISOString().slice(0, 10);

  const st = loadState();
  st.token_expires_around = until;
  saveState(st);

  /* 로컬에서 돌렸으면 .env 도 갱신해 준다.
   * 서버(Actions)에서는 시크릿을 코드가 고칠 수 없으므로 새 토큰을 화면에 남긴다. */
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath) && !process.env.IG_TOKEN) {
    const cur = fs.readFileSync(envPath, 'utf8');
    fs.writeFileSync(envPath, cur.match(/^IG_TOKEN=/m)
      ? cur.replace(/^IG_TOKEN=.*$/m, 'IG_TOKEN=' + j.access_token)
      : cur.trimEnd() + '\nIG_TOKEN=' + j.access_token + '\n', 'utf8');
    log.ok(`.env 갱신 · 만료 예상 ${until} (${days}일 후)`);
  } else {
    log.ok(`토큰 연장됨 · 만료 예상 ${until} (${days}일 후)`);
    log.warn('서버는 시크릿을 자동으로 못 바꿉니다. 아래 토큰을 IG_TOKEN 시크릿에 넣으십시오:');
    console.log('\n' + j.access_token + '\n');
  }
}

/* ── 실행 ────────────────────────────────────────── */
const cmd = process.argv[2];
const run = { status: cmdStatus, queue: cmdQueue, refresh: cmdRefresh }[cmd];
if (!run) {
  console.log('사용법: node scripts/ig.js <status|queue|refresh>');
  process.exit(1);
}
run().catch(e => { log.fail(e.message); process.exit(1); });
