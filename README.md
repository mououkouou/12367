# 출장 전 인천공항 체크보드 (ICN 체크보드)

오늘·내일 인천공항 출발편의 지연·결항, 시간대별 출국장 혼잡, 권장 도착 시각, 목적지 날씨를 한 화면에서 보는 웹 앱입니다.
화면 디자인 기준은 [DESIGN.md](DESIGN.md)에 있습니다.

> 참고용 · 공식 운항 정보는 항공사 안내 확인

## 기능

| 기능 | 설명 |
|---|---|
| 요약 | 출발편 수(공동운항 1편으로 합침), 지연, 결항, 가장 붐비는 시간, 목적지 수 |
| 내 출장 편 | 편명(공동운항 편명도 가능)을 담아 두면 이 기기에 저장, 5분마다 상태 확인, 바뀌면 알림 |
| 출국장 혼잡 | 출국장 × 0~23시 색 띠. 칸 하나 또는 시간 세로줄을 선택하면 연결 카드에 그 시간 출발편 |
| 색 구간 정하기 | 분포 그래프를 보고 보통·혼잡 기준을 직접 정함(기본: 분포 50%·80% 지점) |
| 전체 출발편 | 터미널·항공사·상태 필터, 목적지·편명 검색, 지연·결항 맨 위 |
| 출발 플래너 | 편을 누르면 집 출발 → 공항 도착 권장 → 체크인 마감 → 탑승 → 출발 타임라인, 요약 복사 |
| 최근 3일 지연 경향 | 항공사별·목적지별 지연·결항 비율 (5편 이상) |
| 목적지 날씨 | 도착 공항의 현재 관측값(예보 아님) |

## 데이터와 캐시

| API (공공데이터포털, 인천국제공항공사) | 서버 경로 | 캐시 |
|---|---|---|
| 여객기 운항 현황 상세 (출발) | `/api/board` | 5분 (오늘·내일, 페이지 끝까지) |
| 출입국별 승객 예고 | `/api/board` | 오늘·내일 두 날짜만 저장, 10분마다 새로 받음 |
| 기상 정보 (출발편 도착지) | `/api/board` | 30분 |
| 여객기 운항 현황 상세 (지난 3일) | `/api/trends` | 6시간 |
| 여객기 운항 현황 상세 (달력에서 고른 날) | `/api/day?date=YYYY-MM-DD` | 오늘 기준 3일 전 ~ 6일 뒤만. 지난 날 6시간, 오늘 이후 5분 |
| AI 분석 (OpenAI Responses API) | `POST /api/analyze` | 같은 화면 10분 캐시. 화면 집계값만 보내고, 답의 숫자가 보낸 값에 없으면 다시 요청하거나 보여주지 않음. `OPENAI_API_KEY`·`OPENAI_MODEL`(기본 gpt-6-luna) 필요 |

- 인증키는 **서버 환경 변수 `DATA_GO_KR_KEY`에서만** 읽습니다. 브라우저 코드와 API 응답에는 키가 들어가지 않습니다.
- AI 분석 키는 **서버 환경 변수 `OPENAI_API_KEY`**, 모델은 `OPENAI_MODEL`(기본 `gpt-6-luna`)에서 읽습니다. 키가 없으면 AI 패널에 "설정되지 않음" 안내가 뜨고 나머지 화면은 그대로 동작합니다.
- API가 막히면(키 없음, 한도 초과, 오류) 마지막으로 받은 캐시, 그것도 없으면 `data/samples/` 자료로 화면을 띄우고 상단에 안내합니다.
- 캐시 파일: 로컬은 `data/cache/`, Vercel은 `/tmp/icn-cache` (git에 올라가지 않음).

## 로컬 실행

필요한 것: Node.js 18 이상 (외부 패키지 없음)

1. 키를 환경 변수로 설정합니다. 둘 중 하나:
   - 터미널 환경 변수 `DATA_GO_KR_KEY` 설정 (권장)
   - `.env.example`을 `.env`로 복사하고 값 입력 (`.env`는 git에 올라가지 않음)
2. 실행

```bash
npm start
```

3. 브라우저에서 http://localhost:3000 을 엽니다.

키 없이 실행하면 `data/samples/`의 샘플 자료로 화면이 뜹니다.

## Vercel 배포

1. GitHub 저장소에 올립니다.
2. Vercel에서 저장소를 가져옵니다(Framework Preset: Other, 빌드 명령 없음). `vercel.json`이 `public/`을 정적 파일로, `api/*.js`를 서버 함수로 배포합니다.
3. Project → Settings → Environment Variables에 `DATA_GO_KR_KEY`(필수)와 `OPENAI_API_KEY`·`OPENAI_MODEL`(AI 분석용)을 추가하고 다시 배포합니다.

## 폴더

```
api/            Vercel 서버 함수 (board, trends, health)
lib/            API 호출 · 캐시 · 변환 · 샘플 대체 (서버 전용)
public/         화면 (index.html, styles.css, app.js)
data/samples/   API가 막혔을 때 쓰는 샘플 자료
scripts/        수집·점검용 Python 스크립트 (collect, verify, make_samples)
server.js       로컬 실행용 서버
```

샘플 자료 다시 만들기: `python scripts/collect.py` 후 `python scripts/make_samples.py`
