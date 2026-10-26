# Debate Dev System

Codex가 저장소를 읽고 1라운드 설계 초안을 작성합니다. 2라운드부터는 Gemini가 개선안을 제안하고, 매 라운드 Nemotron이 반박하고 Gemini가 재반론합니다. Judge는 항목별 0~5점과 검증 수준을 기록합니다. 기본 3라운드, 최대 5라운드 뒤 Codex가 기술 결정과 실행계획을 작성합니다. 읽기 전용 설계 단계에서는 파일을 수정하지 않으며, 계획을 사용자가 승인해야 Codex가 로컬 작업을 시작합니다.

첫 초안에 GitHub 파일 링크가 있으면 최대 2개의 원문을 커밋으로 고정해 Codex에 전달합니다. 지원하지 않거나 가져올 수 없는 링크는 미확인으로 표시하며, Codex 자체의 네트워크 접근은 계속 막습니다.

## 실행

Node.js 24.5 이상 및 pnpm이 필요합니다. SQLite는 Node 내장 모듈을 사용하므로 Python이나 C++ 빌드 도구가 필요하지 않습니다.

Windows (PowerShell):

```powershell
pnpm install
pnpm dev
```

macOS / Linux (zsh 또는 bash):

```sh
pnpm install
pnpm dev
```

다른 터미널에서 `pnpm web`을 실행하고 `http://127.0.0.1:5173`에 접속합니다. Gemini와 Nemotron 제공자 키가 없으면 첫 화면에서 입력받아 `.env`에 저장하고 즉시 적용합니다. 이미 키가 있으면 설정 화면은 건너뜁니다. 프로젝트 없이 일반 기술 주제를 토론할 수 있으며 이 경우 저장소 파일 검증과 Codex 실행은 제공되지 않습니다. 코드 실행까지 하려면 좌측에서 **프로젝트 루트 폴더를 직접 선택하거나 절대 경로를 입력해** 등록하고 선택한 뒤 토론을 시작합니다. 폴더 선택은 웹 화면에서 서버의 디렉터리를 탐색하므로 별도 OS 폴더 선택 프로그램이 필요하지 않습니다. 프로젝트별 세션과 최근 세션을 좌측에서 확인할 수 있으며, 승인 화면에 고정된 실행 경로가 표시됩니다. `.env`를 직접 수정했다면 서버를 다시 시작해야 합니다. 서버는 운영체제의 신뢰 인증서를 Node 기본 인증서에 추가해 TLS 검증을 유지합니다. macOS에서는 `pnpm test`, `pnpm check`, `pnpm build`를 실행해 환경을 확인하세요. macOS와 Linux 실기기 검증은 아직 하지 않았습니다.

API 키가 없다면 `$env:MOCK_PROVIDERS = "true"`로 전체 토론 흐름을 검증할 수 있습니다. Mock 수치는 실측 모델 성능이 아닙니다. `pnpm test`, `pnpm check`, `pnpm build`를 사용할 수 있습니다.

## 인증과 무료 사용 조건

- Gemini: Google AI Studio의 **무료 티어 프로젝트 키**를 `GEMINI_API_KEY`에 지정합니다. 기본 `gemini-3.5-flash-lite` 접근 권한과 한도는 AI Studio에서 확인합니다.
- OpenRouter: `OPENROUTER_API_KEY`를 지정하면 Nemotron 반박은 `nvidia/nemotron-3.5-lightning:free`만 호출합니다. 기존에 OpenRouter 키를 `NVIDIA_API_KEY`에 저장했다면 키 형식으로 자동 인식합니다. 무료 endpoint는 호출 한도가 있고 프롬프트가 서비스 제공자에게 기록될 수 있으므로 기밀 코드는 보내지 마세요.
- NVIDIA: NVIDIA Build의 **무료 평가용 API 키**를 `NVIDIA_API_KEY`에 지정합니다. 기본 `nvidia/nemotron-3.5-lightning-30b-a3b`는 현재 NVIDIA가 무료 endpoint로 표시합니다. 한도와 사용 조건은 계정 화면에서 확인합니다.
- Codex: 토론 초안·최종 계획과 승인 후 로컬 코드 실행을 쓰려면 [Codex CLI](https://learn.chatgpt.com/docs/codex/cli)를 설치하고 `codex login`으로 기존 ChatGPT 계정에 로그인합니다. `codex app-server --help`로 설치를 확인합니다. 별도의 `OPENAI_API_KEY`는 사용하지 않습니다. 앱은 Codex 호출 전에 인증 방식을 확인하고 API 키 로그인을 차단합니다. 프로젝트 폴더 등록과 세션 목록 조회는 모델을 호출하지 않습니다. 토론 초안·최종 계획·승인 후 실행은 계정의 Codex 한도를 소비하며, 큰 저장소에서는 파일 탐색과 문맥 때문에 호출당 사용량이 늘 수 있습니다.

Windows에서 `spawn codex ENOENT`가 나오면 서버 프로세스가 Codex 실행 파일을 찾지 못한 것입니다. Codex 앱의 `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`를 자동 탐색합니다. 다른 위치에 설치했다면 `.env`의 `CODEX_BIN`에 `codex.exe` 절대 경로를 넣고 서버를 재시작하세요.

`PAID_API_ENABLED=false`가 기본이고 429 응답이면 중단합니다. OpenRouter 경로는 무료 모델 ID로 고정합니다. Gemini·NVIDIA 키의 요금 등급은 앱에서 확인할 수 없으므로 **유료 결제가 연결되지 않은 키**를 사용해야 합니다. 앱은 유료 OpenAI API로 우회하지 않습니다.

## 안전 및 기록

Fastify는 `127.0.0.1:3001`에만 바인딩됩니다. 등록된 프로젝트 경로와 세션·실행 상태는 `data/system.sqlite`, LangGraph 체크포인트는 `data/graph.sqlite`에 저장됩니다. `reports/debate`, `reports/execution`, `reports/nvidia-performance`에 결과를 기록합니다. 실행 승인은 세션 계획별로 필요하며, Codex가 추가 명령·파일 승인을 요청하면 UI에서 개별 결정합니다. Codex는 세션에 저장된 프로젝트 폴더로 작업을 제한하고 네트워크를 끕니다. Git push·배포 지시는 전달하지 않습니다.

Judge는 기본적으로 Gemini를 별도 역할로 다시 호출하므로 **모델 수준 독립성은 없습니다**. 점수는 AI 정성 평가이며 `verification=unverified`면 테스트 검증이 아닙니다. Codex·Gemini·Nemotron 발화는 실시간 스트리밍하며 Codex 읽기 전용 초안 호출 제한은 기본 600초(`CODEX_DRAFT_TIMEOUT_MS`로 변경), Gemini·Nemotron 호출 제한은 180초입니다. Nemotron의 첫 출력 시간(TTFT)을 기록합니다. 표본 20건 미만에서는 분위수를 숨깁니다.

좌측 세션에서 보관·복원·삭제할 수 있습니다. 삭제는 중단된 세션에만 허용하며 해당 세션의 DB 기록, 체크포인트, 보고서를 지웁니다. Performance 화면은 에이전트별 앱 내 입력·출력 토큰 누계와 확인 가능한 제공자 한도를 구분해 표시합니다. Gemini/NVIDIA 계정의 실시간 토큰 한도는 API 키만으로 조회하지 못합니다. OpenRouter 키 지출 한도는 토큰 한도가 아닌 USD 금액으로 표시합니다.

## 검증 기준

Mock 테스트는 지정한 Next.js SSR/CSR 주제로 3라운드, Nemotron 호출 계측, 체크포인트, 승인 대기, 보고서 생성을 확인합니다. 실계정 API 테스트와 Codex 실제 수정 작업은 API 키·계정 권한·실행 승인 후 별도로 수행해야 합니다.

## 참고 문서

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Gemini generateContent](https://ai.google.dev/api/generate-content)
- [NVIDIA Nemotron endpoint](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/build)
- [OpenRouter Nemotron 무료 endpoint](https://openrouter.ai/nvidia/nemotron-3.5-lightning:free)
- [LangGraph.js](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)
