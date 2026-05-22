#!/usr/bin/env bash
set -euo pipefail

deb_arch="${CLOUDFLARED_DEB_ARCH:-$(dpkg --print-architecture)}"
case "${deb_arch}" in
    amd64 | arm64)
        asset_arch="${deb_arch}"
        ;;
    armhf)
        asset_arch="arm"
        ;;
    i386 | 386)
        asset_arch="386"
        ;;
    *)
        printf 'Unsupported cloudflared Debian architecture: %s\n' "${deb_arch}" >&2
        exit 1
        ;;
esac

deb_path="${TMPDIR:-/tmp}/cloudflared-${asset_arch}.deb"
release="${CLOUDFLARED_RELEASE:-latest}"
if [[ "${release}" == "latest" ]]; then
    release_url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${asset_arch}.deb"
else
    release_url="https://github.com/cloudflare/cloudflared/releases/download/${release}/cloudflared-linux-${asset_arch}.deb"
fi

curl -fsSL --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors "${release_url}" -o "${deb_path}"

if [[ "$(id -u)" -eq 0 ]]; then
    dpkg -i "${deb_path}"
else
    sudo -n dpkg -i "${deb_path}"
fi

rm -f "${deb_path}"
cloudflared --version
