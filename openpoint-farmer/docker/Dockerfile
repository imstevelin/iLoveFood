# syntax=docker/dockerfile:1.7

ARG PYTHON_IMAGE=python:3.11-slim-bookworm@sha256:528257d48c1da0dcecc2e725d1ae34498d60c965f1241e39cd6a85a8859bdf84
ARG REDROID_IMAGE=redroid/redroid:12.0.0_64only-latest@sha256:a6c464bbedcf1dcb67dbf91f329fbb19bee5b50631f0ca6bda6ed7c41b0e64e2

FROM --platform=$BUILDPLATFORM ${PYTHON_IMAGE} AS farmer-tests

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /opt/farmer
COPY docker/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt
COPY reactive_farmer.py hook_mid.js test_reactive_farmer.py ./
RUN PYTHONPATH=/opt/farmer python test_reactive_farmer.py \
    && touch /tmp/tests-passed

FROM ${PYTHON_IMAGE} AS farmer-rootfs

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends adb ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY docker/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt \
    && rm -rf \
      /usr/local/lib/python3.11/ensurepip \
      /usr/local/lib/python3.11/idlelib \
      /usr/local/lib/python3.11/lib2to3 \
      /usr/local/lib/python3.11/tkinter \
      /usr/local/lib/python3.11/unittest \
      /usr/local/lib/python3.11/site-packages/pip \
      /usr/local/lib/python3.11/site-packages/pip-*.dist-info \
      /usr/local/lib/python3.11/site-packages/setuptools \
      /usr/local/lib/python3.11/site-packages/setuptools-*.dist-info \
      /usr/local/lib/python3.11/site-packages/wheel \
      /usr/local/lib/python3.11/site-packages/wheel-*.dist-info \
      /usr/share/doc/* \
      /usr/share/man/*

WORKDIR /opt/farmer
COPY reactive_farmer.py hook_mid.js ./
COPY docker/container-supervisor.sh ./
COPY docker/private/openpoint.apk ./assets/openpoint.apk
COPY docker/private/bootstrap-prefs.xml ./assets/bootstrap-prefs.xml
COPY --from=farmer-tests /tmp/tests-passed /tmp/tests-passed
RUN echo "6850210ae249a0561df7cfc2c480069bd81c118c3bdccd8413a7500d3b7375f1  assets/openpoint.apk" \
      | sha256sum -c - \
    && grep -q 'name="mid"' assets/bootstrap-prefs.xml \
    && grep -q 'name="vcode"' assets/bootstrap-prefs.xml \
    && grep -q 'name="GID"' assets/bootstrap-prefs.xml \
    && chmod 0755 container-supervisor.sh \
    && mkdir -p /run /proc /sys /dev \
    && test -f /tmp/tests-passed \
    && rm -f /tmp/tests-passed

FROM debian:bookworm-slim AS frida-server
ARG TARGETARCH
ARG FRIDA_VERSION=16.2.1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && case "$TARGETARCH" in \
         amd64) frida_arch=x86_64; expected=cec890eba3e60a89f8f08a4124a11a521f69c354aa05546e1b04bac852ef5b30 ;; \
         arm64) frida_arch=arm64; expected=4da75009745c4d7c349331d5aff6563ea9cb50d017ae18e278a67c4310fd09bf ;; \
         *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 64 ;; \
       esac \
    && curl -fL --retry 3 \
       -o /tmp/frida-server.xz \
       "https://github.com/frida/frida/releases/download/${FRIDA_VERSION}/frida-server-${FRIDA_VERSION}-android-${frida_arch}.xz" \
    && echo "$expected  /tmp/frida-server.xz" | sha256sum -c - \
    && unxz /tmp/frida-server.xz \
    && install -m 0755 /tmp/frida-server /frida-server

FROM busybox:1.37.0-musl AS bootstrap

FROM ${REDROID_IMAGE}

LABEL org.opencontainers.image.title="iLoveFood OPENPOINT mid_v farmer" \
      org.opencontainers.image.description="Multi-architecture Android and Frida token farmer" \
      org.opencontainers.image.source="https://github.com/imstevelin/iLoveFood"

COPY --from=bootstrap /bin/busybox /bootstrap/busybox
COPY --from=frida-server /frida-server /bootstrap/frida-server
COPY --from=farmer-rootfs / /farmer-rootfs
COPY --chmod=0755 docker/android-entrypoint.sh /bootstrap/android-entrypoint.sh
COPY --chmod=0755 docker/farmer-launch.sh /bootstrap/farmer-launch.sh
COPY --chmod=0644 docker/ilovefood-farmer.rc /vendor/etc/init/ilovefood-farmer.rc

EXPOSE 5000 5555
STOPSIGNAL SIGRTMIN+3
HEALTHCHECK --interval=15s --timeout=3s --start-period=420s --retries=4 \
  CMD ["/bootstrap/busybox", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:5000/health"]

ENTRYPOINT ["/bootstrap/busybox", "sh", "/bootstrap/android-entrypoint.sh"]
CMD ["androidboot.redroid_width=320", "androidboot.redroid_height=640", "androidboot.redroid_dpi=160", "androidboot.redroid_fps=10", "androidboot.redroid_gpu_mode=guest", "androidboot.use_memfd=1"]
