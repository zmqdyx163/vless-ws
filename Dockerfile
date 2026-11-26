FROM node:20-alpine AS build
WORKDIR /usr/src
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

FROM scratch
COPY --from=build /usr/local/bin/node /usr/bin/node
COPY --from=build /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1
COPY --from=build /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=build /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=build /etc/os-release /etc/os-release
COPY --from=build /usr/src /usr/src
ENV PORT=8080
CMD ["/usr/bin/node", "/usr/src/server.js"]
