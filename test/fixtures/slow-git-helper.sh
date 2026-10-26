# Synthetic transport worker; invoked explicitly through the system interpreter.
root="$2"
if [ "$1" = child ]; then
  trap '' TERM
  echo "$$" > "$root/helper.pid"
  (/bin/sleep 0.7; printf '%s' 'orphaned helper mutated state' > "$root/late-write") &
  while :; do /bin/sleep 1; done
else
  printf '%s' "${GIT_TERMINAL_PROMPT-unset}" > "$root/prompt-setting"
  /bin/sh "$0" child "$root" </dev/null >/dev/null 2>&1 &
  while :; do /bin/sleep 1; done
fi
