# Web app + async worker. The VM daemon shells out to virsh/ssh, so the runtime
# image ships libvirt-clients + ssh. To control VMs on the host, mount the libvirt
# socket and set CUF_LIBVIRT_URI=qemu:///system (see README hosting notes).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends libvirt-clients openssh-client sshpass ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    CUF_DB_PATH=/data/fleet.db
COPY --from=build /app ./
VOLUME /data
EXPOSE 3000
CMD ["npm", "run", "start"]
