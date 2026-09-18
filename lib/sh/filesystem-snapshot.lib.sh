# Shared filesystem snapshot primitive for rumiai-test and rumiai-validate.

rumiai_test_fs_snapshot_prepare() {
    rumiai_test_fs_snapshot_mode=$1
    rumiai_test_fs_snapshot_probe=$2

    case $rumiai_test_fs_snapshot_mode in
        metadata|hash) : ;;
        *) return 1 ;;
    esac

    if stat -c '%a' "$rumiai_test_fs_snapshot_probe" >/dev/null 2>&1; then
        rumiai_test_fs_snapshot_stat_style=gnu
    elif stat -f '%Lp' "$rumiai_test_fs_snapshot_probe" >/dev/null 2>&1; then
        rumiai_test_fs_snapshot_stat_style=bsd
    else
        return 1
    fi

    rumiai_test_fs_snapshot_hash_tool=
    if [ "$rumiai_test_fs_snapshot_mode" = hash ]; then
        if command -v sha256sum >/dev/null 2>&1; then
            rumiai_test_fs_snapshot_hash_tool=sha256sum
        elif command -v shasum >/dev/null 2>&1; then
            rumiai_test_fs_snapshot_hash_tool=shasum
        elif command -v openssl >/dev/null 2>&1; then
            rumiai_test_fs_snapshot_hash_tool=openssl
        else
            return 1
        fi
    fi
    return 0
}

rumiai_test_fs_path_is_at_or_below() {
    rumiai_test_fs_root=$1
    rumiai_test_fs_path=$2
    if [ "$rumiai_test_fs_root" = / ]; then
        case $rumiai_test_fs_path in
            /*) return 0 ;;
            *) return 1 ;;
        esac
    fi
    case $rumiai_test_fs_path in
        "$rumiai_test_fs_root"|"$rumiai_test_fs_root"/*) return 0 ;;
        *) return 1 ;;
    esac
}

rumiai_test_fs_mode() {
    if [ "$rumiai_test_fs_snapshot_stat_style" = gnu ]; then
        stat -c '%a' "$1" 2>/dev/null
    else
        stat -f '%Lp' "$1" 2>/dev/null
    fi
}

rumiai_test_fs_size() {
    if [ "$rumiai_test_fs_snapshot_stat_style" = gnu ]; then
        stat -c '%s' "$1" 2>/dev/null
    else
        stat -f '%z' "$1" 2>/dev/null
    fi
}

rumiai_test_fs_mtime() {
    if [ "$rumiai_test_fs_snapshot_stat_style" = gnu ]; then
        stat -c '%.Y' "$1" 2>/dev/null
    else
        stat -f '%.9Fm' "$1" 2>/dev/null
    fi
}

rumiai_test_fs_sha256() {
    case $rumiai_test_fs_snapshot_hash_tool in
        sha256sum) sha256sum "$1" 2>/dev/null | awk '{print $1}' ;;
        shasum) shasum -a 256 "$1" 2>/dev/null | awk '{print $1}' ;;
        openssl) openssl dgst -sha256 -r "$1" 2>/dev/null | awk '{print $1}' ;;
        *) return 1 ;;
    esac
}

rumiai_test_fs_snapshot_take() {
    rumiai_test_fs_root=$1
    rumiai_test_fs_output=$2
    rumiai_test_fs_work_base=$3
    rumiai_test_fs_exclude=${4-}
    rumiai_test_fs_list=$rumiai_test_fs_work_base.list
    rumiai_test_fs_unsorted=$rumiai_test_fs_work_base.unsorted
    rumiai_test_fs_err=$rumiai_test_fs_work_base.err

    : > "$rumiai_test_fs_err" || return 1
    if [ -n "$rumiai_test_fs_exclude" ] && rumiai_test_fs_path_is_at_or_below "$rumiai_test_fs_root" "$rumiai_test_fs_exclude"; then
        find "$rumiai_test_fs_root" \( -path "$rumiai_test_fs_exclude" -prune \) -o -print > "$rumiai_test_fs_list" 2> "$rumiai_test_fs_err"
    else
        find "$rumiai_test_fs_root" -print > "$rumiai_test_fs_list" 2> "$rumiai_test_fs_err"
    fi
    rumiai_test_fs_status=$?
    [ "$rumiai_test_fs_status" -eq 0 ] || return 1
    [ ! -s "$rumiai_test_fs_err" ] || return 1
    : > "$rumiai_test_fs_unsorted" || return 1

    while IFS= read -r rumiai_test_fs_path; do
        if [ "$rumiai_test_fs_path" = "$rumiai_test_fs_root" ]; then
            rumiai_test_fs_rel=.
        elif [ "$rumiai_test_fs_root" = / ]; then
            rumiai_test_fs_rel=${rumiai_test_fs_path#/}
        else
            rumiai_test_fs_rel=${rumiai_test_fs_path#"$rumiai_test_fs_root"/}
        fi

        rumiai_test_fs_item_mode=$(rumiai_test_fs_mode "$rumiai_test_fs_path") || return 1
        rumiai_test_fs_type=other
        rumiai_test_fs_item_size=
        rumiai_test_fs_item_mtime=
        rumiai_test_fs_target=
        rumiai_test_fs_digest=

        if [ -L "$rumiai_test_fs_path" ] 2>/dev/null; then
            rumiai_test_fs_type=symlink
            rumiai_test_fs_target=$(readlink "$rumiai_test_fs_path" 2>/dev/null) || return 1
        elif [ -f "$rumiai_test_fs_path" ]; then
            rumiai_test_fs_type=file
            rumiai_test_fs_item_size=$(rumiai_test_fs_size "$rumiai_test_fs_path") || return 1
            rumiai_test_fs_item_mtime=$(rumiai_test_fs_mtime "$rumiai_test_fs_path") || return 1
            if [ "$rumiai_test_fs_snapshot_mode" = hash ]; then
                rumiai_test_fs_digest=$(rumiai_test_fs_sha256 "$rumiai_test_fs_path") || return 1
                [ -n "$rumiai_test_fs_digest" ] || return 1
            fi
        elif [ -d "$rumiai_test_fs_path" ]; then
            rumiai_test_fs_type=directory
        elif [ -p "$rumiai_test_fs_path" ]; then
            rumiai_test_fs_type=fifo
        elif [ -b "$rumiai_test_fs_path" ]; then
            rumiai_test_fs_type=block
        elif [ -c "$rumiai_test_fs_path" ]; then
            rumiai_test_fs_type=character
        elif [ -S "$rumiai_test_fs_path" ] 2>/dev/null; then
            rumiai_test_fs_type=socket
        fi

        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
            "$rumiai_test_fs_rel" "$rumiai_test_fs_type" "$rumiai_test_fs_item_mode" \
            "$rumiai_test_fs_item_size" "$rumiai_test_fs_item_mtime" "$rumiai_test_fs_target" \
            "$rumiai_test_fs_digest" >> "$rumiai_test_fs_unsorted" || return 1
    done < "$rumiai_test_fs_list"

    LC_ALL=C sort "$rumiai_test_fs_unsorted" > "$rumiai_test_fs_output" || return 1
    rm -f "$rumiai_test_fs_list" "$rumiai_test_fs_unsorted" "$rumiai_test_fs_err"
    return 0
}

# 0 = CLEAN, 1 = CHANGED, 2 = comparison error.
rumiai_test_fs_snapshot_compare() {
    rumiai_test_fs_before=$1
    rumiai_test_fs_after=$2
    rumiai_test_fs_diff=$3

    if cmp -s "$rumiai_test_fs_before" "$rumiai_test_fs_after"; then
        : > "$rumiai_test_fs_diff" || return 2
        return 0
    fi

    diff -u "$rumiai_test_fs_before" "$rumiai_test_fs_after" > "$rumiai_test_fs_diff"
    rumiai_test_fs_diff_status=$?
    [ "$rumiai_test_fs_diff_status" -eq 1 ] && return 1
    return 2
}
