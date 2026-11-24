# LobeHub 2.3.5 (official image, unmodified, pinned by digest) plus a Railway start script:
# migrations with retries, JWKS key kept in Postgres, Bucket CORS, owner account created
# before the public port opens, safe handling of odd deploy-form values.
ARG LOBEHUB_IMAGE=lobehub/lobehub:2.3.5@sha256:b34dd5a2c130a615d979102e2498fe9532f35f2d22018b48c38879bc0dd6b570
FROM ${LOBEHUB_IMAGE}

COPY --chmod=0644 railway-lobehub.cjs /app/railway-lobehub.cjs

ENV PORT=3210
# ENTRYPOINT is /bin/node in the upstream image.
CMD ["/app/railway-lobehub.cjs"]
