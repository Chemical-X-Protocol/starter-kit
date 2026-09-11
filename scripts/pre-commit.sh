#!/bin/sh
# Chemical X Protocol: Pre-Commit Line Budget & Architecture Gatekeeper
# https://chemicalx.xophz.com | https://github.com/Chemical-X-Protocol/starter-kit
#
# Free, open-source architectural gatekeeper preventing context bloat and monolith sprawl.

MIN_GRADE="${CHEMX_MIN_GRADE:-B}"
MIN_SCORE="${CHEMX_MIN_SCORE:-80}"
MAX_LINES="${CHEMX_MAX_LINES:-500}"
MAX_MOLECULE_LINES="${CHEMX_MAX_MOLECULE_LINES:-100}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

cd "$REPO_ROOT" || exit 1

# Detect staged source files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(jsx?|tsx?|vue|svelte)$' | grep -vE '(\.d\.ts|\.min\.|\.test\.|\.spec\.)')

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

LINE_BUDGET_FAILED=0
LINE_BUDGET_ERRORS=""

for FILE in $STAGED_FILES; do
  if [ -f "$FILE" ]; then
    LINES=$(wc -l < "$FILE" | tr -d ' ')
    
    # Check if file is a molecule capsule
    case "$FILE" in
      *molecules*|*/m-*|*m-*)
        if [ "$LINES" -gt "$MAX_MOLECULE_LINES" ]; then
          LINE_BUDGET_FAILED=1
          LINE_BUDGET_ERRORS="${LINE_BUDGET_ERRORS}\n  \033[31m✕\033[0m $FILE ($LINES LOC > $MAX_MOLECULE_LINES LOC molecule capsule limit)"
        fi
        ;;
      *)
        if [ "$LINES" -gt "$MAX_LINES" ]; then
          LINE_BUDGET_FAILED=1
          LINE_BUDGET_ERRORS="${LINE_BUDGET_ERRORS}\n  \033[31m✕\033[0m $FILE ($LINES LOC > $MAX_LINES LOC file budget)"
        fi
        ;;
    esac
  fi
done

if [ "$LINE_BUDGET_FAILED" -eq 1 ]; then
  printf "\n\033[1m\033[31m[Chemical X] Commit Blocked: Staged files exceed architectural line budgets\033[0m\n"
  printf "$LINE_BUDGET_ERRORS\n\n"
  printf "\033[33mMonolithic files degrade AI context windows and cause hallucination loops.\033[0m\n"
  printf "Decompose large files into single-purpose crystalline capsules before committing.\n\n"
fi

# Run Chemical X audit with minimum grade and score thresholds
if command -v npx >/dev/null 2>&1; then
  printf "\033[38;2;98;201;255m[Chemical X] Verifying architectural health (Min Grade: %s, Min Score: %s)...\033[0m\n" "$MIN_GRADE" "$MIN_SCORE"
  
  AUDIT_CMD="npx chemx audit --min-grade=$MIN_GRADE --min-score=$MIN_SCORE --prompt-on-fail"
  
  if ! $AUDIT_CMD; then
    printf "\n\033[1m\033[31m[Chemical X] Commit Blocked: Codebase falls below required Grade %s (Score %s)\033[0m\n" "$MIN_GRADE" "$MIN_SCORE"
    printf "\033[36m💡 Tip: Want crystalline drop-in templates to refactor in minutes?\033[0m\n"
    printf "   Run 'npm create chemx' or sponsor at https://github.com/sponsors/Chemical-X-Protocol\n\n"
    exit 1
  fi
fi

if [ "$LINE_BUDGET_FAILED" -eq 1 ]; then
  printf "\033[36m💡 Tip: Want crystalline drop-in templates to refactor in minutes?\033[0m\n"
  printf "   Run 'npm create chemx' or sponsor at https://github.com/sponsors/Chemical-X-Protocol\n\n"
  exit 1
fi

printf "\033[32m✔ [Chemical X] Pre-commit architectural guardrails passed.\033[0m\n"
exit 0
