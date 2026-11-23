# Local Music Analysis MVP

> 내 음악 파일을 업로드하면 스템 분리, BPM·조성·코드 분석, MIDI 추출과 오디오 내보내기를 한 작업 공간에서 제공하는 로컬 우선 음악 분석 도구입니다.

**한국어** | [English](#english) | [사용 약관 / Terms of Use](TERMS.md)

## 제품 소개

`Local Music Analysis MVP`는 프로듀서, 연주자, 리믹서가 곡의 구성을 빠르게 파악하고 작업용 소스를 준비할 수 있도록 만든 Moises Studio 스타일의 웹 애플리케이션입니다. MP3 또는 WAV 파일을 업로드하면 백엔드의 분석 작업이 진행되고, DAW 분위기의 화면에서 파트별 오디오를 듣고 분석 결과를 확인할 수 있습니다.

핵심은 복잡한 오디오 처리 과정을 한 번의 업로드로 연결한다는 점입니다. 곡을 보컬·드럼·베이스·기타·피아노·기타 파트로 나누고, 템포와 박자 위치, 키와 모드, 코드 진행을 타임라인으로 제공합니다. 필요한 스템을 선택해 믹스 파일이나 개별 파일 묶음으로 내려받을 수도 있습니다.

## 이런 작업에 적합합니다

- 연습·카피 전에 곡의 BPM, 키, 코드 진행을 빠르게 확인할 때
- 보컬·드럼 등 특정 파트의 소리를 줄이거나 솔로로 들어볼 때
- 리믹스, 편곡, 연주 연습을 위한 스템 파일을 준비할 때
- 분석 결과와 MIDI 초안을 출발점으로 DAW 작업을 시작할 때

## 주요 기능

| 기능             | 설명                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| MP3 / WAV 업로드 | 두 형식의 오디오 파일을 업로드해 비동기 작업으로 처리합니다.                                                                   |
| 6-스템 분리      | Demucs `htdemucs_6s`가 설치된 경우 보컬, 드럼, 베이스, 기타, 피아노, 기타(Other)로 분리합니다.                                 |
| 음악 정보 분석   | `librosa` 기반으로 길이, BPM, 비트 그리드, 키/모드, 크로마 기반 코드 타임라인을 계산합니다.                                    |
| MIDI 파일 생성   | Basic Pitch를 사용할 수 있으면 스템별 MIDI를 추출합니다. 기본 빠른 모드에서는 즉시 사용할 수 있는 placeholder MIDI를 만듭니다. |
| DAW형 플레이어   | 스템별 음소거·솔로·볼륨·팬, 파형 레인, 재생 위치, 메트로놈과 코드 표시를 제공합니다.                                           |
| 라이브러리       | 브라우저 로컬 저장소를 이용해 작업 이름, 폴더, 고정 상태를 유지하고 이전 완료 작업을 다시 불러옵니다.                          |
| 내보내기         | Instrumental, 전체·선택 믹스, 개별 스템, 스템 ZIP을 WAV·FLAC·M4A로 내보냅니다.                                          |
| 저장 공간 최적화 | 분리된 PCM WAV를 보존하고, FLAC·M4A는 다운로드할 때 생성합니다.                            |
| 안전한 대체 동작 | 분리 실패 시 원인을 표시하고, 원본의 BPM·키·코드 분석은 계속합니다.                                                      |

## 처리 흐름

```text
MP3/WAV 업로드
  → 업로드 검증 · 작업 대기열 (Go 또는 FastAPI)
  → WAV 변환 (FFmpeg)
  → 6-스템 분리 (Demucs MLX · PyTorch MPS · CPU)
  → BPM · 키 · 코드 분석 (librosa) 및 스템 파형 계산 (Rust 또는 Python)
  → MIDI 추출 (Basic Pitch)
  → PCM WAV 저장 · 브라우저에서 재생/내보내기
```

Demucs를 실행할 수 없으면 스템 분리 오류가 표시됩니다. 키·코드 또는 MIDI에 대체 결과가 쓰인 경우에는 화면과 API의 `warnings`에서 확인할 수 있습니다.

## 빠른 시작

### 요구 사항

- macOS, Linux 또는 Windows 환경
- Python 3.11 (`start.command` 사용 시)
- Node.js 20 이상 및 npm
- `ffmpeg` 권장 — MP3 변환, 오디오 믹스, FLAC·M4A 내보내기에 사용

### 가장 쉬운 실행 방법 (macOS)

프로젝트 최상위에서 아래 파일을 더블 클릭하거나 터미널에서 실행하세요. 필요한 가상환경과 기본 의존성을 준비한 뒤 백엔드와 프론트엔드를 함께 시작합니다.

```bash
./start.command
```

준비가 끝나면 브라우저에서 `http://localhost:8282`이 열립니다. 실행 중인 터미널을 종료하면 이 스크립트가 시작한 서버도 함께 종료됩니다.

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

브라우저에서 [http://localhost:8282](http://localhost:8282)을 엽니다. 개발 서버는 `/api` 요청을 `http://localhost:8000`으로 전달합니다.

### 권장 분석 도구 설치

정확한 변환과 실제 스템 분리·분석·MIDI 추출을 사용하려면 다음을 설치하세요.

```bash
# macOS 예시
brew install ffmpeg

# 활성화한 Python 가상환경에서, 프로젝트 최상위 기준
pip install -r backend/requirements-optional.txt
```

macOS Apple Silicon에서는 Python 3.11과 네이티브 arm64 PyTorch를 사용합니다. `start.command`는 가상환경에 필요한 패키지가 없으면 설치 여부를 묻고, Demucs 실행과 모델 캐시를 확인합니다. `htdemucs_6s`는 첫 분리 작업에서 모델을 내려받으므로 인터넷과 캐시 저장 공간이 필요합니다. 모델을 먼저 준비하려면 다음을 실행하세요.

```bash
backend/.venv311/bin/python -c 'from demucs.pretrained import get_model; print(get_model("htdemucs_6s").sources)'
```

## 사용 방법

1. 업로드 창에서 Standard 또는 High Quality를 고르고 MP3/WAV 파일을 선택합니다. Standard는 shifts 1·overlap 0.25, High Quality는 shifts 3·overlap 0.50으로 분리합니다. High Quality는 처리 시간이 길고 개선 폭은 곡마다 다릅니다.
2. 분리 상태를 확인합니다. 분리에 실패한 곡은 오류와 BPM·키·코드 분석을 볼 수 있습니다. 스템 재생과 스템 내보내기는 6개 스템이 모두 준비된 곡에서 사용할 수 있습니다.
3. 내보내기에서 출력 형식을 고른 뒤 **Instrumental 다운로드**, 전체 믹스, 개별 스템 또는 **6개 스템 ZIP 다운로드**를 사용합니다. Instrumental은 보컬을 제외한 5개 스템을 합성합니다. 스템 합이 피크 한도를 넘을 때만 전체에 같은 감쇠를 적용합니다. 내보내기에는 플레이어의 Solo·Mute·Volume·Pan 설정이 적용되지 않습니다.
4. DAW 편집에는 샘플 정렬을 유지하는 WAV 또는 FLAC을 사용하세요. WAV는 모델이 생성한 24비트 PCM을 그대로 제공하고, FLAC은 같은 PCM 샘플을 압축합니다. AAC로만 저장된 이전 작업은 그대로 변환할 수 있으며 손실된 신호는 복원할 수 없습니다. 이전 작업의 파형은 새로 분리할 때 생성됩니다.

## 결과물과 저장 위치

작업마다 `backend/storage/jobs/<job_id>/` 아래에 다음 결과가 생성됩니다. 배포 환경에서는 `MUSIC_APP_DATA_DIR`로 저장 위치를 바꿀 수 있습니다.

```text
backend/storage/jobs/<job_id>/
├── job.json                # 작업 상태와 경고
├── analysis.json           # BPM, 키, 코드, 파형, asset URL
├── stems/
│   ├── vocals.wav          # 분리 성공 시 24-bit PCM
│   ├── drums.wav
│   ├── bass.wav
│   ├── guitar.wav
│   ├── piano.wav
│   └── other.wav
└── midi/
    ├── vocals.mid
    ├── drums.mid
    ├── bass.mid
    ├── guitar.mid
    ├── piano.mid
    └── other.mid
```

분리 모델은 자체 샘플레이트와 채널 구성으로 출력합니다. 현재 모델에서 스테레오 44.1kHz 24비트 WAV 6개는 곡 1분당 약 95MB를 사용합니다. 변환 중간 파일과 내보내기 임시 파일은 정리되며, 저장된 WAV는 라이브러리에서 곡을 삭제할 때 제거됩니다.

분리와 분석 품질은 원본 믹스, 설치된 모델과 도구, 컴퓨팅 자원에 따라 달라집니다. 코드·키 추정과 자동 MIDI는 창작/편곡의 출발점으로 확인하고, 상업적·정밀 작업 전에는 귀로 검토하세요.

## 하이브리드 백엔드 실행

```bash
brew install go rust
MUSIC_BACKEND=hybrid MUSIC_FAST_UPLOAD=0 ./start.command
```

Go 1.24 이상과 Rust가 있으면 실행 스크립트가 Go API, Rust 파형 실행 파일과 Rust DSP 라이브러리를 빌드합니다. 이미 빌드한 파일도 사용할 수 있습니다. 위 명령은 실제 Basic Pitch MIDI 추출을 켭니다. 기본 실행 모드는 사용 가능한 하이브리드 백엔드를 선택하고, 준비가 되지 않은 경우 기존 FastAPI로 실행합니다. `MUSIC_BACKEND=python ./start.command`로 FastAPI를 직접 선택할 수 있습니다. 브라우저 주소는 [localhost:8282](http://localhost:8282/)입니다. 기존 백엔드가 8000번 포트에서 실행 중이면 종료한 뒤 모드를 변경하세요.

| 위치 | 역할 |
| --- | --- |
| `backend/go` | 공개 HTTP API, 스트리밍 업로드, 제한된 작업 큐, 중복 감지, 캐시 목록, 취소·삭제, 오디오 범위 전송, DAW용 WAV ZIP |
| `backend/rust` | PCM WAV 파형 피크와 Harmonic 필터의 중앙값 계산 |
| `backend/app/hybrid_worker.py` | 전용 Unix 소켓에서 처리 요청을 받는 Python 워커 |
| `backend/app/processor.py`, `separation.py`, `mlx_stems.py` | 디코딩, Demucs MLX·MPS·CPU, librosa BPM·키·코드, Basic Pitch |
| `backend/app/exports.py` | FFmpeg 믹스와 포맷 변환, 이전 형식·FLAC·M4A ZIP |
| `backend/app/main.py` | 기존 FastAPI 실행 모드와 공유 내보내기 API |

Go와 Python은 같은 저장소의 `job.json`과 결과 파일을 사용합니다. Unix 소켓의 처리 요청에는 작업 ID와 캐시 목록이 전달됩니다. Rust 파형 실행 파일은 WAV 경로를 받아 피크를 JSON으로 돌려줍니다. Python 분석 워커는 Rust DSP 라이브러리에서 Harmonic 필터의 두 중앙값 계산을 실행합니다. STFT, 마스크, 역변환과 Chroma는 librosa가 처리합니다. Rust 라이브러리를 불러올 수 없으면 librosa가 필터링 전부를 처리합니다.

저장소에는 한 번에 서버 하나만 연결할 수 있습니다. Go는 기본 작업자 1개를 사용하며 `MUSIC_JOB_WORKERS`와 `MUSIC_MAX_PENDING_JOBS`로 한도를 조정할 수 있습니다. 16GB 시스템에서 긴 곡을 동시에 여러 개 분리할 때의 메모리 피크는 별도 측정이 필요합니다. 실행 중 파일 삭제는 409를 반환합니다. Go에서 작업을 취소하려면 다음 API를 사용합니다. 대기 작업은 즉시 취소되며, 실행 중 작업은 추론·DSP 프로세스 정리 또는 Python 분석 단계의 종료 후 상태가 갱신됩니다.

```bash
curl -X POST http://127.0.0.1:8000/api/jobs/JOB_ID/cancel
```

스템 캐시와 BPM·키·코드 캐시는 별개입니다. 입력과 분석 라이브러리 버전이 같다면 분리 엔진이나 품질을 바꾸어도 저장된 음악 분석을 재사용할 수 있습니다. Basic Pitch는 작업당 모델 하나를 여섯 스템에 사용합니다. Basic Pitch 0.4.0의 Core ML 경로는 한 번에 최대 8개 입력 창을 추론하고, 배치 실행에 실패하면 기존 단일 창 경로로 다시 시도합니다. 동일한 WAV를 재사용할 때는 모델·의존성 정보와 파일 체크섬이 일치하는 실제 MIDI도 재사용합니다.

`MUSIC_PARALLEL_ANALYSIS=long`은 120초 이상에서 원본 음악 분석과 스템 분리를 겹쳐 실행합니다. 120초 미만은 원본 분석을 분리 후 시작합니다. `0`으로 순차 실행을 강제하고 `1`로 모든 길이에 병렬 실행을 선택할 수 있습니다. 기존 Docker·Render 구성은 FastAPI를 계속 사용합니다.

## Apple Silicon 가속

업로드 창의 분리 엔진에서 **PyTorch MPS** 또는 **Fast · MLX**를 선택할 수 있습니다. 서버 기본값은 기존 PyTorch 경로입니다. Standard와 High Quality는 어느 엔진에서도 같은 shifts와 overlap 설정을 사용합니다. 가속 엔진을 실행하거나 결과를 검증하는 데 실패하면, 오류를 표시하고 같은 품질 설정으로 PyTorch CPU에서 다시 시도합니다.

PyTorch MPS는 기존 PyTorch 가상환경을 사용합니다. 새 환경에서 Fast · MLX를 준비하려면 별도의 가상환경에 검증한 버전을 설치합니다.

```bash
python3.11 -m venv backend/.venv-mlx
backend/.venv-mlx/bin/python -m pip install 'demucs-mlx==1.6.1'
```

첫 MLX 분리에서는 `htdemucs_6s`의 별도 가중치를 내려받습니다. 기본 위치는 `~/.cache/demucs-mlx`입니다. **스템만 분리**를 선택하면 BPM·키·코드 및 MIDI를 생략합니다. 스템 파형과 내보내기는 사용할 수 있습니다.

같은 입력·엔진·모델·품질로 완료된 WAV가 남아 있으면 새 작업에서 이를 재사용합니다. 파일 이름이나 분석·MIDI 옵션이 바뀌어도 이미 분리된 WAV는 재사용할 수 있습니다. 각 항목은 라이브러리에서 개별 삭제할 수 있습니다.

### M5 16GB 하이브리드 최적화 벤치마크

같은 합성 MP3를 MLX Standard 및 실제 Basic Pitch MIDI 설정으로 처리했습니다. 각 조건은 3회 측정한 중앙값이며, 업로드부터 완료까지의 시간입니다. 첫 실행은 가중치가 준비된 새 서버에서 측정했습니다. 반복 실행은 이전 결과를 삭제해 실제 추론을 수행했고, 캐시 적중은 완료 결과를 유지한 뒤 다시 업로드해 측정했습니다.

| 입력 길이 | 첫 실행 | 반복 실행 · 캐시 미적중 | 캐시 적중 |
| --- | ---: | ---: | ---: |
| 60초 | 10.85 → 7.07초 | 7.84 → 4.65초 | 2.30 → 0.27초 |
| 180초 | 21.47 → 15.96초 | 17.81 → 14.89초 | 9.03 → 0.66초 |
| 300초 | 38.93 → 29.85초 | 36.35 → 29.73초 | 18.88 → 0.94초 |

검증한 입력에서 BPM·키·코드·파형은 일치했고, 스템 WAV와 MIDI는 바이트 단위로 일치했습니다. 단계별 시간, 메모리와 테스트 범위는 [백엔드 벤치마크](backend/README.md#hybrid-pipeline-optimization)를 참고하세요.

### 이전 엔진 비교 벤치마크

같은 60초 합성 MP3로 테스트했습니다. 전체 처리 시간은 업로드 대기열과 다운로드를 제외하고 WAV 변환부터 결과 저장까지이며, 실제 Basic Pitch 추출을 포함했습니다. 첫 작업은 새 앱 프로세스 기준이며, 가중치와 운영체제의 GPU 캐시가 준비된 상태에서 측정했습니다.

| 처리 단계 | 변경 전 CPU 첫 작업 / 반복 | 변경 후 MLX 첫 작업 / 반복 |
| --- | ---: | ---: |
| MP3 → WAV | 0.09초 / 0.06초 | 0.08초 / 0.06초 |
| 분리 전체 (모델 시작·추론·WAV 저장·검증) | 13.69초 / 13.43초 | 2.90초 / 2.71초 |
| BPM·키·코드 및 스템 파형 | 3.50초 / 1.95초 | 3.41초 / 1.79초 |
| 실제 MIDI 추출 | 3.24초 / 2.21초 | 3.31초 / 2.16초 |
| 결과 저장 | 0.002초 / 0.002초 | 0.002초 / 0.002초 |
| 전체 작업 | 20.52초 / 17.65초 | 9.71초 / 6.72초 |
| Instrumental WAV 내보내기 | 0.13초 / 0.13초 | 0.12초 / 0.12초 |

별도 추론 벤치마크는 같은 입력의 WAV와 Standard 설정을 사용했습니다. 첫 추론과 같은 프로세스 내 반복 두 번의 중앙값을 측정했습니다. 메모리는 macOS `/usr/bin/time -l`의 프로세스 최대 메모리 풋프린트입니다.

| 엔진 | 모델 로드 | 첫 추론 | 모델 준비 후 반복 | 최대 메모리 |
| --- | ---: | ---: | ---: | ---: |
| PyTorch CPU | 0.24초 | 12.14초 | 13.49초 | 2.14 GiB |
| PyTorch MPS | 0.19초 | 10.29초 | 5.96초 | 3.89 GiB |
| MLX FP32 | 0.11초 | 7.88초 | 2.59초 | 5.07 GiB |

세 엔진 모두 6개 스테레오 44.1kHz 24비트 PCM WAV를 채널당 2,646,000샘플로 출력했습니다. Standard에서 CPU 스템과 비교한 파형 SNR은 MPS 96.9–123.4dB, MLX 44.1–60.9dB였습니다. High Quality에서 같은 시프트 시드로 비교한 MLX 결과는 49.7–61.3dB였으며, 6개 파일의 길이와 포맷도 일치했습니다. SNR은 CPU 출력을 기준으로 한 파형 일치도입니다.

MLX의 스템 전용 작업은 2.81초, 재사용한 스템 전용 API 요청은 0.32초였습니다. 180초 음원은 MLX에서 7.03초, 최대 6.56 GiB로 분리했습니다. 가속 모델은 작업마다 별도 프로세스에서 불러오고 종료 시 해제합니다. 모델 최초 다운로드 속도, 실제 Suno 음원의 청감 품질, 최대 길이 20분의 메모리 사용량은 미검증입니다.

초기 하이브리드 전환의 60초·180초 비교와 API 처리량은 [백엔드 벤치마크](backend/README.md#hybrid-release-validation)를 참고하세요.

## 환경 변수

| 이름                 | 기본값            | 설명                                                                                                                       |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `MUSIC_FAST_UPLOAD`  | `1`               | `1`이면 시간이 오래 걸리는 Basic Pitch 추론을 건너뛰고 placeholder MIDI를 생성합니다. 실제 MIDI 추출은 `0`으로 설정합니다. |
| `MUSIC_STEM_BITRATE` | `256k` | 개별 스템 및 믹스 M4A의 AAC 비트레이트 |
| `MUSIC_EXPORT_BITRATE` | 스템 비트레이트와 동일 | 믹스·Instrumental M4A에만 적용할 AAC 비트레이트 |
| `MUSIC_ENABLE_DEMUCS` | 로컬 `1` / Docker·Render `0` | 분리 활성화 |
| `MUSIC_DEMUCS_DEVICE` | `cpu` | 기본 PyTorch 추론 장치 |
| `MUSIC_SEPARATION_ENGINE` | `torch` | 서버 기본 엔진. `torch`, `mps`, `mlx` |
| `MUSIC_MLX_PYTHON` | `backend/.venv-mlx/bin/python` | 별도 MLX 가상환경의 Python 경로 |
| `DEMUCS_MLX_CACHE_DIR` | `~/.cache/demucs-mlx` | MLX 가중치 저장 경로 |
| `MUSIC_DEMUCS_REPO` | 모델 기본 캐시 | 이미 준비한 Demucs 모델 저장소 경로 |
| `MUSIC_DEMUCS_TIMEOUT_SECONDS` | `3600` | 모델 준비와 분리의 최대 실행 시간 |
| `MUSIC_MAX_UPLOAD_MB` / `MUSIC_MAX_DURATION_SECONDS` | `150` / `1200` | 업로드 최대 크기와 오디오 최대 길이 |
| `MUSIC_BACKEND` | `auto` | 로컬 실행 모드. `auto`, `hybrid`, `python` |
| `MUSIC_JOB_WORKERS` | `1` | Go 백엔드에서 동시에 실행하는 작업 수 |
| `MUSIC_MAX_PENDING_JOBS` | `8` | 실행 중인 작업을 포함한 최대 대기열 크기 |
| `MUSIC_APP_DATA_DIR` | `backend/storage` | 업로드 파일과 작업 결과를 저장할 디렉터리입니다.                                                                           |
| `CORS_ORIGINS`       | localhost만 허용  | 쉼표로 구분한 배포 프론트엔드 origin입니다. 예: `https://example.netlify.app`.                                             |

전체 MIDI 추출 모드로 백엔드를 실행하는 예시입니다.

```bash
cd backend
MUSIC_FAST_UPLOAD=0 uvicorn app.main:app --reload --port 8000
```

## API 요약

| 메서드   | 경로                                     | 용도                                                     |
| -------- | ---------------------------------------- | -------------------------------------------------------- |
| `GET`    | `/api/health`                            | 서버 상태 확인                                           |
| `POST`   | `/api/jobs`                              | multipart `file`, 선택적 `quality`·`engine`·`music_analysis`·`midi`로 작업 생성 |
| `GET`    | `/api/jobs`                              | 저장된 작업 목록 조회                                    |
| `GET`    | `/api/jobs/{job_id}`                     | 진행 상태·경고 조회                                      |
| `GET`    | `/api/jobs/{job_id}/analysis`            | 완료된 분석 데이터 조회                                  |
| `GET`    | `/api/jobs/{job_id}/assets/{asset_path}` | stem 또는 MIDI 에셋 내려받기                             |
| `GET`    | `/api/jobs/{job_id}/export/mix`          | 전체 스템 믹스 내보내기. `format=wav\|flac\|m4a`                                  |
| `GET`    | `/api/jobs/{job_id}/export/stems`        | 반복 `stem` 파라미터, `mode=mix\|single\|zip`, `format=wav\|flac\|m4a`. ZIP에서 스템을 생략하면 전체 내보내기               |
| `GET` | `/api/jobs/{job_id}/export/instrumental` | 보컬을 제외한 5개 스템 믹스. 기본 형식은 WAV |
| `POST` | `/api/jobs/{job_id}/cancel` | Go 백엔드에서 대기 또는 실행 중인 작업 취소 |
| `DELETE` | `/api/jobs/{job_id}`                     | 작업 결과와 업로드 원본 삭제                             |

## 배포

기본 배포 구성은 정적 프론트엔드를 Netlify에, 오디오 처리 백엔드를 Render Docker Web Service에 두는 방식입니다.

1. Render에서 `render.yaml`을 사용해 `backend/Dockerfile` 기반 서비스를 만듭니다.
2. Render의 `CORS_ORIGINS`를 실제 Netlify 도메인으로 바꿉니다.
3. Netlify에 프론트엔드를 배포하고 다음 환경 변수를 설정합니다.

```bash
VITE_API_BASE=https://your-backend-domain.onrender.com
```

기본 Render 설정은 BPM·키·코드 분석을 제공하고 Demucs는 비활성화합니다. 업로드 한도는 40MB·5분이며, 실행 중 및 대기 중인 작업을 합해 최대 2개를 받습니다. 분리가 필요한 자체 Docker 환경에서는 `--build-arg INSTALL_AUDIO_MODELS=1`로 이미지를 빌드하고 `MUSIC_ENABLE_DEMUCS=1`로 실행하세요. 모델 캐시와 `/app/storage`의 영구 디스크를 지정하고, 해당 환경에서 처리 시간과 메모리 사용량을 측정하세요.

Render의 FastAPI는 단일 Uvicorn 프로세스에서 분석 작업을 하나씩 처리합니다. 기다리는 작업은 삭제로 취소할 수 있고, 실행 중인 작업을 삭제하면 409를 반환합니다. 서버 재시작으로 작업이 중단되면 작업 화면에 표시됩니다.

## 프로젝트 구조

```text
backend/
├── go/                     # Go API, 작업 큐, 캐시, 파일 제공과 WAV ZIP
├── rust/                   # WAV 파형 DSP 및 Harmonic 중앙값 필터
├── app/hybrid_worker.py    # Go 백엔드의 Python 추론 워커
├── app/main.py             # FastAPI 모드 및 공유 API
├── app/processor.py        # 변환·분리·분석·MIDI 파이프라인
├── app/exports.py          # 믹스·개별 스템·ZIP 내보내기
├── requirements.txt        # 필수 Python 의존성
└── requirements-optional.txt
frontend/
├── src/App.tsx             # DAW 스타일 작업 화면
├── src/api.ts              # 백엔드 API 클라이언트
└── src/styles.css          # Tailwind CSS v4 및 파형·타임라인 스타일
start.command               # 로컬 원클릭 실행 스크립트
render.yaml                 # Render 배포 설정
netlify.toml                # Netlify 빌드·SPA 라우팅 설정
```

프론트엔드는 React 18, TypeScript, Vite와 Tailwind CSS v4를 사용합니다. Tailwind는 Vite 플러그인으로 빌드하고, 파형과 타임라인에는 기존 동적 스타일을 사용합니다. Netlify 프로젝트에 이전 Node.js 버전이 고정돼 있다면 20 이상을 선택하세요.

## 개인정보 및 사용 시 유의 사항

- 기본 구성은 외부 유료 음악 분석 API를 호출하지 않습니다.
- 로컬 실행 시 업로드 파일과 결과는 내 컴퓨터의 저장소에 보관됩니다.
- 배포 서버에서는 업로드 파일과 생성물이 서버의 persistent disk에 저장됩니다. 타인의 음악을 업로드하거나 공유할 때는 저작권과 서비스 정책을 지켜야 합니다.
- 이 프로젝트는 MVP입니다. 공개 서비스에 적용하려면 인증, 접근 제어, 업로드 제한, 악성 파일 검사, 백그라운드 작업 처리와 모니터링을 별도로 구성하세요.

## 라이선스

프로젝트 코드는 [PolyForm Noncommercial License 1.0.0](LICENSE)에 따라 제공됩니다. 비상업적 사용, 재배포 시 고지, 업로드 음원과 파생 파일의 이용, 저장 방식은 [사용 약관](TERMS.md)에서 확인할 수 있습니다. 이전 MIT 배포본의 저작권 및 허가 고지는 [LICENSE-LEGACY-MIT](LICENSE-LEGACY-MIT)에 있습니다.

---

<a id="english"></a>

## English

### What it is

Local Music Analysis MVP is a local-first, Moises Studio–style music workspace. Upload an MP3 or WAV to separate stems, inspect tempo/key/chords, preview each part in a DAW-like player, generate MIDI starting points, and export mixes or aligned stems for your DAW.

### Highlights

- Six-stem separation with Demucs via Apple MLX, PyTorch MPS, or CPU
- Local Go API with Rust waveform and harmonic filtering, shared Python inference, and standalone FastAPI
- Bounded Core ML MIDI batches and validated reuse of MIDI from identical stem WAVs
- React, TypeScript, and Tailwind CSS v4 through the Vite plugin
- BPM, beat grid, key/mode, chroma-based chord timeline, and waveform analysis (with librosa installed)
- Per-stem mute, solo, volume, pan, playback controls, metronome, and local library metadata
- MIDI extraction with Basic Pitch, or fast placeholder MIDI by default
- Mix and individually aligned stem ZIP exports
- Explicit separation failures while tempo, key, and chord analysis can still finish

### Run locally

Requirements: Python 3.11 recommended, Node.js 20+, npm, and optionally `ffmpeg` plus the packages in `backend/requirements-optional.txt`.

```bash
# Easiest on macOS
./start.command
```

For the hybrid backend, install Go 1.24 or later and Rust, then run `MUSIC_BACKEND=hybrid ./start.command`. To select FastAPI explicitly, run `MUSIC_BACKEND=python ./start.command`.

You can also start FastAPI and the frontend in separate terminals.

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

Open [http://localhost:8282](http://localhost:8282). To enable full Basic Pitch inference, launch the backend with `MUSIC_FAST_UPLOAD=0`.

### Important notes

Install FFmpeg and the optional Python requirements to enable Demucs, librosa, and Basic Pitch. Successful separation stores 24-bit PCM WAV and supports instrumental, mix, and individual or ZIP stem downloads in WAV, FLAC, and M4A. A failed separation leaves the song analysis available and reports the cause in the UI.

See the Korean documentation above for output layout, environment variables, API routes, deployment guidance, data handling, and operational recommendations.

### Performance

On an Apple M5 with 16 GB, uncached repeat time with MLX Standard and real MIDI dropped from 7.84 to 4.65 s at 60 seconds, from 17.81 to 14.89 s at 180 seconds, and from 36.35 to 29.73 s at 300 seconds. See the [benchmark setup and results](backend/README.md#hybrid-pipeline-optimization).

### License and terms

The project code is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). See the [Terms of Use](TERMS.md#english) for licensing, audio permissions, and storage information. The copyright and permission notices for earlier MIT distributions are in [LICENSE-LEGACY-MIT](LICENSE-LEGACY-MIT).
