validation_worktree_path=
validation_worktree_repo=

repo_require_clean() {
    repo_dir=$1
    label=$2
    status=$(git -C "$repo_dir" status --porcelain --untracked-files=normal 2>/dev/null) ||
        fatal "cannot inspect $label working tree"
    if [ -n "$status" ]; then
        say_error "$label working tree is not clean"
        printf '%s\n' "$status" >&2
        exit "$LAUNCHER_STATUS_ERROR"
    fi
}

repo_pull_ff_only() {
    repo_dir=$1
    label=$2
    repo_require_no_tracked_changes "$repo_dir" "$label"
    say "Updating $label..."
    git -C "$repo_dir" pull --ff-only || fatal "cannot update $label with fast-forward only"
}

load_config() {
    config_path=$1
    validation_kind=
    validation_selections=
    expected_rumiai_os_commit=
    kind_seen=0
    commit_seen=0
    selection_count=0
    tab=$(printf '\t')

    [ -r "$config_path" ] || fatal "configuration file not found: $config_path"

    while IFS="$tab" read -r key value extra || [ -n "$key$value$extra" ]; do
        case $key in
            ''|'#'*)
                continue
                ;;
            kind)
                [ "$kind_seen" -eq 0 ] || fatal 'duplicate kind in configuration'
                [ -z "$extra" ] || fatal 'invalid kind record in configuration'
                case $value in task|health) validation_kind=$value ;; *) fatal "invalid validation kind: $value" ;; esac
                kind_seen=1
                ;;
            selection)
                [ -n "$value" ] || fatal 'empty selection in configuration'
                [ -z "$extra" ] || fatal 'invalid selection record in configuration'
                case "
$validation_selections
" in
                    *"
$value
"*) fatal "duplicate selection in configuration: $value" ;;
                esac
                if [ -n "$validation_selections" ]; then
                    validation_selections="$validation_selections
$value"
                else
                    validation_selections=$value
                fi
                selection_count=$((selection_count + 1))
                ;;
            rumiai-os-commit)
                [ "$commit_seen" -eq 0 ] || fatal 'duplicate rumiai-os-commit in configuration'
                [ -n "$value" ] || fatal 'empty rumiai-os-commit in configuration'
                [ -z "$extra" ] || fatal 'invalid rumiai-os-commit record in configuration'
                expected_rumiai_os_commit=$value
                commit_seen=1
                ;;
            *)
                fatal "unknown configuration key: $key"
                ;;
        esac
    done < "$config_path"

    [ "$commit_seen" -eq 1 ] || fatal 'configuration does not define rumiai-os-commit'
    [ "$selection_count" -gt 0 ] || fatal 'configuration does not define selection'

    if [ "$kind_seen" -eq 0 ]; then
        if [ -n "${validation_scope_name-}" ]; then
            validation_kind=task
        else
            validation_kind=health
        fi
    fi
}

latest_completed_session() {
    sessions_dir=$1
    latest=$(
        for candidate in "$sessions_dir"/*; do
            [ -d "$candidate" ] || continue
            candidate_name=${candidate##*/}
            [ "${candidate_name#.*}" = "$candidate_name" ] || continue
            printf '%s\n' "$candidate"
        done | LC_ALL=C sort | sed -n '$p'
    )
    [ -n "$latest" ] || return 1
    printf '%s\n' "$latest"
}

session_field() {
    session_file=$1
    field_name=$2
    awk -F '\t' -v field_name="$field_name" '
        $1 == field_name { count += 1; value = $2 }
        END {
            if (count != 1) exit 1
            print value
        }
    ' "$session_file"
}

validation_remote() {
    branch=$(git -C "$suite_root" symbolic-ref --quiet --short -- HEAD 2>/dev/null) || return 1
    remote=$(git -C "$suite_root" config --get -- "branch.$branch.remote" 2>/dev/null) || return 1
    [ -n "$remote" ] && [ "$remote" != "." ] || return 1
    printf '%s\n' "$remote"
}

prepare_validation_session_tree() {
    session_dir=$1
    recorded_commit=$2
    session_name=${session_dir##*/}
    relative_session=sessions/$session_name
    index_file=${TMPDIR:-/tmp}/rumiai-validate-index-$$-$session_name

    rm -f "$index_file" 2>/dev/null || return 1

    if git -C "$suite_root" ls-tree -r --name-only "$recorded_commit" -- "$relative_session" 2>/dev/null | grep . >/dev/null 2>&1; then
        rm -f "$index_file" 2>/dev/null || :
        return 2
    fi

    GIT_INDEX_FILE="$index_file" git -C "$suite_root" read-tree -- "$recorded_commit" >/dev/null 2>&1 || {
        rm -f "$index_file" 2>/dev/null || :
        return 1
    }
    GIT_INDEX_FILE="$index_file" git -C "$suite_root" add -- "$relative_session" >/dev/null 2>&1 || {
        rm -f "$index_file" 2>/dev/null || :
        return 1
    }
    evidence_tree=$(GIT_INDEX_FILE="$index_file" git -C "$suite_root" write-tree 2>/dev/null) || {
        rm -f "$index_file" 2>/dev/null || :
        return 1
    }
    rm -f "$index_file" 2>/dev/null || return 1
    printf '%s\n' "$evidence_tree"
}

publish_validation_session() {
    session_dir=$1
    session_name=${session_dir##*/}
    relative_session=sessions/$session_name
    session_file=$session_dir/session
    results_file=$session_dir/results

    [ -f "$session_file" ] && [ -r "$session_file" ] || fatal "pending validation session lacks readable metadata: $session_name"
    [ -f "$results_file" ] && [ -r "$results_file" ] || fatal "pending validation session lacks readable results: $session_name"
    [ ! -e "$session_dir/.work" ] || fatal "pending validation session is incomplete: $session_name"

    session_type=$(session_field "$session_file" type 2>/dev/null) || fatal "pending validation session has invalid type metadata: $session_name"
    [ "$session_type" = validation ] || fatal "pending session is not a validation session: $session_name"

    recorded_commit=$(session_field "$session_file" rumiai-tests-commit 2>/dev/null) ||
        fatal "pending validation session lacks an exact rumiai-tests commit: $session_name"
    resolved_commit=$(git -C "$suite_root" rev-parse --verify "$recorded_commit^{commit}" 2>/dev/null) ||
        fatal "pending validation session references an unavailable rumiai-tests commit: $session_name"
    [ "$resolved_commit" = "$recorded_commit" ] ||
        fatal "pending validation session does not record a canonical rumiai-tests commit: $session_name"

    session_field "$session_file" end >/dev/null 2>&1 || fatal "pending validation session lacks completion metadata: $session_name"
    recorded_status=$(session_field "$session_file" runner-exit-status 2>/dev/null) ||
        fatal "pending validation session lacks runner status: $session_name"
    case $recorded_status in
        0|1|2) : ;;
        *) fatal "pending validation session has non-publishable runner status: $session_name" ;;
    esac

    evidence_tree=$(prepare_validation_session_tree "$session_dir" "$recorded_commit")
    prepare_status=$?
    case $prepare_status in
        0) : ;;
        2) fatal "validation session path already exists in recorded suite commit: $session_name" ;;
        *) fatal "cannot prepare validation evidence commit: $session_name" ;;
    esac

    publication_branch=validation/$session_name
    publication_ref=refs/heads/$publication_branch
    git check-ref-format "$publication_ref" >/dev/null 2>&1 || fatal "invalid validation publication ref: $publication_ref"
    remote=$(validation_remote) || fatal 'cannot determine rumiai-tests publication remote'

    remote_line=$(git -C "$suite_root" ls-remote -- "$remote" "$publication_ref" 2>/dev/null) ||
        fatal "cannot inspect remote validation publication ref: $publication_branch"

    if [ -n "$remote_line" ]; then
        git -C "$suite_root" fetch --no-tags -- "$remote" "$publication_ref" >/dev/null 2>&1 ||
            fatal "cannot fetch existing validation publication ref: $publication_branch"
        remote_commit=$(git -C "$suite_root" rev-parse --verify FETCH_HEAD 2>/dev/null) ||
            fatal "cannot resolve existing validation publication ref: $publication_branch"
        remote_tree=$(git -C "$suite_root" rev-parse --verify "$remote_commit^{tree}" 2>/dev/null) ||
            fatal "cannot inspect existing validation publication tree: $publication_branch"
        parent_line=$(git -C "$suite_root" rev-list --parents -n 1 "$remote_commit" 2>/dev/null) ||
            fatal "cannot inspect existing validation publication parent: $publication_branch"
        [ "$parent_line" = "$remote_commit $recorded_commit" ] && [ "$remote_tree" = "$evidence_tree" ] ||
            fatal "remote validation publication ref conflicts with local evidence: $publication_branch"
    else
        evidence_commit=$(printf '%s\n' "Record validation session $session_name" |
            git -C "$suite_root" commit-tree "$evidence_tree" -p "$recorded_commit" 2>/dev/null) ||
            fatal "cannot create validation evidence commit: $session_name"
        git -C "$suite_root" push -- "$remote" "$evidence_commit:$publication_ref" >/dev/null 2>&1 ||
            fatal "cannot push validation evidence: $publication_branch"
        published_line=$(git -C "$suite_root" ls-remote -- "$remote" "$publication_ref" 2>/dev/null) ||
            fatal "cannot verify published validation evidence: $publication_branch"
        published_commit=${published_line%%[[:space:]]*}
        [ "$published_commit" = "$evidence_commit" ] || fatal "published validation evidence does not match local commit: $publication_branch"
    fi

    rm -rf "$session_dir" || fatal "validation evidence was published but local session cleanup failed: $session_name"
    say "Published: $publication_branch"
}

publish_pending_validation_sessions() {
    sessions_dir=$suite_root/sessions
    [ -d "$sessions_dir" ] || return 0

    for candidate in "$sessions_dir"/*; do
        [ -d "$candidate" ] || continue
        session_name=${candidate##*/}
        relative_session=sessions/$session_name
        tracked=$(git -C "$suite_root" ls-files -- "$relative_session" 2>/dev/null) ||
            fatal "cannot inspect validation session tracking state: $session_name"
        [ -z "$tracked" ] || continue
        say "Publishing pending validation session: $session_name..."
        publish_validation_session "$candidate"
    done
}

show_platform() {
    host_os=$(uname -s 2>/dev/null || printf '%s' unknown)
    host_arch=$(uname -m 2>/dev/null || printf '%s' unknown)
    say "Platform: $host_os/$host_arch"
}

validation_cleanup() {
    [ -n "$validation_worktree_path" ] || return 0
    [ -n "$validation_worktree_repo" ] || return 1

    if ! git -C "$validation_worktree_repo" worktree remove "$validation_worktree_path" >/dev/null 2>&1; then
        return 1
    fi
    validation_worktree_path=
    validation_worktree_repo=
    return 0
}

prepare_target_revision() {
    primary_root=$1
    expected_commit=$2

    git -C "$primary_root" cat-file -e "$expected_commit^{commit}" 2>/dev/null ||
        fatal "configured rumiai-os commit is unavailable after update: $expected_commit"

    primary_head=$(git -C "$primary_root" rev-parse HEAD 2>/dev/null) || fatal 'cannot read rumiai-os HEAD'
    if [ "$primary_head" = "$expected_commit" ]; then
        validation_target_root=$primary_root
        return 0
    fi

    validation_worktree_repo=$primary_root
    validation_worktree_path=${TMPDIR:-/tmp}/rumiai-validate-rumiai-os-$$
    [ ! -e "$validation_worktree_path" ] || fatal "temporary target path already exists: $validation_worktree_path"

    say "Preparing rumiai-os worktree at $expected_commit..." >&2
    git -C "$primary_root" worktree add --detach "$validation_worktree_path" "$expected_commit" >/dev/null 2>&1 ||
        fatal "cannot create temporary rumiai-os worktree for $expected_commit"

    validation_target_root=$validation_worktree_path
}

session_has_skip() {
    results_file=$1
    awk -F '\t' '$1 == "SKIP" { found=1 } END { exit found ? 0 : 1 }' "$results_file"
}

merge_scope_status() {
    current=$1
    candidate=$2
    case $candidate in
        3) printf '%s\n' 3 ;;
        2) case $current in 3) printf '%s\n' 3 ;; *) printf '%s\n' 2 ;; esac ;;
        1) case $current in 3|2) printf '%s\n' "$current" ;; *) printf '%s\n' 1 ;; esac ;;
        *) printf '%s\n' "$current" ;;
    esac
}

run_validation_selection() {
    selection=$1
    runner=$2

    say "Selection:    $selection"
    say 'Starting validation...'

    session_before=$(latest_completed_session "$suite_root/sessions" 2>/dev/null || printf '')
    "$runner" --validation -- "$selection"
    runner_status=$?
    session_after=$(latest_completed_session "$suite_root/sessions" 2>/dev/null || printf '')

    say 'Validation finished.'
    say "Status: $runner_status"

    case $runner_status in
        0|1|2) scope_status=$runner_status ;;
        *) scope_status=3 ;;
    esac
    if [ -n "$session_after" ] && [ "$session_after" != "$session_before" ]; then
        say "Session: ${session_after##*/}"
        if [ "$validation_kind" = task ] && [ "$runner_status" -eq 0 ] && session_has_skip "$session_after/results"; then
            say 'Task scope contains SKIP: selection is not positively validated.'
            scope_status=1
        fi
        publish_validation_session "$session_after"
    else
        say 'Session: no new completed validation session'
        if [ "$validation_kind" = task ]; then
            scope_status=3
        fi
    fi

    return "$scope_status"
}

rumiai_validate_run() {
    command -v uname >/dev/null 2>&1 || fatal 'uname is required'
    command -v awk >/dev/null 2>&1 || fatal 'awk is required'

    repo_require_no_tracked_changes "$suite_root" 'rumiai-tests'
    publish_pending_validation_sessions
    repo_require_clean "$suite_root" 'rumiai-tests'

    if [ -n "${validation_scope_name-}" ]; then
        config_path=$suite_root/validation/$validation_scope_name.conf
        scope_label=$validation_scope_name
    else
        config_path=$suite_root/rumiai-validate.conf
        scope_label=default
    fi
    load_config "$config_path"

    target_lib=$suite_root/lib/rumiai-os-target.lib
    [ -r "$target_lib" ] || fatal "target discovery library not found: $target_lib"
    . "$target_lib"

    primary_target_root=$(rumiai_test_target_rumiai_os_find "$suite_root")
    target_status=$?
    case $target_status in
        0) : ;;
        1) fatal 'rumiai-os target checkout not found' ;;
        2) fatal 'invalid explicit rumiai-os target checkout' ;;
        *) fatal 'rumiai-os target discovery failed' ;;
    esac

    repo_pull_ff_only "$primary_target_root" 'rumiai-os'
    repo_require_clean "$primary_target_root" 'rumiai-os'

    prepare_target_revision "$primary_target_root" "$expected_rumiai_os_commit" ||
        fatal 'cannot prepare configured rumiai-os revision'
    RUMIAI_TEST_RUMIAI_OS_ROOT=$validation_target_root
    export RUMIAI_TEST_RUMIAI_OS_ROOT

    runner=$suite_root/rumiai-test
    [ -x "$runner" ] || fatal 'rumiai-test is not executable'

    show_platform
    say "rumiai-tests: $(git -C "$suite_root" rev-parse HEAD 2>/dev/null)"
    say "rumiai-os:    $expected_rumiai_os_commit"
    say "Scope:        $scope_label ($validation_kind)"

    aggregate_status=0
    old_ifs=$IFS
    selection_ifs=$(printf '\n_')
    selection_ifs=${selection_ifs%_}
    IFS=$selection_ifs
    for validation_selection in $validation_selections; do
        IFS=$old_ifs
        run_validation_selection "$validation_selection" "$runner"
        selection_status=$?
        aggregate_status=$(merge_scope_status "$aggregate_status" "$selection_status")
        [ "$aggregate_status" -ne 3 ] || break
        IFS=$selection_ifs
    done
    IFS=$old_ifs

    if ! validation_cleanup; then
        fatal 'cannot remove temporary rumiai-os worktree'
    fi
    unset RUMIAI_TEST_RUMIAI_OS_ROOT

    case $validation_kind:$aggregate_status in
        task:0) say 'Scope result: VALIDATED' ;;
        task:1) say 'Scope result: NOT VALIDATED' ;;
        task:2) say 'Scope result: TEST ERROR' ;;
        health:0) say 'Health result: SUCCESS' ;;
        health:1) say 'Health result: FAIL' ;;
        health:2) say 'Health result: TEST ERROR' ;;
        *) say 'Validation result: ERROR' ;;
    esac

    return "$aggregate_status"
}
