#!/bin/sh

setup_dev_support_error() {
    printf '%s\n' "$TEST_ID: $*" >&2
    exit 3
}

setup_dev_support_fail() {
    printf '%s\n' "$TEST_ID: $*" >&2
    exit 1
}

setup_dev_support_skip() {
    printf '%s\n' "$TEST_ID: $*" >&2
    exit 2
}

setup_dev_have() {
    command -v "$1" >/dev/null 2>&1
}

setup_dev_init() {
    setup_dev_have git || setup_dev_support_error 'git is unavailable'
    setup_dev_have curl || setup_dev_support_skip 'curl is unavailable'
    setup_dev_have grep || setup_dev_support_error 'grep is unavailable'
    setup_dev_have uname || setup_dev_support_error 'uname is unavailable'

    SETUP_DEV_SYSTEM=$(uname -s 2>/dev/null) || setup_dev_support_error 'cannot determine operating system'
    case $SETUP_DEV_SYSTEM in
        Darwin)
            setup_dev_have expect || setup_dev_support_skip 'expect(1) is unavailable on macOS'
            ;;
        Linux)
            setup_dev_have script || setup_dev_support_skip 'script(1) is unavailable on Linux'
            ;;
        *)
            setup_dev_support_skip "PTY automation is not implemented for $SETUP_DEV_SYSTEM"
            ;;
    esac

    SETUP_DEV_URL=https://raw.githubusercontent.com/massimilianonardi-ai/rumiai-dev/refs/heads/main/setup-dev.sh
    SETUP_DEV_TMP=${TMPDIR:-/tmp}/rumiai-tests-setup-dev-${TEST_ID##*/}-$$
    umask 077
    mkdir "$SETUP_DEV_TMP" || setup_dev_support_error 'cannot create temporary directory'
    trap 'rm -rf "$SETUP_DEV_TMP"' 0 HUP INT TERM

    SETUP_DEV_WRAPPER=$SETUP_DEV_TMP/run-setup
    cat > "$SETUP_DEV_WRAPPER" <<'EOT'
#!/bin/sh
HOME=$CASE_HOME
export HOME
curl -fsSL "$SETUP_DEV_URL" | sh -s -- "$CASE_ROOT"
status=$?
printf '%s\n' "$status" > "$CASE_STATUS"
exit "$status"
EOT
    chmod +x "$SETUP_DEV_WRAPPER" || setup_dev_support_error 'cannot make PTY wrapper executable'
}

setup_dev_run_darwin_case() {
    case_name=$1
    driver=$CASE_DIR/driver.expect

    case $case_name in
        invalid)
            cat > "$driver" <<'EOT'
set timeout -1
log_user 0
log_file -noappend $env(CASE_OUTPUT)
spawn $env(SETUP_DEV_WRAPPER)
expect -exact "Git user.name: "
send -- "massimilianonardi-ai\r"
expect -exact "Git user.email: "
send -- "not-an-email\r"
expect eof
EOT
            ;;
        cancel)
            cat > "$driver" <<'EOT'
set timeout -1
log_user 0
log_file -noappend $env(CASE_OUTPUT)
spawn $env(SETUP_DEV_WRAPPER)
expect -exact "Git user.name: "
send -- "massimilianonardi-ai\r"
expect -exact "Git user.email: "
send -- "massimiliano.nardi.ai@gmail.com\r"
expect -exact "Use this Git identity globally? [y/N] "
send -- "n\r"
expect eof
EOT
            ;;
        positive)
            cat > "$driver" <<'EOT'
set timeout -1
log_user 0
log_file -noappend $env(CASE_OUTPUT)
spawn $env(SETUP_DEV_WRAPPER)
expect -exact "Git user.name: "
send -- "massimilianonardi-ai\r"
expect -exact "Git user.email: "
send -- "massimiliano.nardi.ai@gmail.com\r"
expect -exact "Use this Git identity globally? [y/N] "
send -- "y\r"
expect -exact "Configure a GitHub personal access token now? [y/N] "
send -- "n\r"
expect eof
EOT
            ;;
        *)
            setup_dev_support_error "unknown Darwin PTY case '$case_name'"
            ;;
    esac

    CASE_OUTPUT=$CASE_OUTPUT SETUP_DEV_WRAPPER=$SETUP_DEV_WRAPPER expect -f "$driver" >/dev/null 2>&1 ||
        setup_dev_support_error "$case_name Expect driver failed"
}

setup_dev_run_case() {
    case_name=$1
    input_file=$2

    CASE_DIR=$SETUP_DEV_TMP/$case_name
    CASE_HOME=$CASE_DIR/home
    CASE_ROOT=$CASE_DIR/rumiai-os
    CASE_STATUS=$CASE_DIR/status
    CASE_OUTPUT=$CASE_DIR/output
    export CASE_HOME CASE_ROOT CASE_STATUS CASE_OUTPUT SETUP_DEV_URL SETUP_DEV_WRAPPER

    mkdir -p "$CASE_HOME" || setup_dev_support_error "cannot create $case_name HOME"

    case $SETUP_DEV_SYSTEM in
        Darwin)
            setup_dev_run_darwin_case "$case_name"
            ;;
        Linux)
            script -q -c "$SETUP_DEV_WRAPPER" /dev/null < "$input_file" > "$CASE_OUTPUT" 2>&1
            ;;
    esac

    [ -f "$CASE_STATUS" ] || setup_dev_support_error "$case_name did not persist child exit status"
    CASE_RESULT=$(cat "$CASE_STATUS") || setup_dev_support_error "cannot read $case_name exit status"
    case $CASE_RESULT in
        0|1|2|3) : ;;
        *) setup_dev_support_error "$case_name returned invalid setup status '$CASE_RESULT'" ;;
    esac
}

setup_dev_assert_output() {
    needle=$1
    grep -F "$needle" "$CASE_OUTPUT" >/dev/null 2>&1 || {
        printf '%s\n' "--- $TEST_ID captured output ---" >&2
        cat "$CASE_OUTPUT" >&2
        printf '%s\n' "--- end captured output ---" >&2
        setup_dev_support_fail "expected output not found: $needle"
    }
}

setup_dev_assert_no_identity() {
    HOME="$CASE_HOME" git config --global --get user.name >/dev/null 2>&1 &&
        setup_dev_support_fail 'unexpectedly persisted user.name'
    HOME="$CASE_HOME" git config --global --get user.email >/dev/null 2>&1 &&
        setup_dev_support_fail 'unexpectedly persisted user.email'
}
