# Local Music Analysis MVP

> 내 음악 파일을 업로드하면 스템 분리, BPM·조성·코드 분석, MIDI 추출과 오디오 내보내기를 한 작업 공간에서 제공하는 로컬 우선 음악 분석 도구입니다.

**한국어** | [English](#english)

## 제품 소개

`Local Music Analysis MVP`는 프로듀서, 연주자, 리믹서가 곡의 구성을 빠르게 파악하고 작업용 소스를 준비할 수 있도록 만든 Moises Studio 스타일의 웹 애플리케이션입니다. MP3 또는 WAV 파일을 업로드하면 백엔드의 분석 작업이 진행되고, DAW 분위기의 화면에서 파트별 오디오를 듣고 분석 결과를 확인할 수 있습니다.

핵심은 복잡한 오디오 처리 과정을 한 번의 업로드로 연결한다는 점입니다. 곡을 보컬·드럼·베이스·기타·피아노·기타 파트로 나누고, 템포와 박자 위치, 키와 모드, 코드 진행을 타임라인으로 제공합니다. 필요한 스템을 선택해 믹스 파일이나 개별 파일 묶음으로 내려받을 수도 있습니다.

## 이런 작업에 적합합니다

- 연습·카피 전에 곡의 BPM, 키, 코드 진행을 빠르게 확인할 때
- 보컬·드럼 등 특정 파트의 소리를 줄이거나 솔로로 들어볼 때
- 리믹스, 편곡, 연주 연습을 위한 스템 파일을 준비할 때
- 분석 결과와 MIDI 초안을 출발점으로 DAW 작업을 시작할 때

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| MP3 / WAV 업로드 | 두 형식의 오디오 파일을 업로드해 비동기 작업으로 처리합니다. |
| 6-스템 분리 | Demucs `htdemucs_6s`가 설치된 경우 보컬, 드럼, 베이스, 기타, 피아노, 기타(Other)로 분리합니다. |
| 음악 정보 분석 | `librosa` 기반으로 길이, BPM, 비트 그리드, 키/모드, 크로마 기반 코드 타임라인을 계산합니다. |
| MIDI 파일 생성 | Basic Pitch를 사용할 수 있으면 스템별 MIDI를 추출합니다. 기본 빠른 모드에서는 즉시 사용할 수 있는 placeholder MIDI를 만듭니다. |
| DAW형 플레이어 | 스템별 음소거·솔로·볼륨·팬, 파형 레인, 재생 위치, 메트로놈과 코드 표시를 제공합니다. |
| 라이브러리 | 브라우저 로컬 저장소를 이용해 작업 이름, 폴더, 고정 상태를 유지하고 이전 완료 작업을 다시 불러옵니다. |
| 내보내기 | 선택한 스템의 믹스 오디오 또는 DAW에 가져가기 좋은 정렬된 개별 스템 ZIP을 생성합니다. |
| 저장 공간 최적화 | `ffmpeg`가 있으면 stem WAV를 AAC `.m4a`로 압축하고, 원본·중간 파일·무음 fallback 파일을 정리합니다. |
| 안전한 대체 동작 | 선택 도구가 없어도 서버가 중단되지 않으며, 결과와 경고를 함께 반환합니다. |

## 처리 흐름

```text
MP3/WAV 업로드
  → WAV 변환 (ffmpeg)
  → 6-스템 분리 (Demucs)
  → BPM · 키 · 코드 · 파형 분석 (librosa)
  → MIDI 추출 (Basic Pitch)
  → 압축 · 결과 저장 · 브라우저에서 재생/내보내기
```

괄호 안의 도구는 선택 설치 항목입니다. 설치되지 않은 환경에서도 작업은 완료되지만, 실제 분리·정밀 분석·MIDI 추출 대신 대체 결과가 제공될 수 있습니다. 화면과 API의 `warnings`로 적용된 대체 동작을 확인할 수 있습니다.

## 빠른 시작

### 요구 사항

- macOS, Linux 또는 Windows 환경
- Python 3.11 권장 (실행 스크립트는 `python3`도 지원)
- Node.js 18 이상 및 npm
- `ffmpeg` 권장 — MP3 변환과 `.m4a` 압축 저장에 사용

### 가장 쉬운 실행 방법 (macOS)

프로젝트 최상위에서 아래 파일을 더블 클릭하거나 터미널에서 실행하세요. 필요한 가상환경과 기본 의존성을 준비한 뒤 백엔드와 프론트엔드를 함께 시작합니다.

```bash
./start.command
```

준비가 끝나면 브라우저에서 `http://localhost:5173`이 열립니다. 실행 중인 터미널을 종료하면 이 스크립트가 시작한 서버도 함께 종료됩니다.

### 수동 실행

백엔드와 프론트엔드를 각각 별도 터미널에서 시작할 수 있습니다.

```bash
# 터미널 1 — Backend
cd backend
python3.11 -m venv .venv311
source .venv311/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
# 터미널 2 — Frontend
cd frontend
npm install
npm run dev
```

브라우저에서 [http://localhost:5173](http://localhost:5173)을 엽니다. 개발 서버는 `/api` 요청을 `http://localhost:8000`으로 전달합니다.

### 권장 분석 도구 설치

정확한 변환과 실제 스템 분리·분석·MIDI 추출을 사용하려면 다음을 설치하세요.

```bash
# macOS 예시
brew install ffmpeg

# 활성화한 Python 가상환경에서, 프로젝트 최상위 기준
pip install -r backend/requirements-optional.txt
```

첫 Demucs 또는 Basic Pitch 실행은 모델 다운로드 때문에 시간이 오래 걸릴 수 있습니다.

## 사용 방법

1. 화면의 업로드 메뉴에서 `.mp3` 또는 `.wav` 파일을 선택합니다.
2. 진행 상태를 보며 변환, stem 분리, 분석, MIDI 생성이 끝날 때까지 기다립니다.
3. 타임라인을 재생하면서 파트별 음소거·솔로·볼륨·팬을 조절하고 BPM, 키, 코드 진행을 확인합니다.
4. 내보내기에서 원하는 스템을 고른 뒤 믹스 파일 또는 개별 stem ZIP을 내려받습니다.

완료된 작업은 서버의 저장소와 브라우저 라이브러리에 남습니다. 더 이상 필요하지 않은 곡은 라이브러리에서 삭제해 디스크 공간을 비울 수 있습니다.

## 결과물과 저장 위치

작업마다 `backend/storage/jobs/<job_id>/` 아래에 다음 결과가 생성됩니다. 배포 환경에서는 `MUSIC_APP_DATA_DIR`로 저장 위치를 바꿀 수 있습니다.

```text
backend/storage/jobs/<job_id>/
├── job.json                # 작업 상태와 경고
├── analysis.json           # BPM, 키, 코드, 파형, asset URL
├── stems/
│   ├── vocals.m4a          # ffmpeg가 없으면 .wav
│   ├── drums.m4a
│   ├── bass.m4a
│   ├── guitar.m4a
│   ├── piano.m4a
│   └── other.m4a
└── midi/
    ├── vocals.mid
    ├── drums.mid
    ├── bass.mid
    ├── guitar.mid
    ├── piano.mid
    └── other.mid
```

분리와 분석 품질은 원본 믹스, 설치된 모델과 도구, 컴퓨팅 자원에 따라 달라집니다. 코드·키 추정과 자동 MIDI는 창작/편곡의 출발점으로 확인하고, 상업적·정밀 작업 전에는 귀로 검토하세요.

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `MUSIC_FAST_UPLOAD` | `1` | `1`이면 시간이 오래 걸리는 Basic Pitch 추론을 건너뛰고 placeholder MIDI를 생성합니다. 실제 MIDI 추출은 `0`으로 설정합니다. |
| `MUSIC_STEM_BITRATE` | `80k` | `ffmpeg` 사용 시 stem `.m4a`의 AAC 비트레이트입니다. 예: `96k`, `160k`. 값이 높을수록 파일은 커집니다. |
| `MUSIC_APP_DATA_DIR` | `backend/storage` | 업로드 파일과 작업 결과를 저장할 디렉터리입니다. |
| `CORS_ORIGINS` | localhost만 허용 | 쉼표로 구분한 배포 프론트엔드 origin입니다. 예: `https://example.netlify.app`. |

전체 MIDI 추출 모드로 백엔드를 실행하는 예시입니다.

```bash
cd backend
MUSIC_FAST_UPLOAD=0 uvicorn app.main:app --reload --port 8000
```

## API 요약

| 메서드 | 경로 | 용도 |
| --- | --- | --- |
| `GET` | `/api/health` | 서버 상태 확인 |
| `POST` | `/api/jobs` | `file` multipart 필드로 MP3/WAV 업로드 및 분석 작업 생성 |
| `GET` | `/api/jobs` | 저장된 작업 목록 조회 |
| `GET` | `/api/jobs/{job_id}` | 진행 상태·경고 조회 |
| `GET` | `/api/jobs/{job_id}/analysis` | 완료된 분석 데이터 조회 |
| `GET` | `/api/jobs/{job_id}/assets/{asset_path}` | stem 또는 MIDI 에셋 내려받기 |
| `GET` | `/api/jobs/{job_id}/export/mix` | 전체 stem 믹스 내보내기 |
| `GET` | `/api/jobs/{job_id}/export/stems` | 선택 stem 믹스 또는 개별 stem ZIP 내보내기 |
| `DELETE` | `/api/jobs/{job_id}` | 작업 결과와 업로드 원본 삭제 |

## 배포

기본 배포 구성은 정적 프론트엔드를 Netlify에, 오디오 처리 백엔드를 Render Docker Web Service에 두는 방식입니다.

1. Render에서 `render.yaml`을 사용해 `backend/Dockerfile` 기반 서비스를 만듭니다.
2. Render의 `CORS_ORIGINS`를 실제 Netlify 도메인으로 바꿉니다.
3. Netlify에 프론트엔드를 배포하고 다음 환경 변수를 설정합니다.

```bash
VITE_API_BASE=https://your-backend-domain.onrender.com
```

Render 설정은 결과 보존을 위해 `/app/storage`에 persistent disk를 마운트합니다. 실제 운영 전에는 파일 크기 제한, 인증, 사용자별 격리, 작업 큐/워커 확장 및 보존 정책을 추가하는 것을 권장합니다.

## 프로젝트 구조

```text
backend/
├── app/main.py             # FastAPI API, 업로드, 작업 큐, 에셋/내보내기 API
├── app/processor.py        # 변환·분리·분석·MIDI·압축 파이프라인
├── requirements.txt        # 필수 Python 의존성
└── requirements-optional.txt
frontend/
├── src/App.tsx             # DAW 스타일 작업 화면
├── src/api.ts              # 백엔드 API 클라이언트
└── src/styles.css          # UI 스타일
start.command               # 로컬 원클릭 실행 스크립트
render.yaml                 # Render 배포 설정
netlify.toml                # Netlify 빌드·SPA 라우팅 설정
```

## 개인정보 및 사용 시 유의 사항

- 기본 구성은 외부 유료 음악 분석 API를 호출하지 않습니다.
- 로컬 실행 시 업로드 파일과 결과는 내 컴퓨터의 저장소에 보관됩니다.
- 배포 서버에서는 업로드 파일과 생성물이 서버의 persistent disk에 저장됩니다. 타인의 음악을 업로드하거나 공유할 때는 저작권과 서비스 정책을 지켜야 합니다.
- 이 프로젝트는 MVP입니다. 공개 서비스에 적용하려면 인증, 접근 제어, 업로드 제한, 악성 파일 검사, 백그라운드 작업 처리와 모니터링을 별도로 구성하세요.

## 라이선스

이 프로젝트는 [MIT License](LICENSE)로 배포됩니다. 자세한 조건은 [LICENSE](LICENSE) 파일을 확인하세요.

---

<a id="english"></a>

## English

### What it is

Local Music Analysis MVP is a local-first, Moises Studio–style music workspace. Upload an MP3 or WAV to separate stems, inspect tempo/key/chords, preview each part in a DAW-like player, generate MIDI starting points, and export mixes or aligned stems for your DAW.

### Highlights

- Six-stem separation: vocals, drums, bass, guitar, piano, and other (with Demucs installed)
- BPM, beat grid, key/mode, chroma-based chord timeline, and waveform analysis (with librosa installed)
- Per-stem mute, solo, volume, pan, playback controls, metronome, and local library metadata
- MIDI extraction with Basic Pitch, or fast placeholder MIDI by default
- Mix and individually aligned stem ZIP exports
- Graceful fallbacks and in-product warnings when optional processing tools are unavailable

### Run locally

Requirements: Python 3.11 recommended, Node.js 18+, npm, and optionally `ffmpeg` plus the packages in `backend/requirements-optional.txt`.

```bash
# Easiest on macOS
./start.command
```

Or start the services separately:

```bash
cd backend
python3.11 -m venv .venv311
source .venv311/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). To enable full Basic Pitch inference, launch the backend with `MUSIC_FAST_UPLOAD=0`.

### Important notes

Optional tools are intentionally non-fatal. Without them, jobs still finish using fallback assets/data and report warnings; install `ffmpeg`, Demucs, librosa, and Basic Pitch for production-quality processing. Separation, chord/key detection, and automatic MIDI are estimates and should be reviewed by ear before critical or commercial use.

See the Korean documentation above for output layout, environment variables, API routes, deployment guidance, data handling, and operational recommendations.

### License

Released under the [MIT License](LICENSE).
