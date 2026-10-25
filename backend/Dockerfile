# Build the standalone engine binary with Bun's compiler.
# The decky CLI mounts the backend directory and expects artifacts in ./out.
FROM oven/bun:1-slim AS build
WORKDIR /backend
COPY . .
ENTRYPOINT [ "/bin/sh", "-c", "make" ]
