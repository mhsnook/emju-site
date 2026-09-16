#!/usr/bin/env bash
# Collect normalised static-check output into $1.
#
# Runs once on the head tree and once on the base tree, always from that tree's
# own root. Output is one sorted line per issue, so the diff engine can treat
# the two runs as comparable sets.
#
# NOTE: this script ends by restoring the tree with `git checkout -- .`. That is
# correct in CI, where the checkout is clean. Run it against a working tree with
# uncommitted edits and it discards them.

# Deliberately no `-e`: every check here exits non-zero when it finds issues,
# which is the normal case, not a script failure.
set -uo pipefail

OUT="${1:?usage: collect-static.sh <output-dir>}"
mkdir -p "$OUT"

# Byte-order sorting, so the two trees produce comparable lists even if the two
# runners ever differ in locale. `sort` under a UTF-8 locale ignores leading
# punctuation, which would order `.oxfmtrc.json` after `AGENTS.md`.
export LC_ALL=C

# Paths kept out of the lint and formatter deltas. Generated and build output
# produces noise nobody on the PR can act on.
#
# This repeats what .oxlintrc.json and .oxfmtrc.json already ignore, on purpose.
# Each tree is measured with its own config until the base job checks the
# configs out from head, so duplicating the list means a PR that edits one of
# those configs cannot move its own baseline.
EXCLUDE='^(dist/|drizzle/|scenetest-reports/|scenetest/\.reports/|\.wrangler/|\.github/ci/|src/routeTree\.gen\.ts$|worker-configuration\.d\.ts$)'

# `tsc --noEmit` needs the Cloudflare binding types, which are generated and
# gitignored. `pnpm install` generates them on postinstall; regenerate them here
# too so this script also works on a tree where install was cached. Seconds, and
# it keeps the typecheck independent of the build.
pnpm exec wrangler types >/dev/null 2>&1

# Read-only checks run concurrently. The typechecker is the long pole and the
# linter finishes underneath it, so this is close to free.
(
	# Keep the grep — it drops the summary lines, which change with the error
	# count and would diff as noise.
	pnpm exec tsc --noEmit 2>&1 | grep ': error TS' | sort >"$OUT/typecheck.txt"
	status=${PIPESTATUS[0]}

	# A typechecker that failed but printed nothing the grep recognises would
	# leave an empty file, which reads as zero errors and merges clean. Record
	# the failure as an issue instead.
	if [ "$status" -ne 0 ] && [ ! -s "$OUT/typecheck.txt" ]; then
		echo "typecheck:0:0: error TS0000: the typechecker exited $status without recognisable error lines — see the job log" \
			>"$OUT/typecheck.txt"
	fi
) &
(
	# oxlint is the only linter here. `-f unix` gives `file:line:col: message`,
	# which is what the diff engine's unix parser reads.
	pnpm exec oxlint . -f unix >"$OUT/.oxlint.raw" 2>&1
	grep -E '^[^:[:space:]][^:]*:[0-9]+:[0-9]+:' "$OUT/.oxlint.raw" |
		grep -Ev "$EXCLUDE" |
		sort -u >"$OUT/lint.txt"
	rm -f "$OUT/.oxlint.raw"
) &
wait

# The formatter REWRITES files, so it runs after the read-only checks. The set
# of files it modified is exactly the formatting debt — no separate --check
# pass needed. Restore the tree afterwards so later steps see a clean checkout.
#
# `git diff --name-only` gives repo-root-relative paths with no `./` prefix,
# which is the same shape the workflow's touched.txt step produces. The
# formatter gate intersects the two lists, and a mismatch would make that
# intersection empty on every PR.
pnpm exec oxfmt . >/dev/null 2>&1
git diff --name-only | grep -Ev "$EXCLUDE" | sort >"$OUT/format.txt"
git checkout -- .

# Never let a missing file break the render step.
#
# `touched.txt` is deliberately NOT in this list. The workflow writes it into
# the same directory on the head tree only, and the formatter gate reads its
# ABSENCE as "the step that lists this PR's files did not run" — an empty file
# here would turn that failure into a silent pass.
for f in typecheck lint format; do
	[ -f "$OUT/$f.txt" ] || : >"$OUT/$f.txt"
done

wc -l "$OUT"/*.txt
