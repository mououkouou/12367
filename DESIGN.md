# ICN CHECKBOARD — 디자인 표준 v5 "Stripe-inspired Colour & Type"

출장자를 위한 공항 출발 컨시어지. 화면을 만들거나 고칠 때 이 문서의 토큰 · 컴포넌트 · 데이터 규칙을 먼저 따른다. 규칙을 바꾸면 이 문서부터 고친다.
v5는 v4의 **레이아웃 · 섹션 구성 · 컴포넌트 구조 · 간격 · 아이콘 · 이미지를 그대로 두고 색과 글자만** 바꾼 판이다(v4의 아이보리 · 코발트 · 라임 · 코랄 색 규칙은 폐기). 토큰의 실제 값은 `public/styles.css`의 `:root`에 있다.

---

## 1. Design Philosophy

| 원칙 | 의미 |
|---|---|
| **판단이 먼저, 장식은 나중** | 5초 안에 "내 편 상태 · 언제 어디로 · 지금 주의할 점"을 읽게 한다. 색과 글자 크기는 읽는 순서를 만드는 도구다 |
| **Neutral 75 · Primary 15 · Accent 10** | 바탕은 아주 밝은 뉴트럴과 흰색. 브랜드 퍼플은 주 버튼 · 선택 상태 · 핵심 수치에만. 시안 · 바이올렛은 시선이 모여야 하는 1~2곳에만 |
| **의미 색은 브랜드와 분리** | 정상 · 지연 · 결항 · 혼잡은 정해진 의미 색만 쓴다. 퍼플을 상태로, 상태 색을 장식으로 쓰지 않는다 |
| **정직한 데이터** | 공항 자료 · 자체 계산 · AI 생성을 태그로 구분한다. 없는 값 · 예보 · 비교 기준 없는 증감은 만들지 않는다 |
| **절제된 그라디언트** | 그라디언트는 히어로 바탕의 옅은 빛(바이올렛 · 시안)과 내 항공편 패널 윗선 3px에만 |

## 2. Visual Direction

참고: Stripe의 선명한 퍼플 · 블루, 밝은 바탕, 정교한 대비, 자신감 있는 큰 타이포. 복제하지 않고 공항 출발 서비스에 맞게 재해석한다.

- **밝은 첫 화면.** `#F6F9FC` 바탕 위 딥 인디고 헤드라인, 오른쪽 위에서 번지는 옅은 바이올렛 · 시안 빛. 사진 카드는 오버레이 없이.
- **딥 인디고는 글자와 한 개의 패널에.** `#0A2540`은 제목 · 큰 숫자 글자색, 그리고 내 항공편 패널과 바닥글 면에만.
- **퍼플은 핵심에만.** 주 버튼, 선택된 칩 · 날짜 · 혼잡 칸/시간, 대표 KPI 숫자(출발 예정 편수), 주 데이터 계열.
- **시안은 다크 패널 위 "다음에 할 일"**(남은 시간, 체크리스트 다음 단계, 권장 도착 테두리)과 AI 표시에만. 바이올렛은 아이브로 점 · 항로 비행기에만.
- 이미지: `public/icn/airport-hero.webp`(연출용 생성 이미지 — 실제 인천공항 사진처럼 표기하지 않는다). 로고 마크 `airport-mark.svg`는 임시 심볼(에셋 원본 색 유지).

## 3. Color Tokens

### 3-1. Foundation · Brand (Light)

| 토큰 | HEX | 용도 | 비고 |
|---|---|---|---|
| `--bg` | `#F6F9FC` Main Background | 페이지 바탕 | |
| `--bg-2` | `#EEF2F7` | 혼잡 영역 바탕 | 뉴트럴 한 단계 |
| `--tint` | `#F0EFFF` Subtle Purple | 날씨 섹션 띠 | |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F6F9FC` | 카드 · 표 / 카드 안 칸 · 표 헤더 | |
| `--ink` | `#0A2540` Deep Indigo (Heading) | 제목 · 강한 값 · 숫자 | `:where(h1~h4, b, strong, dt)`에 기본 적용 |
| `--ink-2` | `#425466` Body | 본문(`body` 기본 글자색) | |
| `--muted` | `#5E6B7E` | 설명 · 라벨 · 캡션 | 기준값 `#697386`은 `#EEF2F7`·`#F0EFFF` 위에서 4.3:1이라 AA를 위해 한 단계 낮춤 |
| `--line` / `--line-2` | `#E3E8EE` Border / `#D0D8E2` | 카드 테두리 · 구분선 / 입력 테두리 | |
| `--primary` | `#635BFF` Brand Purple | 주 CTA · 선택 · 핵심 수치 · 주 데이터 | 흰 바탕 대비 5.2:1 |
| `--primary-hover` | `#5148E5` | CTA hover · 퍼플 글자(링크, 아이브로) | 6.4:1 |
| `--primary-soft` / `--lavender` | `#F0EFFF` / `#E9E7FF` Soft Lavender | 자체 계산 태그 · 선택 배경 | |
| `--accent` | `#00C4FF` Cyan | 다크 패널 위 강조, AI 표시 | 흰 바탕 글자 금지(2.1:1). 딥 인디고 위 8.3:1 |
| `--accent-2` | `#7A73FF` Violet | 아이브로 점 · 항로 비행기 · 그라디언트 | 글자색 금지 |
| `--blue` | `#007BFF` Bright Blue | 그라디언트 · 보조 데이터 계열 예약 | 흰 바탕 글자 금지(3.9:1) |
| `--dark` / `--dark-2` / `--dark-line` | `#0A2540` / `#133358` / `#24497A` | 내 항공편 패널 · 바닥글 / 패널 안 칸 / 패널 안 선 | |
| `--on-dark` / `--on-dark-2` | `#FFFFFF` Inverse / `#ADBDCC` | 다크 위 글자 / 보조 | 보조 7.9:1 |
| `--hero-wash` | 바이올렛 16% + 시안 12% 방사형 | 히어로 바탕만 | |
| `--brand-line` | `#7A73FF → #635BFF → #00C4FF` | 내 항공편 패널 윗선 3px만 | |

### 3-2. Semantic (상태 전용, 브랜드와 분리 — 의미 유지)

| 의미 | 글자 · 선 | 바탕 `-soft` | 아이콘 | 쓰는 곳 |
|---|---|---|---|---|
| Success (정상 · 출발) | `#15704F` | `#E5F5EC` | 체크 | 상태 알약 |
| Warning (지연 · 지연 출발) | `#A15C00` | `#FDF1DE` | 시계 | 상태 알약, 변경 시각, 지연 계열 |
| Danger (결항) | `#C42B3F` | `#FDE8EC` | 원 안 X | 상태 알약, 결항 계열 |
| Info (탑승 관련 · 안내) | `#0060C7` | `#E5F0FF` | 화살표 · 전구 | 탑승 알약, 해석 문장 |
| Disabled | `#A3ACB9` | `#EEF2F7` | — | 비활성 컨트롤 |
| Unknown (예정) | `#5E6B7E` | `#EEF2F7` | 점 | 예정 알약 |

상태는 항상 **아이콘 + 글자 + 색**. 퍼플 · 시안 · 바이올렛은 상태 의미로 쓰지 않는다.

### 3-3. Dark theme (`prefers-color-scheme: dark` · `[data-theme="dark"]`)

| 토큰 | Dark | 토큰 | Dark |
|---|---|---|---|
| `--bg` / `--bg-2` / `--tint` | `#0A1628` / `#0E1D33` / `#17163A` | `--primary` / `-hover` / `-soft` | `#8F89FF` / `#A8A3FF` / `#221F4D` |
| `--surface` / `--surface-2` | `#0F2038` / `#142846` | `--success` / `-soft` | `#4CC38A` / `#0F3326` |
| `--ink` / `--ink-2` / `--muted` | `#F6F9FC` / `#C1CCD9` / `#95A3B6` | `--warning` / `-soft` | `#F2B45A` / `#3A2A12` |
| `--line` / `--line-2` | `#1F3555` / `#2B4468` | `--danger` / `-soft` | `#FF7A8A` / `#3D1A22` |
| `--dark` / `--dark-2` / `--dark-line` | `#0D2A4C` / `#15365F` / `#2A5285` | `--info` / `-soft` | `#5CB2FF` / `#0F2A4A` |

시안 · 바이올렛은 두 테마에서 같은 값. 선택된 컨트롤 글자는 `var(--on-primary)`(라이트 `#FFFFFF`, 다크 `#0A1628`).

### 3-4. Tailwind theme 대응 (도입 시 그대로 사용)
```js
// tailwind.config.js — theme.extend (CSS 변수를 그대로 참조)
colors: {
  bg: "var(--bg)", "bg-2": "var(--bg-2)", tint: "var(--tint)", surface: "var(--surface)", "surface-2": "var(--surface-2)",
  ink: "var(--ink)", body: "var(--ink-2)", muted: "var(--muted)", line: "var(--line)",
  primary: { DEFAULT: "var(--primary)", hover: "var(--primary-hover)", soft: "var(--primary-soft)" },
  lavender: "var(--lavender)", cyan: "var(--accent)", violet: "var(--accent-2)", blue: "var(--blue)", dark: "var(--dark)",
  success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)", info: "var(--info)",
},
fontFamily: { sans: ["Inter", "Pretendard Variable", "sans-serif"], num: ["Inter", "sans-serif"] },
fontWeight: { heading: "700", sub: "650", label: "600", body: "400" },
```
현재 프로젝트는 순수 CSS라 CSS 변수가 기준이다. 컴포넌트 CSS · JS에서 HEX를 직접 쓰지 않는다(예외: `:root` 토큰 정의, 에셋 SVG).

## 4. Typography System

- 글꼴: `--font: "Inter", "Pretendard Variable", Pretendard, …` — 영문 · 숫자는 Inter, 한글은 Pretendard로 자동 분리. Inter(Google Fonts, 가변 400~700) · Pretendard(jsDelivr) 로드.
- 숫자 · 시각 · 편명 · 공항 코드: `--font-num`(Inter) + `font-variant-numeric: tabular-nums`. 대상: `.fid .code td.t .times b .route .ap b .kpi .val .tile b .tp .tr-nums b .check .tm .wl .t .hero-stats b .selbar b .facts b .mf-id .mf-grid b .hr .hax .timeline .tt`.
- 굵기 토큰: `--w-heading 700` · `--w-sub 650` · `--w-label 600` · `--w-body 400`. 800 이상 쓰지 않는다.
- 자간: 영문 · 숫자 헤딩 -0.02~-0.03em, 한글 헤딩 -0.015~-0.025em(가독성 우선), 본문 0. 한글은 `word-break: keep-all`.

| 단계 | 데스크톱 | 모바일 | 굵기 / 행간 | 용도 |
|---|---|---|---|---|
| Hero Heading | clamp(36px, 4.4vw, 58px) | 34px | 700 / 1.15, -0.025em | 히어로 |
| Airport Code | clamp(44px, 5vw, 60px) | 36px | 700 / 1.0 | 대표 편 ICN · 목적지 |
| KPI Value (대표) | 56px, 퍼플 | 48px | 700 / 1.1 | 출발 예정 편수 |
| KPI Value | 40px | 34px | 700 / 1.1 | 지연 · 결항, 예상 승객, 피크 |
| Section Heading | 30px | 30px | 700 / 1.25, -0.02em | 섹션 제목 |
| Departure Time | 36px | 28px | 700 / 1.15 | 대표 편 출발 시각 |
| Card Heading | 20px | 20px | 650 / 1.3 | 카드 제목 |
| Body | 15px (14~16) | 15px | 400 / 1.6 | 본문(`#425466`) |
| Label | 13px | 13px | 600 | KPI 라벨, 칩 |
| Caption / Eyebrow | 12px | 12px | 600, 아이브로 대문자 .08em 퍼플 | 설명 · 태그 |

## 5. Spacing & Layout (v4 그대로 — 이번 판에서 변경 금지)

- 8px 체계 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96, 섹션 간격 64(모바일 48), 최대 폭 1360px.
- 그리드: KPI 12열, 히어로 7:5, 대표 편 8:4. 브레이크포인트 1180 · 1040 · 980 · 760 · 560 · 420 · 320.

## 6. Surface & Component Styles

- 모서리: 칩 999 · 컨트롤 12 · 카드 16 · 패널 20 (v4 그대로).
- 그림자: `--shadow-1`(딥 인디고 5%), `--shadow-2`(`rgba(50,50,93,.25)` — 대표 편 패널 · 서랍 · 토스트만).

| 컴포넌트 | 색 규칙 |
|---|---|
| 주 버튼 `.btn.primary` | 퍼플 면 + 흰 글자, hover `#5148E5`. 그라디언트 · 글로우 없음 |
| 보조 버튼 · 고스트 | 흰 면 + `--line-2` 테두리 + 딥 인디고 글자 / 투명 → hover `--surface-2` |
| 세그먼트(오늘 · 내일 · 터미널) | 트랙 `--surface-2`, 선택 = 흰 알약 + 퍼플 글자 |
| 상태 칩 · 날짜 선택 버튼 | 선택 = 퍼플 면 + 흰 글자 |
| 상태 알약 | 의미 색 soft 바탕 + 의미 색 글자 + 아이콘 |
| 출처 태그 | 공항 자료 = 뉴트럴, 자체 계산 = 라벤더 바탕 + 퍼플 글자, AI 생성 = 시안 테두리 |
| 대표 편 패널 | 딥 인디고 면 + 윗선 `--brand-line`, 남은 시간 · 다음 단계 · 권장 도착 = 시안, 비행기 = 바이올렛 |
| KPI | 흰 면, 대표 숫자만 퍼플, 나머지 딥 인디고 |
| 표 | 얇은 `--line` 가로선, hover `--surface-2`, ☆ 선택 = 퍼플, 지연 · 결항 = 왼쪽 3px 의미 색 |

## 7. Section-specific Color Rules

| 섹션 | 바탕 | 강조 | 금지 |
|---|---|---|---|
| 헤더 | `--bg` 88% + 블러 | 현재 메뉴 = 딥 인디고 글자 + 퍼플 밑줄 2px | 어두운 바 |
| 히어로 | `--bg` + `--hero-wash` | 헤드라인 딥 인디고, CTA 퍼플, 아이브로 퍼플 + 바이올렛 점 | 강한 그라디언트 면, 사진 오버레이 |
| 내 항공편 | `--dark` + 윗선 그라디언트 | 시각 · 코드 흰색 최대 위계, 시안 강조 | 다크 위 퍼플 글자 |
| KPI | `--surface` | 대표 숫자 퍼플, 막대 = 연한 퍼플, 지금 시각 = 퍼플 | 카드마다 다른 색 |
| 혼잡 | `--bg-2` 판 + 무채색(인디고 톤) 단계 | 선택 칸 · 시간만 퍼플 | 퍼플을 단계 색으로 |
| 운항 표 | `--surface` | 상태 알약, 변경 시각 = warning | 지연 행 전체 색칠 |
| 지연 분석 | `--surface` | 편수 = 연한 퍼플, 지연 = warning, 결항 = danger, 순위 막대 = 퍼플 한 계열, 해석 = info | 무지개 계열 |
| 날씨 | `--tint`(옅은 라벤더) 띠 + 흰 카드 | 기온 숫자 | 자료에 없는 날씨 상태 아이콘 · 예보 |
| 바닥글 | `--dark` | 시안 · 퍼플 쓰지 않음 | — |

## 8. Interaction States

| 상태 | 정의 |
|---|---|
| Hover | 면 `--surface-2` 또는 테두리 `--line-2`/`--ink-2`; 주 버튼 `--primary-hover`; 150ms |
| Focus | `outline: 2px solid var(--primary); outline-offset: 2px` (`:focus-visible`), 입력은 `0 0 0 4px var(--primary-soft)` |
| Selected | 칩 · 날짜 = 퍼플 면 + `--on-primary`; 세그먼트 = 흰 알약 + 퍼플 글자; 혼잡 칸 = 퍼플 2px 링; 시간 열 = 퍼플 면; 정렬 열 = 딥 인디고 + 퍼플 ↑ |
| Disabled | 글자 `--disabled`, 바탕 `--disabled-soft`, `cursor: not-allowed` |
| Loading | 스켈레톤 `--surface-2`→`--line` 쉬머, 버튼 회전 표시 + "분석 중…" |
| Error | danger 테두리 + soft 바탕 + 다시 시도 안내 |

## 9. Data Visualization Palette

| 토큰 | Light | Dark | 용도 |
|---|---|---|---|
| `--dv-1` | `#635BFF` | `#8F89FF` | 주 계열 · 강조 막대(지금 시각) · 순위 막대 |
| `--dv-1-soft` | `#CFCBFF` | `#3B3780` | 일반 막대(시간대별 편수) |
| `--dv-base` | `#E3E8EE` | `#22395A` | 배경 막대 |
| 지연 / 결항 | `--warning` / `--danger` | | 상태 계열 |
| `--cg-rest` · `--cg-low` · `--cg-mid` · `--cg-high` | `#F1F4F8` · `#E1E7F0` · `#9AABC2` · `#2E4A6E` | `#12233B` · `#1B2F4C` · `#435C80` · `#AFC0D8` | 혼잡: 0 · 여유 · 보통 · 혼잡 |

혼잡 범례 의미(여유 · 보통 · 혼잡 · 미운영)는 그대로다. 단계는 툴팁 · `aria-label` · 선택 요약 태그에 글자로 함께 쓴다.

## 10. Responsive & Accessibility Rules

- 텍스트 대비 WCAG AA(본문 4.5:1, 큰 글자 3:1). 시안 · 바이올렛 · 브라이트 블루는 흰 바탕 글자로 쓰지 않는다.
- 색만으로 의미 전달 금지(아이콘 · 글자 · 범례 · `aria-label`). 키보드 선택 · 포커스 표시 유지.
- 모바일 글자 크기는 4장 표의 모바일 열. 320px까지 글자 잘림 · 가로 넘침 없음.

## 11. Do & Don't

| Do | Don't |
|---|---|
| 밝은 뉴트럴 바탕 + 흰 카드 + 딥 인디고 글자 | 화면 대부분을 진한 색으로 |
| 퍼플은 주 버튼 · 선택 · 대표 수치에만 | 모든 링크 · 아이콘 · 카드에 퍼플 |
| 그라디언트는 히어로 빛 · 패널 윗선에만 | 버튼 · 카드 그라디언트, 글로우 |
| 상태는 의미 색 + 아이콘 + 글자 | 퍼플 · 시안으로 상태 표시 |
| Inter 숫자 + tabular, 굵기 650~700 | 800 이상 굵기, 숫자 폭이 흔들리는 글꼴 |
| 한글 자간 자연스럽게, `keep-all` | 한글에 과한 음수 자간 |

## 12. Implementation Acceptance Criteria

1. 컴포넌트 CSS · JS에 HEX/RGB 직접값이 없다(`:root` 토큰 블록 제외).
2. v4 아이보리 `#F7F6F2` · 코발트 `#345DFF` · 라임 `#D8F36A` · 코랄 `#FF7966` 값이 코드에 남아 있지 않다.
3. 지연 = warning, 결항 = danger, 정상 = success, 혼잡 = `--cg-*`. 브랜드 색이 상태 의미로 쓰이지 않는다.
4. 레이아웃 · 간격 · 컴포넌트 구조 · 아이콘 · 이미지 · 기능은 v4와 같다(색 · 글꼴 · 크기 · 굵기 · 자간 · 행간만 다름).
5. 1440px · 390px에서 글자 잘림 · 가로 넘침이 없고, 라이트 · 다크 모두 텍스트 대비 기준 미달 0건(검사 스크립트).

## 13. 정보구조 · 상태 · 데이터 규칙 (유지)

- 순서: 헤더 → 히어로(`#overview`) → 내 항공편(`#mine`) → 공항 전반 상황 → 출국장 혼잡(`#congestion`) → 운항 현황(`#flights`) → 지연 분석(`#trends`) → 목적지 날씨(`#weather`) → 바닥글.
- 상태 설계: 첫 로딩 스켈레톤, API 오류 · 한도 시 상단 안내 + 1분 뒤 재시도, 혼잡 예고 없는 날짜 안내, 날짜 변경 시 선택 · AI 결과 초기화, 검색 실패 문장, 즐겨찾기 0건 빈 상태, 지난 날짜 안내.
- 문구: 고정 문구 **"참고용 · 공식 운항 정보는 항공사 안내 확인"**. 날씨는 "현재 관측(예보 아님)", 관측 시각은 자료 수신 시각. 지연 해석 문장은 5편 이상 시간대가 있을 때만, "지난 자료 집계이며 예측이 아님". 권장 도착은 "출발 2시간 30분 전 · 탑승동 +15분 · 혼잡 시 +30분"의 자체 계산.
- 데이터 · 보안: `DATA_GO_KR_KEY`, `OPENAI_API_KEY` · `OPENAI_MODEL`, `AIRTABLE_TOKEN` · `AIRTABLE_BASE_ID` · `AIRTABLE_TABLE`은 서버 환경 변수에서만. 캐시 운항 5분 · 기상 30분 · 승객예고 오늘·내일만(10분) · 3일 경향 6시간 · AI 같은 화면 10분. API가 막히면 `data/samples`로 대체하고 표시. 공동운항은 1편으로. 지연 = 변경 − 예정 ≥ 15분 또는 '지연' 표시. 시각은 KST.
- 이용 기록: 시간대 선택 · 터미널/항공사 필터 · AI 분석(성공 여부 · 응답 시간)만, 익명 세션 ID, IP · 이름 · 연락처 기록 금지.
