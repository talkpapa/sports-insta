/* ig.js — 인스타그램에 릴스를 올린다. (Instagram API with Instagram Login v23.0)
 *
 *   node scripts/ig.js status     계정·최근 게시·오늘 진행 상황
 *   node scripts/ig.js queue      다음 슬롯 하나를 게시한다 (자동 운전용)
 *   node scripts/ig.js refresh    토큰 60일 연장
 *
 * 원칙
 *  - 본인 계정에 올리는 것만 한다. 남의 계정 자동 좋아요·팔로우는 정책 위반이라
 *    계정이 정지된다. 이 파일에는 그런 기능이 아예 없다.
 *  - 게시는 API 로 삭제할 수 없다. 올리기 전에 스스로 멈출 이유를 먼저 찾는다.
 *  - 한 번 돌 때 한 편만 올린다. 몰아서 쏟으면 서로의 도달을 깎고 스팸으로 보인다.
 */
const { config, env, tzDate, loadState, saveState, sleep, log } = require('./lib/util.js');
const { nextSlot, pendingSlots, markDone } = require('./lib/queue.js');

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
  const perDay = cfg.publish?.perDay || 3;

  const me = await api('/me', { fields: 'username,account_type,media_count' });
  log.step(`계정 ${me.username} (${me.account_type}) · 게시물 ${me.media_count}개`);

  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  log.info(`오늘 ${today} · 게시 ${postedToday}/${perDay}편 · 남은 큐 ${pendingSlots(today).length}편`);

  const media = await api('/me/media', { fields: 'id,permalink,timestamp,media_type', limit: 1 });
  const last = media.data?.[0];
  if (last) {
    const h = (Date.now() - new Date(last.timestamp).getTime()) / 3600000;
    const gap = cfg.publish?.minGapHours ?? 1.5;
    log.info(`최근 게시 ${last.timestamp.slice(0, 16).replace('T', ' ')} (${h.toFixed(1)}시간 전, ${last.media_type})`);
    log.info(last.permalink);
    console.log(h < gap ? `  ⛔ ${gap}시간 규칙에 걸린다` : `  ✅ ${gap}시간 규칙 통과`);
  }
  if (st.token_expires_around) log.info(`토큰 만료 예상 ${st.token_expires_around}`);
}

/* ── 컨테이너가 다 익을 때까지 기다린다 ──────────────
 * 영상은 사진과 달리 인스타가 받아서 인코딩까지 해야 한다. 오래 걸린다.
 * 사진은 몇 초면 끝나지만 영상은 1분 넘게 걸리는 일이 흔하다. */
async function waitFinished(id, what) {
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const s = await api(`/${id}`, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR') throw new Error(`${what} 실패: ${s.status || ''}`);
    if (i % 10 === 9) log.info(`${what} 처리 중… (${(i + 1) * 3}초)`);
  }
  throw new Error(`${what} 이 3분 안에 끝나지 않았습니다 (영상 규격을 확인하십시오)`);
}

/* ── 게시 ────────────────────────────────────────── */
async function publishReel(meta, caption) {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 3;
  const minGap = cfg.publish?.minGapHours ?? 1.5;
  const st = loadState();

  /* 안전장치 ① 오늘 몫을 다 썼으면 중단 */
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  if (postedToday >= perDay) {
    log.fail(`오늘 이미 ${postedToday}편 올렸습니다 (한도 ${perDay}편). 중단합니다.`);
    process.exit(1);
  }

  /* 안전장치 ② 같은 슬롯을 두 번 올리지 않는다 */
  if ((st.posted_log || []).some(p => p.date === today && p.slot === meta.slot)) {
    log.fail(`슬롯 ${meta.slot} 은 이미 올라갔습니다. 중단합니다.`);
    process.exit(1);
  }

  /* 안전장치 ③ 직전 게시와 너무 붙어 있으면 중단 */
  const recent = await api('/me/media', { fields: 'timestamp', limit: 1 });
  const last = recent.data?.[0];
  if (last) {
    const h = (Date.now() - new Date(last.timestamp).getTime()) / 3600000;
    if (h < minGap) {
      log.fail(`최근 게시가 ${h.toFixed(1)}시간 전입니다 (${minGap}시간 규칙). 중단합니다.`);
      process.exit(1);
    }
  }

  log.step(`릴스 게시 · 슬롯 ${meta.slot} · ${meta.seconds}초 · 캡션 ${caption.length}자`);

  /* ① 컨테이너 만들기 */
  const params = {
    media_type: 'REELS',
    video_url: meta.video,
    caption,
    share_to_feed: 'true',        // 피드에도 보이게 — 도달이 늘어난다
  };
  if (meta.cover) params.cover_url = meta.cover;

  const c = await api('/me/media', params, 'POST');
  log.info(`컨테이너 ${c.id} — 인스타가 영상을 받아 인코딩하는 중`);

  /* ② 다 익을 때까지 */
  await waitFinished(c.id, '영상');

  /* ③ 발행 */
  const pub = await api('/me/media_publish', { creation_id: c.id }, 'POST');
  const info = await api(`/${pub.id}`, { fields: 'permalink' });
  log.ok(`게시 완료 ${info.permalink}`);

  st.posted_log = st.posted_log || [];
  st.posted_log.push({
    date: today, slot: meta.slot,
    media_id: pub.id, permalink: info.permalink,
    seconds: Number(meta.seconds || 0),
    source: meta.source || '',
    title: meta.source_title || '',
    at: new Date().toISOString(),
  });
  saveState(st);
  return info.permalink;
}

/* ── 오늘 큐에서 다음 한 편 ───────────────────────── */
async function cmdQueue() {
  const cfg = config();
  const tz = cfg.account?.timezone || 'Asia/Seoul';
  const today = tzDate(0, tz);
  const perDay = cfg.publish?.perDay || 3;

  const st = loadState();
  const postedToday = (st.posted_log || []).filter(p => p.date === today).length;
  if (postedToday >= perDay) { log.info(`오늘 ${postedToday}/${perDay}편 완료 — 게시 생략.`); return; }

  const s = nextSlot(today);
  if (!s) { log.info(`오늘(${today}) 남은 큐가 없습니다 — 게시 생략.`); return; }
  if (!s.meta.video || !s.caption) throw new Error(`슬롯 ${s.slot} 에 영상 또는 캡션이 없습니다.`);

  await publishReel({ ...s.meta, slot: s.slot }, s.caption);

  markDone(today, s.file);
  log.ok(`queue/_done/${today}/${s.slot}.md 로 옮겼습니다.`);
  log.info(`오늘 진행 ${postedToday + 1}/${perDay}편 · 남은 큐 ${pendingSlots(today).length}편`);
}

/* ── 토큰 연장 ───────────────────────────────────── */
async function cmdRefresh() {
  const fs = require('fs');
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
