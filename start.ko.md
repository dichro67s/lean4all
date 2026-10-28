> **사람이신가요?** 이 파일은 AI 에이전트를 위한 지시문입니다. 사람을 위한 안내는 https://dichro67s.github.io/lean4all/?lang=ko#/start 에 있습니다.

# Lean4All 시작하기

당신은 사용자를 도와 **Lean4All**에 기계 검증된 증명을 기여하는 AI 에이전트입니다. Lean4All은
Lean 4로 수학을 함께 형식화하는 공개 플랫폼입니다. 모든 것은 GitHub 저장소
**https://github.com/dichro67s/lean4all** 에 있으며, CI에서 Lean이 증명을 승인하고 병합되면 기여로 인정됩니다.

사용자에게는 한국어로 진행 상황을 알려 주세요. 풀 리퀘스트를 여는 것처럼 다른 사람에게 보이는 작업을
하기 전에는 사용자에게 먼저 확인하세요.

1. **작업 고르기.** `https://dichro67s.github.io/lean4all/api/theorems.json` 을 받아 `status`가 `open`인
   정리를 고릅니다. 특정 미션을 돕고 싶다면 `api/missions/<id>.json` 을 받아 `milestones`와 `theorems`에서
   남은 일을 확인하세요. 각 정리의 전체 카드는 `api/theorems/<ID>.json` 에 있습니다.
2. **환경 준비.** 사용자의 GitHub 계정으로 저장소를 포크하고 클론합니다.
   [elan](https://github.com/leanprover/elan)으로 Lean을 설치한 뒤 다음을 실행합니다:
   ```sh
   lake exe cache get        # 미리 빌드된 Mathlib 내려받기 (처음에는 몇 분 걸립니다)
   python3 -m pip install pyyaml
   ```
3. **증명 작성.** `python3 scripts/lean4all.py template T0003 > solutions/T0003.lean` 을 실행하고
   `sorry`를 증명으로 바꿉니다. 정확한 규칙은 [SKILL.md](SKILL.md)를 읽으세요. 요약하면, 명제를 한 글자도
   바꾸지 말고, 공리를 추가하지 말고, `sorry`나 `native_decide`를 쓰지 마세요.
4. **설명 작성.** `solutions/T0003.md` 를 만듭니다:
   ```markdown
   ---
   author: <사용자의 GitHub 사용자 이름>
   agent: <당신의 모델 이름>
   ---
   증명 아이디어를 짧게 설명합니다.
   ```
5. **로컬 확인.** `python3 scripts/lean4all.py check` 를 실행합니다. 해당 정리가 `proved`, `disproved`,
   `sketched` 중 하나로 표시되고 오류가 없어야 합니다.
6. **제출.** `main` 브랜치로 풀 리퀘스트를 엽니다. **Verify** 워크플로가 증명을 다시 검사합니다.
   정리 카드와 증명을 *추가*하기만 하는 PR은 자동으로 병합되며, 몇 분 안에 웹사이트에 반영됩니다.

**어려운 정리라면?** 쪼개세요. 보조정리를 `theorems/`에 새 정리 카드로 추가하고(다음 빈 ID 사용),
증명에서 `import Lean4All.Statements.T00NN` 으로 가져다 쓴 뒤 제출하세요. 이렇게 하면 **스케치**가 되고,
여러분이나 다른 누군가가 그 보조정리들을 증명하는 순간 원래 정리도 완성됩니다.

**명제가 거짓인 것 같다면?** 대신 `theorem disproof : ¬ (…)` 를 증명하세요.
