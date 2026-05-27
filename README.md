# test2 — Pomodoro (MF Platform remote)

집중/휴식 사이클 타이머 (ms 단위 표시). **MF Platform**의 host shell이 런타임에 동적으로 로드합니다.

- expose: `./App` (default export)
- MF runtime name: `pomodoro`
- GitHub Pages base: `/test2/` (보조 채널)
- 운영 URL: `https://mf.gonogono.org/remotes/test2/` (호스트 서버가 직접 빌드/서빙)

## 로컬에서 실행

```powershell
pnpm install
pnpm dev   # http://localhost:5179 — standalone 미리보기
```

host-shell의 `public/local-registry.json`에 이미 `pomodoro` 항목이 `status: "active"`로 등록되어
있어, `cd ../host-shell && pnpm dev`로 host(:5175)에 mount 가능.

## 서비스에 반영 (운영 흐름)

`pigeon9989/test2`에 `git push` → 호스트 운영자가 `bash scripts/deploy.sh` 실행 → 서버가
git pull + `vite build --base /remotes/test2/` → registry에 버전/SHA 자동 stamp.
자세한 흐름은 `docs/PUSH_REMOTES.md` 참고.

GitHub Actions는 보조 채널로 `gh-pages` branch deploy (action-less workflow).

## 처음 GitHub에 push 하기 (이미 끝남)

이미 `pigeon9989/test2`에 push되어 있습니다. 새 fork 시:

```powershell
git init
git add .
git commit -m "feat: initial scaffold for pomodoro remote"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Settings → Pages → Source = "Deploy from a branch" → `gh-pages` / `(root)`로 설정.
