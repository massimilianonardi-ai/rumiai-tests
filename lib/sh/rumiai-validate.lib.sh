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
    validation_selection=
    expected_rumiai_os_commit=
    selection_seen=0
    commit_seen=0
    tab=$(printf '\t')

    [ -r "$config_path" ] || fatal "configuration file not found: $config_path"

    while IFS="$tab" read -r key value extra || [ -n "$key$value$extra" ]; do
        case $key in
            ''|'#'*)
                continue
                ;;
            selection)
                [ "$selection_seen" -eq 0 ] || fatal 'duplicate selection in configuration'
                [ -n "$value" ] || fatal 'empty selection in configuration'
                [ -z "$extra" ] || fatal 'invalid selection record in configuration'
                validation_selection=$value
                selection_seen=1
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

    [ "$selection_seen" -eq 1 ] || fatal 'configuration does not define selection'
    [ "$commit_seen" -eq 1 ] || fatal 'configuration does not define rumiai-os-commit'
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

show_platform() {
    host_os=$(uname -s 2>/dev/null || printf '%s' unknown)
    host_arch=$(uname -m 2>/dev/null || printf '%s' unknown)
    say "Platform: $host_os/$host_arch"
}

rumiai_validate_run() {
    command -v uname >/dev/null 2>&1 || fatal 'uname is required'

    repo_require_clean "$suite_root" 'rumiai-tests'

    config_path=$suite_root/rumiai-validate.conf
    load_config "$config_path"

    target_lib=$suite_root/lib/rumiai-os-target.lib
    [ -r "$target_lib" ] || fatal "target discovery library not found: $target_lib"
    . "$target_lib"

    target_root=$(rumiai_test_target_rumiai_os_find "$suite_root")
    target_status=$?
    case $target_status in
        0) : ;;
        1) fatal 'rumiai-os target checkout not found' ;;
        2) fatal 'invalid explicit rumiai-os target checkout' ;;
        *) fatal 'rumiai-os target discovery failed' ;;
    esac

    repo_pull_ff_only "$target_root" 'rumiai-os'
    repo_require_clean "$target_root" 'rumiai-os'

    target_head=$(git -C "$target_root" rev-parse HEAD 2>/dev/null) || fatal 'cannot read rumiai-os HEAD'
    [ "$target_head" = "$expected_rumiai_os_commit" ] ||
        fatal "rumiai-os HEAD $target_head does not match configured commit $expected_rumiai_os_commit"

    runner=$suite_root/rumiai-test
    [ -x "$runner" ] || fatal 'rumiai-test is not executable'

    show_platform
    say "rumiai-tests: $(git -C "$suite_root" rev-parse HEAD 2>/dev/null)"
    say "rumiai-os:    $target_head"
    say "Selection:    $validation_selection"
    say 'Starting validation...'

    session_before=$(latest_completed_session "$suite_root/sessions" 2>/dev/null || printf '')
    "$runner" --validation -- "$validation_selection"
    runner_status=$?
    session_after=$(latest_completed_session "$suite_root/sessions" 2>/dev/null || printf '')

    say 'Validation finished.'
    say "Status: $runner_status"
    if [ -n "$session_after" ] && [ "$session_after" != "$session_before" ]; then
        say "Session: ${session_after##*/}"
    else
        say 'Session: no new completed validation session'
    fi

    return "$runner_status"
}
