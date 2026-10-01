#!/usr/bin/env bash
# Use this script to start a docker container for a local development database

# TO RUN ON WINDOWS:
# 1. Install WSL (Windows Subsystem for Linux) - https://learn.microsoft.com/en-us/windows/wsl/install
# 2. Install Docker Desktop or Podman Deskop
# - Docker Desktop for Windows - https://docs.docker.com/docker-for-windows/install/
# - Podman Desktop - https://podman.io/getting-started/installation
# 3. Open WSL - `wsl`
# 4. Run this script - `./start-database.sh`

# On Linux and macOS you can run this script directly - `./start-database.sh`

# import env variables from .env
set -a
source .env || exit 1
set +a

DB_PASSWORD=$(echo "$DATABASE_URL" | awk -F':' '{print $3}' | awk -F'@' '{print $1}')
DB_PORT=$(echo "$DATABASE_URL" | awk -F':' '{print $4}' | awk -F'\/' '{print $1}')
DB_NAME=$(echo "$DATABASE_URL" | awk -F'/' '{print $4}')
DB_CONTAINER_NAME="$DB_NAME-postgres"

# Publishing without a host IP exposes PostgreSQL on every host interface.
# Remote access must be an explicit, reviewed choice, independent of DATABASE_URL.
DB_BIND_ADDRESS="${DB_BIND_ADDRESS:-127.0.0.1}"
if ! [[ "$DB_BIND_ADDRESS" =~ ^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$ ]] ||
  (( BASH_REMATCH[1] > 255 || BASH_REMATCH[2] > 255 || BASH_REMATCH[3] > 255 || BASH_REMATCH[4] > 255 )); then
  echo "DB_BIND_ADDRESS must be a literal IPv4 address (default: 127.0.0.1)." >&2
  exit 1
fi
if [[ "$DB_BIND_ADDRESS" != 127.* ]]; then
  echo "Warning: PostgreSQL will be published on $DB_BIND_ADDRESS; review network access and authentication."
fi

if ! [ -x "$(command -v docker)" ] && ! [ -x "$(command -v podman)" ]; then
  echo -e "Docker or Podman is not installed. Please install docker or podman and try again.\nDocker install guide: https://docs.docker.com/engine/install/\nPodman install guide: https://podman.io/getting-started/installation"
  exit 1
fi

# determine which docker command to use
if [ -x "$(command -v docker)" ]; then
  DOCKER_CMD="docker"
elif [ -x "$(command -v podman)" ]; then
  DOCKER_CMD="podman"
fi

if ! $DOCKER_CMD info > /dev/null 2>&1; then
  echo "$DOCKER_CMD daemon is not running. Please start $DOCKER_CMD and try again."
  exit 1
fi

# A restart cannot change a container's publishing configuration. Refuse old broad
# bindings rather than silently reusing them or deleting a developer's database.
EXISTING_CONTAINER=$($DOCKER_CMD ps -a -q -f "name=^/?${DB_CONTAINER_NAME}$") || exit 1
if [ -n "$EXISTING_CONTAINER" ]; then
  EXISTING_BINDINGS=$($DOCKER_CMD inspect --format '{{range (index .HostConfig.PortBindings "5432/tcp")}}{{.HostIp}}:{{.HostPort}}{{"\n"}}{{end}}' "$DB_CONTAINER_NAME") || exit 1
  EXISTING_NETWORK=$($DOCKER_CMD inspect --format '{{.HostConfig.NetworkMode}}' "$DB_CONTAINER_NAME") || exit 1
  if [ "$EXISTING_BINDINGS" != "$DB_BIND_ADDRESS:$DB_PORT" ] || [ "$EXISTING_NETWORK" = "host" ]; then
    echo "Existing container '$DB_CONTAINER_NAME' does not match the requested PostgreSQL binding." >&2
    echo "Back up its data and review its mounts before recreating it; see docs/local-development.md." >&2
    exit 1
  fi
  EXISTING_RUNNING=$($DOCKER_CMD inspect --format '{{.State.Running}}' "$DB_CONTAINER_NAME") || exit 1
  if [ "$EXISTING_RUNNING" = "true" ]; then
    echo "Database container '$DB_CONTAINER_NAME' already running with the requested binding"
    exit 0
  fi
fi

if command -v nc >/dev/null 2>&1; then
  if nc -z localhost "$DB_PORT" 2>/dev/null; then
    echo "Port $DB_PORT is already in use."
    exit 1
  fi
else
  echo "Warning: Unable to check if port $DB_PORT is already in use (netcat not installed)"
  read -p "Do you want to continue anyway? [y/N]: " -r REPLY
  if ! [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting."
    exit 1
  fi
fi

if [ -n "$EXISTING_CONTAINER" ]; then
  $DOCKER_CMD start "$DB_CONTAINER_NAME" || exit 1
  echo "Existing database container '$DB_CONTAINER_NAME' started"
  exit 0
fi

if [ "$DB_PASSWORD" = "password" ]; then
  echo "You are using the default database password"
  read -p "Should we generate a random password for you? [y/N]: " -r REPLY
  if ! [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Please change the default password in the .env file and try again"
    exit 1
  fi
  # Generate a random URL-safe password
  DB_PASSWORD=$(openssl rand -base64 12 | tr '+/' '-_')
  if [[ "$(uname)" == "Darwin" ]]; then
    # macOS requires an empty string to be passed with the `i` flag
    sed -i '' "s#:password@#:$DB_PASSWORD@#" .env
  else
    sed -i "s#:password@#:$DB_PASSWORD@#" .env
  fi
fi

$DOCKER_CMD run -d \
  --name "$DB_CONTAINER_NAME" \
  -e POSTGRES_USER="postgres" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -p "$DB_BIND_ADDRESS:$DB_PORT:5432" \
  docker.io/postgres && echo "Database container '$DB_CONTAINER_NAME' was successfully created"
