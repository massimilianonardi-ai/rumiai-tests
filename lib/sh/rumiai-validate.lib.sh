validation_environment_root=
validation_environment_counter=0
validation_evidence_work=
validation_evidence_id=
validation_audit_status=CLEAN

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

    if [ "$kind_seen" -eq 0 ]; then
        if [ -n "${validation_scope_name-}" ]; then
            validation_kind=task
        else
            validation_kind=health
        fi
    fi

    if [ "$selection_count" -eq 0 ] && [ "$validation_kind" != health ]; then
        fatal 'task configuration does not define selection'
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

prepare_validation_record_tree() {
    record_dir=$1
    recorded_commit=$2
    record_name=${record_dir##*/}
    relative_record=validations/$record_name
    index_file=${TMPDIR:-/tmp}/rumiai-validate-record-index-$-$record_name

    rm -f "$index_file" 2>/dev/null || return 1
    if git -C "$suite_root" ls-tree -r --name-only "$recorded_commit" -- "$relative_record" 2>/dev/null | grep . >/dev/null 2>&1; then
        rm -f "$index_file" 2>/dev/null || :
        return 2
    fi
    GIT_INDEX_FILE="$index_file" git -C "$suite_root" read-tree -- "$recorded_commit" >/dev/null 2>&1 || {
        rm -f "$index_file" 2>/dev/null || :
        return 1
    }
    GIT_INDEX_FILE="$index_file" git -C "$suite_root" add -- "$relative_record" >/dev/null 2>&1 || {
        rm -f "$index_file" 2>/dev/null || :
        return 1
    }
    record_tree=$(GIT_INDEX_FILE="$index_file" git -C "$suite_root" write-tree 2>/dev/null) || {
        rm -f "$index_file" 2>/dev/null || :
        return 1
    }
    rm -f "$index_file" 2>/dev/null || return 1
    printf '%s\n' "$record_tree"
}

publish_validation_record() {
    record_dir=$1
    record_name=${record_dir##*/}
    metadata=$record_dir/validation
    sessions=$record_dir/sessions

    [ -r "$metadata" ] || fatal "pending validation record lacks metadata: $record_name"
    [ -r "$sessions" ] || fatal "pending validation record lacks session list: $record_name"
    recorded_commit=$(session_field "$metadata" rumiai-tests-commit 2>/dev/null) ||
        fatal "pending validation record lacks exact rumiai-tests commit: $record_name"
    session_field "$metadata" end >/dev/null 2>&1 ||
        fatal "pending validation record lacks completion metadata: $record_name"
    recorded_status=$(session_field "$metadata" aggregate-status 2>/dev/null) ||
        fatal "pending validation record lacks aggregate status: $record_name"
    case $recorded_status in
        0|1|2) : ;;
        *) fatal "pending validation record has non-publishable status: $record_name" ;;
    esac

    record_tree=$(prepare_validation_record_tree "$record_dir" "$recorded_commit")
    prepare_status=$?
    case $prepare_status in
        0) : ;;
        2) fatal "validation record path already exists in recorded suite commit: $record_name" ;;
        *) fatal "cannot prepare validation record tree: $record_name" ;;
    esac

    publication_branch=validation/$record_name
    publication_ref=refs/heads/$publication_branch
    git check-ref-format "$publication_ref" >/dev/null 2>&1 ||
        fatal "invalid validation publication ref: $publication_ref"
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
        [ "$parent_line" = "$remote_commit $recorded_commit" ] && [ "$remote_tree" = "$record_tree" ] ||
            fatal "remote validation publication ref conflicts with local evidence: $publication_branch"
    else
        record_commit=$(printf '%s\n' "Record validation $record_name" |
            git -C "$suite_root" commit-tree "$record_tree" -p "$recorded_commit" 2>/dev/null) ||
            fatal "cannot create validation record commit: $record_name"
        git -C "$suite_root" push -- "$remote" "$record_commit:$publication_ref" >/dev/null 2>&1 ||
            fatal "cannot push validation record: $publication_branch"
        published_line=$(git -C "$suite_root" ls-remote -- "$remote" "$publication_ref" 2>/dev/null) ||
            fatal "cannot verify published validation record: $publication_branch"
        published_commit=${published_line%%[[:space:]]*}
        [ "$published_commit" = "$record_commit" ] ||
            fatal "published validation record does not match local commit: $publication_branch"
    fi

    rm -rf "$record_dir" || fatal "published validation record cleanup failed: $record_name"
    say "Published: $publication_branch"
}

publish_pending_validation_records() {
    records_dir=$suite_root/validations
    [ -d "$records_dir" ] || return 0

    for candidate in "$records_dir"/*; do
        [ -d "$candidate" ] || continue
        record_name=${candidate##*/}
        relative_record=validations/$record_name
        tracked=$(git -C "$suite_root" ls-files -- "$relative_record" 2>/dev/null) ||
            fatal "cannot inspect validation record tracking state: $record_name"
        [ -z "$tracked" ] || continue
        say "Publishing pending validation record: $record_name..."
        publish_validation_record "$candidate"
    done
}

show_platform() {
    host_os=$(uname -s 2>/dev/null || printf '%s' unknown)
    host_arch=$(uname -m 2>/dev/null || printf '%s' unknown)
    say "Platform: $host_os/$host_arch"
}

validation_environment_destroy() {
    [ -n "$validation_environment_root" ] || return 0
    rm -rf "$validation_environment_root" || return 1
    validation_environment_root=
    validation_target_root=
    return 0
}

validation_cleanup() {
    cleanup_status=0
    validation_environment_destroy || cleanup_status=1
    if [ -n "$validation_evidence_work" ] && [ -e "$validation_evidence_work" ]; then
        rm -rf "$validation_evidence_work" || cleanup_status=1
    fi
    validation_evidence_work=
    return "$cleanup_status"
}

prepare_validation_environment() {
    primary_root=$1
    expected_commit=$2

    git -C "$primary_root" cat-file -e "$expected_commit^{commit}" 2>/dev/null ||
        fatal "configured rumiai-os commit is unavailable after update: $expected_commit"
    primary_origin=$(git -C "$primary_root" config --get remote.origin.url 2>/dev/null) ||
        fatal 'cannot read rumiai-os canonical origin URL'

    validation_environment_counter=$((validation_environment_counter + 1))
    validation_environment_root=${TMPDIR:-/tmp}/rumiai-validate-env-$$-$validation_environment_counter
    [ ! -e "$validation_environment_root" ] || fatal "temporary validation environment already exists: $validation_environment_root"
    mkdir -p "$validation_environment_root/home/.config" \
        "$validation_environment_root/home/.cache" \
        "$validation_environment_root/home/.local/share" \
        "$validation_environment_root/home/.local/state" \
        "$validation_environment_root/tmp" \
        "$validation_environment_root/runtime" || fatal 'cannot create temporary validation user environment'
    chmod 700 "$validation_environment_root/home" "$validation_environment_root/tmp" "$validation_environment_root/runtime" ||
        fatal 'cannot protect temporary validation user environment'

    validation_target_root=$validation_environment_root/target
    say "Preparing isolated rumiai-os clone at $expected_commit..." >&2
    git clone --no-local --no-checkout -q -- "$primary_root" "$validation_target_root" ||
        fatal 'cannot create independent temporary rumiai-os clone'
    if ! git -C "$validation_target_root" cat-file -e "$expected_commit^{commit}" 2>/dev/null; then
        git -C "$validation_target_root" fetch -q --no-tags -- "$primary_root" "$expected_commit" ||
            fatal "cannot materialize configured rumiai-os commit in temporary clone: $expected_commit"
    fi
    git -C "$validation_target_root" checkout -q --detach "$expected_commit" ||
        fatal "cannot checkout configured rumiai-os commit in temporary clone: $expected_commit"
    git -C "$validation_target_root" remote set-url origin "$primary_origin" ||
        fatal 'cannot restore canonical origin URL in temporary rumiai-os clone'
    [ -z "$(git -C "$validation_target_root" status --porcelain --untracked-files=normal 2>/dev/null)" ] ||
        fatal 'temporary rumiai-os clone is not clean after preparation'
}

validation_environment_run() {
    env_root=$1
    shift
    HOME="$env_root/home" \
    TMPDIR="$env_root/tmp" \
    TMP="$env_root/tmp" \
    TEMP="$env_root/tmp" \
    XDG_CONFIG_HOME="$env_root/home/.config" \
    XDG_CACHE_HOME="$env_root/home/.cache" \
    XDG_DATA_HOME="$env_root/home/.local/share" \
    XDG_STATE_HOME="$env_root/home/.local/state" \
    XDG_RUNTIME_DIR="$env_root/runtime" \
    RUMIAI_TEST_RUMIAI_OS_ROOT="$env_root/target" \
    export HOME TMPDIR TMP TEMP XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_RUNTIME_DIR RUMIAI_TEST_RUMIAI_OS_ROOT
    "$@"
}

validation_record_put() {
    key=$1
    value=$(printf '%s' "$2" | tr '\t\r\n' '   ')
    printf '%s\t%s\n' "$key" "$value" >> "$validation_evidence_work/validation"
}

validation_evidence_begin() {
    validation_stamp=$(date '+%Y%m%dT%H%M%S%z' 2>/dev/null) || fatal 'cannot create validation timestamp'
    validation_evidence_id=$validation_stamp-$$
    validation_evidence_work=${TMPDIR:-/tmp}/rumiai-validation-evidence-$validation_evidence_id
    [ ! -e "$validation_evidence_work" ] || fatal 'validation evidence work path already exists'
    mkdir -p "$validation_evidence_work" || fatal 'cannot create validation evidence work directory'
    : > "$validation_evidence_work/validation" || fatal 'cannot create validation metadata'
    : > "$validation_evidence_work/sessions" || fatal 'cannot create validation session index'
    : > "$validation_evidence_work/selections" || fatal 'cannot create validation selection index'

    validation_record_put type validation || fatal 'cannot write validation metadata'
    validation_record_put start "$(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || printf unknown)" || fatal 'cannot write validation metadata'
    validation_record_put scope "$scope_label" || fatal 'cannot write validation metadata'
    validation_record_put kind "$validation_kind" || fatal 'cannot write validation metadata'
    validation_record_put isolation "$validation_isolation" || fatal 'cannot write validation metadata'
    validation_record_put rumiai-tests-commit "$suite_commit" || fatal 'cannot write validation metadata'
    validation_record_put rumiai-os-commit "$expected_rumiai_os_commit" || fatal 'cannot write validation metadata'
    validation_record_put os "$(uname -s 2>/dev/null || printf unknown)" || fatal 'cannot write validation metadata'
    validation_record_put architecture "$(uname -m 2>/dev/null || printf unknown)" || fatal 'cannot write validation metadata'

    if [ "$selection_count" -eq 0 ]; then
        printf '%s\n' 'tests/' > "$validation_evidence_work/selections" || fatal 'cannot write validation selections'
    else
        printf '%s\n' "$validation_selections" > "$validation_evidence_work/selections" || fatal 'cannot write validation selections'
    fi
}

validation_audit_begin() {
    env_root=$1
    audit_dir=$2
    mkdir -p "$audit_dir" || return 1
    rumiai_test_fs_snapshot_prepare metadata "$env_root" || return 1
    rumiai_test_fs_snapshot_take "$env_root" "$audit_dir/before" "$audit_dir/.before-work" "" || return 1
}

validation_audit_end() {
    env_root=$1
    audit_dir=$2
    audit_label=$3
    rumiai_test_fs_snapshot_prepare metadata "$env_root" || return 2
    rumiai_test_fs_snapshot_take "$env_root" "$audit_dir/after" "$audit_dir/.after-work" "" || return 2
    rumiai_test_fs_snapshot_compare "$audit_dir/before" "$audit_dir/after" "$audit_dir/diff"
    audit_compare_status=$?
    case $audit_compare_status in
        0)
            printf 'CLEAN  %s\n' "$audit_label"
            return 0
            ;;
        1)
            printf 'CHANGED %s\n' "$audit_label"
            validation_audit_status=CHANGED
            return 1
            ;;
        *)
            printf 'ERROR  %s\n' "$audit_label"
            return 2
            ;;
    esac
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
    env_root=$3

    if [ -n "$selection" ]; then
        say "Selection:    $selection"
    else
        say 'Selection:    tests/ (full suite)'
    fi
    say 'Starting validation...'

    session_before=$(latest_completed_session "$suite_root/sessions" 2>/dev/null || printf '')
    if [ -n "$selection" ]; then
        validation_environment_run "$env_root" "$runner" --validation -- "$selection"
    else
        validation_environment_run "$env_root" "$runner" --validation
    fi
    runner_status=$?
    session_after=$(latest_completed_session "$suite_root/sessions" 2>/dev/null || printf '')

    say 'Validation finished.'
    say "Status: $runner_status"

    case $runner_status in
        0|1|2) scope_status=$runner_status ;;
        *) scope_status=3 ;;
    esac
    if [ -n "$session_after" ] && [ "$session_after" != "$session_before" ]; then
        session_name=${session_after##*/}
        say "Session: $session_name"
        printf '%s\n' "$session_name" >> "$validation_evidence_work/sessions" || fatal 'cannot record child validation session'
        if [ "$validation_kind" = task ] && [ "$runner_status" -eq 0 ] && session_has_skip "$session_after/results"; then
            say 'Task scope contains SKIP: selection is not positively validated.'
            scope_status=1
        fi
        publish_validation_session "$session_after"
    else
        say 'Session: no new completed validation session'
        scope_status=3
    fi

    return "$scope_status"
}

validation_discover_tests() {
    runner=$1
    output=$2
    : > "$output" || return 1
    if [ "$selection_count" -eq 0 ]; then
        "$runner" --list >> "$output" || return 1
        return 0
    fi

    old_ifs=$IFS
    selection_ifs=$(printf '\n_')
    selection_ifs=${selection_ifs%_}
    IFS=$selection_ifs
    for validation_selection in $validation_selections; do
        IFS=$old_ifs
        "$runner" --list -- "$validation_selection" >> "$output" || { IFS=$old_ifs; return 1; }
        IFS=$selection_ifs
    done
    IFS=$old_ifs
    return 0
}

run_validation_session_isolation() {
    runner=$1
    prepare_validation_environment "$primary_target_root" "$expected_rumiai_os_commit"
    audit_dir=$validation_evidence_work/environment
    validation_audit_begin "$validation_environment_root" "$audit_dir" || fatal 'cannot capture initial validation environment metadata'

    aggregate_status=0
    if [ "$selection_count" -eq 0 ]; then
        run_validation_selection '' "$runner" "$validation_environment_root"
        aggregate_status=$?
    else
        old_ifs=$IFS
        selection_ifs=$(printf '\n_')
        selection_ifs=${selection_ifs%_}
        IFS=$selection_ifs
        for validation_selection in $validation_selections; do
            IFS=$old_ifs
            run_validation_selection "$validation_selection" "$runner" "$validation_environment_root"
            selection_status=$?
            aggregate_status=$(merge_scope_status "$aggregate_status" "$selection_status")
            [ "$aggregate_status" -ne 3 ] || break
            IFS=$selection_ifs
        done
        IFS=$old_ifs
    fi

    validation_audit_end "$validation_environment_root" "$audit_dir" 'validation environment'
    audit_status=$?
    [ "$audit_status" -ne 2 ] || fatal 'cannot capture final validation environment metadata'
    validation_environment_destroy || fatal 'cannot remove temporary validation environment'
    return "$aggregate_status"
}

run_validation_test_isolation() {
    runner=$1
    discovered=$validation_evidence_work/discovered-tests
    validation_discover_tests "$runner" "$discovered" || fatal 'cannot expand validation selections with rumiai-test --list'
    [ -s "$discovered" ] || fatal 'validation discovery returned no tests'

    aggregate_status=0
    while IFS= read -r test_id; do
        [ -n "$test_id" ] || continue
        prepare_validation_environment "$primary_target_root" "$expected_rumiai_os_commit"
        audit_dir=$validation_evidence_work/environments/$test_id
        validation_audit_begin "$validation_environment_root" "$audit_dir" || fatal "cannot capture initial environment metadata for: $test_id"

        run_validation_selection "$test_id" "$runner" "$validation_environment_root"
        test_status=$?

        validation_audit_end "$validation_environment_root" "$audit_dir" "validation environment $test_id"
        audit_status=$?
        [ "$audit_status" -ne 2 ] || fatal "cannot capture final environment metadata for: $test_id"
        validation_environment_destroy || fatal "cannot remove validation environment for: $test_id"

        aggregate_status=$(merge_scope_status "$aggregate_status" "$test_status")
        [ "$aggregate_status" -ne 3 ] || break
    done < "$discovered"
    return "$aggregate_status"
}

validation_evidence_finish_publish() {
    aggregate_status=$1
    validation_record_put audit-status "$validation_audit_status" || fatal 'cannot write validation audit status'
    validation_record_put end "$(date '+%Y-%m-%dT%H:%M:%S%z' 2>/dev/null || printf unknown)" || fatal 'cannot write validation end time'
    validation_record_put aggregate-status "$aggregate_status" || fatal 'cannot write validation aggregate status'

    [ "$aggregate_status" -ne 3 ] || return 0
    mkdir -p "$suite_root/validations" || fatal 'cannot create validation records directory'
    final_record=$suite_root/validations/$validation_evidence_id
    [ ! -e "$final_record" ] || fatal 'validation record identifier collision'
    mv "$validation_evidence_work" "$final_record" || fatal 'cannot finalize validation record'
    validation_evidence_work=
    publish_validation_record "$final_record"
}

rumiai_validate_run() {
    command -v uname >/dev/null 2>&1 || fatal 'uname is required'
    command -v awk >/dev/null 2>&1 || fatal 'awk is required'

    repo_require_no_tracked_changes "$suite_root" 'rumiai-tests'
    publish_pending_validation_sessions
    publish_pending_validation_records
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
    filesystem_snapshot_lib=$suite_root/lib/sh/filesystem-snapshot.lib.sh
    [ -r "$filesystem_snapshot_lib" ] || fatal 'filesystem snapshot library not found'
    . "$filesystem_snapshot_lib"

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
    git -C "$primary_target_root" cat-file -e "$expected_rumiai_os_commit^{commit}" 2>/dev/null ||
        fatal "configured rumiai-os commit is unavailable after update: $expected_rumiai_os_commit"

    runner=$suite_root/rumiai-test
    [ -x "$runner" ] || fatal 'rumiai-test is not executable'
    suite_commit=$(git -C "$suite_root" rev-parse HEAD 2>/dev/null) || fatal 'cannot read rumiai-tests HEAD'

    show_platform
    say "rumiai-tests: $suite_commit"
    say "rumiai-os:    $expected_rumiai_os_commit"
    say "Scope:        $scope_label ($validation_kind)"
    say "Isolation:    $validation_isolation"

    validation_evidence_begin
    validation_audit_status=CLEAN
    case $validation_isolation in
        session)
            run_validation_session_isolation "$runner"
            aggregate_status=$?
            ;;
        test)
            run_validation_test_isolation "$runner"
            aggregate_status=$?
            ;;
        *)
            fatal "invalid validation isolation mode: $validation_isolation"
            ;;
    esac

    validation_evidence_finish_publish "$aggregate_status"

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
