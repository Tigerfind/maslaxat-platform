ARG DEBIAN_SNAPSHOT=20260815T000000Z

FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS nsjail-builder
ARG DEBIAN_SNAPSHOT
ARG NSJAIL_COMMIT=079d70dda4aa1edd9512cfd25ff1e47e316dc355

RUN printf '%s\n' \
      "deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/ bookworm main" \
      "deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}/ bookworm-security main" \
      > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends \
      "bison=2:3.8.2+dfsg-1+b1" \
      "build-essential=12.9" \
      "ca-certificates=20250419~deb12u1" \
      "flex=2.6.4-8.2" \
      "git=1:2.39.5-0+deb12u3" \
      "libcap-dev=1:2.66-4+deb12u3+b1" \
      "libnl-3-dev=3.7.0-0.2+b1" \
      "libnl-genl-3-dev=3.7.0-0.2+b1" \
      "libnl-route-3-dev=3.7.0-0.2+b1" \
      "libprotobuf-dev=3.21.12-3+deb12u1" \
      "libseccomp-dev=2.5.4-1+deb12u1" \
      "pkg-config=1.8.1-1" \
      "protobuf-compiler=3.21.12-3+deb12u1" \
    && git init /src/nsjail \
    && git -C /src/nsjail remote add origin https://github.com/google/nsjail.git \
    && git -C /src/nsjail fetch --depth 1 origin "${NSJAIL_COMMIT}" \
    && git -C /src/nsjail checkout --detach FETCH_HEAD \
    && test "$(git -C /src/nsjail rev-parse HEAD)" = "${NSJAIL_COMMIT}" \
    && make -C /src/nsjail -j2

FROM node:22.18.0-bookworm-slim@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e
ARG DEBIAN_SNAPSHOT

RUN printf '%s\n' \
      "deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/ bookworm main" \
      "deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}/ bookworm-security main" \
      > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends \
      "ca-certificates=20250419~deb12u1" \
      "clamav=1.4.3+dfsg-1~deb12u2" \
      "clamav-freshclam=1.4.3+dfsg-1~deb12u2" \
      "qpdf=11.3.0-1+deb12u1" \
      "poppler-utils=22.12.0-2+deb12u3" \
      "util-linux=2.38.1-5+deb12u3" \
      "libcap2=1:2.66-4+deb12u3+b1" \
      "libnl-3-200=3.7.0-0.2+b1" \
      "libnl-genl-3-200=3.7.0-0.2+b1" \
      "libnl-route-3-200=3.7.0-0.2+b1" \
      "libprotobuf32=3.21.12-3+deb12u1" \
      "libseccomp2=2.5.4-1+deb12u1" \
    && rm -rf /var/lib/apt/lists/*

COPY --from=nsjail-builder /src/nsjail/nsjail /usr/local/bin/nsjail

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY pdf-toolchain/ ./pdf-toolchain/
COPY migrations/ ./migrations/
COPY .sequelizerc ./.sequelizerc
COPY Dockerfile ./Dockerfile
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY src/ ./src/
COPY docker-entrypoint.sh /usr/local/bin/maslaxat-api-entrypoint

RUN chmod 0755 /usr/local/bin/nsjail /usr/local/bin/maslaxat-api-entrypoint \
    && mkdir -p \
      /data/uploads /var/lib/clamav \
      /opt/pdf-runtime-root/app/src/workers \
      /opt/pdf-runtime-root/input /opt/pdf-runtime-root/tmp /opt/pdf-runtime-root/proc \
    && for binary in /usr/local/bin/node /usr/bin/pdftotext; do \
      cp --parents "$binary" /opt/pdf-runtime-root; \
      ldd "$binary" | while read -r first second third remainder; do \
        library=''; \
        if [ "$second" = '=>' ] && [ -n "$third" ] && [ "$third" != 'not' ]; then library="$third"; \
        elif [ "${first#/}" != "$first" ]; then library="$first"; fi; \
        if [ -n "$library" ] && [ -e "$library" ]; then cp --parents "$library" /opt/pdf-runtime-root; fi; \
      done; \
    done \
    && cp src/workers/parseLinkedinPdf.js src/workers/pdfSandboxSelfTest.js \
      /opt/pdf-runtime-root/app/src/workers/ \
    && if [ -d /usr/share/poppler ]; then cp -a --parents /usr/share/poppler /opt/pdf-runtime-root; fi \
    && touch /opt/pdf-runtime-root/input/profile.pdf /opt/pdf-runtime-root/input/probe \
    && chmod -R a-w /opt/pdf-runtime-root \
    && chown -R node:node /data /var/lib/clamav \
    && printf '%s\n' \
      'DatabaseOwner node' \
      'DatabaseDirectory /var/lib/clamav' \
      'DatabaseMirror database.clamav.net' \
      'Checks 4' \
      > /etc/clamav/freshclam.conf \
    && node src/scripts/verifyPdfToolchain.js \
    && node src/scripts/verifyPdfDockerContract.js

ENV CLAMAV_DEFINITION_DIRECTORY=/var/lib/clamav \
    PDF_IMPORT_AVAILABILITY_FILE=/tmp/pdf-import-availability.json

USER node
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/maslaxat-api-entrypoint"]
CMD ["node", "src/server.js"]
