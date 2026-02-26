#!/usr/bin/env bash
# Deploy ContinuOz Workspace to GKE (app only).
# Supports managed Postgres or a local-in-cluster Postgres StatefulSet.
#
# Managed Postgres usage:
#   PROJECT_ID=your-project \
#   DATABASE_URL='postgresql://user:pass@host:5432/oz_workspace?schema=public' \
#   AUTH_SECRET='...' WARP_API_KEY='...' WARP_ENVIRONMENT_ID='...' \
#   AGENT_CALLBACK_URL='https://your-domain.example.com' AGENT_API_KEY='...' \
#   ./scripts/deploy.sh
#
# StatefulSet usage (quick test, in-cluster Postgres):
#   PROJECT_ID=your-project \
#   POSTGRES_MODE=statefulset \
#   AUTH_SECRET='...' WARP_API_KEY='...' WARP_ENVIRONMENT_ID='...' \
#   AGENT_CALLBACK_URL='https://your-domain.example.com' AGENT_API_KEY='...' \
#   ./scripts/deploy.sh
#
# To source env vars from a custom file:
#   ENV_FILE=.env.gcp ./scripts/deploy.sh

ENV_FILE=${ENV_FILE:-.env}
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1091
  source "$ENV_FILE"
fi

PROJECT_ID=${PROJECT_ID:-}
REGISTRY=${REGISTRY:-gcr.io}
IMAGE_NAME=${IMAGE_NAME:-oz-workspace}
IMAGE_TAG=${IMAGE_TAG:-latest}
PRISMA_SCHEMA=${PRISMA_SCHEMA:-prisma/schema.postgres.prisma}
SECRET_NAME=${SECRET_NAME:-oz-workspace-secrets}
NAMESPACE=${NAMESPACE:-default}
SKIP_BUILD=${SKIP_BUILD:-0}
SKIP_PUSH=${SKIP_PUSH:-0}
SKIP_APPLY=${SKIP_APPLY:-0}
ROLLING_RESTART=${ROLLING_RESTART:-1}
POSTGRES_MODE=${POSTGRES_MODE:-managed}
POSTGRES_USER=${POSTGRES_USER:-oz}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-oz}
POSTGRES_DB=${POSTGRES_DB:-oz_workspace}
POSTGRES_SERVICE_NAME=${POSTGRES_SERVICE_NAME:-oz-postgres}
POSTGRES_SECRET_NAME=${POSTGRES_SECRET_NAME:-oz-postgres-secret}

if [ -z "$PROJECT_ID" ]; then
  echo "PROJECT_ID is required."
  exit 1
fi

if [ "$POSTGRES_MODE" = "statefulset" ] && [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_SERVICE_NAME}:5432/${POSTGRES_DB}?schema=public"
fi

required_vars=(DATABASE_URL AUTH_SECRET WARP_API_KEY WARP_ENVIRONMENT_ID AGENT_CALLBACK_URL AGENT_API_KEY)
missing=0
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "Missing required env var: $var"
    missing=1
  fi
 done
if [ "$missing" -ne 0 ]; then
  exit 1
fi

IMAGE_REF="$REGISTRY/$PROJECT_ID/$IMAGE_NAME:$IMAGE_TAG"
DOCKER_PLATFORM=${DOCKER_PLATFORM:-linux/amd64}

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "Building image: $IMAGE_REF"
  if ! docker build --platform "$DOCKER_PLATFORM" --build-arg PRISMA_SCHEMA="$PRISMA_SCHEMA" -t "$IMAGE_REF" .; then
    echo "Docker build failed."
    exit 1
  fi
fi

if [ "$SKIP_PUSH" -eq 0 ]; then
  echo "Pushing image: $IMAGE_REF"
  if ! docker push "$IMAGE_REF"; then
    echo "Docker push failed."
    exit 1
  fi
fi

if [ "$SKIP_APPLY" -eq 0 ]; then
  if [ "$POSTGRES_MODE" = "statefulset" ]; then
    echo "Updating Postgres secret: $POSTGRES_SECRET_NAME"
    if ! kubectl create secret generic "$POSTGRES_SECRET_NAME" \
      --from-literal=POSTGRES_USER="$POSTGRES_USER" \
      --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
      --from-literal=POSTGRES_DB="$POSTGRES_DB" \
      --dry-run=client -o yaml \
      -n "$NAMESPACE" | kubectl apply -f -; then
      echo "Failed to update Postgres secret."
      exit 1
    fi

    echo "Applying Postgres manifests"
    if ! kubectl apply -n "$NAMESPACE" -f k8s/oz-postgres-service.yaml; then
      echo "Failed to apply Postgres service."
      exit 1
    fi
    if ! kubectl apply -n "$NAMESPACE" -f k8s/oz-postgres-statefulset.yaml; then
      echo "Failed to apply Postgres StatefulSet."
      exit 1
    fi
  fi

  echo "Updating Kubernetes secret: $SECRET_NAME"
  if ! kubectl create secret generic "$SECRET_NAME" \
    --from-literal=DATABASE_URL="$DATABASE_URL" \
    --from-literal=AUTH_SECRET="$AUTH_SECRET" \
    --from-literal=WARP_API_KEY="$WARP_API_KEY" \
    --from-literal=WARP_ENVIRONMENT_ID="$WARP_ENVIRONMENT_ID" \
    --from-literal=AGENT_CALLBACK_URL="$AGENT_CALLBACK_URL" \
    --from-literal=AGENT_API_KEY="$AGENT_API_KEY" \
    --dry-run=client -o yaml \
    -n "$NAMESPACE" | kubectl apply -f -; then
    echo "Failed to update secret."
    exit 1
  fi

  echo "Applying manifests in k8s/"
  if ! kubectl apply -n "$NAMESPACE" -f k8s/oz-workspace-deployment.yaml; then
    echo "Failed to apply deployment."
    exit 1
  fi
  if ! kubectl apply -n "$NAMESPACE" -f k8s/oz-workspace-service.yaml; then
    echo "Failed to apply service."
    exit 1
  fi

  echo "Setting deployment image to $IMAGE_REF"
  if ! kubectl set image -n "$NAMESPACE" deployment/oz-workspace oz-workspace="$IMAGE_REF"; then
    echo "Failed to set deployment image."
    exit 1
  fi

  if [ "$ROLLING_RESTART" -eq 1 ]; then
    echo "Restarting deployment to pick up new image"
    kubectl rollout restart -n "$NAMESPACE" deployment/oz-workspace || true
  fi
fi

echo "Deploy complete: $IMAGE_REF"
