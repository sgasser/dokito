#!/bin/sh

set -eu

fail() {
  printf 'dokito: %s\n' "$*" >&2
  exit 1
}

release_base="${DOKITO_RELEASE_BASE:-https://github.com/sgasser/dokito/releases/latest/download}"
install_dir="${DOKITO_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin)
    platform="macos"
    archive_type="zip"
    ;;
  Linux)
    platform="linux"
    archive_type="tar.gz"
    ;;
  *)
    fail "macOS and Linux are supported"
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64)
    architecture="arm64"
    ;;
  x86_64 | amd64)
    architecture="x64"
    ;;
  *)
    fail "arm64 and x64 are supported"
    ;;
esac

for required_command in awk curl install mktemp; do
  command -v "$required_command" >/dev/null 2>&1 ||
    fail "$required_command is required"
done

if [ "$archive_type" = "zip" ]; then
  command -v shasum >/dev/null 2>&1 || fail "shasum is required"
  command -v unzip >/dev/null 2>&1 || fail "unzip is required"
else
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
  command -v tar >/dev/null 2>&1 || fail "tar is required"
fi

archive="dokito-$platform-$architecture.$archive_type"
install_tmp="$(mktemp -d "${TMPDIR:-/tmp}/dokito.XXXXXX")"
trap 'rm -rf "$install_tmp"' 0 1 2 15

curl -fsSLo "$install_tmp/$archive" "$release_base/$archive"
curl -fsSLo "$install_tmp/SHA256SUMS" "$release_base/SHA256SUMS"

expected_checksum="$(
  awk -v archive="$archive" '$2 == archive { print $1 }' \
    "$install_tmp/SHA256SUMS"
)"
[ -n "$expected_checksum" ] || fail "no checksum found for $archive"

if [ "$archive_type" = "zip" ]; then
  actual_checksum="$(shasum -a 256 "$install_tmp/$archive" | awk '{ print $1 }')"
else
  actual_checksum="$(sha256sum "$install_tmp/$archive" | awk '{ print $1 }')"
fi

[ "$actual_checksum" = "$expected_checksum" ] ||
  fail "checksum verification failed"

mkdir "$install_tmp/package"
if [ "$archive_type" = "zip" ]; then
  unzip -q "$install_tmp/$archive" -d "$install_tmp/package"
else
  tar -xzf "$install_tmp/$archive" -C "$install_tmp/package"
fi

mkdir -p "$install_dir"
install -m 755 "$install_tmp/package/dokito" "$install_dir/dokito"
installed_version="$("$install_dir/dokito" --version)"

printf 'Installed Dokito %s to %s\n' "$installed_version" "$install_dir/dokito"

case ":${PATH:-}:" in
  *":$install_dir:"*) ;;
  *) printf 'Add %s to your PATH.\n' "$install_dir" ;;
esac
