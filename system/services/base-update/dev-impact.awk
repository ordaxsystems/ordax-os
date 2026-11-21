# Owner Development Base production impact. Only this classifier decides
# whether a changed source path needs an exact-commit Base candidate.
# Usage: awk -f dev-impact.awk dev-helper-manifest.tsv - < changed-paths
# Output: 0 (no Base bytes affected), 1 (candidate needed); invalid input exits 2.
BEGIN { FS = "\t" }
FILENAME == ARGV[1] {
    if ($0 == "" || $0 ~ /^#/) next
    if (NF < 2 || NF > 3 ||
        $1 !~ /^bootstrap\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/ ||
        $1 ~ /(^|\/)\.\.($|\/)/ || ($1 in helpers)) {
        invalid = 1
        next
    }
    helpers[$1] = 1
    helper_count++
    next
}
{
    path = $0
    if (path == "") next
    # Git quotes unusual paths. Consumers must not misclassify escaped
    # paths, absolute paths, or noncanonical path segments.
    if (path ~ /^["\/]/ || path ~ /(^|\/)\.\.?($|\/)/ ||
        path ~ /[[:cntrl:]\\]/) {
        invalid = 1
        next
    }
    if (path in helpers) next
    if (path ~ /^bootstrap\/kernel\/candidates\// ||
        path == "bootstrap/kernel/candidate_pipeline.py" ||
        path == "bootstrap/kernel/update_engine.py" ||
        path == "bootstrap/kernel/module_archive.py") next
    # Boot/ESP policy and delivery tooling outside this producer are not
    # Base bytes. They retain their own owners and activation requirements.
    if (path ~ /^bootstrap\/(kernel|initramfs|dev-base|independent-base|recovery)\// ||
        path ~ /^tools\/dev-base-channel\// ||
        path == "bootstrap/base/firmware_policy.py" ||
        path == "docs/contracts/hardware-support-matrix.json") affected = 1
}
END {
    if (invalid || !helper_count) exit 2
    print affected ? 1 : 0
}
