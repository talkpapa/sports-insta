/* teams-ko.js — 구단 이름을 한글로.
 *
 * 한국 사람이 보는 계정이므로 카드에 "Tottenham Hotspur" 대신 "토트넘"이 찍혀야 한다.
 * 없는 이름은 원문 그대로 나간다(틀린 한글보다 영문이 낫다).
 * 새 구단이 필요하면 여기에 한 줄씩 더하면 된다.
 */
const MAP = {
  /* 프리미어리그 */
  'Arsenal': '아스널', 'Aston Villa': '아스톤 빌라', 'Bournemouth': '본머스',
  'AFC Bournemouth': '본머스', 'Brentford': '브렌트포드', 'Brighton': '브라이턴',
  'Brighton & Hove Albion': '브라이턴', 'Burnley': '번리', 'Chelsea': '첼시',
  'Crystal Palace': '크리스탈 팰리스', 'Everton': '에버턴', 'Fulham': '풀럼',
  'Leeds United': '리즈', 'Liverpool': '리버풀', 'Manchester City': '맨시티',
  'Manchester United': '맨유', 'Newcastle United': '뉴캐슬',
  'Nottingham Forest': '노팅엄', 'Sunderland': '선덜랜드',
  'Tottenham Hotspur': '토트넘', 'Tottenham': '토트넘',
  'West Ham United': '웨스트햄', 'Wolverhampton Wanderers': '울버햄튼',
  'Wolves': '울버햄튼', 'Ipswich Town': '입스위치', 'Leicester City': '레스터',
  'Southampton': '사우샘프턴',

  /* 라리가 */
  'Real Madrid': '레알 마드리드', 'Barcelona': '바르셀로나', 'FC Barcelona': '바르셀로나',
  'Atletico Madrid': '아틀레티코', 'Atlético Madrid': '아틀레티코',
  'Athletic Bilbao': '아틀레틱 빌바오', 'Athletic Club': '아틀레틱 빌바오',
  'Sevilla': '세비야', 'Real Betis': '베티스', 'Villarreal': '비야레알',
  'Valencia': '발렌시아', 'Real Sociedad': '레알 소시에다드', 'Girona': '지로나',
  'Celta Vigo': '셀타 비고', 'Osasuna': '오사수나', 'Getafe': '헤타페',
  'Rayo Vallecano': '라요 바예카노', 'Mallorca': '마요르카', 'Espanyol': '에스파뇰',
  'Alaves': '알라베스', 'Deportivo Alavés': '알라베스',

  /* 유럽 주요 구단 (챔피언스리그) */
  'Bayern Munich': '바이에른 뮌헨', 'FC Bayern München': '바이에른 뮌헨',
  'Borussia Dortmund': '도르트문트', 'Bayer Leverkusen': '레버쿠젠',
  'RB Leipzig': '라이프치히', 'Paris Saint-Germain': 'PSG', 'Paris Saint Germain': 'PSG',
  'Marseille': '마르세유', 'Monaco': '모나코', 'Lyon': '리옹',
  'Inter Milan': '인터 밀란', 'Internazionale': '인터 밀란', 'AC Milan': 'AC 밀란',
  'Juventus': '유벤투스', 'Napoli': '나폴리', 'AS Roma': '로마', 'Roma': '로마',
  'Lazio': '라치오', 'Atalanta': '아탈란타', 'Fiorentina': '피오렌티나',
  'Benfica': '벤피카', 'Porto': '포르투', 'FC Porto': '포르투',
  'Sporting CP': '스포르팅', 'Ajax': '아약스', 'PSV': 'PSV', 'PSV Eindhoven': 'PSV',
  'Feyenoord': '페예노르트', 'Celtic': '셀틱', 'Rangers': '레인저스',
  'Galatasaray': '갈라타사라이', 'Club Brugge': '클럽 브뤼헤',
  'Shakhtar Donetsk': '샤흐타르', 'Red Bull Salzburg': '잘츠부르크',
};

/** 영문 구단명 → 한글. 없으면 원문 그대로. */
function ko(name) {
  const n = String(name || '').trim();
  if (!n) return '';
  if (MAP[n]) return MAP[n];
  /* "Manchester United FC" 처럼 꼬리가 붙어 오는 경우가 있다 */
  const trimmed = n.replace(/\s+(FC|CF|AFC|SC|AC|BK)$/i, '').trim();
  return MAP[trimmed] || n;
}

module.exports = { ko, MAP };
