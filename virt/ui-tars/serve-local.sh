#!/usr/bin/env bash
#
# serve-local.sh — serve the UI-TARS grounding model as an OpenAI-compatible
# endpoint via vLLM on this host (needs an NVIDIA GPU + CUDA). The guest runner's
# grounding client points at http://<host>:8080/v1 (CUF_GROUNDING_BASE_URL).
#
# If this box lacks GPU/compute, use the container path (docker-compose.yml) and
# run it on a cloud GPU host instead — the runner only needs the URL.
#
# Config via env:
#   UI_TARS_MODEL   HF model id                (default: ByteDance-Seed/UI-TARS-1.5-7B)
#   SERVED_NAME     name clients request       (default: ui-tars-1.5-7b)
#   PORT            listen port                (default: 8080)
#   GPU_MEM_FRAC    vLLM gpu-memory-utilization(default: 0.9)
#   HF_TOKEN        Hugging Face token if the model is gated

set -euo pipefail

UI_TARS_MODEL="${UI_TARS_MODEL:-ByteDance-Seed/UI-TARS-1.5-7B}"
SERVED_NAME="${SERVED_NAME:-ui-tars-1.5-7b}"
PORT="${PORT:-8080}"
GPU_MEM_FRAC="${GPU_MEM_FRAC:-0.9}"

command -v vllm >/dev/null 2>&1 || {
  echo "vllm not found. Install with: pip install vllm" >&2
  exit 1
}

echo "[ui-tars] serving ${UI_TARS_MODEL} as '${SERVED_NAME}' on :${PORT}"
exec vllm serve "${UI_TARS_MODEL}" \
  --served-model-name "${SERVED_NAME}" \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --gpu-memory-utilization "${GPU_MEM_FRAC}" \
  --limit-mm-per-prompt image=5
