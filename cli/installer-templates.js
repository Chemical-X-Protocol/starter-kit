export const buildPreCommitHookScript = (minGrade = 'B', minScore = 80) => `#!/bin/sh
# Chemical X Protocol: Pre-Commit Line Budget & Architecture Gatekeeper
# Free architectural guardrail preventing context bloat and monolith sprawl.

MIN_GRADE="\${CHEMX_MIN_GRADE:-${minGrade}}"
MIN_SCORE="\${CHEMX_MIN_SCORE:-${minScore}}"
MAX_LINES="\${CHEMX_MAX_LINES:-500}"
MAX_MOLECULE_LINES="\${CHEMX_MAX_MOLECULE_LINES:-100}"

REPO_ROOT="\$(git rev-parse --show-toplevel 2>/dev/null)"
[ -z "\$REPO_ROOT" ] && exit 0
cd "\$REPO_ROOT" || exit 1

STAGED_FILES=\$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(jsx?|tsx?|vue|svelte)\$' | grep -vE '(\\.(d\\.ts|min\\.|test\\.|spec\\.))')
[ -z "\$STAGED_FILES" ] && exit 0

FAILED=0
ERRORS=""
for F in \$STAGED_FILES; do
  [ ! -f "\$F" ] && continue
  L=\$(wc -l < "\$F" | tr -d ' ')
  case "\$F" in
    *molecules*|*/m-*|*m-*)
      [ "\$L" -gt "\$MAX_MOLECULE_LINES" ] && FAILED=1 && ERRORS="\${ERRORS}\\n  \\033[31m✕\\033[0m \$F (\$L LOC > \$MAX_MOLECULE_LINES molecule limit)" ;;
    *)
      [ "\$L" -gt "\$MAX_LINES" ] && FAILED=1 && ERRORS="\${ERRORS}\\n  \\033[31m✕\\033[0m \$F (\$L LOC > \$MAX_LINES file budget)" ;;
  esac
done

if [ "\$FAILED" -eq 1 ]; then
  printf "\\n\\033[1m\\033[31m[Chemical X] Commit Blocked: Staged files exceed architectural line budgets\\033[0m\\n\$ERRORS\\n\\n"
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

if [ -n "\$AUDIT_BIN" ]; then
  printf "\\033[38;2;98;201;255m[Chemical X] Verifying architectural health (Min Grade: %s, Min Score: %s)...\\033[0m\\n" "\$MIN_GRADE" "\$MIN_SCORE"
  if ! \$AUDIT_BIN audit --min-grade="\$MIN_GRADE" --min-score="\$MIN_SCORE" --non-interactive < /dev/null; then
    printf "\\n\\033[1m\\033[31m[Chemical X] Commit Blocked: Codebase falls below required Grade %s (Score %s)\\033[0m\\n" "\$MIN_GRADE" "\$MIN_SCORE"
    printf "\\033[36m💡 Tip: Want crystalline drop-in templates? Run 'npm create chemx' or sponsor at https://github.com/sponsors/Chemical-X-Protocol\\033[0m\\n\\n"
    exit 1
  fi
fi

[ "\$FAILED" -eq 1 ] && exit 1
printf "\\033[32m✔ [Chemical X] Pre-commit architectural guardrails passed.\\033[0m\\n"
exit 0
`;

export const buildGitHubWorkflowScript = (minGrade = 'B', minScore = 80) => `name: Chemical X Architectural Gatekeeper

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
        run: npx --yes chemx audit --min-grade=\${{ vars.CHEMX_MIN_GRADE || '${minGrade}' }} --min-score=\${{ vars.CHEMX_MIN_SCORE || ${minScore} }} --markdown --output=AUDIT_REPORT.md
      - name: Upload Audit Scorecard Artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: chemical-x-audit-report
          path: AUDIT_REPORT.md

      - name: Post Architectural Audit Comment on PR
        if: always() && github.event_name == 'pull_request' && hashFiles('AUDIT_REPORT.md') != ''
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
          if [ -z "\$DISCUSSION_URL" ]; then
            DISCUSSION_URL="https://github.com/orgs/Chemical-X-Protocol/discussions/categories/npx-chemx-audit"
          fi

          {
            echo "<!-- chemical-x-audit-pr-comment -->"
            echo "> 💬 **Architectural Discussion Topic:** [View Discussion & Community Showcase](\$DISCUSSION_URL)"
            echo ""
            cat AUDIT_REPORT.md
          } > PR_COMMENT.md

          EXISTING_COMMENT_ID=\$(gh api "repos/\$REPO/issues/\$PR_NUMBER/comments" --jq '.[] | select(.body | contains("<!-- chemical-x-audit-pr-comment -->")) | .id' | head -n 1)

          if [ -n "\$EXISTING_COMMENT_ID" ]; then
            gh api --method PATCH "repos/\$REPO/issues/comments/\$EXISTING_COMMENT_ID" -F body=@PR_COMMENT.md
          else
            gh pr comment "\$PR_NUMBER" --body-file PR_COMMENT.md
          fi
`;
