import { defaultTemplateLauncher } from './hooks/launcher.js';

// launcher pins the chemx this hook and the CI workflow run (GAP-4): { version, cliPath, ciBin }.
export const buildPreCommitHookScript = (minGrade = 'B', minScore = 80, launcher = defaultTemplateLauncher()) => `#!/bin/sh
# Chemical X Protocol: Pre-Commit Architecture Gatekeeper
# Free architectural guardrail preventing context bloat and monolith sprawl.
# chemx-pin: ${launcher.version}

REPO_ROOT="\$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "\$REPO_ROOT" ] && exit 0
cd "\$REPO_ROOT" || exit 1

# Documented bypass (also honoured by scripts/pre-commit.sh)
if [ "\$CHEMX_FORCE_COMMIT" = "1" ] || [ "\$CHEMX_SKIP_PRECOMMIT" = "1" ]; then
  exit 0
fi
# Pinned launcher: the same chemx the MCP server and Claude hooks run. CHEMX_BIN overrides it.
PINNED_CLI='${launcher.cliPath ?? ''}'
if [ -z "\$CHEMX_BIN" ] && [ -n "\$PINNED_CLI" ] && [ -f "\$PINNED_CLI" ]; then
  CHEMX_BIN="node \\"\$PINNED_CLI\\""
fi
export CHEMX_BIN

# Delegate to version-controlled script if present
if [ -f "\$REPO_ROOT/scripts/pre-commit.sh" ]; then
  exec "\$REPO_ROOT/scripts/pre-commit.sh" "\$@"
fi

# Detect TTY and color support
if [ -t 1 ] && [ -z "\$NO_COLOR" ] && [ "\$TERM" != "dumb" ]; then
  C_RESET="\$(printf '\\033[0m')"
  C_BOLD="\$(printf '\\033[1m')"
  C_RED="\$(printf '\\033[31m')"
  C_GREEN="\$(printf '\\033[32m')"
  C_YELLOW="\$(printf '\\033[33m')"
  C_CYAN="\$(printf '\\033[36m')"
  C_BLUE="\$(printf '\\033[38;2;98;201;255m')"
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

# Default gate: any rule whose violation count rises in a staged file vs HEAD, at any
# severity (the audit ratchet's rule). The failure output lists each new hazard as
# RULE@file:line. Grade thresholds only apply to the opt-in absolute gate
# (CHEMX_PRECOMMIT_GATE=grade). Line budgets come from chemx's line-budgets.js through
# the staged-delta audit, so this hook and \`chemx check\` never disagree.
CONF_MIN_GRADE=""
CONF_MIN_SCORE=""
CONFIG_FILE="\$REPO_ROOT/.chemx/config.json"

if [ -f "\$CONFIG_FILE" ]; then
  CONF_MIN_GRADE=\$(grep -o '"minGrade"[[:space:]]*:[[:space:]]*"[^"]*"' "\$CONFIG_FILE" 2>/dev/null | sed 's/.*"minGrade"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
  CONF_MIN_SCORE=\$(grep -o '"minScore"[[:space:]]*:[[:space:]]*[0-9]*' "\$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*\$')
fi

MIN_GRADE="\${CHEMX_MIN_GRADE:-\${CONF_MIN_GRADE:-${minGrade}}}"
MIN_SCORE="\${CHEMX_MIN_SCORE:-\${CONF_MIN_SCORE:-${minScore}}}"

# Nothing added, copied, modified or renamed: nothing to gate.
git diff --cached --quiet -M --diff-filter=ACMR && exit 0

AUDIT_BIN="\$CHEMX_BIN"
if [ -n "\$AUDIT_BIN" ]; then
  :
elif [ -f "./cli/index.js" ]; then
  AUDIT_BIN="node ./cli/index.js"
elif [ -x "./node_modules/.bin/chemx" ]; then
  AUDIT_BIN="./node_modules/.bin/chemx"
elif command -v chemx >/dev/null 2>&1; then
  AUDIT_BIN="chemx"
elif command -v npx >/dev/null 2>&1; then
  AUDIT_BIN="npx --yes chemx@${launcher.version}"
fi

if [ -n "\$AUDIT_BIN" ]; then
  if [ "\$CHEMX_VERBOSE" = "1" ]; then
    printf "%s[Chemical X] Verifying architectural health (Min Grade: %s, Min Score: %s)...%s\\n" "\$C_BLUE" "\$MIN_GRADE" "\$MIN_SCORE" "\$C_RESET"
  fi
  AUDIT_GATE_ARGS="--staged-delta"
  if [ "\$CHEMX_PRECOMMIT_GATE" = "grade" ]; then AUDIT_GATE_ARGS="--git --min-grade=\$MIN_GRADE --min-score=\$MIN_SCORE"; fi
  if ! AUDIT_OUT=\$(eval "\$AUDIT_BIN audit \$AUDIT_GATE_ARGS --non-interactive" < /dev/null 2>&1); then
    printf "\\n%s%s[Chemical X] Commit Blocked: Architectural health verification failed%s\\n" "\$C_BOLD" "\$C_RED" "\$C_RESET"
    printf "%s\\n\\n" "\$AUDIT_OUT"
    printf "%s╭──────────────────────────────────────────────────────────────────────────╮%s\\n" "\$C_CYAN" "\$C_RESET"
    printf "%s│ 🤖 AI REFACTOR PROMPT (Copy & paste into your AI assistant):            │%s\\n" "\$C_CYAN" "\$C_RESET"
    printf "%s╰──────────────────────────────────────────────────────────────────────────╯%s\\n" "\$C_CYAN" "\$C_RESET"
    printf "Please fix the Chemical X architectural hazards reported above in staged files.\\n\\n"
    printf "Refactor Directives:\\n"
    printf "1. Surgically resolve each new hazard listed above (RULE@file:line), at any severity.\\n"
    printf "2. Decompose monoliths into single-purpose crystalline capsules.\\n"
    printf "3. Preserve all existing symbols, exports, and test contracts.\\n"
    printf "4. Verify with 'chemx audit' after making changes.\\n"
    printf "%s────────────────────────────────────────────────────────────────────────────%s\\n\\n" "\$C_CYAN" "\$C_RESET"
    printf "%s💡 Tip: Run 'chemx audit' locally to inspect details or run autofixes.%s\\n" "\$C_CYAN" "\$C_RESET"
    printf "   To bypass this check temporarily: CHEMX_SKIP_PRECOMMIT=1 git commit\\n"
    printf "   That skips only this hook; chemx verify applies the same rule repo-wide and will fail on these hazards.\\n\\n"
    exit 1
  fi
fi

if [ "\$CHEMX_VERBOSE" = "1" ]; then
  printf "%s✔ [Chemical X] Pre-commit architectural guardrails passed.%s\\n" "\$C_GREEN" "\$C_RESET"
fi
exit 0
`;

export const buildGitHubWorkflowScript = (minGrade = 'B', minScore = 80, launcher = defaultTemplateLauncher()) => `name: Chemical X Architectural Gatekeeper
# chemx-pin: ${launcher.version}

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read
  pull-requests: write

jobs:
  molecular-audit:
    name: Chemical X Architecture & Line Budget Audit
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: |
          if [ -f package-lock.json ]; then
            npm ci
          elif [ -f package.json ]; then
            npm install
          fi

      - name: Run Chemical X Architectural Audit
        run: ${launcher.ciBin} audit --min-grade=\${{ vars.CHEMX_MIN_GRADE || '${minGrade}' }} --min-score=\${{ vars.CHEMX_MIN_SCORE || ${minScore} }} --markdown --output=AUDIT_REPORT.md
      - name: Upload Audit Scorecard Artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: chemical-x-audit-report
          path: AUDIT_REPORT.md

      - name: Post Architectural Audit Comment on PR
        if: always() && github.event_name == 'pull_request' && hashFiles('AUDIT_REPORT.md') != '' && vars.CHEMX_ENABLE_PR_COMMENTS == 'true'
        continue-on-error: true
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          REPO: \${{ github.repository }}
        run: |
          DISCUSSION_URL="\${{ vars.CHEMX_DISCUSSION_URL }}"
          if [ -z "\$DISCUSSION_URL" ] && [ -f .chemx/discussion.json ]; then
            DISCUSSION_URL=\$(node -e "try { const d = JSON.parse(require('fs').readFileSync('.chemx/discussion.json')); console.log(d.url || ''); } catch (e) {}")
          fi

          {
            echo "<!-- chemical-x-audit-pr-comment -->"
            if [ -n "\$DISCUSSION_URL" ]; then
              echo "> 💬 **Architectural Discussion Topic:** [View Discussion & Community Showcase](\$DISCUSSION_URL)"
              echo ""
            fi
            cat AUDIT_REPORT.md
          } > PR_COMMENT.md

          EXISTING_COMMENT_ID=\$(gh api "repos/\$REPO/issues/\$PR_NUMBER/comments" --jq '.[] | select(.body | contains("<!-- chemical-x-audit-pr-comment -->")) | .id' | head -n 1)

          if [ -n "\$EXISTING_COMMENT_ID" ]; then
            gh api --method PATCH "repos/\$REPO/issues/comments/\$EXISTING_COMMENT_ID" -F body=@PR_COMMENT.md
          else
            gh pr comment "\$PR_NUMBER" --body-file PR_COMMENT.md
          fi
`;
