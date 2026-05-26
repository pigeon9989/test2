# test2 — Pomodoro (MF Platform remote)

25분 집중 / 5분 휴식 사이클 타이머. **MF Platform**의 host shell이 런타임에 동적으로 로드합니다.

- expose: `./App` (default export)
- MF runtime name: `pomodoro`
- GitHub Pages base: `/test2/`

## 로컬에서 실행

```powershell
pnpm install
pnpm dev   # http://localhost:5179 — standalone 미리보기
```

## 처음 GitHub에 push 하기

```powershell
git init
git add .
git commit -m "feat: initial scaffold for pomodoro remote"
git branch -M main
git remote add origin https://github.com/pigeon9989/test2.git
git push -u origin main
```

## GitHub Pages 활성화

저장소 Settings → Pages → **Source: GitHub Actions**.

배포 URL: `https://pigeon9989.github.io/test2/`

## host에 등록

host-shell의 `public/local-registry.json`에서 `pomodoro` 항목 status를 `active`로.
