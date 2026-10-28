#!/usr/bin/env bash
# Read-only deployment headroom gate. The operator supplies the filesystem and
# peak budget; a passing observation neither reserves space nor authorizes work.
set -euo pipefail
export LC_ALL=C

if [[ $# -ne 2 || ! -d "$1" || ! "$2" =~ ^[1-9][0-9]{0,6}$ ]]; then
  echo 'Usage: bash scripts/check-storage-capacity.sh EXISTING_DIRECTORY PEAK_GIB' >&2
  echo 'PEAK_GIB must be a whole number from 1 to 1048576; round estimates up.' >&2
  exit 64
fi
peak_gib=$((10#$2))
if ((peak_gib > 1048576)); then
  echo 'PEAK_GIB exceeds the supported measurement range.' >&2
  exit 64
fi
target=$1
for tool in df timeout head; do
  if ! command -v "$tool" >/dev/null; then
    echo 'assessment=UNKNOWN (required GNU measurement tool unavailable)' >&2
    exit 2
  fi
done

# Two serial reads, each bounded to five seconds (+ one-second kill grace) and
# 4 KiB. Discard diagnostics: failures can contain private paths or host details.
# Keep a sentinel so command substitution cannot hide an oversized newline tail.
read_measurement() {
  local mode=$1 output status=0 header values
  local -a arguments
  if [[ "$mode" == bytes ]]; then
    arguments=(--block-size=1 --output=size,avail)
  else
    arguments=(--output=itotal,iavail)
  fi
  output=$(
    timeout --signal=TERM --kill-after=1s 5s df "${arguments[@]}" -- "$target" </dev/null 2>/dev/null | head -c 4097
    command_status=$?
    printf '.'
    exit "$command_status"
  ) || status=$?
  output=${output%.}
  if ((status != 0 || ${#output} > 4096)) || [[ "$output" != *$'\n'* ]]; then
    return 1
  fi
  header=${output%%$'\n'*}
  values=${output#*$'\n'}
  if [[ "$mode" == bytes ]]; then
    [[ "$header" =~ ^[[:space:]]*1B-blocks[[:space:]]+Avail[[:space:]]*$ ]] || return 1
  else
    [[ "$header" =~ ^[[:space:]]*Inodes[[:space:]]+IFree[[:space:]]*$ ]] || return 1
  fi
  [[ "$values" =~ ^[[:space:]]*([0-9]{1,16})[[:space:]]+([0-9]{1,16})[[:space:]]*$ ]] || return 1
  observed_total=$((10#${BASH_REMATCH[1]}))
  observed_available=$((10#${BASH_REMATCH[2]}))
  # Keep every intermediate well below Bash's signed 64-bit arithmetic limit.
  ((observed_total > 0 && observed_total <= 9007199254740991 && observed_available <= observed_total))
}

if ! read_measurement bytes; then
  echo 'assessment=UNKNOWN (byte measurement unavailable or invalid)' >&2
  exit 2
fi
total_bytes=$observed_total
available_bytes=$observed_available
if ! read_measurement inodes; then
  echo 'assessment=UNKNOWN (inode measurement unavailable or invalid)' >&2
  exit 2
fi
total_inodes=$observed_total
available_inodes=$observed_available

# df's available column already excludes reserved blocks. Use it directly;
# total minus used could incorrectly count those blocks as deployment headroom.
peak_bytes=$((peak_gib * 1073741824))
reserve_bytes=$(((total_bytes + 4) / 5)) # ceil(20% of filesystem capacity)
minimum_reserve=$((5 * 1073741824))
((reserve_bytes >= minimum_reserve)) || reserve_bytes=$minimum_reserve
required_bytes=$((peak_bytes + reserve_bytes))
printf 'SHBS storage preflight v1\nfilesystem_bytes=%s\navailable_bytes=%s\n' "$total_bytes" "$available_bytes"
printf 'peak_bytes=%s\nreserve_bytes=%s\nrequired_available_bytes=%s\n' "$peak_bytes" "$reserve_bytes" "$required_bytes"
printf 'total_inodes=%s\navailable_inodes=%s\n' "$total_inodes" "$available_inodes"
if ((available_bytes < required_bytes || available_inodes == 0)); then
  echo 'assessment=INSUFFICIENT'
  exit 1
fi
echo 'assessment=HEADROOM_OK (point-in-time capacity only; no space reserved)'
