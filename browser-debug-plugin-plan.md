# План v5: Browser Debug Plugin + strict guardrails для `$fix-app-bugs`

## Краткое резюме
1. Добавлены guarded entrypoints в skill: `bootstrap_guarded.py` и `cleanup_guarded.sh`.
2. Введён обязательный capability verdict: browser instrumentation разрешена только при `canInstrumentFromBrowser=true`.
3. При любой недоступности bootstrap включается явный fallback `terminal-probe` без ложного статуса активной browser instrumentation.
4. Введён единый execution contract финального отчёта из пяти блоков.
5. Добавлены smoke/regression-проверки guardrails в skill scripts.

## Публичные интерфейсы

### Guarded bootstrap contract
`python3 ~/.codex/skills/fix-app-bugs/scripts/bootstrap_guarded.py --project-root <project-root> --json`

Ключевые поля вывода:
1. `browserInstrumentation.canInstrumentFromBrowser`
2. `browserInstrumentation.mode`
3. `browserInstrumentation.reason`
4. `bootstrap.status` (`ok` или `fallback`)
5. `bootstrap.reason`
6. `debugEndpoint` / `queryEndpoint` (могут быть `null` в fallback)

Поведение:
1. Wrapper пытается запустить базовый `bootstrap_browser_debug.py`.
2. При missing script / launch failure / non-zero exit / invalid JSON возвращает fallback JSON.
3. В fallback `canInstrumentFromBrowser=false`, `mode=terminal-probe`, и процесс не блокируется (exit code 0).

### Guarded cleanup contract
`bash ~/.codex/skills/fix-app-bugs/scripts/cleanup_guarded.sh <project-root> [--strict]`

Поведение:
1. Если найден `check_instrumentation_cleanup.sh`, запускает его и проксирует результат.
2. Если скрипт недоступен, запускает fallback scan:
   `rg -n "BUGFIX_TRACE|debugEndpoint|traceId|issue tag" src test`
3. Код возврата: `2` при хвостах instrumentation, `0` при чистом состоянии.

### Final execution contract
Каждый запуск `fix-app-bugs` завершает отчёт блоками:
1. `Root Cause`
2. `Patch`
3. `Validation`
4. `Instrumentation Status`
5. `Residual Risk`

## Guardrails для render багов (WebGL/fullscreen)

Для симптомов типа diagonal split / half-black screen / invisible simulation обязательны проверки:
1. Coverage clip-space (`gl_Position`).
2. Coverage UV-space (`vUv` в `[0..1]`).
3. Совпадение canvas CSS size и drawing buffer size.
4. Корректный clear/blend/alpha для final composite.

Если исправлен только один из пунктов, ожидается риск регрессии.

## Rule: Two hypotheses before patch

До code changes требуется минимум две гипотезы в формате:
1. `Hypothesis`
2. `Evidence`
3. `Verdict` (`confirmed`/`rejected`)

Для render bug приоритетные первые гипотезы:
1. Geometry/UV mismatch.
2. Canvas resize/viewport mismatch.

## Обновлённые артефакты

### В skill `~/.codex/skills/fix-app-bugs`
1. `scripts/bootstrap_guarded.py`
2. `scripts/cleanup_guarded.sh`
3. `scripts/test_bootstrap_guarded.py`
4. `scripts/test_cleanup_guarded.sh`
5. `scripts/run_guardrail_smoke.sh`
6. `references/final-report-template.md`
7. Обновлены `SKILL.md`, `references/debug-log-spec.md`, `references/repro-request-template.md`, `agents/openai.yaml`

### В plugin repo
1. Обновлён `AGENTS.md` под guarded flow.
2. Обновлён `README-debug.md` под strict evidence contract.
3. Текущий документ зафиксировал v5-контракт.

## Acceptance / Regression

1. Bootstrap missing/failure не приводит к ложному browser-fetch режиму.
2. `terminal-probe` режим явно объявляется и исключает page-side `fetch(debugEndpoint)`.
3. Cleanup fallback работает даже при отсутствии cleanup script.
4. Smoke script подтверждает guarded bootstrap и cleanup сценарии.
5. Финальный отчёт воспроизводим и соответствует 5-блочному контракту.
