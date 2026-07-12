import { useState, useMemo, useEffect, useRef } from "react";

// 색상 상수 — 모듈 전역에서 쓰이므로 최상단에 선언(중간의 O 스타일 객체가
// 초기화 시점에 참조하기 때문에, 아래쪽에 두면 TDZ ReferenceError로 흰 화면이 됨)
const INK = "#2B2620";
const PAPER = "#FBF7EF";
const ACCENT = "#1F4E6B";

// ─────────────────────────────────────────────────────────────
// 달마다 — 매달 빠지는 돈, 한눈에 잡다.
// 고정비(메인) + 가계부(보조). 핵심 결과물은 "이번 달 남은 돈".
//   탭1 대시보드  : 연환산 충격 숫자 + 카테고리 도넛 + 고정비 리스트
//   탭2 돈 빠지는 날: 결제일 캘린더 + 곧 빠질 돈
//   탭3 이번 달    : 예산 - 고정비 - 변동비 = 남은 돈 (가계부)
// 데이터는 세션 메모리 (회원가입 없음 / MVP)
// ─────────────────────────────────────────────────────────────

// 고정비 카테고리
const FIXED_CATS = [
  { key: "housing", label: "주거", color: "#3B6EA5" },
  { key: "comm", label: "통신", color: "#5BA68B" },
  { key: "sub", label: "구독", color: "#C98A3B" },
  { key: "insurance", label: "보험", color: "#9B6FB0" },
  { key: "loan", label: "대출", color: "#C0566B" },
  { key: "fixEtc", label: "기타", color: "#7A8290" },
];

// 변동비(가계부) 카테고리
const VAR_CATS = [
  { key: "food", label: "식비", color: "#D98244" },
  { key: "cafe", label: "카페·간식", color: "#C2A14D" },
  { key: "shop", label: "쇼핑", color: "#B0628F" },
  { key: "transport", label: "교통", color: "#4E9AA6" },
  { key: "culture", label: "문화·여가", color: "#7A6FB0" },
  { key: "varEtc", label: "기타", color: "#8A8290" },
];

// 고정수입 카테고리 (월급 등 반복)
const INCOME_CATS = [
  { key: "salary", label: "월급", color: "#2E8B6B" },
  { key: "side", label: "정기 부수입", color: "#4E9AA6" },
  { key: "incEtc", label: "기타", color: "#7A8290" },
];

// 변동수입 카테고리 (그때그때 들어오는 돈)
const VAR_INCOME_CATS = [
  { key: "bonus", label: "상여·보너스", color: "#C2A14D" },
  { key: "resale", label: "중고판매", color: "#5BA68B" },
  { key: "refund", label: "환급·페이백", color: "#4E9AA6" },
  { key: "gift", label: "용돈·선물", color: "#B0628F" },
  { key: "freelance", label: "프리랜스", color: "#7A6FB0" },
  { key: "varIncEtc", label: "기타", color: "#8A8290" },
];

const ALL_CATS = [...FIXED_CATS, ...VAR_CATS, ...INCOME_CATS, ...VAR_INCOME_CATS];
const catOf = (k) => ALL_CATS.find((c) => c.key === k) || VAR_CATS[5];
const won = (n) => Math.round(n).toLocaleString("ko-KR");

// 월 환산: 주기별로 한 달 평균 금액 계산
// cycle: 'monthly'(매달) | 'yearly'(매년) | 'weekly'(매주) | 'custom'(N일/주/월마다)
const WEEKS_PER_MONTH = 365.25 / 12 / 7; // ≈ 4.348
function monthly(item) {
  switch (item.cycle) {
    case "yearly":
      return item.amount / 12;
    case "weekly":
      return item.amount * WEEKS_PER_MONTH;
    case "custom": {
      const { everyN = 1, unit = "month" } = item;
      if (unit === "day") return (item.amount * 30.4375) / everyN;
      if (unit === "week") return (item.amount * WEEKS_PER_MONTH) / everyN;
      if (unit === "month") return item.amount / everyN;
      return item.amount;
    }
    default:
      return item.amount; // monthly
  }
}

// 주기 라벨(사람이 읽는 말)
function cycleLabel(item) {
  switch (item.cycle) {
    case "yearly":
      return `매년 ${item.day}일`;
    case "weekly":
      return `매주 ${["일", "월", "화", "수", "목", "금", "토"][item.weekday ?? 0]}요일`;
    case "custom": {
      const u = { day: "일", week: "주", month: "개월" }[item.unit || "month"];
      return `${item.everyN}${u}마다`;
    }
    default:
      return `매월 ${item.day}일`;
  }
}

// "YYYY.MM" 문자열 ↔ 비교용 숫자(YYYYMM)
const ymNum = (y, m0) => y * 100 + (m0 + 1);
const ymKey = (y, m0) => `${y}.${String(m0 + 1).padStart(2, "0")}`;
function ymStrToNum(s) {
  if (!s) return null;
  const [y, m] = s.split(".").map(Number);
  return y * 100 + m;
}

// 이 달에 적용되는 예외(override) 가져오기
function overrideFor(item, y, m0) {
  return item.overrides && item.overrides[ymKey(y, m0)];
}
// 이 달 이 항목이 건너뛰기(스킵)됐는지
function isSkipped(item, y, m0) {
  const ov = overrideFor(item, y, m0);
  return ov && ov.skip;
}
// 이 달 이 항목의 실제 금액 (예외 있으면 예외 금액)
function amountIn(item, y, m0) {
  const ov = overrideFor(item, y, m0);
  if (ov && !ov.skip && ov.amount != null) return ov.amount;
  return item.amount;
}
// 기간(startYM~endYM) 안에 드는지
function inPeriod(item, y, m0) {
  const cur = ymNum(y, m0);
  const s = ymStrToNum(item.startYM);
  const e = ymStrToNum(item.endYM);
  if (s && cur < s) return false;
  if (e && cur > e) return false;
  return true;
}

// 이번(특정) 달 이 항목의 실제 발생액 합계.
// monthly: 예외/스킵 반영. weekly/custom: 그 달 발생 횟수 × 금액. yearly: 해당 월이면 1회.
function amountForMonth(item, y, m0) {
  if (!inPeriod(item, y, m0)) return 0;
  if (isSkipped(item, y, m0)) return 0;
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  if (item.cycle === "monthly" || !item.cycle) return amountIn(item, y, m0);
  if (item.cycle === "yearly") return item.amount; // 데모: 해당 월 1회로 간주
  // weekly / custom: 그 달 발생 횟수 계산
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) if (occursOn(item, y, m0, d, daysInMonth)) count++;
  return item.amount * count;
}

// "YYYY-MM-DD" → 로컬 자정 Date. new Date("YYYY-MM-DD")는 UTC로 해석돼
// 시간대에 따라 하루 밀리므로 직접 파싱한다.
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;

// 특정 날짜(y, m0, d)에 이 반복 항목이 발생하는지
function occursOn(item, y, m0, d, daysInMonth) {
  if (!inPeriod(item, y, m0)) return false; // 기간 밖
  if (isSkipped(item, y, m0)) return false; // 이 달 건너뛰기
  const date = new Date(y, m0, d);
  switch (item.cycle) {
    case "weekly": {
      // anchor(첫 발생일)가 있으면 그 날부터. 없으면(구 데이터) 제한 없이 매주.
      if (item.anchor && date < parseISO(item.anchor)) return false;
      return date.getDay() === (item.weekday ?? 0);
    }
    case "custom": {
      const anchor = item.anchor ? parseISO(item.anchor) : new Date(y, m0, item.day || 1);
      const { everyN = 1, unit = "month" } = item;
      if (date < anchor) return false;
      if (unit === "day") {
        const diff = Math.round((date - anchor) / 86400000);
        return diff >= 0 && diff % everyN === 0;
      }
      if (unit === "week") {
        const diff = Math.round((date - anchor) / 86400000);
        return diff >= 0 && diff % (everyN * 7) === 0;
      }
      if (unit === "month") {
        const monthsDiff = (y - anchor.getFullYear()) * 12 + (m0 - anchor.getMonth());
        return monthsDiff >= 0 && monthsDiff % everyN === 0 && d === Math.min(anchor.getDate(), daysInMonth);
      }
      return false;
    }
    case "yearly": {
      // 데모상 해당 월의 day에 표시
      return d === Math.min(item.day, daysInMonth);
    }
    default: // monthly
      return d === Math.min(item.day, daysInMonth);
  }
}

// 이번 달 아직 남은 반복 항목들의 "다음 발생일" 목록. 고정비 탭의 '다가올 결제일'과
// 대시보드의 '다가올 큰 지출'이 같은 값을 쓴다(계산 중복 금지).
// occursOn/amountIn을 그대로 재사용하므로 기간·예외·스킵이 자동 반영된다.
function upcomingIn(groups, y, m0, fromDay) {
  const daysInMonth = new Date(y, m0 + 1, 0).getDate();
  const out = [];
  groups.forEach(({ items, kind, type }) => {
    items.forEach((i) => {
      for (let d = Math.max(1, fromDay); d <= daysInMonth; d++) {
        if (occursOn(i, y, m0, d, daysInMonth)) {
          out.push({ key: `${type}-${i.id}`, day: d, item: i, amount: amountIn(i, y, m0), kind, type });
          break; // 이 달의 첫 발생만
        }
      }
    });
  });
  return out.sort((a, b) => a.day - b.day || b.amount - a.amount);
}

const today = new Date();
const D = today.getDate();
const todayISO = isoOf(today); // toISOString()은 UTC라 KST 새벽에 하루 밀림

// 변동 항목이 특정 연·월(기본: 이번 달)에 속하는지. date 없으면 이번 달로 간주(구 데이터 호환).
function inMonth(item, y = today.getFullYear(), m1 = today.getMonth() + 1) {
  if (!item.date) return y === today.getFullYear() && m1 === today.getMonth() + 1;
  const [iy, im] = item.date.split("-").map(Number);
  return iy === y && im === m1;
}

const SEED_FIXED = [];
const SEED_VAR = [];
const SEED_INCOME = [];
const SEED_VAR_INCOME = [];

// 자산 분류 (예금은 현금성에 통합)
const ASSET_CATS = [
  { key: "cash", label: "현금성", desc: "통장·현금·예금", color: "#3B6EA5" },
  { key: "savings", label: "적금·저축", desc: "정기적금 등", color: "#2E8B6B" },
  { key: "invest", label: "투자", desc: "주식·펀드·코인", color: "#C98A3B" },
  { key: "etc", label: "기타", desc: "부동산 등", color: "#7A8290" },
];
const assetCatOf = (k) => ASSET_CATS.find((c) => c.key === k) || ASSET_CATS[3];

// 저축/투자 이동 대상 (적금·투자·기타 — 현금성으로의 '저축'은 의미 없으므로 제외)
const SAVE_TARGETS = ASSET_CATS.filter((c) => c.key !== "cash");

// 시작 자산: 분류별 잔액 (신규 = 0, 온보딩에서 입력)
const SEED_ASSETS = { cash: 0, savings: 0, invest: 0, etc: 0 };

const SEED_FIXED_SAVE = [];
const SEED_VAR_SAVE = [];

const _now = new Date();
function monthLabel(offset) {
  const dt = new Date(_now.getFullYear(), _now.getMonth() - offset, 1);
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
const SEED_HISTORY = [];

// ── 기기 저장 (localStorage). 외부 서버·회원가입 없이 이 기기에만 보관 ──
// 뒤로가기(back) 처리: "한 번 더 누르면 종료" 대기 시간(ms)과 하드웨어 back 버튼 유무.
// iOS는 하드웨어 back이 없어(스와이프는 브라우저가 관리) 종료 안내를 띄우지 않는다.
const EXIT_MS = 2000;
const HAS_HW_BACK = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");

const STORE_KEY = "dalmada:v1";

// 저장본(또는 백업 파일)을 앱 상태로 정규화. 없는 필드는 기본값으로 채워 하위호환.
// loadState와 가져오기(import)가 함께 쓴다 — 기본값은 여기 한 곳에만 둔다.
function normalizeState(d) {
  return {
    fixed: d.fixed ?? SEED_FIXED,
    variable: d.variable ?? SEED_VAR,
    income: d.income ?? SEED_INCOME,
    varIncome: d.varIncome ?? SEED_VAR_INCOME,
    heroView: d.heroView ?? "month",
    history: d.history ?? SEED_HISTORY,
    assets: { ...SEED_ASSETS, ...(d.assets ?? {}) },
    fixedSave: d.fixedSave ?? SEED_FIXED_SAVE,
    varSave: d.varSave ?? SEED_VAR_SAVE,
    lastYM: d.lastYM ?? null,
    onboarded: d.onboarded ?? true, // 기존 사용자는 온보딩 건너뜀
  };
}

// 백업 파일이 이 앱의 데이터인지 확인. 항목 배열들이 실제로 배열이어야 한다.
const STATE_ARRAYS = ["fixed", "variable", "income", "varIncome", "history", "fixedSave", "varSave"];
function isValidBackup(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  const known = STATE_ARRAYS.filter((k) => k in d);
  if (known.length === 0) return false; // 우리 파일이 아님
  if (known.some((k) => !Array.isArray(d[k]))) return false;
  if ("assets" in d && (typeof d.assets !== "object" || d.assets === null || Array.isArray(d.assets))) return false;
  return true;
}

// 저장된 데이터를 한 번에 읽음. 없거나 막혀 있으면 시드로 시작.
function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch {
    return null; // 미리보기 등 localStorage 미지원 환경
  }
}

function saveState(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* 저장 불가 환경이면 조용히 무시 */
  }
}

export default function Dalmada() {
  const saved = loadState();
  const [fixed, setFixed] = useState(saved?.fixed ?? SEED_FIXED);
  const [variable, setVariable] = useState(saved?.variable ?? SEED_VAR);
  const [income, setIncome] = useState(saved?.income ?? SEED_INCOME);
  const [varIncome, setVarIncome] = useState(saved?.varIncome ?? SEED_VAR_INCOME);
  const [history, setHistory] = useState(saved?.history ?? SEED_HISTORY);
  const [assets, setAssets] = useState(saved?.assets ?? SEED_ASSETS);
  const [fixedSave, setFixedSave] = useState(saved?.fixedSave ?? SEED_FIXED_SAVE);
  const [varSave, setVarSave] = useState(saved?.varSave ?? SEED_VAR_SAVE);
  const [lastYM, setLastYM] = useState(saved?.lastYM ?? null);
  const [onboarded, setOnboarded] = useState(saved ? saved.onboarded : false);
  const [tab, setTab] = useState("dash");
  const [heroView, setHeroView] = useState(saved?.heroView ?? "month"); // month | year
  const [editing, setEditing] = useState(null); // { type, item } — item 있으면 수정
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [pickMenu, setPickMenu] = useState(null); // 'income' | 'expense' | null
  const [calDay, setCalDay] = useState(null); // 달력에서 펼친 날짜(1~31). 뒤로가기로 접으려고 여기서 관리
  const [backToast, setBackToast] = useState(false); // "한 번 더 누르면 종료됩니다"

  const openAdd = (type) => setEditing({ type, item: null });
  const openEdit = (type, item) => setEditing({ type, item });

  // 기기에 저장되는 전체 상태 객체. 내보내기도 이걸 그대로 직렬화하므로
  // 나중에 상태 필드가 늘어나도 여기만 고치면 저장·백업이 함께 따라온다.
  const stateObj = { fixed, variable, income, varIncome, heroView, history, assets, fixedSave, varSave, lastYM, onboarded };

  // 데이터가 바뀔 때마다 기기에 저장
  useEffect(() => {
    saveState(stateObj);
  }, [fixed, variable, income, varIncome, heroView, history, assets, fixedSave, varSave, lastYM, onboarded]);

  const NY = today.getFullYear();
  const NM = today.getMonth();

  // 대시보드용: 월 환산 평균 (예외 무시, 평소 흐름)
  const monthAvg = useMemo(
    () => Math.round(fixed.reduce((s, i) => s + monthly(i), 0)),
    [fixed]
  );
  const yearTotal = monthAvg * 12;

  // 이번 달 실제 발생 고정비 (기간·예외·스킵 반영)
  const monthTotal = useMemo(
    () => Math.round(fixed.reduce((s, i) => s + amountForMonth(i, NY, NM), 0)),
    [fixed, NY, NM]
  );

  const varTotal = useMemo(
    () => variable.filter((i) => inMonth(i)).reduce((s, i) => s + i.amount, 0),
    [variable]
  );

  // 고정수입: 이번 달 실제 발생액 + 변동수입(이번 달 합계)
  const fixedIncomeTotal = useMemo(
    () => Math.round(income.reduce((s, i) => s + amountForMonth(i, NY, NM), 0)),
    [income, NY, NM]
  );
  const varIncomeTotal = useMemo(
    () => varIncome.filter((i) => inMonth(i)).reduce((s, i) => s + i.amount, 0),
    [varIncome]
  );
  const incomeTotal = fixedIncomeTotal + varIncomeTotal;

  // 저축/투자 납입: 고정저축(이번 달 실제) + 수시저축(이번 달)
  const fixedSaveTotal = useMemo(
    () => fixedSave.reduce((s, i) => s + amountForMonth(i, NY, NM), 0),
    [fixedSave, NY, NM]
  );
  const varSaveTotal = useMemo(
    () => varSave.filter((i) => inMonth(i)).reduce((s, i) => s + i.amount, 0),
    [varSave]
  );
  const saveTotal = fixedSaveTotal + varSaveTotal;

  // 저축 납입을 자산 분류별로 집계 (마감 시 자동 배분)
  const saveByTarget = useMemo(() => {
    const m = {};
    fixedSave.forEach((i) => { const a = amountForMonth(i, NY, NM); if (a) m[i.target] = (m[i.target] || 0) + a; });
    varSave.filter((i) => inMonth(i)).forEach((i) => { m[i.target] = (m[i.target] || 0) + i.amount; });
    return m;
  }, [fixedSave, varSave, NY, NM]);

  // 쓸 수 있는 돈(이번 달 남는 돈) = 수입 - 고정비 - 변동비 - 저축
  const thisMonthNet = incomeTotal - monthTotal - varTotal - saveTotal;

  // 이번 달 자산 증가분 = 남는 돈(현금성 등으로) + 저축(적금/투자로). 둘 다 자산.
  const thisMonthAssetGain = thisMonthNet + saveTotal; // = 수입 - 고정 - 변동

  // 분류별 잔액 합계 = 지난 달 마감까지 반영된 "현재(이번 달 시작 시점) 자산"
  const assetsBase = useMemo(
    () => ASSET_CATS.reduce((s, c) => s + (assets[c.key] || 0), 0),
    [assets]
  );
  // 화면에 보여줄 현재 총자산 = 마감 자산 + 이번 달 자산 증가분(남는 돈 + 저축)
  const currentAsset = assetsBase + thisMonthAssetGain;

  // 자산 추이 그래프: 과거를 역산해 시작점부터 복원
  const assetSeries = useMemo(() => {
    // 지난 달들의 마감 시점 잔액 = assetsBase. 이전 달들은 (net+saved)를 차례로 빼서 복원.
    const closes = [];
    let bal = assetsBase;
    for (let i = history.length - 1; i >= 0; i--) {
      const gain = history[i].net + (history[i].saved || 0);
      closes.unshift({ label: history[i].ym, asset: bal, net: history[i].net, detail: history[i] });
      bal -= gain;
    }
    const startPt = { label: "시작", asset: bal, net: null };
    const current = { label: "이번 달", asset: assetsBase + thisMonthAssetGain, net: thisMonthNet, current: true };
    return [startPt, ...closes, current];
  }, [assetsBase, history, thisMonthNet, thisMonthAssetGain]);

  const byCat = useMemo(() => {
    const m = {};
    fixed.forEach((i) => (m[i.cat] = (m[i.cat] || 0) + monthly(i)));
    return FIXED_CATS.map((c) => ({ ...c, value: Math.round(m[c.key] || 0) })).filter(
      (c) => c.value > 0
    );
  }, [fixed]);

  // 이번 달 아직 안 빠진 고정비·고정저축 (오늘 포함). 고정비 탭과 대시보드가 공유.
  const upcoming = useMemo(
    () => upcomingIn(
      [
        { items: fixed, kind: "고정비", type: "fixed" },
        { items: fixedSave, kind: "고정저축", type: "fixedSave" },
      ],
      NY, NM, D
    ),
    [fixed, fixedSave, NY, NM]
  );

  // 대시보드 빈 상태 판정: 아직 아무것도 기록하지 않은 사용자
  const isEmptyMonth = fixed.length + income.length + fixedSave.length
    + variable.length + varIncome.length + varSave.length === 0;

  // type → setter / 날짜 보정 매핑
  const SETTERS = {
    fixed: setFixed,
    var: setVariable,
    income: setIncome,
    varIncome: setVarIncome,
    fixedSave: setFixedSave,
    varSave: setVarSave,
  };
  const DAY_DEFAULT = { var: true, varIncome: true, varSave: true }; // 날짜 보정 대상

  const RECURRING = { fixed: true, income: true, fixedSave: true };
  const thisYMKey = ymKey(NY, NM);
  const prevYMKey = ymKey(NM === 0 ? NY - 1 : NY, NM === 0 ? 11 : NM - 1);

  // 추가 또는 수정. scope: 'all'(전체) | 'this'(이 달만) | 'future'(이후 전부) | 'skip'(이 달 건너뛰기)
  const saveItem = (it, scope = "all") => {
    const { type, item } = editing;
    const setter = SETTERS[type];
    const withDay = DAY_DEFAULT[type] ? { ...it, day: it.day ?? D } : it;

    // 신규 추가
    if (!item) {
      setter((p) => [...p, { ...withDay, id: Date.now() }]);
      setEditing(null);
      return;
    }

    // 반복 항목 + 부분 범위
    if (RECURRING[type] && scope === "this") {
      // 이 달만: 원본 유지 + override 추가 (금액만)
      setter((p) => p.map((x) => x.id === item.id
        ? { ...x, overrides: { ...(x.overrides || {}), [thisYMKey]: { amount: it.amount } } }
        : x));
    } else if (RECURRING[type] && scope === "future") {
      // 이후 전부: 원본은 지난달로 종료, 새 항목을 이번 달부터 시작
      setter((p) => [
        ...p.map((x) => x.id === item.id ? { ...x, endYM: prevYMKey } : x),
        { ...item, ...withDay, id: Date.now(), startYM: thisYMKey, endYM: undefined, overrides: {} },
      ]);
    } else {
      // 전체(또는 비반복): 원본 교체 (기간/예외는 유지)
      setter((p) => p.map((x) => x.id === item.id ? { ...x, ...withDay, id: item.id } : x));
    }
    setEditing(null);
  };

  // 이 달만 건너뛰기 (스킵 override)
  const skipThisMonth = () => {
    const { type, item } = editing;
    if (!item) return;
    SETTERS[type]((p) => p.map((x) => x.id === item.id
      ? { ...x, overrides: { ...(x.overrides || {}), [thisYMKey]: { skip: true } } }
      : x));
    setEditing(null);
  };

  // 수정 폼 안에서 삭제
  const deleteItem = () => {
    const { type, item } = editing;
    if (item) SETTERS[type]((p) => p.filter((x) => x.id !== item.id));
    setEditing(null);
  };

  // 월 마감: 남는 돈은 사용자가 배분(alloc), 저축은 target대로 자동 배분.
  const handleClose = (alloc) => {
    const ymNow = `${_now.getFullYear()}.${String(_now.getMonth() + 1).padStart(2, "0")}`;
    setHistory((p) => [
      ...p,
      { id: Date.now(), ym: ymNow, income: incomeTotal, fixed: monthTotal, variable: varTotal, saved: saveTotal, net: thisMonthNet, alloc, saveAlloc: { ...saveByTarget },
        snapshot: { variable: [...variable], varIncome: [...varIncome], varSave: [...varSave] } },
    ]);
    setAssets((p) => {
      const next = { ...p };
      // 남는 돈 배분
      ASSET_CATS.forEach((c) => {
        next[c.key] = (next[c.key] || 0) + (alloc[c.key] || 0);
      });
      // 저축 납입: 현금성에서 빠져나가 대상 자산으로 이동
      let totalSaved = 0;
      Object.keys(saveByTarget).forEach((k) => {
        next[k] = (next[k] || 0) + saveByTarget[k];
        totalSaved += saveByTarget[k];
      });
      next.cash = (next.cash || 0) - totalSaved; // 저축한 만큼 현금성 감소(이동)
      return next;
    });
    setVariable([]);
    setVarIncome([]);
    setVarSave([]); // 수시 저축도 새 달 시작 (고정저축은 유지)
    setLastYM(`${_now.getFullYear()}.${String(_now.getMonth() + 1).padStart(2, "0")}`);
    setShowCloseForm(false);
    setTab("asset");
  };

  // 내보내기: 기기에 저장되는 객체를 그대로 JSON 파일로 (외부 라이브러리 없이 Blob + <a download>)
  const handleExport = () => {
    try {
      const blob = new Blob([JSON.stringify(stateObj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dalmada-backup-${isoOf(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.alert("파일을 만들지 못했어요. 다른 브라우저에서 시도해보세요.");
    }
  };

  // 가져오기: 파일을 검증한 뒤 상태·localStorage에 반영. 기존 데이터는 덮어씀.
  const handleImport = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => window.alert("파일을 읽지 못했어요.");
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        window.alert("JSON 파일이 아니거나 내용이 손상됐어요.");
        return;
      }
      if (!isValidBackup(parsed)) {
        window.alert("달마다 백업 파일이 아니에요. 내보내기로 만든 파일을 골라주세요.");
        return;
      }
      if (!window.confirm("지금 이 기기의 데이터를 모두 지우고 백업 파일로 덮어씁니다. 계속할까요?")) return;

      const d = normalizeState(parsed);
      setFixed(d.fixed);
      setVariable(d.variable);
      setIncome(d.income);
      setVarIncome(d.varIncome);
      setHeroView(d.heroView);
      setHistory(d.history);
      setAssets(d.assets);
      setFixedSave(d.fixedSave);
      setVarSave(d.varSave);
      setLastYM(d.lastYM);
      setOnboarded(d.onboarded);
      saveState(d); // 저장 useEffect를 기다리지 않고 즉시 반영
      setTab("dash");
      window.alert("불러왔어요. 백업 시점의 기록으로 돌아갑니다.");
    };
    reader.readAsText(file);
  };

  const handleReset = () => {
    if (!window.confirm("모든 데이터를 지우고 처음부터 시작할까요? 되돌릴 수 없어요.")) return;
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* 무시 */
    }
    setFixed([]);
    setVariable([]);
    setIncome([]);
    setVarIncome([]);
    setHistory([]);
    setAssets({ cash: 0, savings: 0, invest: 0, etc: 0 });
    setFixedSave([]);
    setVarSave([]);
    setLastYM(null);
    setHeroView("month");
  };

  // 월 자동 마감: 마지막 활동 달이 이번 달과 다르면 그 달을 자동 마감(남는 돈은 현금성으로).
  // 수동 마감했으면 이미 history에 있어 중복 처리 안 함.
  const curYM = ymKey(NY, NM);
  useEffect(() => {
    if (lastYM == null) { setLastYM(curYM); return; }
    if (lastYM === curYM) return;
    const already = history.some((h) => h.ym === lastYM);
    if (!already) {
      const [ly, lm] = lastYM.split(".").map(Number);
      const m0 = lm - 1;
      const inc = Math.round(income.reduce((s, i) => s + amountForMonth(i, ly, m0), 0)) + varIncome.reduce((s, i) => s + i.amount, 0);
      const fx = Math.round(fixed.reduce((s, i) => s + amountForMonth(i, ly, m0), 0));
      const vr = variable.reduce((s, i) => s + i.amount, 0);
      const fsv = Math.round(fixedSave.reduce((s, i) => s + amountForMonth(i, ly, m0), 0));
      const vsv = varSave.reduce((s, i) => s + i.amount, 0);
      const sv = fsv + vsv;
      const net = inc - fx - vr - sv;
      const sbt = {};
      fixedSave.forEach((i) => { const a = amountForMonth(i, ly, m0); if (a) sbt[i.target] = (sbt[i.target] || 0) + a; });
      varSave.forEach((i) => { sbt[i.target] = (sbt[i.target] || 0) + i.amount; });
      setHistory((p) => [...p, {
        id: Date.now(), ym: lastYM, income: inc, fixed: fx, variable: vr, saved: sv, net,
        alloc: { cash: net, savings: 0, invest: 0, etc: 0 },
        saveAlloc: { ...sbt }, auto: true,
        snapshot: { variable: [...variable], varIncome: [...varIncome], varSave: [...varSave] },
      }]);
      setAssets((p) => {
        const next = { ...p };
        next.cash = (next.cash || 0) + net;
        let totalSaved = 0;
        Object.keys(sbt).forEach((k) => { next[k] = (next[k] || 0) + sbt[k]; totalSaved += sbt[k]; });
        next.cash = (next.cash || 0) - totalSaved;
        return next;
      });
      setVariable([]);
      setVarIncome([]);
      setVarSave([]);
    }
    setLastYM(curYM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 온보딩 완료: 입력받은 초기값을 반영
  const finishOnboarding = ({ assets: a, salary, salaryDay, fixedItems }) => {
    if (a) setAssets(a);
    if (salary > 0) setIncome([{ id: Date.now(), name: "월급", amount: salary, cycle: "monthly", day: salaryDay, cat: "salary" }]);
    if (fixedItems && fixedItems.length) {
      setFixed(fixedItems.map((f, k) => ({ id: Date.now() + k + 1, name: f.name, amount: f.amount, cycle: "monthly", day: f.day, cat: f.cat })));
    }
    setOnboarded(true);
  };

  // ── 안드로이드 뒤로가기 ────────────────────────────────────
  // 브라우저는 back을 직접 막을 수 없으므로, history에 "가드 엔트리"를 하나 쌓아두고
  // popstate로 가로챈다. 앱을 유지해야 하면 가드를 다시 쌓고, 종료시켜야 하면 쌓지 않는다.
  // (가드가 없는 상태에서 back을 누르면 브라우저 기본 동작 = 앱 종료)
  const backState = useRef({});
  // 의존성 배열 없음 → 매 렌더마다 최신 상태를 ref에 담는다.
  // popstate 핸들러는 마운트 시 한 번만 등록되므로, 상태를 ref로만 읽어 stale closure를 피한다.
  useEffect(() => {
    backState.current = { tab, editing, pickMenu, showAssetForm, showCloseForm, calDay };
  });

  // 달력 탭을 벗어나면 펼친 날짜도 접는다(예전에 CalendarView가 언마운트되며 하던 일).
  useEffect(() => {
    if (tab !== "calendar") setCalDay(null);
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.history?.pushState) return;
    let toastTimer = null;
    const pushGuard = () => {
      try {
        window.history.pushState({ dalmadaGuard: true }, "");
      } catch {
        // pushState 호출 제한 등으로 실패해도 앱 동작에는 영향이 없다(기본 back으로 폴백).
      }
    };
    pushGuard();

    const onPop = () => {
      const s = backState.current;

      // 1) 떠 있는 오버레이부터 닫는다(가장 위에 있는 것 우선).
      //    각 오버레이의 onClose와 동일한 정리를 하도록 같은 setter를 쓴다.
      const closeTop =
        s.editing ? () => setEditing(null)
        : s.showCloseForm ? () => setShowCloseForm(false)
        : s.showAssetForm ? () => setShowAssetForm(false)
        : s.pickMenu ? () => setPickMenu(null)
        : s.calDay != null ? () => setCalDay(null)
        : null;
      if (closeTop) {
        closeTop();
        pushGuard();
        return;
      }

      // 2) 오버레이가 없고 홈이 아니면 홈으로.
      if (s.tab !== "dash") {
        setTab("dash");
        pushGuard();
        return;
      }

      // 3) 홈 + 오버레이 없음 → 가드를 복원하지 않는다. 이 상태에서 back을 한 번 더 누르면
      //    가로챌 엔트리가 없어 앱이 실제로 종료된다. 2초가 지나면 가드를 다시 쌓아 리셋.
      if (HAS_HW_BACK) {
        setBackToast(true);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          setBackToast(false);
          pushGuard();
        }, EXIT_MS);
      }
      // 하드웨어 back이 없는 기기(iOS 스와이프 back 등)에서는 안내 없이 히스토리를 그대로 넘긴다.
    };

    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      clearTimeout(toastTimer);
    };
  }, []);

  if (!onboarded) {
    return (
      <>
        <Onboarding onDone={finishOnboarding} onSkip={() => setOnboarded(true)} />
        {backToast && <div style={S.toast}>한 번 더 누르면 종료됩니다</div>}
      </>
    );
  }

  return (
    <div style={S.app}>
      <style>{KEYFRAMES}</style>

      <header style={S.header}>
        <div style={S.headerTop}>
          <div>
            <div style={S.brand}>
              달마다<span style={S.brandDot}>·</span>
            </div>
            <div style={S.tagline}>매달 빠지는 돈, 한눈에 잡다.</div>
          </div>
        </div>
        <div style={S.actionRow}>
          <button style={{ ...S.actionBtn, ...S.actionIn }} onClick={() => setPickMenu("income")}>
            <span style={S.actionSign}>+</span> 들어온 돈
          </button>
          <button style={{ ...S.actionBtn, ...S.actionOut }} onClick={() => setPickMenu("expense")}>
            <span style={S.actionSign}>−</span> 나가는 돈
          </button>
        </div>
      </header>

      {/* 고정비 히어로 (고정비 탭 전용) — 기본 월 단위, 토글로 연 단위 */}
      {tab === "fixed" && (
        <section style={S.hero}>
          <div style={S.heroTopRow}>
            <div style={S.heroLabel}>
              {heroView === "month" ? "매달 빠지는 고정비" : "고정비, 1년이면"}
            </div>
            <div style={S.viewToggle}>
              <button
                style={{ ...S.viewBtn, ...(heroView === "month" ? S.viewBtnOn : {}) }}
                onClick={() => setHeroView("month")}
              >
                월
              </button>
              <button
                style={{ ...S.viewBtn, ...(heroView === "year" ? S.viewBtnOn : {}) }}
                onClick={() => setHeroView("year")}
              >
                연
              </button>
            </div>
          </div>
          <div style={S.heroBig}>
            <span style={S.heroNum} key={heroView + (heroView === "month" ? monthAvg : yearTotal)}>
              {won(heroView === "month" ? monthAvg : yearTotal)}
            </span>
            <span style={S.heroUnit}>원</span>
          </div>
          <div style={S.heroSub}>
            {heroView === "month" ? (
              <>고정비 {fixed.length}건 · 1년이면 <b>{won(yearTotal)}원</b></>
            ) : (
              <>매달 <b>{won(monthAvg)}원</b>씩 · 고정비 {fixed.length}건</>
            )}
          </div>
          {monthAvg > 0 && (
            <div style={S.heroDaily}>
              눈 뜨면 하루 <b>{won(monthAvg / 30)}원</b>이 자동으로 빠지는 셈이에요
            </div>
          )}
          <div style={S.flowTrack}>
            <div style={S.flowFill} />
          </div>
        </section>
      )}

      {/* 이번 달 히어로 = 쓸 수 있는 돈 (수입 - 고정비 - 변동비 - 저축).
          대시보드(요약 홈)와 이번 달 탭이 같은 컴포넌트를 공유한다. */}
      {(tab === "month" || (tab === "dash" && !isEmptyMonth)) && (
        <RemainHero
          incomeTotal={incomeTotal}
          monthTotal={monthTotal}
          varTotal={varTotal}
          saveTotal={saveTotal}
        />
      )}

      <nav style={S.tabs}>
        {[
          ["dash", "홈"],
          ["fixed", "고정비"],
          ["month", "이번 달"],
          ["calendar", "달력"],
          ["asset", "총자산"],
        ].map(([k, l]) => (
          <button
            key={k}
            style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </nav>

      <main style={S.main}>
        {tab === "dash" && (
          <Dashboard
            incomeTotal={incomeTotal}
            monthTotal={monthTotal}
            varTotal={varTotal}
            saveTotal={saveTotal}
            thisMonthNet={thisMonthNet}
            history={history}
            upcoming={upcoming}
            variable={variable}
            isEmpty={isEmptyMonth}
            onEdit={openEdit}
            onAdd={openAdd}
            onGoTab={setTab}
          />
        )}
        {tab === "fixed" && (
          <FixedTab
            fixed={fixed}
            income={income}
            fixedSave={fixedSave}
            byCat={byCat}
            monthTotal={monthTotal}
            upcoming={upcoming}
            onEdit={openEdit}
            onAdd={openAdd}
          />
        )}
        {tab === "calendar" && (
          <CalendarView
            fixed={fixed}
            income={income}
            fixedSave={fixedSave}
            variable={variable}
            varIncome={varIncome}
            varSave={varSave}
            onEdit={openEdit}
            openDay={calDay}
            setOpenDay={setCalDay}
          />
        )}
        {tab === "month" && (
          <MonthView
            income={income}
            varIncome={varIncome}
            fixed={fixed}
            fixedSave={fixedSave}
            varSave={varSave}
            fixedIncomeTotal={fixedIncomeTotal}
            varIncomeTotal={varIncomeTotal}
            incomeTotal={incomeTotal}
            monthTotal={monthTotal}
            variable={variable}
            varTotal={varTotal}
            saveTotal={saveTotal}
            onEdit={openEdit}
            onAdd={openAdd}
            onReset={handleReset}
            onExport={handleExport}
            onImport={handleImport}
          />
        )}
        {tab === "asset" && (
          <AssetView
            series={assetSeries}
            currentAsset={currentAsset}
            assets={assets}
            assetsBase={assetsBase}
            thisMonthNet={thisMonthNet}
            onEditAsset={() => setShowAssetForm(true)}
            onClose={() => setShowCloseForm(true)}
          />
        )}
      </main>

      {editing?.type === "fixed" && (
        <FixedForm initial={editing.item} onSave={saveItem} onSkip={skipThisMonth} onDelete={editing.item ? deleteItem : null} onClose={() => setEditing(null)} />
      )}
      {editing?.type === "var" && (
        <VarForm initial={editing.item} onSave={saveItem} onDelete={editing.item ? deleteItem : null} onClose={() => setEditing(null)} />
      )}
      {editing?.type === "income" && (
        <IncomeForm initial={editing.item} onSave={saveItem} onSkip={skipThisMonth} onDelete={editing.item ? deleteItem : null} onClose={() => setEditing(null)} />
      )}
      {editing?.type === "varIncome" && (
        <VarIncomeForm initial={editing.item} onSave={saveItem} onDelete={editing.item ? deleteItem : null} onClose={() => setEditing(null)} />
      )}
      {editing?.type === "fixedSave" && (
        <FixedSaveForm initial={editing.item} onSave={saveItem} onSkip={skipThisMonth} onDelete={editing.item ? deleteItem : null} onClose={() => setEditing(null)} />
      )}
      {editing?.type === "varSave" && (
        <VarSaveForm initial={editing.item} onSave={saveItem} onDelete={editing.item ? deleteItem : null} onClose={() => setEditing(null)} />
      )}
      {showAssetForm && (
        <AssetForm
          current={assets}
          onSave={(v) => {
            setAssets(v);
            setShowAssetForm(false);
          }}
          onClose={() => setShowAssetForm(false)}
        />
      )}
      {showCloseForm && (
        <CloseForm
          net={thisMonthNet}
          income={incomeTotal}
          fixed={monthTotal}
          variable={varTotal}
          saveTotal={saveTotal}
          saveByTarget={saveByTarget}
          onConfirm={handleClose}
          onClose={() => setShowCloseForm(false)}
        />
      )}
      {pickMenu && (
        <PickSheet
          kind={pickMenu}
          onClose={() => setPickMenu(null)}
          onPick={(key) => {
            setPickMenu(null);
            const map = { fixedIncome: "income", varIncome: "varIncome", fixed: "fixed", var: "var", fixedSave: "fixedSave", varSave: "varSave" };
            openAdd(map[key]);
          }}
        />
      )}
      {backToast && <div style={S.toast}>한 번 더 누르면 종료됩니다</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 온보딩: 첫 실행 시 시작 자산·월급·고정비를 간단히 입력받음
// ─────────────────────────────────────────────────────────────
function Onboarding({ onDone, onSkip }) {
  const [step, setStep] = useState(0);
  // 자산
  const [cash, setCash] = useState("");
  const [savings, setSavings] = useState("");
  const [invest, setInvest] = useState("");
  // 월급 — 날짜는 달력에서 고르고 '일'만 쓴다
  const [salary, setSalary] = useState("");
  const [salaryISO, setSalaryISO] = useState(() => isoForDay(25));
  const salaryDay = Number(salaryISO.slice(8));
  // 고정비 (동적)
  const [items, setItems] = useState([{ name: "", amount: "", iso: isoForDay(1), cat: "housing" }]);

  const addItemRow = () => setItems((p) => [...p, { name: "", amount: "", iso: isoForDay(1), cat: "housing" }]);
  const setItem = (idx, key, v) => setItems((p) => p.map((it, i) => i === idx ? { ...it, [key]: v } : it));
  const removeItemRow = (idx) => setItems((p) => p.filter((_, i) => i !== idx));

  const finish = () => {
    onDone({
      assets: { cash: Number(cash) || 0, savings: Number(savings) || 0, invest: Number(invest) || 0, etc: 0 },
      salary: Number(salary) || 0,
      salaryDay: salaryDay || 25,
      fixedItems: items
        .filter((f) => f.name.trim() && Number(f.amount) > 0)
        .map((f) => ({ name: f.name.trim(), amount: Number(f.amount), day: Number(f.iso.slice(8)) || 1, cat: f.cat })),
    });
  };

  return (
    <div style={O.wrap}>
      <style>{`*{box-sizing:border-box}button{font-family:inherit;cursor:pointer}input:focus{outline:none;border-color:#1F4E6B}`}</style>

      <div style={O.top}>
        <div style={O.brand}>달마다<span style={{ color: ACCENT }}>·</span></div>
        <button style={O.skip} onClick={onSkip}>건너뛰기</button>
      </div>

      <div style={O.dots}>
        {[0, 1, 2].map((i) => <span key={i} style={{ ...O.dot, ...(i === step ? O.dotOn : {}) }} />)}
      </div>

      <div style={O.body}>
        {step === 0 && (
          <>
            <div style={O.title}>지금 가진 돈부터</div>
            <div style={O.sub}>통장·적금·투자에 얼마가 있나요? 여기에 매달 남는 돈이 쌓여 총자산이 됩니다. 모르면 비워도 돼요.</div>
            <Field label="현금성 (통장·현금·예금)"><MoneyInput value={cash} onChange={setCash} big autoFocus /></Field>
            <Field label="적금·저축"><MoneyInput value={savings} onChange={setSavings} /></Field>
            <Field label="투자 (주식·펀드 등)"><MoneyInput value={invest} onChange={setInvest} /></Field>
          </>
        )}

        {step === 1 && (
          <>
            <div style={O.title}>월급은 얼마인가요?</div>
            <div style={O.sub}>매달 들어오는 고정 수입이에요. 여기서 고정비·지출을 빼면 "쓸 수 있는 돈"이 나옵니다. 없으면 비워도 돼요.</div>
            <Field label="월급 (원)"><MoneyInput value={salary} onChange={setSalary} big autoFocus /></Field>
            <div style={S.fieldLabel}>들어오는 날</div>
            <input type="date" style={{ ...S.input, colorScheme: "light", marginBottom: 6 }}
              value={salaryISO} onChange={(e) => e.target.value && setSalaryISO(e.target.value)} />
            <div style={S.fieldHint}>매월 <b>{salaryDay}일</b>에 들어와요. 연·월은 쓰지 않아요.</div>
          </>
        )}

        {step === 2 && (
          <>
            <div style={O.title}>매달 나가는 고정비</div>
            <div style={O.sub}>월세·통신·구독처럼 매달 빠지는 돈이에요. 생각나는 것만 넣으세요. 나중에 얼마든 추가할 수 있어요.</div>
            {items.map((it, idx) => (
              <div key={idx} style={O.itemCard}>
                <div style={O.itemTop}>
                  <input style={{ ...S.input, flex: 1 }} value={it.name} placeholder="예: 월세"
                    onChange={(e) => setItem(idx, "name", e.target.value)} />
                  {items.length > 1 && <button style={O.rm} onClick={() => removeItemRow(idx)}>×</button>}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1 }}><MoneyInput value={it.amount} onChange={(v) => setItem(idx, "amount", v)} /></div>
                  <input type="date" style={{ ...S.input, width: 150, colorScheme: "light" }} value={it.iso}
                    onChange={(e) => e.target.value && setItem(idx, "iso", e.target.value)} />
                </div>
                <div style={{ ...S.fieldHint, marginTop: 6 }}>매월 {Number(it.iso.slice(8))}일에 빠져요</div>
                <div style={O.catRow}>
                  {FIXED_CATS.map((c) => (
                    <button key={c.key} onClick={() => setItem(idx, "cat", c.key)}
                      style={{ ...O.catChip, ...(it.cat === c.key ? { borderColor: c.color, background: c.color + "18", color: INK } : {}) }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button style={O.addRow} onClick={addItemRow}>+ 고정비 더 추가</button>
          </>
        )}
      </div>

      <div style={O.footer}>
        {step < 2 ? (
          <button style={O.next} onClick={() => setStep(step + 1)}>다음</button>
        ) : (
          <button style={O.next} onClick={finish}>시작하기</button>
        )}
        {step > 0 && <button style={O.back} onClick={() => setStep(step - 1)}>이전</button>}
      </div>
    </div>
  );
}

const O = {
  wrap: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: PAPER, color: INK, display: "flex", flexDirection: "column", fontFamily: "-apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', sans-serif" },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 20px 8px" },
  brand: { fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" },
  skip: { background: "none", border: "none", color: "#A39C8F", fontSize: 14, fontWeight: 600 },
  dots: { display: "flex", gap: 6, justifyContent: "center", padding: "8px 0 4px" },
  dot: { width: 7, height: 7, borderRadius: 999, background: "#DDD5C5" },
  dotOn: { background: ACCENT, width: 20 },
  body: { flex: 1, padding: "24px 20px", overflowY: "auto" },
  title: { fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8 },
  sub: { fontSize: 13.5, color: "#8A8479", lineHeight: 1.6, marginBottom: 24 },
  itemCard: { background: "#fff", borderRadius: 14, border: "1px solid #EFE9DD", padding: 14, marginBottom: 10 },
  itemTop: { display: "flex", alignItems: "center", gap: 8 },
  rm: { background: "none", border: "none", color: "#C9C2B4", fontSize: 22, lineHeight: 1, padding: "0 4px" },
  catRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 },
  catChip: { background: "#fff", border: "1px solid #E4DCCC", borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, color: "#8A8479" },
  addRow: { width: "100%", background: "#F2EEE2", border: "none", borderRadius: 12, padding: "12px 0", fontSize: 13.5, fontWeight: 600, color: "#7A7468" },
  footer: { padding: "12px 20px 26px", borderTop: "1px solid #EFE9DD" },
  next: { width: "100%", background: INK, color: PAPER, border: "none", borderRadius: 13, padding: "15px 0", fontSize: 15.5, fontWeight: 700 },
  back: { width: "100%", background: "none", border: "none", color: "#A39C8F", padding: "12px 0 0", fontSize: 14 },
};

// ─────────────────────────────────────────────────────────────
// 들어온 돈 / 나가는 돈 → 종류 선택 시트
// ─────────────────────────────────────────────────────────────
function PickSheet({ kind, onPick, onClose }) {
  const income = kind === "income";
  const items = income
    ? [
        { key: "fixedIncome", label: "고정수입", desc: "월급처럼 매달 들어오는 돈", color: "#2E8B6B" },
        { key: "varIncome", label: "들어온 돈", desc: "중고판매·환급·용돈 등 일회성", color: "#4E9AA6" },
      ]
    : [
        { key: "var", label: "지출", desc: "오늘 쓴 밥값·커피 등 (변동비)", color: "#D98244" },
        { key: "fixed", label: "고정비", desc: "월세·통신·구독 등 매달 빠짐", color: "#3B6EA5" },
        { key: "fixedSave", label: "고정 저축", desc: "적금처럼 매달 자동 — 자산 이동", color: "#2E8B6B" },
        { key: "varSave", label: "저축·투자", desc: "여윳돈을 옮길 때 — 자산 이동", color: "#2E8B6B" },
      ];

  return (
    <Sheet title={income ? "들어온 돈 기록" : "나가는 돈 기록"} onClose={onClose}>
      {!income && (
        <div style={S.tip}>
          저축·투자는 <b>쓴 게 아니라 자산으로 옮기는 돈</b>이에요. 쓸 수 있는 돈에선 빠지지만 총자산은 그대로예요.
        </div>
      )}
      <div style={S.pickList}>
        {items.map((it) => (
          <button key={it.key} style={S.pickItem} onClick={() => onPick(it.key)}>
            <span style={{ ...S.pickDot, background: it.color }} />
            <div style={S.pickText}>
              <div style={S.pickLabel}>{it.label}</div>
              <div style={S.pickDesc}>{it.desc}</div>
            </div>
            <span style={S.pickChev}>›</span>
          </button>
        ))}
      </div>
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// 이번 달 히어로: 쓸 수 있는 돈 (수입 - 고정비 - 변동비 - 저축)
// 저축은 '쓴 돈'이 아니라 자산 이동이지만, 지갑에선 나가므로 차감해 보여줌.
// ─────────────────────────────────────────────────────────────
function RemainHero({ incomeTotal, monthTotal, varTotal, saveTotal }) {
  const spent = monthTotal + varTotal + saveTotal;
  const remain = incomeTotal - spent;
  const over = remain < 0;
  const denom = incomeTotal || 1;
  const fixedPct = Math.max(0, Math.min(100, (monthTotal / denom) * 100));
  const varPct = Math.max(0, Math.min(100 - fixedPct, (varTotal / denom) * 100));
  const savePct = Math.max(0, Math.min(100 - fixedPct - varPct, (saveTotal / denom) * 100));

  // 코칭: 남은 일수, 하루 쓸 수 있는 돈, 현재 변동비 페이스 비교
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayNow = now.getDate();
  const daysLeft = Math.max(1, daysInMonth - dayNow + 1);
  const perDay = remain / daysLeft;
  const varPace = dayNow > 0 ? varTotal / dayNow : 0;
  const fast = !over && perDay > 0 && varPace > perDay;

  let coach;
  if (over) {
    coach = { tone: "warn", text: <>저축까지 하고 나니 <b>{won(-remain)}원</b> 부족해요. 변동비를 조금 줄이거나 저축을 조정해볼까요?</> };
  } else if (remain === 0) {
    coach = { tone: "warn", text: <>딱 맞아떨어졌어요. 변동수입이 생기면 그만큼 여유가 늘어납니다.</> };
  } else if (fast) {
    coach = { tone: "warn", text: <>남은 <b>{daysLeft}일</b> 동안 하루 <b>{won(perDay)}원</b>까지 괜찮아요. 지금은 하루 <b>{won(varPace)}원</b> 쓰는 중이라 조금 빠른 편이에요.</> };
  } else {
    coach = { tone: "ok", text: <>저축 빼고 남은 <b>{daysLeft}일</b> 동안 하루 <b>{won(perDay)}원</b>까지 써도 괜찮아요.</> };
  }

  return (
    <section style={S.hero}>
      <div style={S.heroLabel}>이번 달 쓸 수 있는 돈</div>
      <div style={S.heroBig}>
        <span style={{ ...S.heroNum, color: over ? "#C0566B" : ACCENT }} key={remain}>
          {won(remain)}
        </span>
        <span style={{ ...S.heroUnit, color: over ? "#C0566B" : ACCENT }}>원</span>
      </div>
      <div style={S.heroSub}>
        수입 <b>{won(incomeTotal)}</b> − 고정비 <b>{won(monthTotal)}</b> − 변동비{" "}
        <b>{won(varTotal)}</b>{saveTotal > 0 && <> − 저축 <b>{won(saveTotal)}</b></>}
      </div>
      <div style={S.budgetTrack}>
        <div style={{ ...S.budgetFixed, width: `${fixedPct}%` }} />
        <div style={{ ...S.budgetVar, width: `${varPct}%` }} />
        {saveTotal > 0 && <div style={{ ...S.budgetSave, width: `${savePct}%` }} />}
      </div>
      <div style={S.budgetLegend}>
        <span><i style={{ ...S.miniDot, background: ACCENT }} />고정비</span>
        <span><i style={{ ...S.miniDot, background: "#D98244" }} />변동비</span>
        {saveTotal > 0 && <span><i style={{ ...S.miniDot, background: "#2E8B6B" }} />저축</span>}
      </div>
      {saveTotal > 0 && (
        <div style={S.saveNote}>저축 {won(saveTotal)}원은 쓴 게 아니라 <b>자산으로 옮겨졌어요</b>. 총자산은 그대로예요.</div>
      )}
      <div style={{ ...S.coach, ...(coach.tone === "warn" ? S.coachWarn : S.coachOk) }}>
        {coach.text}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 대시보드 (고정비)
// ─────────────────────────────────────────────────────────────
// 대시보드 = 이번 달 요약 홈. 위쪽 '쓸 수 있는 돈' 히어로(RemainHero)는 Dalmada가 렌더.
// 모든 수치는 메인에서 계산된 값을 props로 받는다 (여기서 회계 계산을 하지 않는다).
function Dashboard({ incomeTotal, monthTotal, varTotal, saveTotal, thisMonthNet, history, upcoming, variable, isEmpty, onEdit, onAdd, onGoTab }) {
  if (isEmpty) {
    return (
      <>
        <Empty
          title="이번 달 기록을 시작해보세요"
          body="월세·통신 같은 고정비를 먼저 넣으면 매달 얼마가 빠지는지 바로 보여요. 오늘 쓴 밥값은 3초면 기록됩니다."
        />
        <div style={S.emptyCta}>
          <button style={S.emptyCtaMain} onClick={() => onAdd("fixed")}>고정비 추가하기</button>
          <button style={S.emptyCtaSub} onClick={() => onAdd("income")}>월급 등록하기</button>
          <button style={S.emptyCtaSub} onClick={() => onAdd("var")}>오늘 지출 기록하기</button>
        </div>
      </>
    );
  }

  // 지난달 대비 지출(고정비+변동비). 마감 기록이 있어야만 비교한다.
  const prev = history.length ? history[history.length - 1] : null;
  const prevSpend = prev ? (prev.fixed || 0) + (prev.variable || 0) : 0;
  const curSpend = monthTotal + varTotal;
  const diffPct = prev && prevSpend > 0 ? Math.round(((curSpend - prevSpend) / prevSpend) * 100) : null;

  // 최근 남는 돈 추이: 마감된 달들 + 진행 중인 이번 달
  const trend = [
    ...history.slice(-5).map((h) => ({ label: `${Number(h.ym.split(".")[1])}월`, net: h.net })),
    { label: "이번", net: thisMonthNet, current: true },
  ];

  // 다가올 큰 지출: 아직 안 빠진 고정비 중 금액 큰 순 3개
  const bigUpcoming = upcoming
    .filter((u) => u.type === "fixed")
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);

  // ── 예산 페이스: 수입 대비 지금까지 나간 비율 vs 날짜 진행률.
  // 지출률이 날짜 진행률보다 앞서면 경고(RemainHero의 "하루치보다 빠르다" 판정과 같은 취지).
  const dayNow = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - dayNow;
  const spent = monthTotal + varTotal + saveTotal;
  const spentPct = incomeTotal > 0 ? Math.round((spent / incomeTotal) * 100) : null;
  const datePct = Math.round((dayNow / daysInMonth) * 100);
  const fastPace = spentPct !== null && spentPct > datePct;

  // ── 오늘 / 이번 주(월요일~오늘) 변동비. date가 없는 구 데이터는 오늘·이번 주에서 제외한다.
  const thisMonthVar = variable.filter((i) => inMonth(i));
  const todaySpend = thisMonthVar.filter((i) => i.date === todayISO).reduce((s, i) => s + i.amount, 0);
  const weekStartISO = isoOf(new Date(today.getFullYear(), today.getMonth(), dayNow - ((today.getDay() + 6) % 7)));
  const weekSpend = variable
    .filter((i) => i.date && i.date >= weekStartISO && i.date <= todayISO)
    .reduce((s, i) => s + i.amount, 0);

  // ── 지출 카테고리 톱3 (이번 달 변동비만. 고정비는 고정비 탭에서 분류별로 이미 보여줌)
  const varByCat = {};
  thisMonthVar.forEach((i) => { varByCat[i.cat] = (varByCat[i.cat] || 0) + i.amount; });
  const top3 = Object.entries(varByCat)
    .map(([k, v]) => ({ ...catOf(k), value: v }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const topMax = top3.length ? top3[0].value : 0;

  // ── 인사이트: 지난달과 하루 평균 변동비 비교 (고정비는 날짜와 무관해 제외)
  let dailyInsight = null;
  if (prev && prev.variable > 0 && dayNow > 0) {
    const [py, pm] = prev.ym.split(".").map(Number);
    const prevDays = new Date(py, pm, 0).getDate();
    const prevDaily = prev.variable / prevDays;
    const curDaily = varTotal / dayNow;
    const gap = Math.round(curDaily - prevDaily);
    if (Math.abs(gap) >= 100) dailyInsight = { gap, prevDaily: Math.round(prevDaily) };
  }

  const cards = [
    { label: "수입", value: incomeTotal, color: "#2E8B6B", sign: "+" },
    { label: "고정비", value: monthTotal, color: ACCENT, sign: "−" },
    { label: "변동비", value: varTotal, color: "#D98244", sign: "−" },
    { label: "저축·투자", value: saveTotal, color: "#C98A3B", sign: "→" },
  ];

  return (
    <>
      <div style={S.sumGrid}>
        {cards.map((c) => (
          <div key={c.label} style={S.sumCard}>
            <div style={S.sumCardTop}>
              <span style={{ ...S.legendDot, background: c.color }} />
              <span style={S.sumCardLabel}>{c.label}</span>
            </div>
            <div style={{ ...S.sumCardVal, color: c.value > 0 ? c.color : "#B9B3A8" }}>
              {c.value > 0 ? c.sign : ""}{won(c.value)}
              <span style={S.sumCardUnit}>원</span>
            </div>
          </div>
        ))}
      </div>

      {diffPct !== null && (
        <div style={S.cmpRow}>
          지난달({prev.ym}) 지출 <b>{won(prevSpend)}원</b>보다{" "}
          {diffPct === 0 ? (
            <b>변화 없어요</b>
          ) : (
            <b style={{ color: diffPct > 0 ? "#C0566B" : "#2E8B6B" }}>
              {diffPct > 0 ? "▲" : "▼"} {Math.abs(diffPct)}% {diffPct > 0 ? "더 썼어요" : "덜 썼어요"}
            </b>
          )}
        </div>
      )}

      {/* 예산 페이스: 수입이 있어야 비율이 의미가 있다 */}
      {spentPct !== null && (
        <div style={{ ...S.card, marginTop: 12 }}>
          <div style={S.paceHead}>
            <span style={S.cardTitle}>이번 달 예산 페이스</span>
            <span style={{ ...S.pacePct, color: fastPace ? "#C0566B" : ACCENT }}>{spentPct}%</span>
          </div>
          <div style={S.paceTrack}>
            <div style={{ ...S.paceFill, width: `${Math.min(100, spentPct)}%`, background: fastPace ? "#C0566B" : ACCENT }} />
            <div style={{ ...S.paceMark, left: `${Math.min(100, datePct)}%` }} />
          </div>
          <div style={S.paceNote}>
            수입의 <b>{spentPct}%</b> 사용 · 이번 달 <b>{daysLeft > 0 ? `${daysLeft}일 남음` : "마지막 날"}</b>
            {fastPace ? (
              <span style={{ color: "#C0566B" }}> · 날짜 진행({datePct}%)보다 빠른 편이에요</span>
            ) : (
              <span style={{ color: "#3A6B55" }}> · 날짜 진행({datePct}%)보다 여유 있어요</span>
            )}
          </div>
        </div>
      )}

      {/* 오늘 / 이번 주 변동비 — 변동비 기록이 있어야 의미가 있다 */}
      {thisMonthVar.length > 0 && (
        <div style={S.duoGrid}>
          <div style={S.sumCard}>
            <div style={S.duoLabel}>오늘 쓴 돈</div>
            <div style={{ ...S.duoVal, color: todaySpend > 0 ? "#D98244" : "#B9B3A8" }}>
              {won(todaySpend)}<span style={S.sumCardUnit}>원</span>
            </div>
          </div>
          <div style={S.sumCard}>
            <div style={S.duoLabel}>이번 주(월~오늘)</div>
            <div style={{ ...S.duoVal, color: weekSpend > 0 ? "#D98244" : "#B9B3A8" }}>
              {won(weekSpend)}<span style={S.sumCardUnit}>원</span>
            </div>
          </div>
        </div>
      )}

      {dailyInsight && (
        <div style={S.cmpRow}>
          지난달 하루 평균 <b>{won(dailyInsight.prevDaily)}원</b>보다{" "}
          <b style={{ color: dailyInsight.gap > 0 ? "#C0566B" : "#2E8B6B" }}>
            하루 {won(Math.abs(dailyInsight.gap))}원 {dailyInsight.gap > 0 ? "더" : "덜"}
          </b>{" "}
          쓰는 중이에요
        </div>
      )}

      {/* 지출 카테고리 톱3 (이번 달 변동비) */}
      {top3.length > 0 && (
        <div style={{ ...S.card, marginTop: 12 }}>
          <div style={S.cardTitle}>많이 쓴 곳 톱{top3.length}</div>
          {top3.map((c) => (
            <div key={c.key} style={S.topRow}>
              <span style={S.topName}>{c.label}</span>
              <span style={S.topTrack}>
                <span style={{ ...S.topFill, width: `${topMax > 0 ? (c.value / topMax) * 100 : 0}%`, background: c.color }} />
              </span>
              <span style={S.topVal}>{won(c.value)}원</span>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ ...S.card, marginTop: 12 }}>
          <div style={S.cardTitle}>최근 남는 돈 추이</div>
          <NetTrend points={trend} />
        </div>
      )}

      <div style={S.listHead}>
        <span>다가올 큰 지출</span>
        <button style={S.quickAdd} onClick={() => onGoTab("fixed")}>고정비 전체 ›</button>
      </div>
      {bigUpcoming.length === 0 ? (
        <div style={S.incomeEmpty} onClick={() => onAdd("fixed")}>
          이번 달 남은 고정비가 없어요. 탭해서 추가하기
        </div>
      ) : (
        <div style={S.list}>
          {bigUpcoming.map((u) => {
            const c = catOf(u.item.cat);
            return (
              <ItemRow key={u.key} barColor={c.color} name={u.item.name}
                meta={<>{u.day}일 · {c.label}</>}
                amount={`−${won(u.amount)}원`} onClick={() => onEdit(u.type, u.item)} />
            );
          })}
        </div>
      )}
    </>
  );
}

// 남는 돈 추이 미니 막대 (0을 기준선으로, 마이너스 달은 아래로)
function NetTrend({ points }) {
  const max = Math.max(1, ...points.map((p) => Math.abs(p.net)));
  return (
    <div style={S.trendRow}>
      {points.map((p, i) => {
        const up = p.net >= 0;
        const h = (Math.abs(p.net) / max) * 100;
        return (
          <div key={i} style={S.trendCol}>
            <div style={S.trendUpper}>
              {up && <div style={{ ...S.trendBar, height: `${Math.max(3, h)}%`, background: "#2E8B6B", opacity: p.current ? 1 : 0.5 }} />}
            </div>
            <div style={S.trendBase} />
            <div style={S.trendLower}>
              {!up && <div style={{ ...S.trendBar, height: `${Math.max(3, h)}%`, background: "#C0566B", opacity: p.current ? 1 : 0.5, alignSelf: "flex-start" }} />}
            </div>
            <div style={{ ...S.trendLabel, ...(p.current ? { color: INK, fontWeight: 700 } : {}) }}>{p.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 고정비 탭: 매달 반복되는 항목 전부 (고정수입 · 고정비 · 고정저축)
// 히어로(월/연 환산 토글)는 Dalmada가 렌더한다.
// ─────────────────────────────────────────────────────────────
function FixedTab({ fixed, income, fixedSave, byCat, monthTotal, upcoming, onEdit, onAdd }) {
  const hasAny = fixed.length + income.length + fixedSave.length > 0;
  if (!hasAny)
    return (
      <Empty
        title="아직 고정 항목이 없어요"
        body="월세·통신·구독부터 넣어보세요. 1년에 얼마가 빠지는지 바로 보입니다."
      />
    );

  return (
    <>
      {fixed.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>어디로 빠지나</div>
          <div style={S.donutRow}>
            <Donut data={byCat} total={monthTotal} center="매월" />
            <div style={S.legend}>
              {byCat
                .slice()
                .sort((a, b) => b.value - a.value)
                .map((c) => (
                  <div key={c.key} style={S.legendRow}>
                    <span style={{ ...S.legendDot, background: c.color }} />
                    <span style={S.legendLabel}>{c.label}</span>
                    <span style={S.legendVal}>{monthTotal > 0 ? Math.round((c.value / monthTotal) * 100) : 0}%</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      <div style={S.listHead}>
        <span>다가올 결제일</span>
        <span style={S.listHeadHint}>이번 달 남은 것</span>
      </div>
      {upcoming.length === 0 ? (
        <div style={S.upBox}>
          <div style={S.upEmpty}>이번 달 남은 결제일이 없어요.</div>
        </div>
      ) : (
        <div style={S.list}>
          {upcoming.slice(0, 5).map((u) => {
            const c = u.type === "fixedSave" ? assetCatOf(u.item.target) : catOf(u.item.cat);
            return (
              <ItemRow key={u.key} barColor={c.color} name={u.item.name}
                meta={<>{u.day}일 · {u.kind}{u.day === D && <span style={S.todayTag}>오늘</span>}</>}
                amount={`${u.type === "fixedSave" ? "→" : "−"}${won(u.amount)}원`}
                amountColor={u.type === "fixedSave" ? c.color : INK}
                onClick={() => onEdit(u.type, u.item)} />
            );
          })}
        </div>
      )}

      {/* 고정수입 */}
      <div style={S.listHead}>
        <span>고정수입 {income.length}건</span>
        <button style={S.quickAdd} onClick={() => onAdd("income")}>+ 고정수입</button>
      </div>
      {income.length === 0 ? (
        <div style={S.incomeEmpty} onClick={() => onAdd("income")}>
          월급처럼 매달 들어오는 돈을 등록하세요. 탭해서 추가하기
        </div>
      ) : (
        <div style={S.list}>
          {income
            .slice()
            .sort((a, b) => monthly(b) - monthly(a))
            .map((i) => {
              const c = catOf(i.cat);
              return (
                <ItemRow key={i.id} barColor={c.color} name={i.name}
                  meta={<>{c.label} · {cycleLabel(i)}{i.hideInCalendar && <span style={S.hiddenTag}>달력 숨김</span>}</>}
                  amount={`+${won(monthly(i))}원`} amountColor="#2E8B6B" onClick={() => onEdit("income", i)} />
              );
            })}
        </div>
      )}

      {/* 고정비 */}
      <div style={S.listHead}>
        <span>고정비 {fixed.length}건</span>
        <button style={S.quickAdd} onClick={() => onAdd("fixed")}>+ 고정비</button>
      </div>
      {fixed.length === 0 ? (
        <div style={S.incomeEmpty} onClick={() => onAdd("fixed")}>
          월세·통신·구독처럼 매달 빠지는 돈을 등록하세요. 탭해서 추가하기
        </div>
      ) : (
        <div style={S.list}>
          {fixed
            .slice()
            .sort((a, b) => monthly(b) - monthly(a))
            .map((i) => {
              const c = catOf(i.cat);
              return (
                <ItemRow key={i.id} barColor={c.color} name={i.name}
                  meta={<>{c.label} · {cycleLabel(i)}{i.cycle === "yearly" && <span style={S.yearTag}>연 {won(i.amount)}원</span>}{i.hideInCalendar && <span style={S.hiddenTag}>달력 숨김</span>}</>}
                  amount={`${won(monthly(i))}원`} onClick={() => onEdit("fixed", i)} />
              );
            })}
        </div>
      )}

      {/* 고정저축 */}
      <div style={S.listHead}>
        <span>고정 저축 {fixedSave.length}건</span>
        <button style={S.quickAdd} onClick={() => onAdd("fixedSave")}>+ 고정 저축</button>
      </div>
      {fixedSave.length === 0 ? (
        <div style={S.incomeEmpty} onClick={() => onAdd("fixedSave")}>
          주기적으로 빠지는 적금·정기투자를 등록하세요. 탭해서 추가하기
        </div>
      ) : (
        <div style={S.list}>
          {fixedSave.map((i) => {
            const t = assetCatOf(i.target);
            return (
              <ItemRow key={i.id} barColor={t.color} name={i.name}
                meta={<>{t.label}으로 · {cycleLabel(i)}{i.hideInCalendar && <span style={S.hiddenTag}>달력 숨김</span>}</>}
                amount={`→${won(monthly(i))}원`} amountColor={t.color} onClick={() => onEdit("fixedSave", i)} />
            );
          })}
        </div>
      )}

      <div style={S.storeNote}>금액은 월 환산 기준이에요. 매주·격주 항목도 한 달 평균으로 보여줍니다.</div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 이번 달 (가계부): 수입 + 변동비 도넛 + 변동비 리스트
// ─────────────────────────────────────────────────────────────
function MonthView({ income, varIncome, fixed, fixedSave, varSave, fixedIncomeTotal, varIncomeTotal, incomeTotal, monthTotal, variable, varTotal, saveTotal, onEdit, onAdd, onReset, onExport, onImport }) {
  const [q, setQ] = useState("");
  const fileRef = useRef(null);
  const byVarCat = useMemo(() => {
    const m = {};
    variable.forEach((i) => (m[i.cat] = (m[i.cat] || 0) + i.amount));
    return VAR_CATS.map((c) => ({ ...c, value: m[c.key] || 0 })).filter((c) => c.value > 0);
  }, [variable]);

  const daysPassed = D;
  const dailyAvg = daysPassed > 0 ? varTotal / daysPassed : 0;
  const _NY = today.getFullYear();
  const _NM = today.getMonth();
  const amtNow = (i) => amountForMonth(i, _NY, _NM);
  const hasOverride = (i) => i.overrides && i.overrides[ymKey(_NY, _NM)];

  // 검색: 모든 항목을 가로질러 이름·분류·금액으로 필터
  const query = q.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!query) return null;
    const qNum = Number(query.replace(/[^0-9]/g, ""));
    const hit = (i, catLabel, typeLabel) => {
      const nm = (i.name || "").toLowerCase();
      const inName = nm.includes(query);
      const inCat = (catLabel || "").toLowerCase().includes(query);
      const inType = typeLabel.toLowerCase().includes(query);
      const inAmt = qNum > 0 && String(i.amount).includes(String(qNum));
      return inName || inCat || inType || inAmt;
    };
    const out = [];
    income.forEach((i) => hit(i, catOf(i.cat)?.label, "고정수입") && out.push({ i, type: "income", sign: "+", tag: "고정수입", color: "#2E8B6B", label: i.name }));
    varIncome.forEach((i) => hit(i, catOf(i.cat)?.label, "변동수입 들어온돈") && out.push({ i, type: "varIncome", sign: "+", tag: "변동수입", color: "#2E8B6B", label: i.name || catOf(i.cat)?.label }));
    fixed.forEach((i) => hit(i, catOf(i.cat)?.label, "고정비") && out.push({ i, type: "fixed", sign: "−", tag: "고정비", color: catOf(i.cat)?.color, label: i.name }));
    variable.forEach((i) => hit(i, catOf(i.cat)?.label, "변동비 지출") && out.push({ i, type: "var", sign: "−", tag: "변동비", color: catOf(i.cat)?.color, label: i.name || catOf(i.cat)?.label }));
    fixedSave.forEach((i) => hit(i, assetCatOf(i.target)?.label, "고정저축") && out.push({ i, type: "fixedSave", sign: "→", tag: "고정저축", color: assetCatOf(i.target)?.color, label: i.name }));
    varSave.forEach((i) => hit(i, assetCatOf(i.target)?.label, "수시저축 저축") && out.push({ i, type: "varSave", sign: "→", tag: "수시저축", color: assetCatOf(i.target)?.color, label: i.name || "저축" }));
    return out;
  }, [query, income, varIncome, fixed, variable, fixedSave, varSave]);

  return (
    <>
      <div style={S.searchWrap}>
        <span style={S.searchIcon}>⌕</span>
        <input style={S.searchInput} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="이름·분류·금액으로 검색" />
        {q && <button style={S.searchClear} onClick={() => setQ("")}>×</button>}
      </div>

      {searchResults ? (
        <>
          <div style={S.listHead}>
            <span>검색 결과 {searchResults.length}건</span>
          </div>
          {searchResults.length === 0 ? (
            <Empty title="찾는 항목이 없어요" body="다른 이름이나 분류로 검색해보세요." />
          ) : (
            <div style={S.list}>
              {searchResults.map((r, k) => (
                <ItemRow key={r.type + k} barColor={r.color} name={r.label}
                  meta={<>{r.tag}{r.i.day ? ` · ${r.i.day}일` : ""}</>}
                  amount={`${r.sign}${won(r.i.amount)}원`}
                  amountColor={r.sign === "+" ? "#2E8B6B" : r.sign === "→" ? "#C98A3B" : INK}
                  onClick={() => onEdit(r.type, r.i)} />
              ))}
            </div>
          )}
        </>
      ) : (
      <>
      <div style={S.tip}>
        <b>수입</b>에서 고정비·변동비를 뺀 <b>남는 돈</b>이 위에 나와요. 월급은 자동, 중고판매·환급 같은 <b>변동수입</b>과 변동비만 그때그때 기록하면 됩니다.
      </div>

      {/* 수입 섹션 */}
      <div style={S.listHead}>
        <span>이번 달 수입 {won(incomeTotal)}원</span>
      </div>

      {/* 고정수입 */}
      <div style={S.subHead}>
        <span>고정수입 {won(fixedIncomeTotal)}원</span>
        <button style={S.quickAdd} onClick={() => onAdd("income")}>+ 고정수입</button>
      </div>
      {income.length === 0 ? (
        <div style={S.incomeEmpty} onClick={() => onAdd("income")}>
          월급처럼 매달 들어오는 돈을 등록하세요. 탭해서 추가하기
        </div>
      ) : (
        <div style={S.list}>
          {income
            .slice()
            .sort((a, b) => monthly(b) - monthly(a))
            .map((i) => {
              const c = catOf(i.cat);
              return (
                <ItemRow key={i.id} barColor={c.color} name={i.name}
                  meta={<>{c.label} · {cycleLabel(i)}{i.cycle === "yearly" && <span style={S.yearTag}>연 {won(i.amount)}원</span>}{hasOverride(i) && <span style={S.ovTag}>이번 달 변경</span>}{i.hideInCalendar && <span style={S.hiddenTag}>달력 숨김</span>}</>}
                  amount={`+${won(amtNow(i))}원`} amountColor="#2E8B6B" onClick={() => onEdit("income", i)} />
              );
            })}
        </div>
      )}

      {/* 변동수입 */}
      <div style={S.subHead}>
        <span>변동수입 {won(varIncomeTotal)}원</span>
        <button style={S.quickAdd} onClick={() => onAdd("varIncome")}>+ 들어온 돈</button>
      </div>
      {varIncome.length === 0 ? (
        <div style={S.incomeEmpty} onClick={() => onAdd("varIncome")}>
          중고판매·환급·용돈처럼 그때그때 들어온 돈을 기록하세요. 탭해서 추가하기
        </div>
      ) : (
        <div style={S.list}>
          {varIncome
            .slice()
            .sort((a, b) => b.day - a.day || b.id - a.id)
            .map((i) => {
              const c = catOf(i.cat);
              return (
                <ItemRow key={i.id} barColor={c.color} name={i.name || c.label}
                  meta={`${c.label} · ${i.day}일`}
                  amount={`+${won(i.amount)}원`} amountColor="#2E8B6B" onClick={() => onEdit("varIncome", i)} />
              );
            })}
        </div>
      )}

      {variable.length > 0 && (
        <div style={{ ...S.card, marginTop: 18 }}>
          <div style={S.cardTitle}>이번 달 변동비, 어디에 썼나</div>
          <div style={S.donutRow}>
            <Donut data={byVarCat} total={varTotal} center="변동비" />
            <div style={S.legend}>
              {byVarCat
                .slice()
                .sort((a, b) => b.value - a.value)
                .map((c) => (
                  <div key={c.key} style={S.legendRow}>
                    <span style={{ ...S.legendDot, background: c.color }} />
                    <span style={S.legendLabel}>{c.label}</span>
                    <span style={S.legendVal}>{won(c.value)}</span>
                  </div>
                ))}
            </div>
          </div>
          <div style={S.avgRow}>
            하루 평균 <b>{won(dailyAvg)}원</b> 쓰는 중 · {daysPassed}일 경과
          </div>
        </div>
      )}

      <div style={S.listHead}>
        <span>변동비 {variable.length}건</span>
        <button style={S.quickAdd} onClick={() => onAdd("var")}>+ 빠른 기록</button>
      </div>

      {variable.length === 0 ? (
        <Empty
          title="기록된 지출이 없어요"
          body="오늘 쓴 밥값·커피부터 3초에 기록해보세요."
        />
      ) : (
        <div style={S.list}>
          {variable
            .slice()
            .sort((a, b) => b.day - a.day || b.id - a.id)
            .map((i) => {
              const c = catOf(i.cat);
              return (
                <ItemRow key={i.id} barColor={c.color} name={i.name || c.label}
                  meta={`${c.label} · ${i.day}일`} amount={`-${won(i.amount)}원`}
                  onClick={() => onEdit("var", i)} />
              );
            })}
        </div>
      )}

      {/* 저축·투자 (비용 아님 — 자산 이동) */}
      <div style={S.saveSectionHead}>
        <div>
          <div style={S.saveSectionTitle}>저축·투자 {won(saveTotal)}원</div>
          <div style={S.saveSectionSub}>쓴 게 아니라 자산으로 옮기는 돈</div>
        </div>
      </div>

      <div style={S.subHead}>
        <span>고정 저축 · 자동</span>
        <button style={S.quickAdd} onClick={() => onAdd("fixedSave")}>+ 고정 저축</button>
      </div>
      {fixedSave.length === 0 ? (
        <div style={S.incomeEmpty} onClick={() => onAdd("fixedSave")}>
          주기적으로 빠지는 적금·정기투자를 등록하세요. 탭해서 추가하기
        </div>
      ) : (
        <div style={S.list}>
          {fixedSave.map((i) => {
            const t = assetCatOf(i.target);
            return (
              <ItemRow key={i.id} barColor={t.color} name={i.name}
                meta={<>{t.label}으로 · {cycleLabel(i)}{hasOverride(i) && <span style={S.ovTag}>이번 달 변경</span>}{i.hideInCalendar && <span style={S.hiddenTag}>달력 숨김</span>}</>}
                amount={`→${won(amtNow(i))}원`} amountColor={t.color} onClick={() => onEdit("fixedSave", i)} />
            );
          })}
        </div>
      )}

      <div style={S.subHead}>
        <span>수시 저축 · 그때그때</span>
        <button style={S.quickAdd} onClick={() => onAdd("varSave")}>+ 저축하기</button>
      </div>
      {varSave.length === 0 ? (
        <div style={S.incomeEmpty} onClick={() => onAdd("varSave")}>
          여윳돈을 적금·투자로 옮길 때 기록하세요. 탭해서 추가하기
        </div>
      ) : (
        <div style={S.list}>
          {varSave
            .slice()
            .sort((a, b) => b.day - a.day || b.id - a.id)
            .map((i) => {
              const t = assetCatOf(i.target);
              return (
                <ItemRow key={i.id} barColor={t.color} name={i.name || `${t.label} 이체`}
                  meta={`${t.label}으로 · ${i.day}일`} amount={`→${won(i.amount)}원`}
                  amountColor={t.color} onClick={() => onEdit("varSave", i)} />
              );
            })}
        </div>
      )}

      {/* 백업: 기기를 바꾸거나 브라우저 데이터를 지우면 기록이 사라지므로 */}
      <div style={S.backupHead}>데이터 백업</div>
      <div style={S.backupRow}>
        <button style={S.backupBtn} onClick={onExport}>데이터 내보내기</button>
        <button style={S.backupBtn} onClick={() => fileRef.current?.click()}>데이터 가져오기</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          onImport(e.target.files?.[0]);
          e.target.value = ""; // 같은 파일을 다시 골라도 onChange가 뜨도록
        }}
      />
      <div style={S.storeNote}>
        내보내기로 JSON 파일을 저장해두면 새 기기·새 브라우저에서 가져오기로 되살릴 수 있어요.
      </div>

      <button style={S.resetBtn} onClick={onReset}>
        모든 데이터 초기화
      </button>
      <div style={S.storeNote}>데이터는 이 기기에만 저장돼요. 서버로 보내지 않습니다.</div>
      </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 총자산: 분류별 잔액 + 달마다 순증감 누적. 마감하면 배분만큼 자산 증감.
// ─────────────────────────────────────────────────────────────
function AssetView({ series, currentAsset, assets, assetsBase, thisMonthNet, onEditAsset, onClose }) {
  const [openId, setOpenId] = useState(null);
  const rows = series.slice(1).reverse(); // 최신 달이 위로
  const firstAsset = series[0].asset;
  const totalChange = currentAsset - firstAsset;

  // 자산 구성: 마감 잔액 기준 (이번 달 진행분은 아직 어느 자산인지 미정이라 별도 표시)
  const composition = ASSET_CATS.map((c) => ({ ...c, value: assets[c.key] || 0 }));

  return (
    <>
      <section style={S.assetHero}>
        <div style={S.heroLabel}>현재 총자산</div>
        <div style={S.heroBig}>
          <span style={S.heroNum} key={currentAsset}>{won(currentAsset)}</span>
          <span style={S.heroUnit}>원</span>
        </div>
        <div style={S.heroSub}>
          시작 <b>{won(firstAsset)}</b>에서{" "}
          <b style={{ color: totalChange >= 0 ? "#2E8B6B" : "#C0566B" }}>
            {totalChange >= 0 ? "+" : "−"}{won(Math.abs(totalChange))}
          </b>{" "}
          쌓였어요
        </div>
        <AssetChart series={series} />
      </section>

      {/* 자산 구성 */}
      <div style={S.card}>
        <div style={S.cardHeadRow}>
          <div style={S.cardTitle}>자산 구성</div>
          <button style={S.viewBtn} onClick={onEditAsset}>수정 ›</button>
        </div>
        <div style={S.compBar}>
          {composition.filter((c) => c.value > 0).map((c) => (
            <div key={c.key} style={{ width: `${assetsBase > 0 ? (c.value / assetsBase) * 100 : 0}%`, background: c.color, height: "100%" }} />
          ))}
        </div>
        <div style={S.compList}>
          {composition.map((c) => (
            <div key={c.key} style={S.compRow}>
              <span style={{ ...S.legendDot, background: c.color }} />
              <span style={S.compLabel}>{c.label}<span style={S.compDesc}> · {c.desc}</span></span>
              <span style={S.compVal}>{won(c.value)}원</span>
            </div>
          ))}
        </div>
        {thisMonthNet !== 0 && (
          <div style={S.pendingNote}>
            이번 달 진행분 <b style={{ color: thisMonthNet >= 0 ? "#2E8B6B" : "#C0566B" }}>
              {thisMonthNet >= 0 ? "+" : "−"}{won(Math.abs(thisMonthNet))}원
            </b>은 마감할 때 자산에 배분돼요.
          </div>
        )}
      </div>

      {/* 월 마감 버튼 */}
      <button style={S.closeBtn} onClick={onClose}>
        이번 달 마감하고 자산에 반영
      </button>

      <div style={S.listHead}>
        <span>달마다 기록</span>
        <span style={S.listHeadHint}>탭하면 상세</span>
      </div>

      <div style={S.list}>
        {rows.map((r, idx) => {
          const open = openId === r.label;
          const up = r.net >= 0;
          return (
            <div key={r.label} style={S.assetCard}>
              <button
                style={S.assetCardHead}
                onClick={() => setOpenId(open ? null : r.label)}
              >
                <div style={S.assetCardLeft}>
                  <span style={S.assetMonth}>{r.label}</span>
                  {r.current && <span style={S.nowTag}>진행 중</span>}
                </div>
                <div style={S.assetCardRight}>
                  <span style={{ ...S.assetNet, color: up ? "#2E8B6B" : "#C0566B" }}>
                    {up ? "+" : "−"}{won(Math.abs(r.net))}
                  </span>
                  <span style={S.assetAfter}>{won(r.asset)}원</span>
                  <span style={{ ...S.chev, transform: open ? "rotate(90deg)" : "none" }}>›</span>
                </div>
              </button>
              {open && (
                <div style={S.assetDetail}>
                  {r.detail || r.current ? (
                    <>
                      <DetailRow label="수입" value={`+${won((r.detail || r).income ?? 0)}`} color="#2E8B6B" />
                      <DetailRow label="고정비" value={`−${won((r.detail || r).fixed ?? 0)}`} color={ACCENT} />
                      <DetailRow label="변동비" value={`−${won((r.detail || r).variable ?? 0)}`} color="#D98244" />
                      <div style={S.detailDivider} />
                      <DetailRow label="이 달 남은 돈" value={`${up ? "+" : "−"}${won(Math.abs(r.net))}`} color={up ? "#2E8B6B" : "#C0566B"} bold />
                      {r.detail?.alloc && (
                        <div style={S.allocBlock}>
                          <div style={S.allocBlockTitle}>자산 배분</div>
                          {ASSET_CATS.filter((c) => (r.detail.alloc[c.key] || 0) !== 0).map((c) => {
                            const v = r.detail.alloc[c.key];
                            return (
                              <div key={c.key} style={S.allocMini}>
                                <span style={{ ...S.legendDot, background: c.color }} />
                                <span style={S.allocMiniLabel}>{c.label}</span>
                                <span style={{ ...S.allocMiniVal, color: v >= 0 ? "#2E8B6B" : "#C0566B" }}>
                                  {v >= 0 ? "+" : "−"}{won(Math.abs(v))}원
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {r.detail?.snapshot && (r.detail.snapshot.variable?.length > 0 || r.detail.snapshot.varIncome?.length > 0 || r.detail.snapshot.varSave?.length > 0) && (
                        <div style={S.allocBlock}>
                          <div style={S.allocBlockTitle}>이 달 기록</div>
                          {r.detail.snapshot.varIncome?.map((i, k) => (
                            <div key={"si" + k} style={S.allocMini}>
                              <span style={{ ...S.legendDot, background: "#2E8B6B" }} />
                              <span style={S.allocMiniLabel}>{i.name || "수입"}</span>
                              <span style={{ ...S.allocMiniVal, color: "#2E8B6B" }}>+{won(i.amount)}원</span>
                            </div>
                          ))}
                          {r.detail.snapshot.variable?.map((i, k) => (
                            <div key={"sv" + k} style={S.allocMini}>
                              <span style={{ ...S.legendDot, background: catOf(i.cat)?.color || "#D98244" }} />
                              <span style={S.allocMiniLabel}>{i.name || catOf(i.cat)?.label}</span>
                              <span style={S.allocMiniVal}>−{won(i.amount)}원</span>
                            </div>
                          ))}
                          {r.detail.snapshot.varSave?.map((i, k) => (
                            <div key={"ss" + k} style={S.allocMini}>
                              <span style={{ ...S.legendDot, background: assetCatOf(i.target)?.color || "#C98A3B" }} />
                              <span style={S.allocMiniLabel}>{i.name || "저축"}</span>
                              <span style={{ ...S.allocMiniVal, color: "#C98A3B" }}>→{won(i.amount)}원</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {r.current && (
                        <div style={S.upEmpty}>아직 마감 전이에요. 마감하면 자산에 배분됩니다.</div>
                      )}
                    </>
                  ) : (
                    <div style={S.upEmpty}>상세 내역이 없어요.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DetailRow({ label, value, color, bold }) {
  return (
    <div style={S.detailRow}>
      <span style={{ fontSize: 13.5, color: "#6B655B", fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: color || INK, fontVariantNumeric: "tabular-nums" }}>{value}원</span>
    </div>
  );
}

// 자산 추이 라인 그래프 (SVG)
function AssetChart({ series }) {
  const W = 320, H = 110, padX = 8, padY = 14;
  const vals = series.map((p) => p.asset);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = series.length;
  const x = (i) => padX + (i * (W - padX * 2)) / (n - 1);
  const y = (v) => padY + (1 - (v - min) / span) * (H - padY * 2);
  const pts = series.map((p, i) => [x(i), y(p.asset)]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H - padY} L${padX},${H - padY} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ marginTop: 16, display: "block" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="assetFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={ACCENT} stopOpacity="0.18" />
          <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#assetFill)" />
      <path d={line} fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === n - 1 ? 4 : 2.5}
          fill={i === n - 1 ? ACCENT : "#fff"} stroke={ACCENT} strokeWidth="2" />
      ))}
    </svg>
  );
}

// SVG 도넛
function Donut({ data, total, center }) {
  const R = 52, C = 2 * Math.PI * R, stroke = 22;
  let offset = 0;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
      <circle cx="70" cy="70" r={R} fill="none" stroke="#ECE7DD" strokeWidth={stroke} />
      {total > 0 &&
        data.map((d) => {
          const len = (d.value / total) * C;
          const seg = (
            <circle
              key={d.key}
              cx="70" cy="70" r={R} fill="none"
              stroke={d.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
              style={{ transition: "stroke-dasharray .6s ease" }}
            />
          );
          offset += len;
          return seg;
        })}
      <text x="70" y="64" textAnchor="middle" style={S.donutTopText}>{center}</text>
      <text x="70" y="84" textAnchor="middle" style={S.donutBigText}>{won(total)}</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// 캘린더: 고정비 결제일(파랑) + 변동비 지출(주황) 함께 표시
// ─────────────────────────────────────────────────────────────
// openDay(펼친 날짜)는 뒤로가기로 닫을 수 있도록 Dalmada()가 들고 있는 제어 상태다.
function CalendarView({ fixed, income, fixedSave, variable, varIncome, varSave, onEdit, openDay, setOpenDay }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });

  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const startPad = new Date(ym.y, ym.m, 1).getDay();
  const isThisMonth = ym.y === now.getFullYear() && ym.m === now.getMonth();

  // 그날 발생하는 모든 항목을 모음 (반복 항목은 주기로, 변동 항목은 기록된 날짜로)
  const eventsOn = (d) => {
    const out = { income: [], expense: [], save: [] };
    income.forEach((i) => {
      if (!i.hideInCalendar && occursOn(i, ym.y, ym.m, d, daysInMonth))
        out.income.push({ ...i, amount: amountIn(i, ym.y, ym.m), kind: "고정수입", type: "income" });
    });
    fixed.forEach((i) => {
      if (!i.hideInCalendar && occursOn(i, ym.y, ym.m, d, daysInMonth))
        out.expense.push({ ...i, amount: amountIn(i, ym.y, ym.m), kind: "고정비", type: "fixed" });
    });
    fixedSave.forEach((i) => {
      if (!i.hideInCalendar && occursOn(i, ym.y, ym.m, d, daysInMonth))
        out.save.push({ ...i, amount: amountIn(i, ym.y, ym.m), kind: "고정저축", type: "fixedSave" });
    });
    // 변동 항목: 그 항목의 날짜가 이 달력 월(ym)에 속하면 표시
    const inThisCalMonth = (i) => inMonth(i, ym.y, ym.m + 1);
    varIncome.forEach((i) => { if (inThisCalMonth(i) && Math.min(i.day, daysInMonth) === d) out.income.push({ ...i, kind: "변동수입", type: "varIncome" }); });
    variable.forEach((i) => { if (inThisCalMonth(i) && Math.min(i.day, daysInMonth) === d) out.expense.push({ ...i, kind: "변동비", type: "var" }); });
    varSave.forEach((i) => { if (inThisCalMonth(i) && Math.min(i.day, daysInMonth) === d) out.save.push({ ...i, kind: "수시저축", type: "varSave" }); });
    return out;
  };

  const dayData = useMemo(() => {
    const map = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const e = eventsOn(d);
      const inSum = e.income.reduce((s, i) => s + i.amount, 0);
      const exSum = e.expense.reduce((s, i) => s + i.amount, 0);
      const svSum = e.save.reduce((s, i) => s + i.amount, 0);
      // 칸에 찍는 순합계 = 그날 지갑 잔고의 변화. 저축은 '비용'은 아니지만 지갑에선 나가므로 뺀다
      // (자산 이동이라는 회계 규칙은 그대로고, 여기서는 달력의 "그날 얼마가 들고 났나" 표시용).
      const net = inSum - exSum - svSum;
      if (inSum || exSum || svSum) map[d] = { e, inSum, exSum, svSum, net };
    }
    return map;
  }, [fixed, income, fixedSave, variable, varIncome, varSave, ym, daysInMonth, isThisMonth]);

  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const move = (delta) => {
    let m = ym.m + delta, y = ym.y;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setYm({ y, m });
    setOpenDay(null);
  };

  const compact = (n) => (n >= 10000 ? `${Math.round(n / 10000)}만` : won(n));

  return (
    <>
      <div style={S.calBar}>
        <button style={S.calNav} onClick={() => move(-1)}>‹</button>
        <div style={S.calTitle}>{ym.y}년 {ym.m + 1}월</div>
        <button style={S.calNav} onClick={() => move(1)}>›</button>
      </div>

      <div style={S.weekRow}>
        {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
          <div key={w} style={{ ...S.weekCell, color: i === 0 ? "#C0566B" : "#9A958B" }}>{w}</div>
        ))}
      </div>

      <div style={S.grid}>
        {cells.map((d, idx) => {
          if (d === null) return <div key={idx} style={S.cellEmpty} />;
          const dd = dayData[d];
          const isToday = isThisMonth && d === now.getDate();
          const isOpen = openDay === d;
          return (
            <button
              key={idx}
              style={{ ...S.cell, ...(dd ? S.cellHit : {}), ...(isOpen ? S.cellOpen : {}) }}
              onClick={() => setOpenDay(isOpen ? null : d)}
            >
              <div style={{ ...S.cellDay, ...(isToday ? S.cellToday : {}) }}>{d}</div>
              {!!dd?.net && (
                <div style={{ ...S.cellBadge, color: dd.net > 0 ? "#2E8B6B" : ACCENT }}>
                  {dd.net > 0 ? "+" : "−"}{compact(Math.abs(dd.net))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 칸에는 그날 순합계(수입 − 지출 − 저축) 하나만. 구분 내역은 날짜를 눌러 아래 상세에서 본다. */}
      <div style={S.calKey}>
        <span><i style={{ ...S.miniDot, background: "#2E8B6B" }} />들어온 게 많은 날</span>
        <span><i style={{ ...S.miniDot, background: ACCENT }} />나간 게 많은 날</span>
      </div>

      {/* 선택한 날짜 상세 */}
      <div style={S.upBox}>
        {openDay ? (
          <>
            <div style={S.upTitle}>{ym.m + 1}월 {openDay}일</div>
            {!dayData[openDay] ? (
              <div style={S.upEmpty}>이 날은 기록이 없어요.</div>
            ) : (
              <>
                {dayData[openDay].e.income.map((i, k) => (
                  <DayRow key={"i" + k} color="#2E8B6B" sign="+" name={i.name} tag={i.kind} amount={i.amount} onClick={() => onEdit(i.type, i)} />
                ))}
                {dayData[openDay].e.expense.map((i, k) => (
                  <DayRow key={"e" + k} color={catOf(i.cat)?.color || ACCENT} sign="−" name={i.name || catOf(i.cat)?.label} tag={i.kind} amount={i.amount} onClick={() => onEdit(i.type, i)} />
                ))}
                {dayData[openDay].e.save.map((i, k) => (
                  <DayRow key={"s" + k} color="#C98A3B" sign="→" name={i.name || "저축"} tag={i.kind} amount={i.amount} onClick={() => onEdit(i.type, i)} />
                ))}
              </>
            )}
          </>
        ) : (
          <div style={S.upEmpty}>날짜를 누르면 그날 내역을 볼 수 있어요.</div>
        )}
      </div>
    </>
  );
}

function DayRow({ color, sign, name, tag, amount, onClick }) {
  return (
    <button style={S.dayRowBtn} onClick={onClick}>
      <span style={{ ...S.upDot, background: color }} />
      <span style={S.upName}>{name}<span style={S.dayRowTag}>{tag}</span></span>
      <span style={{ ...S.upAmt, color: sign === "+" ? "#2E8B6B" : sign === "→" ? "#C98A3B" : INK }}>
        {sign}{won(amount)}원
      </span>
      <span style={S.dayRowChev}>›</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 폼: 고정비 추가
// ─────────────────────────────────────────────────────────────
// 폼 하단 공통 (저장/삭제). 수정 모드면 삭제 버튼 노출.
function FormFooter({ valid, onSave, onDelete }) {
  return (
    <>
      <button style={{ ...S.submit, ...(valid ? {} : S.submitOff) }} disabled={!valid} onClick={onSave}>
        {onDelete ? "저장하기" : "추가하기"}
      </button>
      {onDelete && (
        <button style={S.deleteBtn} onClick={() => { if (window.confirm("이 항목을 삭제할까요?")) onDelete(); }}>
          삭제하기
        </button>
      )}
    </>
  );
}

// 기간 설정 (시작월~종료월). 비우면 무기한.
// 전체 날짜(YYYY-MM-DD) 선택. 지난 달·다음 달도 지정 가능.
function DateField({ date, setDate, label = "날짜" }) {
  return (
    <Field label={label}>
      <input type="date" style={{ ...S.input, colorScheme: "light" }}
        value={date} onChange={(e) => setDate(e.target.value)} />
    </Field>
  );
}

// 기존 항목 수정 시 초기 날짜 복원 (date 없으면 이번 달 + day로)
function initialDate(initial) {
  if (initial?.date) return initial.date;
  const d = initial?.day || D;
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// 저장용: date와 파생된 day를 함께
function dateFields(date) {
  const dd = date ? Number(date.split("-")[2]) : D;
  return { date, day: dd };
}

// "매월 N일"을 달력으로 고르기 위한 표시용 날짜.
// 이번 달에 N일이 없으면(예: 31일) N일이 존재하는 가장 가까운 달을 쓴다.
function isoForDay(day) {
  const d = Math.min(31, Math.max(1, Number(day) || 1));
  let y = today.getFullYear(), m = today.getMonth();
  for (let k = 0; k < 12; k++) {
    if (new Date(y, m + 1, 0).getDate() >= d) break;
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}
// anchor(YYYY-MM-DD) → 비교용 YYYYMM
const anchorYMNum = (a) => (a ? Number(a.slice(0, 4)) * 100 + Number(a.slice(5, 7)) : null);

// 시작 날짜(anchor) · 유효 기간(startYM~endYM) 조합 검증.
// { block } 이면 저장을 막고, 아니면 참고용 안내만 띄운다.
function cycleIssue(cycle, anchor, startYM, endYM) {
  const s = ymStrToNum(startYM);
  const e = ymStrToNum(endYM);
  if (s && e && s > e) return { block: true, text: "유효 기간의 종료월이 시작월보다 빨라요." };
  if (cycle === "monthly" || !anchor) return null;
  const a = anchorYMNum(anchor);
  if (e && a > e) return { block: true, text: "반복 시작 날짜가 유효 기간(종료월)보다 뒤예요. 한 번도 발생하지 않아요." };
  if (s && a < s) return { block: false, text: "반복 시작 날짜가 유효 기간 시작월보다 앞서요. 실제로는 기간이 시작된 뒤부터 발생해요." };
  return null;
}
function CycleWarn({ issue }) {
  if (!issue) return null;
  return <div style={issue.block ? S.errNote : S.pastNote}>{issue.text}</div>;
}

// 선택 날짜가 이번 달이 아니면 안내
function PastDateNote({ date }) {
  if (!date) return null;
  const [y, m] = date.split("-").map(Number);
  const isThis = y === today.getFullYear() && m === today.getMonth() + 1;
  if (isThis) return null;
  const past = new Date(y, m - 1) < new Date(today.getFullYear(), today.getMonth());
  return (
    <div style={S.pastNote}>
      {past ? "지난" : "다음"} 달({y}.{pad2(m)}) 날짜예요. 이번 달 <b>쓸 수 있는 돈</b> 계산에는 들어가지 않고, 달력의 {m}월에서 볼 수 있어요.
    </div>
  );
}

// 유효 기간(만기). 반복이 "언제부터"인지는 CycleField의 시작 날짜(anchor)가 정한다.
// 여기서는 "이 항목이 살아 있는 달의 범위"만 다루므로 월 단위가 맞다(inPeriod도 YYYYMM 비교).
function PeriodField({ startYM, setStartYM, endYM, setEndYM }) {
  // 내부 저장은 "YYYY.MM", <input type=month>는 "YYYY-MM"
  const toInput = (v) => (v ? v.replace(".", "-") : "");
  const fromInput = (v) => (v ? v.replace("-", ".") : "");
  return (
    <>
      <div style={S.fieldLabel}>유효 기간 · 만기 (선택 · 비우면 계속)</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <input type="month" style={{ ...S.input, colorScheme: "light" }}
          value={toInput(startYM)} onChange={(e) => setStartYM(fromInput(e.target.value))} />
        <span style={{ color: "#9A958B" }}>~</span>
        <input type="month" style={{ ...S.input, colorScheme: "light" }}
          value={toInput(endYM)} onChange={(e) => setEndYM(fromInput(e.target.value))} />
      </div>
      <div style={S.fieldHint}>이 항목이 유효한 달의 범위예요. 24개월 적금이면 종료월에 만기를 넣으세요.</div>
    </>
  );
}

// 반복 항목 수정 시: 범위 선택 + 저장/스킵/삭제
function RecurringFooter({ valid, editingItem, onSaveScope, onSkip, onDelete }) {
  const [scope, setScope] = useState("all");
  if (!editingItem) {
    // 신규 추가
    return (
      <button style={{ ...S.submit, ...(valid ? {} : S.submitOff) }} disabled={!valid} onClick={() => onSaveScope("all")}>
        추가하기
      </button>
    );
  }
  return (
    <>
      <div style={S.fieldLabel}>어디까지 적용할까요?</div>
      <div style={S.scopeList}>
        {[
          ["this", "이 달만", "이번 달 금액만 바꿔요"],
          ["future", "이 달부터 이후", "이번 달부터 쭉 바뀌어요 (예: 인상)"],
          ["all", "전체", "과거·미래 모두 바꿔요"],
        ].map(([v, l, d]) => (
          <button key={v} style={{ ...S.scopeBtn, ...(scope === v ? S.scopeOn : {}) }} onClick={() => setScope(v)}>
            <span style={{ ...S.radio, ...(scope === v ? S.radioOn : {}) }} />
            <div style={{ textAlign: "left" }}>
              <div style={S.scopeLabel}>{l}</div>
              <div style={S.scopeDesc}>{d}</div>
            </div>
          </button>
        ))}
      </div>
      <button style={{ ...S.submit, ...(valid ? {} : S.submitOff) }} disabled={!valid} onClick={() => onSaveScope(scope)}>
        저장하기
      </button>
      <button style={S.skipBtn} onClick={() => { if (window.confirm("이번 달은 이 항목을 건너뛸까요? 다음 달부터 다시 반복돼요.")) onSkip(); }}>
        이번 달만 건너뛰기
      </button>
      <button style={S.deleteBtn} onClick={() => { if (window.confirm("이 항목을 완전히 삭제할까요?")) onDelete(); }}>
        완전히 삭제하기
      </button>
    </>
  );
}

function FixedForm({ initial, onSave, onSkip, onDelete, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [cycle, setCycle] = useState(initial?.cycle || "monthly");
  const [day, setDay] = useState(String(initial?.day || 1));
  const [weekday, setWeekday] = useState(initial?.weekday ?? 1);
  const [everyN, setEveryN] = useState(String(initial?.everyN || 2));
  const [unit, setUnit] = useState(initial?.unit || "month");
  const [cat, setCat] = useState(initial?.cat || "housing");
  const [hidden, setHidden] = useState(initial?.hideInCalendar || false);
  const [anchor, setAnchor] = useState(() => initialAnchor(initial));
  const [startYM, setStartYM] = useState(initial?.startYM || "");
  const [endYM, setEndYM] = useState(initial?.endYM || "");
  const issue = cycleIssue(cycle, anchor, startYM, endYM);
  const valid = !!name.trim() && Number(amount) > 0 && !issue?.block;
  const build = () => ({ name: name.trim(), amount: Number(amount), cat, hideInCalendar: hidden, startYM: startYM || undefined, endYM: endYM || undefined, ...buildCycle(cycle, day, weekday, everyN, unit, anchor) });

  return (
    <Sheet title={initial ? "고정비 수정" : "고정비 추가"} onClose={onClose}>
      <Field label="이름">
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 월세, 넷플릭스" autoFocus />
      </Field>
      <Field label="금액">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      <div style={S.fieldLabel}>분류</div>
      <CatGrid cats={FIXED_CATS} value={cat} onChange={setCat} />
      <CycleField cycle={cycle} setCycle={setCycle} day={day} setDay={setDay} dayLabel="매월 결제일"
        weekday={weekday} setWeekday={setWeekday} everyN={everyN} setEveryN={setEveryN} unit={unit} setUnit={setUnit}
        anchor={anchor} setAnchor={setAnchor} />
      <PeriodField startYM={startYM} setStartYM={setStartYM} endYM={endYM} setEndYM={setEndYM} />
      <CycleWarn issue={issue} />
      <HideToggle hidden={hidden} setHidden={setHidden} />
      <RecurringFooter valid={valid} editingItem={initial}
        onSaveScope={(scope) => valid && onSave(build(), scope)} onSkip={onSkip} onDelete={onDelete} />
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// 폼: 변동비(가계부) 빠른 기록 — 금액·분류만, 3초 입력
function VarForm({ initial, onSave, onDelete, onClose }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [cat, setCat] = useState(initial?.cat || "food");
  const [name, setName] = useState(initial?.name || "");
  const [date, setDate] = useState(initialDate(initial));
  const valid = Number(amount) > 0 && !!date;

  return (
    <Sheet title={initial ? "지출 수정" : "지출 기록"} onClose={onClose}>
      <Field label="금액">
        <MoneyInput value={amount} onChange={setAmount} big autoFocus />
      </Field>
      <div style={S.fieldLabel}>분류</div>
      <CatGrid cats={VAR_CATS} value={cat} onChange={setCat} />
      <DateField date={date} setDate={setDate} />
      <PastDateNote date={date} />
      <Field label="메모 (선택)">
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 점심, 택시" />
      </Field>
      <FormFooter valid={valid} onDelete={onDelete}
        onSave={() => valid && onSave({ amount: Number(amount), cat, name: name.trim(), ...dateFields(date) })} />
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// 폼: 수입 추가 (월급·부수입, 고정비처럼 반복)
function IncomeForm({ initial, onSave, onSkip, onDelete, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [cycle, setCycle] = useState(initial?.cycle || "monthly");
  const [day, setDay] = useState(String(initial?.day || 25));
  const [weekday, setWeekday] = useState(initial?.weekday ?? 5);
  const [everyN, setEveryN] = useState(String(initial?.everyN || 2));
  const [unit, setUnit] = useState(initial?.unit || "week");
  const [cat, setCat] = useState(initial?.cat || "salary");
  const [hidden, setHidden] = useState(initial?.hideInCalendar || false);
  const [anchor, setAnchor] = useState(() => initialAnchor(initial));
  const [startYM, setStartYM] = useState(initial?.startYM || "");
  const [endYM, setEndYM] = useState(initial?.endYM || "");
  const issue = cycleIssue(cycle, anchor, startYM, endYM);
  const valid = !!name.trim() && Number(amount) > 0 && !issue?.block;
  const build = () => ({ name: name.trim(), amount: Number(amount), cat, hideInCalendar: hidden, startYM: startYM || undefined, endYM: endYM || undefined, ...buildCycle(cycle, day, weekday, everyN, unit, anchor) });

  return (
    <Sheet title={initial ? "고정수입 수정" : "고정수입 추가"} onClose={onClose}>
      <div style={S.tip}>월급처럼 들어오는 돈을 등록하세요. 매주·격주 같은 주기도 됩니다.</div>
      <Field label="이름">
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 월급, 과외" autoFocus />
      </Field>
      <Field label="금액">
        <MoneyInput value={amount} onChange={setAmount} big />
      </Field>
      <div style={S.fieldLabel}>분류</div>
      <CatGrid cats={INCOME_CATS} value={cat} onChange={setCat} />
      <CycleField cycle={cycle} setCycle={setCycle} day={day} setDay={setDay} dayLabel="매월 들어오는 날"
        weekday={weekday} setWeekday={setWeekday} everyN={everyN} setEveryN={setEveryN} unit={unit} setUnit={setUnit}
        anchor={anchor} setAnchor={setAnchor} />
      <PeriodField startYM={startYM} setStartYM={setStartYM} endYM={endYM} setEndYM={setEndYM} />
      <CycleWarn issue={issue} />
      <HideToggle hidden={hidden} setHidden={setHidden} />
      <RecurringFooter valid={valid} editingItem={initial}
        onSaveScope={(scope) => valid && onSave(build(), scope)} onSkip={onSkip} onDelete={onDelete} />
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// 폼: 변동수입 빠른 기록 — 그때그때 들어온 돈 (변동비와 대칭)
function VarIncomeForm({ initial, onSave, onDelete, onClose }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [cat, setCat] = useState(initial?.cat || "resale");
  const [name, setName] = useState(initial?.name || "");
  const [date, setDate] = useState(initialDate(initial));
  const valid = Number(amount) > 0 && !!date;

  return (
    <Sheet title={initial ? "들어온 돈 수정" : "들어온 돈 기록"} onClose={onClose}>
      <div style={S.tip}>중고판매·환급·용돈처럼 들어온 일회성 수입을 기록하세요.</div>
      <Field label="금액">
        <MoneyInput value={amount} onChange={setAmount} big autoFocus />
      </Field>
      <div style={S.fieldLabel}>분류</div>
      <CatGrid cats={VAR_INCOME_CATS} value={cat} onChange={setCat} />
      <DateField date={date} setDate={setDate} />
      <PastDateNote date={date} />
      <Field label="메모 (선택)">
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 중고 거래, 카드 캐시백" />
      </Field>
      <FormFooter valid={valid} onDelete={onDelete}
        onSave={() => valid && onSave({ amount: Number(amount), cat, name: name.trim(), ...dateFields(date) })} />
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// 폼: 고정 저축 (매달/매주/사용자 주기 자동 — 적금 등)
function FixedSaveForm({ initial, onSave, onSkip, onDelete, onClose }) {
  const [name, setName] = useState(initial?.name || "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [cycle, setCycle] = useState(initial?.cycle || "monthly");
  const [day, setDay] = useState(String(initial?.day || 25));
  const [weekday, setWeekday] = useState(initial?.weekday ?? 1);
  const [everyN, setEveryN] = useState(String(initial?.everyN || 2));
  const [unit, setUnit] = useState(initial?.unit || "week");
  const [target, setTarget] = useState(initial?.target || "savings");
  const [hidden, setHidden] = useState(initial?.hideInCalendar || false);
  const [anchor, setAnchor] = useState(() => initialAnchor(initial));
  const [startYM, setStartYM] = useState(initial?.startYM || "");
  const [endYM, setEndYM] = useState(initial?.endYM || "");
  const issue = cycleIssue(cycle, anchor, startYM, endYM);
  const valid = !!name.trim() && Number(amount) > 0 && !issue?.block;
  const build = () => ({ name: name.trim(), amount: Number(amount), target, hideInCalendar: hidden, startYM: startYM || undefined, endYM: endYM || undefined, ...buildCycle(cycle, day, weekday, everyN, unit, anchor) });

  return (
    <Sheet title={initial ? "고정 저축 수정" : "고정 저축"} onClose={onClose}>
      <div style={S.tip}>매주·격주·매달 등 주기로 빠지는 적금·정기투자예요. <b>비용이 아니라</b> 선택한 자산으로 옮겨지고, 총자산은 줄지 않아요. 만기가 있으면 <b>유효 기간</b>에 종료월을 넣으세요.</div>
      <Field label="이름">
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 주택청약, 정기적금" autoFocus />
      </Field>
      <Field label="금액">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      <div style={S.fieldLabel}>어느 자산으로?</div>
      <CatGrid cats={SAVE_TARGETS} value={target} onChange={setTarget} />
      <CycleField cycle={cycle} setCycle={setCycle} day={day} setDay={setDay} dayLabel="매월 납입일"
        weekday={weekday} setWeekday={setWeekday} everyN={everyN} setEveryN={setEveryN} unit={unit} setUnit={setUnit}
        anchor={anchor} setAnchor={setAnchor} />
      <PeriodField startYM={startYM} setStartYM={setStartYM} endYM={endYM} setEndYM={setEndYM} />
      <CycleWarn issue={issue} />
      <HideToggle hidden={hidden} setHidden={setHidden} />
      <RecurringFooter valid={valid} editingItem={initial}
        onSaveScope={(scope) => valid && onSave(build(), scope)} onSkip={onSkip} onDelete={onDelete} />
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// 폼: 수시 저축 (그때그때 자산으로 이동)
function VarSaveForm({ initial, onSave, onDelete, onClose }) {
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [target, setTarget] = useState(initial?.target || "savings");
  const [name, setName] = useState(initial?.name || "");
  const [date, setDate] = useState(initialDate(initial));
  const valid = Number(amount) > 0 && !!date;

  return (
    <Sheet title={initial ? "저축 수정" : "저축하기"} onClose={onClose}>
      <div style={S.tip}>여윳돈을 적금·투자로 옮길 때 기록하세요. <b>쓴 게 아니라</b> 자산 이동이라, 쓸 수 있는 돈에선 빠지지만 총자산은 그대로예요.</div>
      <Field label="금액">
        <MoneyInput value={amount} onChange={setAmount} big autoFocus />
      </Field>
      <div style={S.fieldLabel}>어느 자산으로?</div>
      <CatGrid cats={SAVE_TARGETS} value={target} onChange={setTarget} />
      <DateField date={date} setDate={setDate} />
      <PastDateNote date={date} />
      <Field label="메모 (선택)">
        <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 보너스 일부 적금" />
      </Field>
      <FormFooter valid={valid} onDelete={onDelete}
        onSave={() => valid && onSave({ amount: Number(amount), target, name: name.trim(), ...dateFields(date) })} />
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// 폼: 자산 구성 수정 (분류별 잔액)
function AssetForm({ current, onSave, onClose }) {
  const [vals, setVals] = useState(() => {
    const o = {};
    ASSET_CATS.forEach((c) => (o[c.key] = String(current[c.key] || 0)));
    return o;
  });
  const set = (k, v) => setVals((p) => ({ ...p, [k]: v.replace(/[^0-9]/g, "") }));
  const total = ASSET_CATS.reduce((s, c) => s + Number(vals[c.key] || 0), 0);

  return (
    <Sheet title="자산 구성" onClose={onClose}>
      <div style={S.tip}>지금 가진 돈을 분류별로 넣어주세요. 여기에 달마다 남는 돈이 쌓여 총자산이 됩니다.</div>
      {ASSET_CATS.map((c) => (
        <Field key={c.key} label={`${c.label} · ${c.desc}`}>
          <MoneyInput value={vals[c.key]} onChange={(v) => set(c.key, v)} />
        </Field>
      ))}
      <div style={S.formTotalRow}>
        <span>합계</span>
        <b>{won(total)}원</b>
      </div>
      <button style={S.submit} onClick={() => {
        const o = {};
        ASSET_CATS.forEach((c) => (o[c.key] = Number(vals[c.key] || 0)));
        onSave(o);
      }}>
        저장하기
      </button>
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// 폼: 월 마감 — 순증감을 자산별로 배분. 합계가 순증감과 일치해야 마감 가능.
function CloseForm({ net, income, fixed, variable, saveTotal, saveByTarget, onConfirm, onClose }) {
  const [alloc, setAlloc] = useState(() => {
    const o = {};
    ASSET_CATS.forEach((c) => (o[c.key] = ""));
    return o;
  });
  const neg = net < 0;
  const set = (k, v) => {
    // 음수 배분(마이너스 달)도 허용: 숫자만 받되 부호는 net 방향으로
    setAlloc((p) => ({ ...p, [k]: v.replace(/[^0-9]/g, "") }));
  };
  // 입력값은 절대값으로 받고, net 부호에 맞춰 해석
  const sumAbs = ASSET_CATS.reduce((s, c) => s + Number(alloc[c.key] || 0), 0);
  const target = Math.abs(net);
  const diff = target - sumAbs; // 남은 배분액(절대값 기준)
  const ok = diff === 0 && target > 0;

  const confirm = () => {
    if (!ok) return;
    const signed = {};
    ASSET_CATS.forEach((c) => {
      const v = Number(alloc[c.key] || 0);
      signed[c.key] = neg ? -v : v;
    });
    onConfirm(signed);
  };

  const autoFill = () => {
    // 남은 금액을 현금성에 몰아주는 편의 버튼
    setAlloc((p) => ({ ...p, cash: String(Number(p.cash || 0) + Math.max(0, diff)) }));
  };

  return (
    <Sheet title="이번 달 마감" onClose={onClose}>
      <div style={S.tip}>
        이번 달 결과를 자산에 반영합니다. 마감하면 변동비·변동수입은 비워지고 새 달이 시작돼요.
      </div>
      <div style={S.closeSummary}>
        <div style={S.closeSumRow}><span>수입</span><b style={{ color: "#2E8B6B" }}>+{won(income)}</b></div>
        <div style={S.closeSumRow}><span>고정비</span><b style={{ color: ACCENT }}>−{won(fixed)}</b></div>
        <div style={S.closeSumRow}><span>변동비</span><b style={{ color: "#D98244" }}>−{won(variable)}</b></div>
        {saveTotal > 0 && (
          <div style={S.closeSumRow}><span>저축·투자</span><b style={{ color: "#2E8B6B" }}>−{won(saveTotal)}</b></div>
        )}
        <div style={S.detailDivider} />
        <div style={S.closeSumRow}>
          <span style={{ fontWeight: 700 }}>이번 달 {neg ? "부족분" : "남은 돈"}</span>
          <b style={{ color: neg ? "#C0566B" : "#2E8B6B", fontSize: 16 }}>
            {neg ? "−" : "+"}{won(target)}원
          </b>
        </div>
      </div>

      {saveTotal > 0 && (
        <div style={S.saveAutoNote}>
          저축·투자 <b>{won(saveTotal)}원</b>은 입력한 대로 자산에 자동 반영돼요
          {Object.keys(saveByTarget || {}).filter((k) => saveByTarget[k] > 0).map((k) => (
            <span key={k} style={S.saveAutoChip}>
              {assetCatOf(k).label} +{won(saveByTarget[k])}
            </span>
          ))}
          . 아래는 <b>남은 돈</b>만 배분하면 돼요.
        </div>
      )}

      <div style={S.fieldLabel}>
        {neg ? "어느 자산에서 빠졌나요?" : "어느 자산으로 갔나요?"}
      </div>
      {ASSET_CATS.map((c) => (
        <div key={c.key} style={S.allocRow}>
          <span style={{ ...S.legendDot, background: c.color }} />
          <span style={S.allocLabel}>{c.label}</span>
          <input style={S.allocInput} value={alloc[c.key] ? Number(alloc[c.key]).toLocaleString("ko-KR") : ""} inputMode="numeric"
            onChange={(e) => set(c.key, e.target.value)} placeholder="0" />
        </div>
      ))}

      <div style={{ ...S.allocStatus, color: ok ? "#2E8B6B" : diff < 0 ? "#C0566B" : "#8A8479" }}>
        {ok ? "배분 완료 ✓" : diff > 0 ? `${won(diff)}원 더 배분해야 해요` : `${won(-diff)}원 초과됐어요`}
        {!ok && diff > 0 && (
          <button style={S.autoFillBtn} onClick={autoFill}>남은 금액 현금성에</button>
        )}
      </div>

      <button style={{ ...S.submit, ...(ok ? {} : S.submitOff) }} disabled={!ok} onClick={confirm}>
        마감하기
      </button>
      <button style={S.cancel} onClick={onClose}>닫기</button>
    </Sheet>
  );
}

// 공통 UI 조각
function Sheet({ title, children, onClose }) {
  // 시트가 열려 있는 동안 뒤 화면 스크롤 잠금 (모바일에서 배경이 같이 밀리는 문제)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={S.sheetGrip} />
        <div style={S.sheetTitle}>{title}</div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

// 실시간 천단위 콤마가 적용되는 금액 입력. value/onChange는 숫자 문자열("50000")로 주고받음.
function MoneyInput({ value, onChange, big, autoFocus, placeholder = "0" }) {
  const display = value ? Number(value).toLocaleString("ko-KR") : "";
  return (
    <div style={{ position: "relative" }}>
      <input
        style={{ ...S.input, ...(big ? { fontSize: 22, fontWeight: 700 } : {}), paddingRight: 34 }}
        value={display}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder={placeholder}
        inputMode="numeric"
        autoFocus={autoFocus}
      />
      <span style={S.wonSuffix}>원</span>
    </div>
  );
}

function CatGrid({ cats, value, onChange }) {
  return (
    <div style={S.catGrid}>
      {cats.map((c) => (
        <button key={c.key}
          style={{ ...S.catBtn, ...(value === c.key ? { borderColor: c.color, background: c.color + "18", color: "#2B2620" } : {}) }}
          onClick={() => onChange(c.key)}>
          <span style={{ ...S.catDot, background: c.color }} />
          {c.label}
        </button>
      ))}
    </div>
  );
}
function Empty({ title, body }) {
  return (
    <div style={S.empty}>
      <div style={S.emptyTitle}>{title}</div>
      <div style={S.emptyBody}>{body}</div>
    </div>
  );
}

// 클릭하면 수정 폼이 열리는 항목 행
function ItemRow({ barColor, name, meta, amount, amountColor, onClick }) {
  return (
    <button style={S.itemBtn} onClick={onClick}>
      <span style={{ ...S.itemBar, background: barColor }} />
      <div style={S.itemMain}>
        <div style={S.itemName}>{name}</div>
        <div style={S.itemMeta}>{meta}</div>
      </div>
      <div style={S.itemRight}>
        <div style={{ ...S.itemAmount, color: amountColor || INK }}>{amount}</div>
        <span style={S.itemChev}>›</span>
      </div>
    </button>
  );
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 반복 주기 선택 (매월 / 매주 / 사용자 지정)
// 날짜는 모두 달력(<input type="date">)으로 고른다.
//  - 매월: 고른 날짜의 '일(日)'만 써서 day에 저장
//  - 매주 / 직접: 고른 날짜가 anchor(첫 발생일)로 저장돼 occursOn의 기준이 됨
function CycleField({ cycle, setCycle, day, setDay, weekday, setWeekday, everyN, setEveryN, unit, setUnit,
  anchor, setAnchor, dayLabel = "매월 며칠" }) {
  // 매월 피커에 보여줄 날짜(연·월은 무시하고 '일'만 쓴다)
  const [monthISO, setMonthISO] = useState(() => isoForDay(day));
  const pickMonthly = (v) => {
    if (!v) return;
    setMonthISO(v);
    setDay(String(Number(v.slice(8))));
  };

  // 요일 칩 ↔ 시작 날짜를 서로 맞춰준다 (둘이 어긋나면 사용자가 혼란스러움)
  const pickAnchor = (v) => {
    setAnchor(v);
    if (v && cycle === "weekly") setWeekday(parseISO(v).getDay());
  };
  const pickWeekday = (i) => {
    setWeekday(i);
    if (anchor) {
      const a = parseISO(anchor);
      a.setDate(a.getDate() + (i - a.getDay())); // 같은 주의 그 요일로 이동
      setAnchor(isoOf(a));
    }
  };

  const anchorLabel = cycle === "weekly"
    ? "언제부터 반복 (첫 발생일)"
    : unit === "month" ? "첫 납입일" : "언제부터 반복 (첫 발생일)";

  return (
    <>
      <div style={S.fieldLabel}>반복 주기</div>
      <div style={S.seg}>
        {[["monthly", "매월"], ["weekly", "매주"], ["custom", "직접"]].map(([v, l]) => (
          <button key={v} style={{ ...S.segBtn, ...(cycle === v ? S.segOn : {}) }} onClick={() => setCycle(v)}>{l}</button>
        ))}
      </div>

      {cycle === "monthly" && (
        <>
          <div style={S.fieldLabel}>{dayLabel}</div>
          <input type="date" style={{ ...S.input, colorScheme: "light", marginBottom: 6 }}
            value={monthISO} onChange={(e) => pickMonthly(e.target.value)} />
          <div style={S.fieldHint}>
            매월 <b>{Number(day) || 1}일</b>에 반복돼요. 연·월은 쓰지 않아요.
            {Number(day) > 28 && " 그 날짜가 없는 달에는 말일에 처리돼요."}
          </div>
        </>
      )}

      {cycle === "weekly" && (
        <>
          <div style={S.fieldLabel}>무슨 요일</div>
          <div style={S.weekdayRow}>
            {WEEKDAYS.map((w, i) => (
              <button key={w} style={{ ...S.weekdayBtn, ...(weekday === i ? S.weekdayOn : {}) }}
                onClick={() => pickWeekday(i)}>{w}</button>
            ))}
          </div>
          <div style={S.fieldLabel}>{anchorLabel}</div>
          <input type="date" style={{ ...S.input, colorScheme: "light", marginBottom: 6 }}
            value={anchor} onChange={(e) => pickAnchor(e.target.value)} />
          <div style={S.fieldHint}>
            {anchor
              ? <>{anchor.replace(/-/g, ".")}({WEEKDAYS[parseISO(anchor).getDay()]})부터 매주 반복돼요.</>
              : "비우면 시작일 제한 없이 매주 반복돼요."}
          </div>
        </>
      )}

      {cycle === "custom" && (
        <>
          <div style={S.customRow}>
            <input style={{ ...S.input, width: 70, textAlign: "center" }} value={everyN} inputMode="numeric"
              onChange={(e) => setEveryN(e.target.value.replace(/[^0-9]/g, ""))} />
            <div style={S.unitSeg}>
              {[["day", "일"], ["week", "주"], ["month", "개월"]].map(([v, l]) => (
                <button key={v} style={{ ...S.segBtn, ...(unit === v ? S.segOn : {}) }} onClick={() => setUnit(v)}>{l}</button>
              ))}
            </div>
            <span style={S.customSuffix}>마다</span>
          </div>
          <div style={S.fieldLabel}>{anchorLabel}</div>
          <input type="date" style={{ ...S.input, colorScheme: "light", marginBottom: 6 }}
            value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          <div style={S.fieldHint}>
            {anchor ? (
              unit === "month"
                ? <>{anchor.replace(/-/g, ".")}부터 {Math.max(1, Number(everyN) || 1)}개월마다 <b>{parseISO(anchor).getDate()}일</b>에 반복돼요.</>
                : <>{anchor.replace(/-/g, ".")}부터 {Math.max(1, Number(everyN) || 1)}{unit === "day" ? "일" : "주"}마다 반복돼요.</>
            ) : "비우면 오늘부터 시작해요."}
          </div>
        </>
      )}
    </>
  );
}

// 달력에 표시 토글
function HideToggle({ hidden, setHidden }) {
  return (
    <button style={S.hideToggle} onClick={() => setHidden(!hidden)}>
      <span style={{ ...S.checkbox, ...(hidden ? {} : S.checkboxOn) }}>{hidden ? "" : "✓"}</span>
      <span>달력에 표시{hidden ? " 안 함" : ""}</span>
    </button>
  );
}

// 반복 항목의 cycle 관련 필드를 객체로 묶어 반환.
// anchor = 사용자가 고른 첫 발생일. custom은 미선택 시 오늘로 폴백(기존 동작),
// weekly는 미선택 시 anchor 없이 저장해 구 데이터와 똑같이 동작하게 둔다.
function buildCycle(cycle, day, weekday, everyN, unit, anchor) {
  if (cycle === "weekly") return { cycle, weekday, anchor: anchor || undefined };
  if (cycle === "custom") return { cycle, everyN: Math.max(1, Number(everyN) || 1), unit, anchor: anchor || todayISO };
  return { cycle, day: Number(day) || 1 };
}
// 폼의 anchor 초기값: 기존 값 → 없으면 신규는 오늘, 수정은 빈 값(기존 동작 유지)
const initialAnchor = (initial) => initial?.anchor ?? (initial ? "" : todayISO);

// ─────────────────────────────────────────────────────────────
const KEYFRAMES = `
@keyframes flow { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
@keyframes pop { 0%{transform:scale(.96);opacity:0} 100%{transform:scale(1);opacity:1} }
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
input:focus { outline: none; border-color:#1F4E6B !important; }
button { font-family: inherit; cursor: pointer; }
/* 클릭 후 남는 포커스 흔적 제거. 단 키보드 이동(:focus-visible)은 살려둔다. */
button:focus { outline: none; }
button:focus-visible { outline: 2px solid #1F4E6B; outline-offset: 2px; }
button::-moz-focus-inner { border: 0; }
@media (prefers-reduced-motion: reduce){ *{animation:none!important;transition:none!important} }
`;

const S = {
  app: { maxWidth: 480, margin: "0 auto", minHeight: "100vh", background: PAPER, color: INK,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', sans-serif", paddingBottom: 40 },
  header: { padding: "22px 20px 14px" },
  headerTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 },
  brandDot: { color: ACCENT },
  tagline: { fontSize: 12.5, color: "#8A8479", marginTop: 6, letterSpacing: "-0.01em" },
  actionRow: { display: "flex", gap: 10, marginTop: 16 },
  actionBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: "none", borderRadius: 14, padding: "14px 0", fontSize: 15, fontWeight: 700 },
  actionSign: { fontSize: 18, fontWeight: 800, lineHeight: 1 },
  actionIn: { background: "#EAF1ED", color: "#2E7D5B" },
  actionOut: { background: "#F7ECE9", color: "#C0566B" },
  addBtn: { background: INK, color: PAPER, border: "none", borderRadius: 999, padding: "9px 15px", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" },
  pickList: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 },
  pickItem: { display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid #EFE9DD", borderRadius: 14, padding: "15px 16px", textAlign: "left" },
  pickDot: { width: 10, height: 10, borderRadius: 4, flexShrink: 0 },
  pickText: { flex: 1, minWidth: 0 },
  pickLabel: { fontSize: 15.5, fontWeight: 700, color: INK },
  pickDesc: { fontSize: 12.5, color: "#8A8479", marginTop: 2 },
  pickChev: { fontSize: 20, color: "#C2BBAC" },
  weekdayRow: { display: "flex", gap: 5, marginBottom: 14 },
  weekdayBtn: { flex: 1, background: "#fff", border: "1px solid #E4DCCC", borderRadius: 10, padding: "10px 0", fontSize: 13.5, fontWeight: 600, color: "#8A8479" },
  weekdayOn: { borderColor: ACCENT, background: ACCENT, color: "#fff" },
  customRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14 },
  unitSeg: { display: "flex", gap: 6, flex: 1 },
  customSuffix: { fontSize: 14, color: "#6B655B", fontWeight: 600 },
  hideToggle: { display: "flex", alignItems: "center", gap: 9, background: "none", border: "none", padding: "4px 2px 18px", fontSize: 13.5, color: "#6B655B", fontWeight: 600 },
  checkbox: { width: 20, height: 20, borderRadius: 6, border: "1.5px solid #CFC8BA", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#fff", background: "#fff" },
  checkboxOn: { background: ACCENT, borderColor: ACCENT },
  cellOpen: { outline: `2px solid ${ACCENT}`, outlineOffset: -2 },
  dayRowTag: { marginLeft: 6, fontSize: 10.5, color: "#A39C8F", fontWeight: 400, background: "#F2EEE2", borderRadius: 4, padding: "1px 5px" },

  hero: { padding: "10px 20px 22px" },
  heroTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  viewToggle: { display: "flex", background: "#EAE3D6", borderRadius: 999, padding: 2 },
  viewBtn: { border: "none", background: "none", borderRadius: 999, padding: "4px 13px", fontSize: 12.5, fontWeight: 600, color: "#9A8F70" },
  viewBtnOn: { background: "#fff", color: INK, boxShadow: "0 1px 2px rgba(0,0,0,.06)" },
  heroLabel: { fontSize: 13, color: "#8A8479", letterSpacing: "-0.01em" },
  heroBig: { display: "flex", alignItems: "baseline", gap: 4, marginTop: 6 },
  heroNum: { fontSize: 46, fontWeight: 800, letterSpacing: "-0.035em", color: ACCENT, animation: "pop .4s ease", fontVariantNumeric: "tabular-nums" },
  heroUnit: { fontSize: 20, fontWeight: 700, color: ACCENT },
  heroSub: { fontSize: 13.5, color: "#6B655B", marginTop: 4 },
  heroDaily: { fontSize: 12.5, color: "#8A8479", marginTop: 7, background: "#F2EEE2", borderRadius: 8, padding: "7px 10px", display: "inline-block" },
  coach: { marginTop: 14, borderRadius: 12, padding: "11px 14px", fontSize: 13, lineHeight: 1.5 },
  coachOk: { background: "#EAF1ED", color: "#3A6B55" },
  coachWarn: { background: "#F7ECE9", color: "#A8483C" },
  flowTrack: { marginTop: 16, height: 4, borderRadius: 4, background: "#EAE3D6", overflow: "hidden" },
  flowFill: { height: "100%", width: "55%", background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`, animation: "flow 2.4s ease-in-out infinite" },

  remainTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  budgetTrack: { marginTop: 16, height: 10, borderRadius: 6, background: "#EAE3D6", overflow: "hidden", display: "flex" },
  budgetFixed: { height: "100%", background: ACCENT, transition: "width .5s ease" },
  budgetVar: { height: "100%", background: "#D98244", transition: "width .5s ease" },
  budgetSave: { height: "100%", background: "#2E8B6B", transition: "width .5s ease" },
  saveNote: { marginTop: 12, fontSize: 12, color: "#3A6B55", background: "#EAF1ED", borderRadius: 8, padding: "8px 11px", lineHeight: 1.5 },
  saveSectionHead: { padding: "24px 4px 4px" },
  saveSectionTitle: { fontSize: 14.5, fontWeight: 700, color: INK },
  saveSectionSub: { fontSize: 12, color: "#9A958B", marginTop: 2 },
  saveAutoNote: { fontSize: 12.5, color: "#3A6B55", background: "#EAF1ED", borderRadius: 10, padding: "11px 13px", marginBottom: 16, lineHeight: 1.6 },
  saveAutoChip: { display: "inline-block", background: "#fff", borderRadius: 6, padding: "1px 7px", margin: "0 2px", fontSize: 11.5, fontWeight: 700, color: "#2E8B6B" },
  budgetLegend: { display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, color: "#7A7468", alignItems: "center" },
  miniDot: { display: "inline-block", width: 8, height: 8, borderRadius: 3, marginRight: 4, verticalAlign: "middle" },

  // 탭 5개 — 각 탭이 폭을 균등 분할(flex:1)해 320px에서도 탭당 약 60×44px 터치 영역.
  // space-between으로 두면 버튼이 글자 폭만큼만 커져 '달력'이 26px밖에 안 됐다.
  tabs: { display: "flex", gap: 0, padding: "0 8px", borderBottom: "1px solid #EAE3D6" },
  tab: { flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", WebkitTapHighlightColor: "transparent", padding: "13px 0 15px", fontSize: 13.5, fontWeight: 600, color: "#A39C8F", borderBottom: "2px solid transparent", marginBottom: -1, whiteSpace: "nowrap", letterSpacing: "-0.02em", textAlign: "center" },
  tabOn: { color: INK, borderBottomColor: ACCENT },

  // 대시보드 — 4분할 요약 카드
  sumGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  sumCard: { background: "#fff", border: "1px solid #EFE9DD", borderRadius: 14, padding: "13px 14px" },
  sumCardTop: { display: "flex", alignItems: "center", gap: 6, marginBottom: 7 },
  sumCardLabel: { fontSize: 12, color: "#8A8479", fontWeight: 600 },
  sumCardVal: { fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" },
  sumCardUnit: { fontSize: 12, fontWeight: 600, marginLeft: 2 },
  // 홈: 예산 페이스 게이지 (회색 세로선 = 오늘까지의 날짜 진행률)
  paceHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  pacePct: { fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  paceTrack: { position: "relative", marginTop: 4, height: 10, borderRadius: 6, background: "#EAE3D6", overflow: "hidden" },
  paceFill: { height: "100%", borderRadius: 6, transition: "width .5s ease" },
  paceMark: { position: "absolute", top: 0, bottom: 0, width: 2, background: "#8A8479", opacity: 0.55 },
  paceNote: { marginTop: 9, fontSize: 12, color: "#8A8479", lineHeight: 1.5 },

  // 홈: 오늘 / 이번 주 지출
  duoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 },
  duoLabel: { fontSize: 12, color: "#8A8479", fontWeight: 600 },
  duoVal: { fontSize: 18, fontWeight: 800, marginTop: 7, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" },

  // 홈: 많이 쓴 곳 톱3
  topRow: { display: "flex", alignItems: "center", gap: 8, marginTop: 9 },
  topName: { fontSize: 13, color: "#4A4540", width: 62, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  topTrack: { flex: 1, height: 8, borderRadius: 5, background: "#EFEADF", overflow: "hidden" },
  topFill: { display: "block", height: "100%", borderRadius: 5, transition: "width .5s ease" },
  topVal: { fontSize: 12.5, fontWeight: 700, color: "#4A4540", width: 76, textAlign: "right", fontVariantNumeric: "tabular-nums" },

  cmpRow: { marginTop: 12, background: "#F2EEE2", borderRadius: 12, padding: "11px 14px", fontSize: 12.5, color: "#6B655B", lineHeight: 1.5 },
  emptyCta: { display: "flex", flexDirection: "column", gap: 8, padding: "0 8px" },
  emptyCtaMain: { width: "100%", background: INK, color: PAPER, border: "none", borderRadius: 13, padding: "15px 0", fontSize: 15, fontWeight: 700 },
  emptyCtaSub: { width: "100%", background: "#fff", border: "1px solid #E4DCCC", borderRadius: 13, padding: "13px 0", fontSize: 14, fontWeight: 600, color: "#4A4540" },

  // 대시보드 — 남는 돈 추이 미니 막대
  trendRow: { display: "flex", alignItems: "flex-end", gap: 6, height: 96 },
  trendCol: { flex: 1, display: "flex", flexDirection: "column", height: "100%" },
  trendUpper: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" },
  trendBase: { height: 1, background: "#E4DCCC" },
  trendLower: { height: 26, display: "flex", flexDirection: "column" },
  trendBar: { width: "100%", borderRadius: 4, transition: "height .4s ease" },
  trendLabel: { textAlign: "center", fontSize: 10.5, color: "#A39C8F", marginTop: 5 },
  todayTag: { marginLeft: 6, background: `${ACCENT}14`, borderRadius: 5, padding: "1px 6px", fontSize: 11, fontWeight: 700, color: ACCENT },

  main: { padding: "18px 16px 0" },
  tip: { background: "#F2EEE2", borderRadius: 12, padding: "11px 14px", fontSize: 12.5, color: "#6B655B", lineHeight: 1.5, marginBottom: 14 },
  pastNote: { background: "#FBF3E7", borderRadius: 10, padding: "9px 12px", fontSize: 12, color: "#A8763C", lineHeight: 1.5, marginTop: -6, marginBottom: 14 },
  errNote: { background: "#F7ECE9", borderRadius: 10, padding: "9px 12px", fontSize: 12, color: "#A8483C", lineHeight: 1.5, marginBottom: 14, fontWeight: 600 },
  fieldHint: { fontSize: 11.5, color: "#9A958B", lineHeight: 1.5, marginBottom: 14 },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #E4DCCC", borderRadius: 12, padding: "0 12px", marginBottom: 14 },
  searchIcon: { fontSize: 18, color: "#A39C8F" },
  searchInput: { flex: 1, border: "none", outline: "none", background: "none", padding: "12px 0", fontSize: 15, color: INK },
  searchClear: { background: "#ECE7DD", border: "none", borderRadius: 999, width: 22, height: 22, fontSize: 15, color: "#7A7468", lineHeight: 1 },

  card: { background: "#fff", borderRadius: 18, padding: "18px 18px 20px", border: "1px solid #EFE9DD" },
  cardTitle: { fontSize: 13, color: "#8A8479", fontWeight: 600, marginBottom: 8 },
  cardHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  compBar: { display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "#ECE7DD", marginBottom: 14 },
  compList: { display: "flex", flexDirection: "column", gap: 9 },
  compRow: { display: "flex", alignItems: "center", gap: 8 },
  compLabel: { fontSize: 13.5, color: "#4A4540", flex: 1 },
  compDesc: { fontSize: 12, color: "#A39C8F" },
  compVal: { fontSize: 13.5, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" },
  pendingNote: { marginTop: 14, paddingTop: 12, borderTop: "1px solid #F0EADC", fontSize: 12.5, color: "#6B655B", lineHeight: 1.5 },
  closeBtn: { width: "100%", marginTop: 14, background: ACCENT, color: "#fff", border: "none", borderRadius: 13, padding: "15px 0", fontSize: 15, fontWeight: 700 },
  closeSummary: { background: "#fff", borderRadius: 12, border: "1px solid #EFE9DD", padding: "14px 16px", marginBottom: 18 },
  closeSumRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 13.5, color: "#6B655B", fontVariantNumeric: "tabular-nums" },
  allocRow: { display: "flex", alignItems: "center", gap: 9, marginBottom: 10 },
  allocLabel: { fontSize: 14, fontWeight: 600, color: "#4A4540", width: 64 },
  allocInput: { flex: 1, background: "#fff", border: "1px solid #E4DCCC", borderRadius: 10, padding: "11px 12px", fontSize: 16, color: INK, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  allocStatus: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600, margin: "14px 0 18px", minHeight: 20 },
  autoFillBtn: { background: "#F0EADC", border: "none", borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: 600, color: "#7A7468" },
  formTotalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 2px 18px", fontSize: 14, color: "#6B655B" },
  donutRow: { display: "flex", alignItems: "center", gap: 18 },
  donutTopText: { fontSize: 10, fill: "#9A958B", fontWeight: 600 },
  donutBigText: { fontSize: 16, fill: INK, fontWeight: 800, letterSpacing: "-0.02em" },
  legend: { flex: 1, display: "flex", flexDirection: "column", gap: 9 },
  legendRow: { display: "flex", alignItems: "center", gap: 8 },
  legendDot: { width: 9, height: 9, borderRadius: 3, flexShrink: 0 },
  legendLabel: { fontSize: 13.5, color: "#4A4540", flex: 1 },
  legendVal: { fontSize: 13, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" },
  avgRow: { marginTop: 14, paddingTop: 12, borderTop: "1px solid #F0EADC", fontSize: 12.5, color: "#6B655B" },

  listHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 4px 10px", fontSize: 13.5, color: "#4A4540", fontWeight: 600 },
  listHeadHint: { fontSize: 11.5, color: "#A39C8F", fontWeight: 400 },
  subHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 4px 8px", fontSize: 12.5, color: "#8A8479", fontWeight: 600 },
  quickAdd: { background: "#F0EADC", border: "none", borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, color: "#7A7468" },
  incomeEmpty: { background: "#fff", border: "1px dashed #D8CFB8", borderRadius: 14, padding: "18px 16px", fontSize: 13, color: "#9A8F70", textAlign: "center", cursor: "pointer" },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  item: { display: "flex", alignItems: "center", background: "#fff", borderRadius: 14, padding: "13px 14px 13px 0", border: "1px solid #EFE9DD", overflow: "hidden" },
  itemBtn: { width: "100%", display: "flex", alignItems: "center", background: "#fff", borderRadius: 14, padding: "13px 14px 13px 0", border: "1px solid #EFE9DD", overflow: "hidden", textAlign: "left" },
  itemChev: { fontSize: 18, color: "#C9C2B4", paddingLeft: 6 },
  itemBar: { width: 4, alignSelf: "stretch", marginRight: 13, borderRadius: 4 },
  itemMain: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" },
  itemMeta: { fontSize: 12, color: "#9A958B", marginTop: 3 },
  yearTag: { marginLeft: 6, background: "#F0EADC", borderRadius: 5, padding: "1px 6px", fontSize: 11, color: "#7A7468" },
  hiddenTag: { marginLeft: 6, background: "#ECE7DD", borderRadius: 5, padding: "1px 6px", fontSize: 11, color: "#9A8F70" },
  ovTag: { marginLeft: 6, background: "#E7EEF3", borderRadius: 5, padding: "1px 6px", fontSize: 11, color: "#3B6EA5" },
  itemRight: { display: "flex", alignItems: "center", gap: 4 },
  itemAmount: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" },
  del: { background: "none", border: "none", color: "#C9C2B4", fontSize: 22, lineHeight: 1, padding: "0 4px 0 8px" },

  calBar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 14px" },
  calNav: { background: "#fff", border: "1px solid #EFE9DD", borderRadius: 10, width: 36, height: 36, fontSize: 20, color: INK },
  calTitle: { fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" },
  weekRow: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 },
  weekCell: { textAlign: "center", fontSize: 12, fontWeight: 600, padding: "4px 0" },
  grid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 },
  cellEmpty: { aspectRatio: "1 / 1.4" },
  cell: { aspectRatio: "1 / 1.4", borderRadius: 10, padding: "5px 0 0", display: "flex", flexDirection: "column", alignItems: "center", background: "#fff", border: "1px solid #F0EADC", overflow: "hidden" },
  cellHit: { border: `1px solid ${ACCENT}33` },
  cellDay: { fontSize: 12.5, color: "#6B655B", fontWeight: 600, width: 22, height: 22, lineHeight: "22px", textAlign: "center" },
  cellToday: { background: ACCENT, color: "#fff", borderRadius: 999 },
  cellBadge: { marginTop: 1, fontSize: 9, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.3 },
  calKey: { display: "flex", gap: 16, justifyContent: "center", marginTop: 12, fontSize: 11.5, color: "#7A7468" },

  upBox: { marginTop: 16, background: "#fff", borderRadius: 16, border: "1px solid #EFE9DD", padding: "14px 16px" },
  upTitle: { fontSize: 13, fontWeight: 700, color: "#8A8479", marginBottom: 10 },
  upEmpty: { fontSize: 13, color: "#A39C8F" },
  upRow: { display: "flex", alignItems: "center", gap: 9, padding: "7px 0" },
  upDot: { width: 8, height: 8, borderRadius: 3, flexShrink: 0 },
  upDay: { fontSize: 13, fontWeight: 700, width: 34, color: ACCENT, fontVariantNumeric: "tabular-nums" },
  upName: { fontSize: 14, flex: 1, color: "#4A4540" },
  upAmt: { fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" },

  toast: { position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", background: "rgba(43,38,32,.92)", color: PAPER,
    padding: "11px 18px", borderRadius: 999, fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap",
    boxShadow: "0 6px 20px rgba(43,38,32,.25)", animation: "pop .2s ease", pointerEvents: "none", zIndex: 90 },

  overlay: { position: "fixed", inset: 0, background: "rgba(43,38,32,.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 },
  sheet: { width: "100%", maxWidth: 480, background: PAPER, borderRadius: "22px 22px 0 0", padding: "10px 20px 26px", animation: "pop .25s ease", maxHeight: "92vh", overflowY: "auto" },
  sheetGrip: { width: 38, height: 4, borderRadius: 4, background: "#D8D0C0", margin: "6px auto 14px" },
  sheetTitle: { fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 },
  field: { display: "block", marginBottom: 14 },
  fieldLabel: { display: "block", fontSize: 12.5, fontWeight: 600, color: "#8A8479", marginBottom: 6 },
  input: { width: "100%", background: "#fff", border: "1px solid #E4DCCC", borderRadius: 12, padding: "13px 14px", fontSize: 16, color: INK },
  wonSuffix: { position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: "#9A958B", pointerEvents: "none" },
  seg: { display: "flex", gap: 8, marginBottom: 14 },
  segBtn: { flex: 1, background: "#fff", border: "1px solid #E4DCCC", borderRadius: 12, padding: "12px 0", fontSize: 14, fontWeight: 600, color: "#8A8479" },
  segOn: { borderColor: ACCENT, background: ACCENT, color: "#fff" },
  catGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 22 },
  catBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#fff", border: "1px solid #E4DCCC", borderRadius: 12, padding: "11px 0", fontSize: 13.5, fontWeight: 600, color: "#8A8479" },
  catDot: { width: 9, height: 9, borderRadius: 3 },
  submit: { width: "100%", background: INK, color: PAPER, border: "none", borderRadius: 13, padding: "15px 0", fontSize: 15.5, fontWeight: 700 },
  submitOff: { background: "#CFC8BA", color: "#fff" },
  cancel: { width: "100%", background: "none", border: "none", color: "#A39C8F", padding: "12px 0 0", fontSize: 14 },
  deleteBtn: { width: "100%", background: "none", border: "none", color: "#C0566B", padding: "12px 0 0", fontSize: 14, fontWeight: 600 },
  skipBtn: { width: "100%", background: "#F2EEE2", border: "none", borderRadius: 12, color: "#7A7468", padding: "13px 0", fontSize: 14, fontWeight: 600, marginTop: 10 },
  scopeList: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  scopeBtn: { display: "flex", alignItems: "center", gap: 11, background: "#fff", border: "1px solid #E4DCCC", borderRadius: 12, padding: "13px 14px", textAlign: "left" },
  scopeOn: { borderColor: ACCENT, background: ACCENT + "0E" },
  radio: { width: 18, height: 18, borderRadius: 999, border: "2px solid #CFC8BA", flexShrink: 0 },
  radioOn: { borderColor: ACCENT, background: ACCENT, boxShadow: "inset 0 0 0 3px #fff" },
  scopeLabel: { fontSize: 14.5, fontWeight: 700, color: INK },
  scopeDesc: { fontSize: 12, color: "#8A8479", marginTop: 2 },
  dayRowBtn: { width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "9px 0", background: "none", border: "none", borderBottom: "1px solid #F2EEE2", textAlign: "left" },
  dayRowChev: { fontSize: 17, color: "#C9C2B4", paddingLeft: 4 },

  empty: { textAlign: "center", padding: "48px 24px" },
  assetHero: { padding: "10px 20px 22px" },
  assetCard: { background: "#fff", borderRadius: 14, border: "1px solid #EFE9DD", overflow: "hidden" },
  assetCardHead: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", padding: "14px 14px" },
  assetCardLeft: { display: "flex", alignItems: "center", gap: 8 },
  assetMonth: { fontSize: 14.5, fontWeight: 700, color: INK },
  nowTag: { fontSize: 10.5, fontWeight: 700, color: ACCENT, background: `${ACCENT}14`, borderRadius: 5, padding: "2px 6px" },
  assetCardRight: { display: "flex", alignItems: "center", gap: 10 },
  assetNet: { fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  assetAfter: { fontSize: 14, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" },
  chev: { fontSize: 17, color: "#C2BBAC", transition: "transform .2s ease", display: "inline-block", width: 10 },
  assetDetail: { padding: "4px 14px 14px", borderTop: "1px solid #F2EEE2" },
  detailRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0" },
  detailDivider: { height: 1, background: "#F0EADC", margin: "4px 0" },
  allocBlock: { marginTop: 10, paddingTop: 10, borderTop: "1px dashed #E4DCCC" },
  allocBlockTitle: { fontSize: 12, fontWeight: 600, color: "#8A8479", marginBottom: 8 },
  allocMini: { display: "flex", alignItems: "center", gap: 8, padding: "4px 0" },
  allocMiniLabel: { fontSize: 13, color: "#6B655B", flex: 1 },
  allocMiniVal: { fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  backupHead: { padding: "28px 4px 8px", fontSize: 12.5, color: "#8A8479", fontWeight: 600 },
  backupRow: { display: "flex", gap: 8 },
  backupBtn: { flex: 1, background: "#fff", border: "1px solid #E4DCCC", borderRadius: 12, padding: "12px 0", fontSize: 13, fontWeight: 600, color: "#4A4540" },
  resetBtn: { width: "100%", marginTop: 28, background: "none", border: "1px solid #E4DCCC", borderRadius: 12, padding: "12px 0", fontSize: 13, fontWeight: 600, color: "#B0683C" },
  storeNote: { textAlign: "center", fontSize: 11.5, color: "#A39C8F", marginTop: 10, lineHeight: 1.5 },
  emptyTitle: { fontSize: 17, fontWeight: 700, marginBottom: 8 },
  emptyBody: { fontSize: 14, color: "#8A8479", lineHeight: 1.6 },
};
