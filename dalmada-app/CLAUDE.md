# 달마다 (Dalmada) — 프로젝트 안내 · Claude Code 작업 지침

이 문서는 이 저장소에서 작업할 때 반드시 먼저 읽어야 하는 규칙과 맥락입니다.

## 이 앱이 무엇인가
"달마다"는 개인 가계부·고정비 관리 모바일 웹앱(PWA)입니다. 슬로건은 "매달 빠지는 돈, 한눈에 잡다". 서버·로그인 없이 **모든 데이터를 사용자 브라우저(localStorage)에만** 저장합니다. Vite + React 단일 컴포넌트 구조입니다.

## 기술 스택 / 실행
- Vite + React 18 (JSX). 상태관리 라이브러리 없음(React 기본 훅만).
- 스타일: **외부 CSS·Tailwind를 쓰지 않고**, 파일 하단의 자바스크립트 객체 `S`(및 온보딩용 `O`)에 인라인 스타일로 관리.
- 명령어:
  - `npm install` — 최초 1회
  - `npm run dev` — 로컬 개발 서버 (localStorage 작동)
  - `npm run build` — 배포용 `dist/` 생성 (PWA 서비스워커·manifest 자동 포함)
- 배포: GitHub → Vercel 자동 배포. Vercel의 Root Directory는 `dalmada-app`으로 설정돼 있음.

## 파일 구조
```
index.html            진입 HTML (PWA 메타 포함)
vite.config.js        Vite + vite-plugin-pwa 설정 (아이콘·manifest)
src/
  main.jsx            React 진입점 (Dalmada 컴포넌트를 렌더)
  Dalmada.jsx         ★ 앱 전체 (약 3,200줄). 거의 모든 작업은 이 파일에서 이뤄짐
  index.css           전역 배경·폰트 정도의 최소 스타일
public/               PWA 아이콘(icon-192/512.png), favicon.svg
```

## Dalmada.jsx 내부 구조 (수정 전 반드시 파악)
파일은 크게 이 순서로 되어 있습니다.
1. **상수·헬퍼** (상단): 카테고리 정의(FIXED_CATS, VAR_CATS, INCOME_CATS, VAR_INCOME_CATS, ASSET_CATS, SAVE_TARGETS), 금액 포맷 `won()`, 반복 주기 계산(`monthly`, `cycleLabel`, `occursOn`, `amountForMonth`, `amountIn`, `inPeriod`, `inMonth`), 기간/예외 헬퍼(`overrideFor`, `isSkipped`), 다가올 결제일(`upcomingIn` — 고정비 탭과 대시보드가 공유), 날짜 헬퍼(`parseISO`, `isoOf`, `pad2`, `isoForDay`, `initialDate`, `dateFields`, `initialAnchor`), 검증(`cycleIssue`), localStorage 입출력(`normalizeState`, `isValidBackup`, `loadState`, `saveState`, STORE_KEY = "dalmada:v1"). 시드 데이터(SEED_*)는 현재 전부 비어 있음(신규 사용자는 온보딩으로 시작).
   - **날짜 문자열은 반드시 `parseISO()`로 파싱**하라. `new Date("YYYY-MM-DD")`는 UTC로 해석돼 KST에서 하루 밀린다. ISO 문자열을 만들 때도 `toISOString()` 대신 `isoOf()`를 쓴다.
2. **메인 컴포넌트** `Dalmada()`: 모든 상태(fixed, variable, income, varIncome, fixedSave, varSave, assets, history, lastYM, onboarded 등)와 핸들러(saveItem, deleteItem, skipThisMonth, handleClose 자동/수동 마감), 탭 렌더링. `onboarded`가 false면 `<Onboarding>`을 먼저 렌더.
   - **오버레이 상태**는 여기 모여 있다: `editing`(입력·수정 시트 6종), `pickMenu`(종류 선택 시트), `showAssetForm`, `showCloseForm`, `calDay`(달력에서 펼친 날짜 — 뒤로가기로 접으려고 `CalendarView` 밖으로 끌어올린 제어 상태). **새 모달/시트를 추가하면 아래 뒤로가기 1단계 목록에도 반드시 넣어라.**
   - **안드로이드 뒤로가기**: 마운트 시 `history.pushState`로 "가드 엔트리"를 하나 쌓고 `popstate`로 back을 가로챈다. ① 떠 있는 오버레이부터 닫고 ② 홈(dash)이 아니면 홈으로 보내고 ③ 홈이면 토스트("한 번 더 누르면 종료됩니다") 후 2초 내 재입력 시 종료. 앱을 유지할 때만 가드를 다시 쌓고, 종료시킬 때는 쌓지 않아 브라우저 기본 동작으로 나간다. 핸들러는 마운트 시 한 번만 등록되므로 상태는 `backState` **ref로만** 읽는다(의존성 없는 `useEffect`가 매 렌더 갱신) — 여기서 상태를 직접 참조하면 stale closure 버그가 난다. 하드웨어 back이 없는 기기(`HAS_HW_BACK` = 안드로이드 UA)에서는 ③의 종료 안내를 띄우지 않는다.
3. **화면 컴포넌트**: Onboarding, PickSheet, RemainHero, Dashboard(이번 달 요약 홈), FixedTab(고정수입·고정비·고정저축), NetTrend, CalendarView, MonthView, AssetView 등.
   - 탭은 5개: `dash`(홈) / `fixed`(고정비) / `month`(이번 달) / `calendar`(달력) / `asset`(총자산). 라벨은 좁은 화면(320px)에 맞춰 짧게 유지하고, `S.tab`은 `flex:1`로 균등 분할해 탭당 약 60×44px 터치 영역을 확보한다. **탭을 더 늘리거나 라벨을 길게 바꾸면 이 폭 계산이 깨진다.**
   - 히어로는 탭별로 다르다: `dash`·`month` → `RemainHero`(쓸 수 있는 돈), `fixed` → 월/연 환산 토글(`heroView`), `calendar`·`asset` → 없음(`asset`은 자체 `assetHero` 보유).
   - `MonthView`와 `FixedTab`은 고정수입·고정저축 목록이 의도적으로 겹친다. `month` 탭은 "남는 돈이 어떻게 나왔는지"의 근거라서 빼면 안 된다.
   - `Dashboard`(홈)는 **회계 계산을 직접 하지 않는다.** 메인이 계산한 값(incomeTotal/monthTotal/varTotal/saveTotal/thisMonthNet/history/upcoming)과 `variable` 배열만 받아 표시용 파생값을 집계할 뿐이다. 블록 순서: 4칸 요약 → 지난달 대비 → **예산 페이스 게이지**(지출률 vs 날짜 진행률, 앞서면 경고색) → **오늘/이번 주 변동비**(이번 주 = 월요일~오늘, `date` ISO 문자열 비교) → **하루 평균 인사이트**(마감 기록 있을 때만) → **지출 카테고리 톱3**(이번 달 변동비, 카테고리 색 재사용) → 남는 돈 추이 → 다가올 큰 지출. 데이터가 없는 블록은 각각 조건부로 숨긴다(0으로 채워진 카드를 만들지 말 것). 신규 사용자는 `isEmpty` 빈 상태 화면이 우선.
   - `CalendarView`의 날짜 칸에는 **그날 순합계 하나만** 찍는다(순합계 = 수입 − 지출 − 저축납입, 양수 초록·음수 ACCENT·0이면 미표시). 저축을 빼는 건 "그날 지갑 잔고가 얼마 변했나"를 보여주는 표시용 파생값일 뿐, 저축=자산 이동이라는 회계 규칙과는 무관하다. 수입·지출·저축 **구분 내역은 날짜를 눌렀을 때의 상세**(`upBox`)에서 보여주므로 `eventsOn`/`dayData`의 inSum·exSum·svSum은 그대로 둔다.
4. **폼 컴포넌트**: FixedForm, VarForm, IncomeForm, VarIncomeForm, FixedSaveForm, VarSaveForm, AssetForm, CloseForm. 모두 추가/수정 겸용(`initial` prop 있으면 수정). 공용 조각: Field, MoneyInput(실시간 콤마), CatGrid, CycleField(주기 선택 + 시작 날짜), PeriodField(유효 기간=month 선택기), DateField(전체 날짜 선택), CycleWarn, PastDateNote, HideToggle, FormFooter, RecurringFooter, ItemRow.
   - 필드 순서는 여섯 폼이 "이름/금액 → 분류 → 주기·날짜 → 기간 → 숨김"으로 통일돼 있다. 날짜는 전부 `<input type="date">`이며 숫자 "며칠" 입력은 쓰지 않는다.
5. **스타일 객체** `S`(하단)와 온보딩용 `O`, 애니메이션 문자열 `KEYFRAMES`, 색상 상수 `INK`/`PAPER`/`ACCENT`.
   - `KEYFRAMES`는 애니메이션 말고도 **인라인 스타일로 못 쓰는 의사 클래스 규칙**을 담는다: `button:focus{outline:none}`(클릭 후 남는 포커스 흔적 제거)과 `button:focus-visible`(키보드 접근성 유지). 포커스 흔적이 다시 보이면 이 규칙부터 확인하고, 인라인으로 우회하지 마라.

## 핵심 도메인 규칙 (절대 훼손 금지)
이 앱의 회계 로직은 특정하게 설계돼 있습니다. 건드릴 때 반드시 지키세요.
- **쓸 수 있는 돈 = 수입 − 고정비 − 변동비 − 저축.** 저축도 지갑에선 나가므로 차감.
- 단, **저축은 "비용"이 아니라 "자산 이동"**이다. 총자산 계산에서는 현금성 −, 대상 자산(적금/투자) + 로 상쇄되어 총자산이 줄지 않는다. 이 이중성(이번 달 남는 돈에선 빠지지만 총자산은 유지)을 깨지 말 것.
- **월 마감**: 남는 돈은 사용자가 자산 분류에 배분(합계 = 순증감과 정확히 일치해야 저장 가능), 저축은 target 자산으로 자동 배분. 마감 시 그 달 변동 내역을 history의 snapshot에 저장(과거 조회용). 자동 마감(달이 바뀌면)과 수동 마감이 있으며 수동이 우선.
- **반복 항목 수정 범위**: '이 달만'(overrides에 예외 저장) / '이 달부터 이후'(원본을 지난달로 종료 + 새 항목 분할) / '전체'. '이번 달 건너뛰기'(skip)도 있음. 이 로직은 amountForMonth/occursOn/overrideFor와 얽혀 있으니 함께 검토.
- **변동 항목의 날짜**: `date`(YYYY-MM-DD) 필드가 기준. 이번 달 소속 판별은 `inMonth()`. 다른 달 항목은 이번 달 계산에서 제외되고 달력의 해당 월에 표시.
- **반복 항목의 날짜는 두 가지가 서로 다른 역할**을 한다. 헷갈리지 말 것.
  - `anchor`(YYYY-MM-DD) = **첫 발생일**. `weekly`·`custom`에서 "언제부터 반복하는가"를 정하며 `occursOn`의 기준점이다. `monthly`는 `day`(일)만 쓰고 anchor를 보지 않는다.
  - `startYM`/`endYM`("YYYY.MM") = **유효 기간·만기**. `inPeriod()`가 YYYYMM 숫자로 비교하므로 월 단위다. 날짜 단위로 바꾸려면 회계 규칙을 건드리게 되니 하지 말 것.
  - **하위호환**: 구 데이터에는 `anchor`가 없다. `weekly`는 anchor가 없으면 시작일 제한 없이 매주 반복(기존 동작)하고, `custom`은 없으면 오늘로 폴백한다. `buildCycle`이 이 폴백을 담당한다.
- **저장 객체는 `Dalmada()`의 `stateObj` 한 곳**에서 나온다. 상태 필드를 늘리면 `stateObj`와 `normalizeState()`(기본값·하위호환)만 고치면 localStorage 저장·백업 내보내기·가져오기가 함께 따라온다.

## 작업 규칙 (Claude Code가 지켜야 할 것)
1. **작업 시작 전에 `src/Dalmada.jsx`의 관련 부분을 먼저 읽고**, 기존 헬퍼·상태·스타일 키를 재사용하라. 비슷한 기능이 이미 있으면 새로 만들지 말고 확장하라.
2. **스타일은 `S` / `O` 객체에 인라인으로 추가**하라. 외부 CSS 파일이나 Tailwind, styled-components를 도입하지 마라. 색은 가능하면 `INK`/`PAPER`/`ACCENT` 상수를 재사용하라.
3. **localStorage 스키마를 바꾸면**(상태 필드 추가 등) `stateObj`, `normalizeState`(기본값·하위호환), 저장 useEffect의 의존성 배열을 함께 업데이트하라. 기존 사용자 데이터가 깨지지 않도록 `?? 기본값`으로 안전하게 처리하라. 항목 단위 옵셔널 필드(`anchor` 등)는 스키마 변경이 아니며, 폴백만 챙기면 된다.
4. **도메인 규칙(위 항목)을 바꾸는 변경은 하지 말고**, 애매하면 먼저 질문하라. 특히 마감·자산배분·저축 이동 로직은 신중히.
5. **변경 후 반드시 `npm run build`로 빌드가 통과하는지 확인**하라. 빌드 에러가 있으면 그 파일을 다시 열어 원인을 고쳐라. (이 앱은 단일 대형 파일이라 괄호·JSX 닫힘 실수가 나기 쉬우니 특히 주의.)
6. 큰 리팩터링(파일 분리 등)은 요청받지 않는 한 하지 마라. 지금은 단일 파일 구조를 유지한다.
7. 변경 요약을 짧게 남기고, 무엇을 왜 바꿨는지 설명하라.

## 알려진 한계 (참고, 당장 고칠 필요 없음)
- 이미 마감된 과거 달로 지출을 소급 입력해도 그 달의 마감(총자산) 기록까지 재계산하지는 않음(달력 표시·이번 달 제외까지만).
- 진짜 OS 홈 위젯은 PWA로 불가(네이티브 필요). `public` 등에 위젯은 없음.
- 데이터 백업은 JSON 내보내기/가져오기만 있음("이번 달" 탭 하단). CSV는 없음.
- 백업 가져오기 직후에는 자동 월 마감이 다시 돌지 않음(해당 useEffect가 마운트 시 1회만 실행). 지난달 `lastYM`이 담긴 백업을 불러오면 그 달 마감은 다음 앱 실행 때 처리됨.
- 뒤로가기는 iOS에서 하드웨어 버튼이 없어 스와이프 back에만 반응한다(오버레이 닫기·홈 이동까지만 동작하고 종료 안내는 뜨지 않음). 종료 안내가 뜬 뒤 2초 동안은 가드 엔트리가 없어, 그 사이에 모달을 열고 곧바로 back을 누르면 모달이 닫히는 대신 앱이 종료될 수 있음(실사용에서 거의 불가능한 타이밍이라 방치).
- `cycleLabel()`은 `anchor`(첫 발생일)를 표시하지 않음. 목록에서는 "2주마다"까지만 보이고 언제부터인지는 수정 폼을 열어야 확인 가능.
