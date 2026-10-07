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

# Prints its argument only when it is a positive whole number; anything else prints nothing,
# so a bad CHEMX_* override or config value falls back instead of breaking the [ -gt ] checks.
positive_int() {
  case "$1" in
    ''|*[!0-9]*) return 0 ;;
  esac
  if [ "$1" -gt 0 ] 2>/dev/null; then
    printf '%s' "$1"
  fi
}

# Load thresholds from .chemx/config.json if available
CONF_MAX_LINES=""
CONF_MIN_GRADE=""
CONF_MIN_SCORE=""
CONFIG_FILE="$REPO_ROOT/.chemx/config.json"

if [ -f "$CONFIG_FILE" ]; then
  if command -v node >/dev/null 2>&1; then
    eval $(node -e "
      try {
        const c = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf8'));
        if (c.maxLineCount || c.maxLines) console.log('CONF_MAX_LINES=' + (c.maxLineCount || c.maxLines));
        if (c.minGrade) console.log('CONF_MIN_GRADE=' + c.minGrade);
        if (c.minScore) console.log('CONF_MIN_SCORE=' + c.minScore);
      } catch (e) {}
    ")
  else
    CONF_MAX_LINES=$(grep -o '"maxLineCount"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*$')
    CONF_MIN_GRADE=$(grep -o '"minGrade"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG_FILE" 2>/dev/null | sed 's/.*"minGrade"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
    CONF_MIN_SCORE=$(grep -o '"minScore"[[:space:]]*:[[:space:]]*[0-9]*' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*$')
  fi
fi

MIN_GRADE="${CHEMX_MIN_GRADE:-${CONF_MIN_GRADE:-B}}"
MIN_SCORE="${CHEMX_MIN_SCORE:-${CONF_MIN_SCORE:-80}}"
ENV_MAX_LINES="$(positive_int "$CHEMX_MAX_LINES")"
CONF_MAX_LINES="$(positive_int "$CONF_MAX_LINES")"
MAX_LINES="${ENV_MAX_LINES:-${CONF_MAX_LINES:-500}}"

# Detect staged source files (including polyglot C#, Python, Go)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(jsx?|tsx?|vue|svelte|cs|py|go)$' | grep -vE '(\.(d\.ts|min\.|test\.|spec\.))')

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Molecule budget: CHEMX_MAX_MOLECULE_LINES wins, then the project profile, then 250.
# Each is used only when it is a positive whole number, so CHEMX_MAX_MOLECULE_LINES=abc
# falls back to the profile instead of making the comparison error out and pass.
# Whichever applies is capped at the MAX_LINES file budget, as the audit checks the
# 500-line file bound before the molecule budget.
# With node the profile comes from the first of .chemxrc, .chemxrc.json, .chemx/config.json
# or package.json "chemx" that parses, as in cli/config/loader.js. atomic-strict or
# enforce-file-length gives 100, otherwise max-line-count-warning or the profile
# default, as in cli/audit/rules.js. A warning that is not a positive number, such as
# "abc", 0 or -5, is ignored in favour of the profile default, as resolveMoleculeLineLimit does.
# strip() drops // and /* */ comments only outside strings, like stripJsonComments in
# cli/config/loader.js. It names a double quote and a backslash by their char codes,
# 34 and 92, because the JS sits inside a double-quoted sh string.
PROFILE_MAX_MOL=""
if command -v node >/dev/null 2>&1; then
  PROFILE_MAX_MOL=$(node -e "
    const fs = require('fs');
    const strip = (text) => {
      let out = '';
      let i = 0;
      let inString = false;
      while (i < text.length) {
        const code = text.charCodeAt(i);
        const pair = text.slice(i, i + 2);
        if (inString) {
          const width = code === 92 ? 2 : 1;
          out += text.slice(i, i + width);
          inString = code !== 34;
          i += width;
        } else if (pair === '//') {
          const end = text.indexOf(String.fromCharCode(10), i);
          i = end < 0 ? text.length : end;
          out += ' ';
        } else if (pair === '/*') {
          const end = text.indexOf('*/', i + 2);
          i = end < 0 ? text.length : end + 2;
          out += ' ';
        } else {
          inString = code === 34;
          out += text[i];
          i += 1;
        }
      }
      return out;
    };
    const read = (rel) => {
      try {
        const text = strip(fs.readFileSync(rel, 'utf8'));
        const value = JSON.parse(text);
        return value !== null && typeof value === 'object' ? value : null;
      } catch {
        return null;
      }
    };
    const pkgRc = (read('package.json') || {}).chemx;
    const rc = read('.chemxrc') || read('.chemxrc.json') || read('.chemx/config.json') || (typeof pkgRc === 'object' && pkgRc) || {};
    const WARN = {'pragmatic': 250, 'atomic-strict': 100, 'loose': 500};
    const name = String(rc.profile || 'pragmatic').toLowerCase();
    const profile = Object.keys(WARN).includes(name) ? name : 'pragmatic';
    const rules = {profile: profile, enforceFileLength: profile === 'atomic-strict', maxLineCountWarning: WARN[profile]};
    const KEYS = {'enforce-file-length': 'enforceFileLength', 'max-line-count-warning': 'maxLineCountWarning'};
    Object.entries(rc.rules || {}).forEach(([key, value]) => { rules[KEYS[key] || key] = value; });
    const isStrict = rules.enforceFileLength === true || rules.profile === 'atomic-strict';
    const parsed = parseInt(rules.maxLineCountWarning, 10);
    const warning = parsed > 0 ? parsed : WARN[profile];
    process.stdout.write(String(isStrict ? 100 : warning));
  " 2>/dev/null)
else
  # Without node only "profile": "atomic-strict" and enforce-file-length (or enforceFileLength)
  # true are detected, giving 100, and only in the first of .chemxrc, .chemxrc.json or
  # .chemx/config.json that exists, even when it does not parse. package.json "chemx", the
  # loose profile and max-line-count-warning are not read, so anything else falls back to 250.
  # Only block comments that open at the start of a line (after optional blanks) are stripped,
  # across lines, and then lines starting with //. A /* that opens later in a line is left
  # alone, so globs inside strings such as "src/**/*.ts" never pair up into a comment; that
  # also keeps a block comment opening mid-line, and a strict setting inside it still counts.
  SOH="$(printf '\001')"
  for RC in .chemxrc .chemxrc.json .chemx/config.json; do
    [ -f "$RC" ] || continue
    if { printf '\001'; tr '\n' '\001' < "$RC"; } \
      | sed "s|${SOH}[[:blank:]]*/\*[^*]*\*\**\([^/*][^*]*\*\**\)*/|${SOH}|g" | tr '\001' '\n' \
      | grep -v '^[[:space:]]*//' \
      | grep -Eq '"profile"[[:space:]]*:[[:space:]]*"atomic-strict"|"(enforce-file-length|enforceFileLength)"[[:space:]]*:[[:space:]]*true'; then
      PROFILE_MAX_MOL=100
    fi
    break
  done
fi
PROFILE_MAX_MOL="$(positive_int "$PROFILE_MAX_MOL")"
ENV_MAX_MOL="$(positive_int "$CHEMX_MAX_MOLECULE_LINES")"
MOL_LIMIT="${ENV_MAX_MOL:-${PROFILE_MAX_MOL:-250}}"
if [ "$MOL_LIMIT" -gt "$MAX_LINES" ]; then
  MOL_LIMIT="$MAX_LINES"
fi
MAX_MOLECULE_LINES="$MOL_LIMIT"

LINE_BUDGET_FAILED=0
LINE_BUDGET_ERRORS=""
EXCEEDED_FILES=""

for FILE in $STAGED_FILES; do
  if [ -f "$FILE" ]; then
    LINES=$(wc -l < "$FILE" | tr -d ' ')
    
    # Check if file is a molecule capsule
    case "$FILE" in
      *molecules*|*/m-*|m-*)
        if [ "$LINES" -gt "$MAX_MOLECULE_LINES" ]; then
          LINE_BUDGET_FAILED=1
          LINE_BUDGET_ERRORS="${LINE_BUDGET_ERRORS}\n  ${C_RED}✕${C_RESET} $FILE ($LINES LOC > $MAX_MOLECULE_LINES LOC molecule capsule limit)"
          EXCEEDED_FILES="${EXCEEDED_FILES}\n- $FILE ($LINES LOC > $MAX_MOLECULE_LINES LOC molecule limit)"
        fi
        ;;
      *)
        if [ "$LINES" -gt "$MAX_LINES" ]; then
          LINE_BUDGET_FAILED=1
          LINE_BUDGET_ERRORS="${LINE_BUDGET_ERRORS}\n  ${C_RED}✕${C_RESET} $FILE ($LINES LOC > $MAX_LINES LOC file budget)"
          EXCEEDED_FILES="${EXCEEDED_FILES}\n- $FILE ($LINES LOC > $MAX_LINES LOC file budget)"
        fi
        ;;
    esac
  fi
done

if [ "$LINE_BUDGET_FAILED" -eq 1 ]; then
  printf "\n%s%s[Chemical X] Commit Blocked: Staged files exceed architectural line budgets%s\n" "$C_BOLD" "$C_RED" "$C_RESET"
  printf "%b\n\n" "$LINE_BUDGET_ERRORS"
  printf "%s╭──────────────────────────────────────────────────────────────────────────╮%s\n" "$C_CYAN" "$C_RESET"
  printf "%s│ 🤖 AI REFACTOR PROMPT (Copy & paste into your AI assistant):            │%s\n" "$C_CYAN" "$C_RESET"
  printf "%s╰──────────────────────────────────────────────────────────────────────────╯%s\n" "$C_CYAN" "$C_RESET"
  printf "Please refactor the following files that exceed Chemical X line budgets:%b\n\n" "$EXCEEDED_FILES"
  printf "Refactor Directives:\n"
  printf "1. Decompose monolithic logic into single-purpose crystalline capsules or helper modules (< %s lines for files, < %s lines for molecules).\n" "$MAX_LINES" "$MAX_MOLECULE_LINES"
  printf "2. Extract presentation into Table-of-Contents views and business state into composables/services.\n"
  printf "3. Preserve all existing symbols, exports, and public API contracts.\n"
  printf "4. Decompose complex inline booleans and flatten nested control flow.\n"
  printf "%s────────────────────────────────────────────────────────────────────────────%s\n\n" "$C_CYAN" "$C_RESET"
  printf "%s💡 Tip: To bypass line budgets temporarily: CHEMX_SKIP_PRECOMMIT=1 git commit%s\n\n" "$C_YELLOW" "$C_RESET"
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
    printf "%s╭──────────────────────────────────────────────────────────────────────────╮%s\n" "$C_CYAN" "$C_RESET"
    printf "%s│ 🤖 AI REFACTOR PROMPT (Copy & paste into your AI assistant):            │%s\n" "$C_CYAN" "$C_RESET"
    printf "%s╰──────────────────────────────────────────────────────────────────────────╯%s\n" "$C_CYAN" "$C_RESET"
    printf "Please fix the Chemical X architectural hazards reported above in staged files.\n\n"
    printf "Refactor Directives:\n"
    printf "1. Surgically resolve each flagged Critical and High severity hazard.\n"
    printf "2. Decompose monoliths into single-purpose crystalline capsules.\n"
    printf "3. Preserve all existing symbols, exports, and test contracts.\n"
    printf "4. Verify with 'chemx audit' after making changes.\n"
    printf "%s────────────────────────────────────────────────────────────────────────────%s\n\n" "$C_CYAN" "$C_RESET"
    printf "%s💡 Tip: Run 'chemx audit' locally to inspect details or run autofixes.%s\n" "$C_CYAN" "$C_RESET"
    printf "   To bypass this check temporarily: CHEMX_SKIP_PRECOMMIT=1 git commit\n\n"
    exit 1
  fi
fi

if [ "$CHEMX_VERBOSE" = "1" ]; then
  printf "%s✔ [Chemical X] Pre-commit architectural guardrails passed.%s\n" "$C_GREEN" "$C_RESET"
fi
exit 0
