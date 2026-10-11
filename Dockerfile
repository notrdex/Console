FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    nodejs npm bash ca-certificates curl git python3 python3-pip \
    qemu-system-x86 qemu-utils lxd-client docker.io util-linux procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js index.html ./
RUN mkdir -p /data && chown -R nobody:nogroup /app /data

# Run unprivileged. This is a web terminal prototype, not a root VM host.
USER nobody
ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000
CMD ["node", "server.js"]
