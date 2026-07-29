#!/usr/bin/env bash
# Tests for qmd-ensure.sh. Run: bash skills/pavilio-search/__tests__/qmd-ensure.test.sh
#
# A fake `qmd` is placed earlier in PATH and logs its arguments, so the real qmd
# invocations are verified without needing qmd, its models, or network access.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/qmd-ensure.sh"
PASS=0
FAIL=0

fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }
pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }

assert_contains() { # haystack needle label
  if [[ "$1" == *"$2"* ]]; then pass "$3"; else fail "$3 — expected to find '$2' in:
$1"; fi
}
assert_not_contains() {
  if [[ "$1" != *"$2"* ]]; then pass "$3"; else fail "$3 — did not expect '$2' in:
$1"; fi
}

# Builds a sandbox: fake qmd on PATH, a synthetic projects dir, an index.yml.
# Echoes the sandbox root.
setup() {
  local root; root="$(mktemp -d)"
  mkdir -p "$root/bin" "$root/config" "$root/projects"

  cat > "$root/bin/qmd" <<'FAKE'
#!/usr/bin/env bash
echo "$@" >> "$QMD_LOG"
FAKE
  chmod +x "$root/bin/qmd"

  for p in alpha beta; do
    mkdir -p "$root/projects/$p"
    echo "# $p" > "$root/projects/$p/PROJECT.md"
  done
  mkdir -p "$root/projects/no-project"          # missing PROJECT.md
  mkdir -p "$root/projects/archived/oldproj"
  echo "# old" > "$root/projects/archived/oldproj/PROJECT.md"
  # `ghost` below points at a missing path but exists under archived/, so --repoint-dead
  # has somewhere to point it.
  mkdir -p "$root/projects/archived/ghost"
  echo "# ghost" > "$root/projects/archived/ghost/PROJECT.md"

  cat > "$root/config/index.yml" <<CFG
collections:
  alpha:
    path: $root/projects/alpha
    pattern: "**/*.md"
  ghost:
    path: $root/projects/deleted-long-ago
    pattern: "**/*.md"
CFG

  echo "$root"
}

run() { # root, extra args...
  local root="$1"; shift
  PATH="$root/bin:$PATH" QMD_LOG="$root/qmd.log" \
    bash "$SCRIPT" --projects-dir "$root/projects" --config "$root/config/index.yml" "$@" 2>&1
}

echo "qmd-ensure.sh"

# --- dry run ---
root="$(setup)"
before="$(cat "$root/config/index.yml")"
out="$(run "$root" --dry-run)"
assert_contains "$out" "add: beta" "dry run plans the missing collection"
assert_not_contains "$out" "add: alpha" "dry run leaves an existing collection alone"
assert_contains "$out" "ok: alpha" "dry run reports the existing collection as ok"
assert_contains "$out" "dead: ghost" "dry run reports a collection whose path is gone"
assert_not_contains "$out" "add: no-project" "a directory without PROJECT.md is not a project"
assert_not_contains "$out" "add: oldproj" "archived projects are skipped by default"
if [[ "$before" == "$(cat "$root/config/index.yml")" ]]; then
  pass "dry run leaves index.yml byte-identical"
else
  fail "dry run modified index.yml"
fi
if [[ ! -s "$root/qmd.log" ]]; then pass "dry run invokes no qmd"; else fail "dry run invoked qmd: $(cat "$root/qmd.log")"; fi
rm -rf "$root"

# --- archived opt-in ---
root="$(setup)"
out="$(run "$root" --dry-run --include-archived)"
assert_contains "$out" "add: oldproj" "--include-archived picks up archived projects"
rm -rf "$root"

# --- a dead collection blocks the update rather than crashing it ---
root="$(setup)"
out="$(run "$root")"
rc=$?
if [[ $rc -ne 0 ]]; then pass "a dead collection makes the run fail fast"; else fail "expected non-zero exit, got $rc"; fi
assert_contains "$out" "Refusing to run qmd update" "explains why it refused"
assert_contains "$out" "--repoint-dead" "names the non-destructive remedy"
assert_contains "$out" "qmd collection remove" "names the destructive remedy"
if [[ ! -s "$root/qmd.log" ]]; then pass "no qmd invoked while a dead collection remains"; else fail "invoked qmd anyway: $(cat "$root/qmd.log")"; fi
rm -rf "$root"

# --- --repoint-dead fixes it non-destructively ---
root="$(setup)"
out="$(run "$root" --repoint-dead)"
assert_contains "$out" "repointed: ghost -> $root/projects/archived/ghost" "repoints a dead collection at its archived home"
assert_contains "$(cat "$root/config/index.yml")" "path: $root/projects/archived/ghost" "rewrites the path in index.yml"
assert_contains "$(cat "$root/config/index.yml")" "path: $root/projects/alpha" "leaves a healthy collection's path alone"
assert_contains "$(cat "$root/qmd.log")" "update" "runs the update once nothing is dead"
rm -rf "$root"

# --- live run (no dead collections) ---
root="$(setup)"
# drop `ghost` so the live path is exercised without the dead-collection guard.
# awk, not python3: this is a bash test suite and python3 is not a dependency of it.
awk '
  /^  ghost:$/ { skip = 1; next }
  skip && /^  [A-Za-z0-9_-]+:$/ { skip = 0 }
  skip && /^    / { next }
  { print }
' "$root/config/index.yml" > "$root/config/index.yml.tmp"
mv "$root/config/index.yml.tmp" "$root/config/index.yml"
out="$(run "$root")"
log="$(cat "$root/qmd.log")"
assert_contains "$log" "collection add $root/projects/beta --name beta --mask **/*.md" "adds the missing collection via qmd"
assert_not_contains "$log" "--name alpha" "does not re-add an existing collection"
assert_contains "$log" "update" "refreshes the index"
assert_contains "$log" "embed" "refreshes embeddings"
rm -rf "$root"

# --- idempotence: a second run adds nothing ---
root="$(setup)"
run "$root" >/dev/null
cat > "$root/config/index.yml" <<CFG
collections:
  alpha:
    path: $root/projects/alpha
    pattern: "**/*.md"
  beta:
    path: $root/projects/beta
    pattern: "**/*.md"
CFG
: > "$root/qmd.log"
out="$(run "$root")"
log="$(cat "$root/qmd.log")"
assert_not_contains "$log" "collection add" "a second run with everything registered adds nothing"
assert_contains "$out" "ok: beta" "the newly registered collection reports as ok"
rm -rf "$root"

# --- a project directory containing spaces ---
root="$(setup)"
mkdir -p "$root/projects/my app"
echo "# my app" > "$root/projects/my app/PROJECT.md"
out="$(run "$root" --repoint-dead)"
log="$(cat "$root/qmd.log")"
assert_contains "$out" "add: my app $root/projects/my app" "reports a spaced project name whole"
assert_contains "$log" "collection add $root/projects/my app --name my app" "registers it with the full name and path"
assert_not_contains "$out" "add: my $root" "does not split the name on the space"
rm -rf "$root"

# --- --dry-run --repoint-dead shows the repoint plan ---
root="$(setup)"
out="$(run "$root" --dry-run --repoint-dead)"
assert_contains "$out" "would repoint: ghost -> $root/projects/archived/ghost" "dry run shows what repointing would do"
assert_contains "$out" "plan-only (dry run)" "still reports it changed nothing"
assert_contains "$(cat "$root/config/index.yml")" "path: $root/projects/deleted-long-ago" "leaves index.yml untouched"
if [[ ! -s "$root/qmd.log" ]]; then pass "dry run invokes no qmd"; else fail "invoked qmd: $(cat "$root/qmd.log")"; fi
rm -rf "$root"

# --- dry run reports the refusal it would hit ---
root="$(setup)"
out="$(run "$root" --dry-run)"
assert_contains "$out" "would refuse to run qmd update" "dry run warns about the dead collection"
rm -rf "$root"

# --- a missing qmd is named, not a bare "command not found" ---
root="$(setup)"
rm "$root/bin/qmd"
# PATH is emptied so the real qmd (installed via bun) cannot satisfy the check either
out="$(PATH="$root/bin:/usr/bin:/bin" QMD_LOG="$root/qmd.log" \
  bash "$SCRIPT" --projects-dir "$root/projects" --config "$root/config/index.yml" --repoint-dead 2>&1)"
rc=$?
assert_contains "$out" "qmd not found on PATH" "says which dependency is missing"
assert_not_contains "$out" "command not found" "does not surface a bare shell error"
if [[ $rc -ne 0 ]]; then pass "exits non-zero when qmd is missing"; else fail "expected non-zero exit, got $rc"; fi
rm -rf "$root"

# --- --help does not depend on line numbers in the header ---
root="$(setup)"
out="$(run "$root" --help)"
assert_contains "$out" "Usage: qmd-ensure.sh" "help prints usage"
assert_contains "$out" "--repoint-dead" "help lists every flag"
assert_not_contains "$out" "#!/usr/bin/env" "help does not leak the shebang"
rm -rf "$root"

echo ""
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
