# Private SearXNG metasearch instance for LobeHub's web-search tool (SEARXNG_URL).
# Adds a settings.yml that enables the JSON output format LobeHub needs.
# Pin (checked 2026-11-24 on Docker Hub): rolling build of commit 1ebea4a07, index digest.
ARG SEARXNG_IMAGE=searxng/searxng:2026.11.20-1ebea4a07@sha256:8140a62838a141721e5031070e2e1a2edd4b91f1730e285716da197d76a40182
FROM ${SEARXNG_IMAGE}

COPY --chown=searxng:searxng settings.yml /etc/searxng/settings.yml

EXPOSE 8080
