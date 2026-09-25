#!/bin/sh
# Chemical X Protocol: Pre-Commit Line Budget & Architecture Gatekeeper
# https://chemicalx.xophz.com | https://github.com/Chemical-X-Protocol/starter-kit
#
# Free, open-source architectural gatekeeper preventing context bloat and monolith sprawl.

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  exit 0
fi

cd "$REPO_ROOT" || exit 1

if [ "$CHEMX_FORCE_COMMIT" = "1" ] || [ "$CHEMX_SKIP_PRECOMMIT" = "1" ]; then
  exit 0
fi

# Detect TTY and color support (respect NO_COLOR and dumb terminals)
if [ -t 1 ] && [ -z "$NO_COLOR" ] && [ "$TERM" != "dumb" ]; then
  C_RESET="$(printf '\033[0m')"
  C_BOLD="$(printf '\033[1m')"
  C_RED="$(printf '\033[31m')"
  C_GREEN="$(printf '\033[32m')"
  C_YELLOW="$(printf '\033[33m')"
  C_CYAN="$(printf '\033[36m')"
  C_BLUE="$(printf '\033[38;2;98;201;255m')"
else
  C_RESET=""
  C_BOLD=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_CYAN=""
  C_BLUE=""
  export NO_COLOR=1
fi

# Load thresholds from .chemx/config.json if available
CONF_MAX_LINES=""
CONF_MAX_MOL=""
CONF_MIN_GRADE=""
CONF_MIN_SCORE=""
CONFIG_FILE="$REPO_ROOT/.chemx/config.json"

if [ -f "$CONFIG_FILE" ]; then
  if command -v node >/dev/null 2>&1; then
    eval $(node -e "
      try {
        const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf8'));
        if (c.maxLineCount || c.maxLines) console.log('CONF_MAX_LINES=' + (c.maxLineCount || c.maxLines));
        if (c.maxMoleculeLineCount || c.maxMoleculeLines) console.log('CONF_MAX_MOL=' + (c.maxMoleculeLineCount || c.maxMoleculeLines));
        if (c.minGrade) console.log('CONF_MIN_GRADE=' + c.minGrade);
        if (c.minScore) console.log('CONF_MIN_SCORE=' + c.minScore);
      } catch (e) {}
    ")
  else
    CONF_MAX_LINES=$(grep -o '"maxLineCount"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*$')
    CONF_MAX_MOL=$(grep -o '"maxMoleculeLineCount"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*$')
    CONF_MIN_GRADE=$(grep -o '"minGrade"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*"minGrade"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    CONF_MIN_SCORE=$(grep -o '"minScore"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*$')
  fi
fi

MIN_GRADE="${CHEMX_MIN_GRADE:-${CONF_MIN_GRADE:-B}}"
MIN_SCORE="${CHEMX_MIN_SCORE:-${CONF_MIN_SCORE:-80}}"
MAX_LINES="${CHEMX_MAX_LINES:-${CONF_MAX_LINES:-500}}"
MAX_MOLECULE_LINES="${CHEMX_MAX_MOLECULE_LINES:-${CONF_MAX_MOL:-100}}"

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
      *molecules*|*/m-*|m-*)
        if [ "$LINES" -gt "$MAX_MOLECULE_LINES" ]; then
          LINE_BUDGET_FAILED=1
          LINE_BUDGET_ERRORS="${LINE_BUDGET_ERRORS}\n  ${C_RED}✕${C_RESET} $FILE ($LINES LOC > $MAX_MOLECULE_LINES LOC molecule capsule limit)"
        fi
        ;;
      *)
        if [ "$LINES" -gt "$MAX_LINES" ]; then
          LINE_BUDGET_FAILED=1
          LINE_BUDGET_ERRORS="${LINE_BUDGET_ERRORS}\n  ${C_RED}✕${C_RESET} $FILE ($LINES LOC > $MAX_LINES LOC file budget)"
        fi
        ;;
    esac
  fi
done

if [ "$LINE_BUDGET_FAILED" -eq 1 ]; then
  printf "\n%s%s[Chemical X] Commit Blocked: Staged files exceed architectural line budgets%s\n" "$C_BOLD" "$C_RED" "$C_RESET"
  printf "%b\n\n" "$LINE_BUDGET_ERRORS"
  printf "%sMonolithic files degrade AI context windows and cause hallucination loops.%s\n" "$C_YELLOW" "$C_RESET"
  printf "Decompose large files into single-purpose crystalline capsules before committing.\n\n"
  exit 1
fi

AUDIT_BIN=""
if [ -f "./cli/index.js" ]; then
  AUDIT_BIN="node ./cli/index.js"
elif [ -x "./node_modules/.bin/chemx" ]; then
  AUDIT_BIN="./node_modules/.bin/chemx"
elif command -v chemx >/dev/null 2>&1; then
  AUDIT_BIN="chemx"
elif command -v npx >/dev/null 2>&1; then
  AUDIT_BIN="npx chemx"
fi

if [ -n "$AUDIT_BIN" ]; then
  if [ "$CHEMX_VERBOSE" = "1" ]; then
    printf "%s[Chemical X] Verifying architectural health (Min Grade: %s, Min Score: %s)...%s\n" "$C_BLUE" "$MIN_GRADE" "$MIN_SCORE" "$C_RESET"
  fi
  
  AUDIT_CMD="$AUDIT_BIN audit --git --min-grade=$MIN_GRADE --min-score=$MIN_SCORE --non-interactive"
  
  if ! AUDIT_OUT=$(eval "$AUDIT_CMD < /dev/null" 2>&1); then
    printf "\n%s%s[Chemical X] Commit Blocked: Architectural health verification failed%s\n" "$C_BOLD" "$C_RED" "$C_RESET"
    printf "%s\n\n" "$AUDIT_OUT"
    printf "%s💡 Tip: Want crystalline drop-in templates to refactor in minutes?%s\n" "$C_CYAN" "$C_RESET"
    printf "   Run 'npm create chemx' or sponsor at https://github.com/sponsors/Chemical-X-Protocol\n\n"
    exit 1
  fi
fi

if [ "$CHEMX_VERBOSE" = "1" ]; then
  printf "%s✔ [Chemical X] Pre-commit architectural guardrails passed.%s\n" "$C_GREEN" "$C_RESET"
fi
exit 0
