#!/usr/bin/env bash
# 部署 web-disk-managerment 到 VPS
#
# 流程：本机 npm run build → 打包 dist/ + server/index.mjs → 经阿里云跳板传到 Vultr
#       → 备份 → 替换 → pm2 restart → 冒烟验证
#
# 说明：本机被 Vultr 的 SSH 白名单拒绝（只放行阿里云那台），所以必须经跳板；
#       密码在运行时从 .env 读取（按 `ip=` 分组匹配其后的 `password=`），脚本内不含明文。
#
# 用法: bash scripts/deploy-to-vps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

JUMP_IP="139.196.121.33"          # 阿里云跳板
TARGET_IP="45.32.56.92"           # Vultr（web 管理器所在机）
TARGET_DIR="/opt/web-disk-manager"
PM2_APP="web-disk-manager"
SITE="https://wdm.laybackzzz.com"

die() { echo "✗ $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "找不到 $ENV_FILE"

pw_for() {
  awk -v want="$1" '
    /^ip=/ { cur = substr($0, 4); next }
    /^password=/ && cur == want { print substr($0, 10); exit }
  ' "$ENV_FILE"
}

JUMP_PW="$(pw_for "$JUMP_IP")"
TARGET_PW="$(pw_for "$TARGET_IP")"
[[ -n "$JUMP_PW" && -n "$TARGET_PW" ]] || die ".env 未找到 $JUMP_IP / $TARGET_IP 的密码"

ASKPASS="$(mktemp -t wdm-askpass)"
TARBALL="$(mktemp -t wdm-deploy).tgz"
trap 'rm -f "$ASKPASS" "$TARBALL"' EXIT
chmod 700 "$ASKPASS"
cat >"$ASKPASS" <<EOF
#!/usr/bin/env bash
case "\$1" in
  *$JUMP_IP*)   printf '%s\n' "$JUMP_PW" ;;
  *$TARGET_IP*) printf '%s\n' "$TARGET_PW" ;;
  *) printf '\n' ;;
esac
EOF

export SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null
          -o ConnectTimeout=20 -o PreferredAuthentications=password
          -o PubkeyAuthentication=no -o LogLevel=ERROR -o ServerAliveInterval=15
          -o NumberOfPasswordPrompts=1)

echo "==> 1/4 构建"
(cd "$ROOT" && npm run build)

echo "==> 2/4 打包 dist/ 与 server/index.mjs"
tar czf "$TARBALL" -C "$ROOT" dist server/index.mjs
ls -l "$TARBALL"

echo "==> 3/4 经跳板 $JUMP_IP 上传到 $TARGET_IP"
scp "${SSH_OPTS[@]}" -J "root@$JUMP_IP" "$TARBALL" "root@$TARGET_IP:/tmp/wdm-deploy.tgz"

echo "==> 4/4 备份 / 替换 / 重启 / 验证"
ssh "${SSH_OPTS[@]}" -J "root@$JUMP_IP" "root@$TARGET_IP" 'bash -s' <<REMOTE
set -e
TS=\$(date +%Y%m%d-%H%M%S)
echo "backup -> ${TARGET_DIR}.bak.\$TS"
cp -a "${TARGET_DIR}" "${TARGET_DIR}.bak.\$TS"
rm -rf /tmp/wdm-stage && mkdir -p /tmp/wdm-stage
tar xzf /tmp/wdm-deploy.tgz -C /tmp/wdm-stage
rm -rf "${TARGET_DIR}/dist"
cp -a /tmp/wdm-stage/dist "${TARGET_DIR}/dist"
cp -a /tmp/wdm-stage/server/index.mjs "${TARGET_DIR}/server/index.mjs"
rm -rf /tmp/wdm-stage /tmp/wdm-deploy.tgz
echo "deployed server/index.mjs md5: \$(md5sum "${TARGET_DIR}/server/index.mjs" | cut -d' ' -f1)"
pm2 restart "${PM2_APP}" --update-env >/dev/null
sleep 2
pm2 describe "${PM2_APP}" | grep -E "status|uptime" | head -3
if command -v curl >/dev/null; then
  echo -n "local /api/config: "; curl -s -m 10 http://127.0.0.1:3001/api/config; echo
fi
REMOTE

echo "==> 冒烟验证"
curl -s -m 15 -o /dev/null -w "站点 HTTP %{http_code}\n" "$SITE"
curl -s -m 15 "$SITE/api/config"; echo
