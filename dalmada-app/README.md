# 달마다 — 고정비·가계부 관리 (PWA)

매달 빠지는 돈을 한눈에 잡는 로컬 기반 가계부. 데이터는 서버 없이 **사용자 기기(localStorage)** 에만 저장됩니다. 폰에서 "홈 화면에 추가"하면 앱처럼 설치됩니다.

## 로컬에서 실행

```bash
npm install
npm run dev
```

→ 안내되는 주소(보통 http://localhost:5173)를 브라우저로 엽니다.
개발 모드에서 localStorage가 작동하므로, 새로고침해도 데이터가 유지되는 것을 처음 확인할 수 있습니다.

## 빌드 (배포용 정적 파일 생성)

```bash
npm run build
```

→ `dist/` 폴더에 정적 파일이 생성됩니다. 서비스워커(sw.js)와 PWA manifest가 자동 포함됩니다.

빌드 결과를 로컬에서 미리 보려면:

```bash
npm run preview
```

## 배포 (무료, 셋 중 택1)

### A. Netlify — 가장 쉬움 (드래그 앤 드롭)
1. https://app.netlify.com 접속 → 로그인
2. `dist/` 폴더를 페이지에 드래그 앤 드롭
3. 끝. 바로 https://___.netlify.app 주소가 생깁니다.

### B. Vercel — 계속 업데이트할 때 편함
```bash
npm i -g vercel
vercel
```
GitHub에 올린 뒤 Vercel과 연결하면, 푸시할 때마다 자동 배포됩니다.

### C. GitHub Pages
`vite.config.js`에 `base: "/저장소이름/"` 추가 후 `npm run build` → `dist/`를 gh-pages 브랜치로 올립니다.

## 폰에 설치 (PWA)

1. 배포된 주소(https 필수)를 **폰 브라우저**로 엽니다.
   - PWA 설치는 https에서만 됩니다. Netlify·Vercel은 기본 https라 그대로 됩니다.
2. **iOS Safari**: 공유 버튼 → "홈 화면에 추가"
   **안드로이드 Chrome**: 메뉴(⋮) → "앱 설치" 또는 "홈 화면에 추가"
3. 홈 화면에 달마다 아이콘이 생기고, 전체화면 앱처럼 열립니다. 오프라인에서도 동작합니다.

## 데이터에 대해

- 모든 데이터는 그 기기의 브라우저(localStorage `dalmada:v1`)에만 저장됩니다.
- 서버로 전송되지 않습니다. 백업·기기 이전이 필요하면 추후 내보내기 기능을 추가하세요.
- 브라우저 데이터를 지우면 함께 삭제됩니다.

## 구조

```
index.html          진입 HTML (PWA 메타 포함)
vite.config.js      Vite + PWA 설정 (아이콘·manifest)
src/
  main.jsx          React 진입점
  Dalmada.jsx       앱 본체 (전체 기능)
  index.css         전역 기본 스타일
public/
  favicon.svg
  icon-192.png      PWA 아이콘
  icon-512.png
```
