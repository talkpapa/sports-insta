/* josa.js — 앞말에 맞는 조사를 고른다.
 *
 * "에스파뇰와", "Groningen가" 처럼 조사가 틀리면 사람이 쓴 글로 안 읽힌다.
 * 하루 여섯 번 나가는 계정이라 한 번 틀리면 하루 종일 틀린 채로 나간다.
 *
 * 받침이 있으면  → 과 / 이 / 은 / 을 / 으로
 * 받침이 없으면  → 와 / 가 / 는 / 를 / 로
 * (ㄹ 받침은 '로' 를 쓴다 — "서울로", "3-1로")
 */

/** 한글 음절의 받침 여부. 받침이 ㄹ 이면 'ㄹ' 을 돌려준다. */
function hangulBatchim(ch) {
  const code = ch.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return null;      // 한글 음절이 아니다
  const jong = (code - 0xAC00) % 28;
  if (jong === 0) return false;
  return jong === 8 ? 'ㄹ' : true;                       // 8 = ㄹ
}

/* 영문·숫자로 끝나는 말은 한국 사람이 읽는 소리를 기준으로 판단한다.
 * 예: Arsenal → "아스날"(ㄹ 받침), Chelsea → "첼시"(받침 없음) */
const LATIN_VOWEL = /[aeiouy]/i;
const DIGIT_BATCHIM = { '0': true, '1': 'ㄹ', '3': true, '6': true, '7': true, '8': 'ㄹ' };
//                      영     일      삼     육     칠     팔
//  2(이) 4(사) 5(오) 9(구) 는 받침이 없다

function tailBatchim(word) {
  const s = String(word || '').trim().replace(/[)\]}"'’”\s.]+$/, '');
  if (!s) return false;
  const last = s[s.length - 1];

  const h = hangulBatchim(last);
  if (h !== null) return h;

  if (/[0-9]/.test(last)) return DIGIT_BATCHIM[last] ?? false;

  if (/[a-z]/i.test(last)) {
    /* l 은 ㄹ 받침으로 읽는다 (Arsenal → 아스날).
     * r 은 "르" 로 읽어 받침이 없다 (Alkmaar → 알크마르). 둘을 같이 두면 안 된다. */
    const lo = last.toLowerCase();
    if (lo === 'l') return 'ㄹ';
    if (lo === 'r') return false;
    return LATIN_VOWEL.test(last) ? false : true;
  }
  return false;                                          // 모르겠으면 받침 없는 쪽으로
}

/* 짝 — [받침 있을 때, 받침 없을 때] */
const PAIRS = {
  '와': ['과', '와'], '과': ['과', '와'],
  '이': ['이', '가'], '가': ['이', '가'],
  '은': ['은', '는'], '는': ['은', '는'],
  '을': ['을', '를'], '를': ['을', '를'],
  '로': ['으로', '로'], '으로': ['으로', '로'],
};

/**
 * 앞말에 맞는 조사를 붙여 돌려준다.
 *   j('아스널', '가')  → '아스널이'
 *   j('첼시', '가')    → '첼시가'
 *   j('3-1', '로')     → '3-1로'
 */
function j(word, josa) {
  const pair = PAIRS[josa];
  if (!pair) return String(word) + josa;
  const b = tailBatchim(word);
  /* '로/으로' 는 ㄹ 받침일 때 '로' 를 쓴다 — "아스널로", "서울로" */
  if (josa === '로' || josa === '으로') return String(word) + (b === 'ㄹ' || b === false ? '로' : '으로');
  return String(word) + (b ? pair[0] : pair[1]);
}

module.exports = { j, tailBatchim };
