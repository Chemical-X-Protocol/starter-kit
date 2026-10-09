#!/bin/sh
# Chemical X Protocol: Pre-Commit Architecture Gatekeeper
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

# Lease guard (#2492): a staged file under another handle's live lease blocks the commit. Only a
# report that starts with "Commit blocked:" refuses; a crash, or a chemx without the subcommand,
# never blocks a commit. Committer = CHEMX_AGENT_ID (unset: a human, so any live agent lease blocks).
LEASE_BIN="$CHEMX_BIN"
if [ -z "$LEASE_BIN" ]; then
  if [ -f "./cli/index.js" ]; then
    LEASE_BIN="node ./cli/index.js"
  elif [ -x "./node_modules/.bin/chemx" ]; then
    LEASE_BIN="./node_modules/.bin/chemx"
  elif command -v chemx >/dev/null 2>&1; then
    LEASE_BIN="chemx"
  fi
fi
if [ -n "$LEASE_BIN" ]; then
  LEASE_OUT=$(eval "$LEASE_BIN team lock check-staged < /dev/null" 2>&1)
  case "$LEASE_OUT" in
    "Commit blocked:"*)
      printf "\n%s%s[Chemical X] %s%s\n\n" "$C_BOLD" "$C_RED" "$LEASE_OUT" "$C_RESET"
      exit 1
      ;;
    "Warning:"*)
      printf "%s%s%s\n" "$C_YELLOW" "$LEASE_OUT" "$C_RESET"
      ;;
  esac
fi

# Grade thresholds only apply to the opt-in absolute gate (CHEMX_PRECOMMIT_GATE=grade).
# Line budgets are not checked here: they come from cli/audit/line-budgets.js through
# the staged-delta audit, so the hook and `chemx check` never disagree (#1476, #1716).
CONF_MIN_GRADE=""
CONF_MIN_SCORE=""
CONFIG_FILE="$REPO_ROOT/.chemx/config.json"

if [ -f "$CONFIG_FILE" ]; then
  CONF_MIN_GRADE=$(grep -o '"minGrade"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*"minGrade"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  CONF_MIN_SCORE=$(grep -o '"minScore"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*$')
fi

MIN_GRADE="${CHEMX_MIN_GRADE:-${CONF_MIN_GRADE:-B}}"
MIN_SCORE="${CHEMX_MIN_SCORE:-${CONF_MIN_SCORE:-80}}"

# Nothing added, copied, modified or renamed: nothing to gate. The audit itself
# decides which staged paths are source files.
if git diff --cached --quiet -M --diff-filter=ACMR; then
  exit 0
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
  
  # Default gate: any rule whose violation count rises in a staged file vs HEAD, at any
  # severity (#1716, #2546). This is the rule the audit ratchet applies, so a commit this
  # hook accepts cannot turn chemx verify red on the ratchet step. The failure output
  # lists each new hazard as RULE@file:line.
  # CHEMX_PRECOMMIT_GATE=grade restores the absolute grade gate on changed files.
  if [ "$CHEMX_PRECOMMIT_GATE" = "grade" ]; then
    AUDIT_CMD="$AUDIT_BIN audit --git --min-grade=$MIN_GRADE --min-score=$MIN_SCORE --non-interactive"
  else
    AUDIT_CMD="$AUDIT_BIN audit --staged-delta --non-interactive"
  fi
  
  if ! AUDIT_OUT=$(eval "$AUDIT_CMD < /dev/null" 2>&1); then
    printf "\n%s%s[Chemical X] Commit Blocked: Architectural health verification failed%s\n" "$C_BOLD" "$C_RED" "$C_RESET"
    printf "%s\n\n" "$AUDIT_OUT"
    printf "%s╭──────────────────────────────────────────────────────────────────────────╮%s\n" "$C_CYAN" "$C_RESET"
    printf "%s│ 🤖 AI REFACTOR PROMPT (Copy & paste into your AI assistant):            │%s\n" "$C_CYAN" "$C_RESET"
    printf "%s╰──────────────────────────────────────────────────────────────────────────╯%s\n" "$C_CYAN" "$C_RESET"
    printf "Please fix the Chemical X architectural hazards reported above in staged files.\n\n"
    printf "Refactor Directives:\n"
    printf "1. Surgically resolve each new hazard listed above (RULE@file:line), at any severity.\n"
    printf "2. Decompose monoliths into single-purpose crystalline capsules.\n"
    printf "3. Preserve all existing symbols, exports, and test contracts.\n"
    printf "4. Verify with 'chemx audit' after making changes.\n"
    printf "%s────────────────────────────────────────────────────────────────────────────%s\n\n" "$C_CYAN" "$C_RESET"
    printf "%s💡 Tip: Run 'chemx audit' locally to inspect details or run autofixes.%s\n" "$C_CYAN" "$C_RESET"
    printf "   To bypass this check temporarily: CHEMX_SKIP_PRECOMMIT=1 git commit\n"
    printf "   That skips only this hook; chemx verify applies the same rule repo-wide and will fail on these hazards.\n\n"
    exit 1
  fi
fi

if [ "$CHEMX_VERBOSE" = "1" ]; then
  printf "%s✔ [Chemical X] Pre-commit architectural guardrails passed.%s\n" "$C_GREEN" "$C_RESET"
fi
exit 0
