#!/usr/bin/env bash
# Local, read-only evidence collection. Interpretation and external checks stay
# with the operator: a successful command is never a perimeter security verdict.
set -euo pipefail
export LC_ALL=C
umask 077

if [[ $# -ne 1 || "$1" == -* ]]; then
  echo 'Usage: bash scripts/collect-network-evidence.sh EXISTING_PRIVATE_DIRECTORY' >&2
  exit 64
fi
if [[ ! -d "$1" ]]; then
  echo 'Create a private evidence directory first; see docs/deployment.md.' >&2
  exit 64
fi
for tool in timeout head mktemp date; do
  command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 69; }
done

# mktemp never overwrites an earlier run; its directory and report are private.
directory=$(mktemp -d "$1/network-review.XXXXXXXX")
report="$directory/evidence.txt"
exec 3>"$report"
printf 'SHBS network evidence v1\nstarted_utc=%s\n' "$(date -u +%FT%TZ)" >&3
printf '%s\n' 'VERDICT: OPERATOR VERIFICATION PENDING' \
  'Private inventory, not sanitized for publication. No configuration changes.' \
  'Docker endpoint: unix:///var/run/docker.sock (local rootful daemon only).' \
  'Cloud/firewall/SSH/runtime proxy configuration/external reachability: NOT COLLECTED.' >&3

incomplete=0
started=$SECONDS
last_output=''
# One process group at a time, <=8 seconds per command, <=120 seconds of command
# budget and <=64 KiB per result. Errors discard stdout and stderr, which may
# contain private diagnostic values. timeout also bounds a stalled local daemon.
collect() {
  local label=$1 remaining limit status=0
  shift
  last_output=''
  printf '\n[%s]\n' "$label" >&3
  remaining=$((120 - SECONDS + started))
  if ((remaining <= 0)); then
    printf 'UNAVAILABLE: collection time budget exhausted\n' >&3
    incomplete=1
    return
  fi
  limit=8
  ((remaining >= limit)) || limit=$remaining
  # The sentinel preserves trailing newlines for the byte-limit check; ordinary
  # command substitution would strip them and could hide a truncated result.
  last_output=$(
    timeout --signal=TERM --kill-after=1s "${limit}s" "$@" </dev/null 2>/dev/null | head -c 65537
    command_status=$?
    printf '.'
    exit "$command_status"
  ) || status=$?
  last_output=${last_output%.}
  if ((status != 0 || ${#last_output} > 65536)); then
    printf 'UNAVAILABLE: command exit=%s or output limit exceeded; review privately\n' "$status" >&3
    last_output=''
    incomplete=1
  else
    printf 'command_exit=0 (observation only)\n%s\n' "$last_output" >&3
  fi
}

collect listeners_ipv4 ss -4 -lntup
collect listeners_ipv6 ss -6 -lntup
collect interface_addresses ip -brief address show
collect routes_ipv4 ip -4 route show
collect routes_ipv6 ip -6 route show
# Do not invoke Compose: interpolation, .env and remote Docker contexts are not
# needed to inspect actual containers. Pin every call to the local Unix socket.
# Ignore ambient remote/TLS options without modifying the operator's environment.
unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker_local=(docker --host unix:///var/run/docker.sock)
collect docker_version "${docker_local[@]}" version --format '{{.Server.Version}}'
collect container_ids "${docker_local[@]}" ps --all --no-trunc --quiet
container_ids=$last_output
count=0
if [[ -z "$container_ids" ]]; then
  printf '\nUNAVAILABLE: no container inventory; expected deployment not established\n' >&3
  incomplete=1
fi
while IFS= read -r container; do
  [[ -n "$container" ]] || continue
  if [[ ! "$container" =~ ^[a-f0-9]{64}$ ]] || ((count >= 12)); then
    printf '\nUNAVAILABLE: invalid ID or more than 12 containers; remaining inventory omitted\n' >&3
    incomplete=1
    break
  fi
  count=$((count + 1))
  collect "container_$container" "${docker_local[@]}" inspect --type container --format \
    'name={{json .Name}} state={{json .State.Status}} project={{json (index .Config.Labels "com.docker.compose.project")}} service={{json (index .Config.Labels "com.docker.compose.service")}} image_id={{.Image}} requested_image={{json .Config.Image}} network_mode={{json .HostConfig.NetworkMode}} configured_ports={{json .HostConfig.PortBindings}} effective_ports={{json .NetworkSettings.Ports}} networks={{range $name, $network := .NetworkSettings.Networks}}{{json $name}}:{{json $network.IPAddress}}:{{json $network.GlobalIPv6Address}};{{end}} mounts={{range .Mounts}}type={{json .Type}},name={{json .Name}},source={{json .Source}},destination={{json .Destination}},rw={{.RW}};{{end}}' "$container"
  collect "image_id_$container" "${docker_local[@]}" inspect --type container --format '{{.Image}}' "$container"
  image_id=${last_output%$'\n'}
  if [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    collect "image_$container" "${docker_local[@]}" image inspect --format \
      'id={{.Id}} digests={{json .RepoDigests}} revision={{json (index .Config.Labels "org.opencontainers.image.revision")}} source={{json (index .Config.Labels "org.opencontainers.image.source")}}' "$image_id"
  else
    printf 'UNAVAILABLE: invalid/missing image identity\n' >&3
    incomplete=1
  fi
done <<< "$container_ids"

collect network_ids "${docker_local[@]}" network ls --no-trunc --quiet
network_ids=$last_output
count=0
if [[ -z "$network_ids" ]]; then
  printf '\nUNAVAILABLE: no network inventory\n' >&3
  incomplete=1
fi
while IFS= read -r network; do
  [[ -n "$network" ]] || continue
  if [[ ! "$network" =~ ^[a-f0-9]{64}$ ]] || ((count >= 8)); then
    printf '\nUNAVAILABLE: invalid ID or more than 8 networks; remaining inventory omitted\n' >&3
    incomplete=1
    break
  fi
  count=$((count + 1))
  # Only known routing fields, never arbitrary driver options or labels.
  collect "network_$network" "${docker_local[@]}" network inspect --format \
    'name={{json .Name}} driver={{json .Driver}} internal={{.Internal}} ipv6={{.EnableIPv6}} ipam={{range .IPAM.Config}}subnet={{json .Subnet}},gateway={{json .Gateway}};{{end}} gateway_mode_ipv4={{json (index .Options "com.docker.network.bridge.gateway_mode_ipv4")}} gateway_mode_ipv6={{json (index .Options "com.docker.network.bridge.gateway_mode_ipv6")}} trusted_host_interfaces={{json (index .Options "com.docker.network.bridge.trusted_host_interfaces")}} host_binding_ipv4={{json (index .Options "com.docker.network.bridge.host_binding_ipv4")}}' "$network"
done <<< "$network_ids"

printf '\nfinished_utc=%s\ncollection_incomplete=%s\n' "$(date -u +%FT%TZ)" "$incomplete" >&3
printf '%s\n' 'VERDICT: OPERATOR VERIFICATION PENDING; complete the deployment runbook worksheet.' >&3
exec 3>&-
printf 'Private evidence saved to %s\n' "$report"
# 0 only means the bounded commands completed. 2 means collection gaps; neither
# status establishes approved SSH policy, preserved data, or Internet isolation.
if ((incomplete)); then exit 2; fi
