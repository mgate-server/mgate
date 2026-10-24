#!/usr/bin/env bash
# Standalone installer and checkout onboarding. Downloads only public release files/images.
# Prompts use /dev/tty so `curl ... | sudo bash` also works.
set -Eeuo pipefail
umask 077

ok()   { printf '  [OK] %s\n' "$*"; }
warn() { printf '  [!] %s\n' "$*" >&2; }
die()  { printf '  [ОШИБКА] %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Установка MGate (Linux x86_64).
  sudo bash install-mgate.sh [параметры]
  sudo bash scripts/install.sh [параметры]    # из распакованного релиза

  --domain example.org       Почтовый домен (ASCII / punycode)
  --hostname mail.example.org Имя сервера, панели и MX (по умолчанию mail.<domain>)
  --admin-email EMAIL        Логин администратора (по умолчанию admin@<domain>)
  --dir /opt/mgate           Каталог установки (по умолчанию checkout или /opt/mgate)
  --version YYYY.M.N         Конкретный релиз (по умолчанию последний опубликованный)
  --without-clamav           Установка без антивируса (для серверов с 2–4 GB RAM)
  --no-install-deps          Только проверять зависимости, без установки пакетов
  --skip-port-check         Пропустить проверку портов (для существующего стека)
  --skip-pull               Использовать уже скачанные образы
  --wait-timeout SECONDS    Ожидание готовности (по умолчанию 900 секунд)
  -h, --help                Эта справка

Docker и зависимости устанавливаются автоматически на Debian/Ubuntu.
На других Linux установите Docker 25+, Compose 2.24+, curl, openssl, python3,
ca-certificates, tar, gzip и iproute2 вручную. Уже существующий .env сохраняется.
EOF
}

parse_args() {
  domain='' hostname='' admin_email='' install_dir='' version=''
  without_clamav=0 install_deps=1 skip_port_check=0 skip_pull=0 wait_timeout=900
  while (($#)); do
    case "$1" in
      --domain|--hostname|--admin-email|--dir|--version|--wait-timeout)
        [[ $# -ge 2 && -n $2 && $2 != --* ]] || die "Для $1 нужно значение."
        case "$1" in
          --domain) domain=$2 ;; --hostname) hostname=$2 ;; --admin-email) admin_email=$2 ;;
          --dir) install_dir=$2 ;; --version) version=${2#v} ;; --wait-timeout) wait_timeout=$2 ;;
        esac
        shift 2 ;;
      --without-clamav) without_clamav=1; shift ;;
      --no-install-deps) install_deps=0; shift ;;
      --skip-port-check) skip_port_check=1; shift ;;
      --skip-pull) skip_pull=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Неизвестный параметр: $1 (см. --help)." ;;
    esac
  done
  [[ $wait_timeout =~ ^[1-9][0-9]{0,4}$ ]] || die "--wait-timeout: нужно целое число от 1 до 99999."
  [[ -z $version || $version =~ ^[0-9]{4}\.([1-9]|1[0-2])\.[1-9][0-9]*$ ]] || die "Версия должна иметь формат YYYY.M.N."
}

prompt() {
  local label=$1 default=$2 answer
  printf '%s [%s]: ' "$label" "$default" >&2
  if [[ -t 0 ]]; then
    IFS= read -r answer || die "Ввод прерван."
  elif { exec 3</dev/tty; } 2>/dev/null; then
    IFS= read -r answer <&3 || die "Ввод прерван."
    exec 3<&-
  else
    die "Нет терминала. Передайте --domain, --hostname и --admin-email параметрами."
  fi
  printf '%s' "${answer:-$default}"
}

validate_settings() {
  python3 - "$domain" "$hostname" "$admin_email" <<'PYCODE'
import ipaddress, re, sys

def fqdn(value):
    if len(value) > 253 or '.' not in value:
        return False
    try:
        ipaddress.ip_address(value)
        return False
    except ValueError:
        pass
    return all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', part)
               for part in value.split('.'))

domain, hostname, email = sys.argv[1:]
if not fqdn(domain) or not fqdn(hostname):
    sys.exit('Укажите домен и имя сервера без протокола, пути и порта (IDN: punycode).')
local, sep, mail_domain = email.rpartition('@')
if not sep or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}", local) or not fqdn(mail_domain):
    sys.exit('Некорректный e-mail администратора.')
PYCODE
}

apt_install() {
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" </dev/null \
    || die "Не удалось установить пакеты: $*. Проверьте apt и доступ в Интернет, затем повторите запуск."
}

prepare_dependencies() {
  local missing=() command_name
  for command_name in curl openssl python3 tar gzip ip ss; do
    command -v "$command_name" >/dev/null 2>&1 || missing+=("$command_name")
  done
  [[ -d /etc/ssl/certs && -n $(ls -A /etc/ssl/certs 2>/dev/null) ]] || missing+=(ca-certificates)
  if ((${#missing[@]})); then
    if [[ $install_deps == 1 && $os_id =~ ^(debian|ubuntu)$ ]] && command -v apt-get >/dev/null; then
      warn "Устанавливаю системные зависимости: ${missing[*]}."
      apt-get update </dev/null || die "Не удалось обновить apt. Проверьте /etc/apt/sources.list и сеть."
      apt_install ca-certificates curl openssl python3 tar gzip iproute2
    else
      die "Не хватает: ${missing[*]}. Установите curl openssl python3 ca-certificates tar gzip iproute2 через пакетный менеджер и повторите запуск."
    fi
  fi
}

fetch() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 300 --retry 2 "$@"
}

install_docker() {
  [[ $install_deps == 1 && $os_id =~ ^(debian|ubuntu)$ ]] \
    || die "Установите Docker Engine 25+ и плагин Compose 2.24+: https://docs.docker.com/engine/install/"
  # Do not remove a host's container runtime or replace an existing package repository.
  local package
  for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
    if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) == 'install ok installed' ]]; then
      die "Пакет $package конфликтует с Docker CE. Подготовьте Docker вручную: https://docs.docker.com/engine/install/$os_id/"
    fi
  done
  [[ -n $os_codename && $os_codename =~ ^[a-z]+$ ]] || die "Не определено кодовое имя ОС; установите Docker вручную."
  [[ ! -e /etc/apt/sources.list.d/docker.sources && ! -e /etc/apt/sources.list.d/docker.list ]] \
    || die "Репозиторий Docker уже настроен. Выполните apt-get update && apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin."
  # Official Docker apt repository: docs.docker.com/engine/install/{debian,ubuntu}/.
  warn "Устанавливаю Docker Engine и Compose из официального apt-репозитория Docker."
  install -d -m 0755 /etc/apt/keyrings
  fetch "https://download.docker.com/linux/$os_id/gpg" -o "$work_dir/docker.asc"
  install -m 0644 "$work_dir/docker.asc" /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$os_id
Suites: $os_codename
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update </dev/null || die "Не удалось подключить репозиторий Docker. Проверьте сеть и поддержку версии ОС."
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

version_at_least() {
  python3 - "$1" "$2" <<'PYCODE'
import re, sys

def parts(value):
    match = re.match(r'v?(\d+)\.(\d+)(?:\.(\d+))?', value)
    return tuple(int(x or 0) for x in match.groups()) if match else (0, 0, 0)
sys.exit(0 if parts(sys.argv[1]) >= parts(sys.argv[2]) else 1)
PYCODE
}

check_host_resources() {
  python3 - "$install_dir" "$without_clamav" <<'PYCODE'
import os, pathlib, shutil, sys
path, without_av = pathlib.Path(sys.argv[1]), sys.argv[2]
existing = path / '.env'
# Existing profile/resource settings are validated with the rendered compose below.
if not existing.exists():
    mem = int(next(line.split()[1] for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:')))
    minimum = 1800000 if without_av == '1' else 3800000
    if mem < minimum:
        sys.exit('Нужно 4 GB RAM с ClamAV или 2 GB без него. Добавьте память или используйте --without-clamav.')
    if (os.cpu_count() or 1) < 2:
        sys.exit('Нужно минимум 2 vCPU. Измените тариф сервера.')
while not path.exists():
    path = path.parent
if shutil.disk_usage(path).free < 20 * 1024**3:
    sys.exit('Нужно минимум 20 GiB свободного места. Увеличьте диск или освободите место.')
PYCODE
}

prepare_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    install_docker
  elif ! docker compose version --short >/dev/null 2>&1; then
    if [[ $install_deps == 1 && $os_id =~ ^(debian|ubuntu)$ ]] && apt-cache show docker-compose-plugin >/dev/null 2>&1; then
      apt_install docker-compose-plugin
    else
      die "Нет плагина Compose. Установите его: https://docs.docker.com/compose/install/linux/"
    fi
  fi
  # Check the context before attempting to start the local daemon.
  [[ $(docker context inspect --format '{{.Endpoints.docker.Host}}') == unix://* && ${DOCKER_HOST:-unix://} == unix://* ]] \
    || die "Нужен локальный Docker daemon (unix socket). Отключите DOCKER_HOST / удалённый docker context."
  if ! docker info >/dev/null 2>&1; then
    if command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; then
      systemctl enable --now docker || die "Docker не запускается. Диагностика: journalctl -u docker; systemctl status docker."
    else
      die "Docker недоступен. Запустите службу Docker (service docker start), проверьте docker info и повторите запуск."
    fi
  fi
  docker info >/dev/null 2>&1 || die "Docker недоступен. Проверьте docker context show, DOCKER_HOST и systemctl status docker."
  [[ $(docker info --format '{{.OSType}}/{{.Architecture}}') =~ ^linux/(x86_64|amd64)$ ]] \
    || die "Docker должен запускать Linux x86_64 контейнеры."
  [[ $(docker info --format '{{json .SecurityOptions}}') != *rootless* ]] || die "Для стандартных почтовых портов нужен rootful Docker."
  local engine compose_version
  engine=$(docker version --format '{{.Server.Version}}')
  compose_version=$(docker compose version --short)
  version_at_least "$engine" 25.0 || die "Docker $engine устарел. Обновите до 25+: https://docs.docker.com/engine/install/"
  version_at_least "$compose_version" 2.24 || die "Compose $compose_version устарел. Обновите плагин до 2.24+."
  ok "Docker $engine, Compose $compose_version."
}

prepare_release() {
  if [[ -f $install_dir/docker-compose.yml && -f $install_dir/.env.example && -f $install_dir/scripts/gen-secrets.sh ]]; then
    [[ -z $version || $(cat "$install_dir/VERSION") == "$version" ]] \
      || die "В каталоге уже другая версия. Для обновления следуйте docs/DEPLOYMENT.md; установщик не заменяет файлы."
    return
  fi
  if [[ -e $install_dir ]]; then
    [[ -d $install_dir && -z $(ls -A "$install_dir") ]] || die "Каталог $install_dir не пуст. Выберите другой через --dir."
  fi
  if [[ -z $version ]]; then
    fetch https://api.github.com/repos/mgate-server/mgate/releases/latest -o "$work_dir/release.json" \
      || die "Не удалось определить релиз. Проверьте доступ к api.github.com или задайте --version YYYY.M.N."
    version=$(python3 - "$work_dir/release.json" <<'PYCODE'
import json, re, sys
with open(sys.argv[1]) as stream:
    tag = json.load(stream).get('tag_name', '')
if not re.fullmatch(r'v[0-9]{4}\.(?:[1-9]|1[0-2])\.[1-9][0-9]*', tag):
    sys.exit('GitHub вернул некорректную версию релиза.')
print(tag[1:])
PYCODE
    )
  fi
  ok "Загружаю релиз $version в $install_dir."
  fetch "https://github.com/mgate-server/mgate/archive/refs/tags/v$version.tar.gz" -o "$work_dir/release.tar.gz" \
    || die "Релиз v$version недоступен. Проверьте https://github.com/mgate-server/mgate/releases и сеть."
  # git archives may carry group-writable modes; the host updater needs root-owned,
  # non-group-writable installation files regardless of the invoking shell's umask.
  (
    umask 022
    mkdir "$work_dir/release"
    tar -xzf "$work_dir/release.tar.gz" --strip-components=1 -C "$work_dir/release" --no-same-owner --no-same-permissions
  )
  [[ $(cat "$work_dir/release/VERSION") == "$version" && -f $work_dir/release/scripts/gen-secrets.sh && -f $work_dir/release/docker-compose.yml ]] \
    || die "Неполный архив релиза или несовпадение VERSION."
  mkdir -p -- "$install_dir"
  cp -a "$work_dir/release/." "$install_dir/"
}

configure() {
  if [[ -f $install_dir/.env ]]; then
    [[ -z $domain && -z $hostname && -z $admin_email && $without_clamav == 0 ]] \
      || die "Конфигурация .env уже существует. Параметры домена/администратора/ClamAV меняйте в ней вручную."
    ok "Существующий .env сохранён; пароли и версия не меняются."
    return
  fi
  [[ -n $domain ]] || domain=$(prompt 'Какой почтовый домен подключить (например company.ru)' '')
  domain=${domain,,}
  [[ -n $hostname ]] || hostname=$(prompt 'Имя почтового сервера (FQDN)' "mail.$domain")
  hostname=${hostname,,}
  [[ -n $admin_email ]] || admin_email=$(prompt 'E-mail администратора' "admin@$domain")
  validate_settings
  if ((without_clamav == 0)) && [[ $(awk '/MemTotal:/ {print $2}' /proc/meminfo) -lt 3800000 ]]; then
    die "Для ClamAV нужно минимум 4 GB RAM. Добавьте память или запустите с --without-clamav (минимум 2 GB)."
  fi
  if [[ -n $(docker volume ls -q --filter label=com.docker.compose.project=mgate) ]]; then
    die "Найдены данные прежней установки MGate. Восстановите её .env и используйте прежний каталог; новые пароли не подойдут к существующей БД."
  fi
  bash "$install_dir/scripts/gen-secrets.sh" "$install_dir/.env.example" "$work_dir/new.env"
  python3 - "$work_dir/new.env" "$domain" "$hostname" "$admin_email" "$without_clamav" <<'PYCODE'
from pathlib import Path
import secrets, sys
path, domain, hostname, email, without_av = sys.argv[1:]
p = Path(path)
updates = dict(MGATE_HOSTNAME=hostname, MGATE_ADMIN_EMAIL="'" + email.replace("'", "\\'") + "'",
               MGATE_ADMIN_PASSWORD='Aa1-' + secrets.token_urlsafe(24), MGATE_MAIL_DOMAIN=domain)
if without_av == '1':
    updates['COMPOSE_PROFILES'] = ''
lines = []
for line in p.read_text().splitlines():
    key = line.partition('=')[0]
    if key in updates:
        line = key + '=' + updates.pop(key)
    lines.append(line)
lines.extend(k + '=' + v for k, v in updates.items())
p.write_text('\n'.join(lines) + '\n')
p.chmod(0o600)
PYCODE
  mv -- "$work_dir/new.env" "$install_dir/.env"
  ok "Домен и случайные пароли сохранены в $install_dir/.env (доступ только владельцу)."
}

compose() {
  docker compose --project-directory "$install_dir" --env-file "$install_dir/.env" \
    -f "$install_dir/docker-compose.yml" "$@"
}

preflight() {
  compose config --format json > "$work_dir/compose.json"
  local docker_root
  docker_root=$(docker info --format '{{.DockerRootDir}}')
  python3 - "$work_dir/compose.json" "$install_dir" "$docker_root" "$skip_port_check" <<'PYCODE'
import ipaddress, json, os, pathlib, shutil, socket, subprocess, sys
config_path, install_dir, docker_root, skip_ports = sys.argv[1:]
c = json.loads(pathlib.Path(config_path).read_text())
errors = []
mem = int(next(line.split()[1] for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:')))
profiles = []
for line in pathlib.Path(install_dir, '.env').read_text().splitlines():
    if line.startswith('COMPOSE_PROFILES='):
        profiles = line.split('=', 1)[1].strip('\"\'').split(',')
minimum = 3800000 if 'clamav' in profiles else 1800000
if mem < minimum:
    errors.append('Недостаточно RAM: нужно 4 GB с ClamAV или 2 GB без него (--without-clamav).')
if (os.cpu_count() or 1) < 2:
    errors.append('Нужно минимум 2 vCPU. Измените тариф сервера.')
for directory in {install_dir, docker_root}:
    if not pathlib.Path(directory).is_dir():
        errors.append('Не найден каталог данных Docker. Проверьте docker info.')
    elif shutil.disk_usage(directory).free < 20 * 1024**3:
        errors.append('Нужно 20 GiB свободного места: ' + directory + '. Освободите место или увеличьте диск.')
# Existing containers must belong to this exact installation before occupied ports are exempt.
owned_ports = set()
ids = subprocess.check_output(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=mgate'], text=True).split()
if ids:
    containers = json.loads(subprocess.check_output(['docker', 'inspect', *ids], text=True))
    for container in containers:
        labels = container.get('Config', {}).get('Labels', {})
        if os.path.realpath(labels.get('com.docker.compose.project.working_dir', '/')) != os.path.realpath(install_dir):
            errors.append('Уже существует другой compose-проект mgate. Используйте его каталог или отдельный сервер.')
        for key, bindings in (container.get('NetworkSettings', {}).get('Ports') or {}).items():
            for binding in bindings or []:
                owned_ports.add(int(binding['HostPort']))
# Published ports can be reserved by Docker NAT even with userland-proxy disabled.
reserved_ports = []
running_ids = subprocess.check_output(['docker', 'ps', '-q'], text=True).split()
running = json.loads(subprocess.check_output(['docker', 'inspect', *running_ids], text=True)) if running_ids else []
for container in running:
    labels = container.get('Config', {}).get('Labels', {})
    if (labels.get('com.docker.compose.project') == 'mgate' and
            os.path.realpath(labels.get('com.docker.compose.project.working_dir', '/')) == os.path.realpath(install_dir)):
        continue
    for bindings in (container.get('NetworkSettings', {}).get('Ports') or {}).values():
        for binding in bindings or []:
            reserved_ports.append((binding.get('HostIp', '0.0.0.0'), int(binding['HostPort'])))
# Reject overlap with VPN/LAN routes and other Docker networks before compose creates them.
subnet = ipaddress.ip_network(c['networks']['backend']['ipam']['config'][0]['subnet'])
network_ids = subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True).split()
networks = json.loads(subprocess.check_output(['docker', 'network', 'inspect', *network_ids], text=True)) if network_ids else []
owned_subnets = set()
for network in networks:
    own = network.get('Labels', {}).get('com.docker.compose.project') == 'mgate' and bool(ids)
    for item in network.get('IPAM', {}).get('Config') or []:
        if not item.get('Subnet'):
            continue
        other = ipaddress.ip_network(item['Subnet'])
        if own:
            owned_subnets.add(str(other))
        elif subnet.overlaps(other):
            errors.append(f'Подсеть {subnet} пересекается с Docker-сетью {network["Name"]}. Измените MGATE_BACKEND_SUBNET, MGATE_RESOLVER_IP и MGATE_VALKEY_IP в .env.')
routes = json.loads(subprocess.check_output(['ip', '-j', 'route', 'show'], text=True))
for route in routes:
    destination = route.get('dst', 'default')
    if destination == 'default' or destination in owned_subnets:
        continue
    try:
        dest_net = ipaddress.ip_network(destination, strict=False)
        if dest_net.prefixlen <= 1:
            continue
        if subnet.overlaps(dest_net):
            errors.append(f'Подсеть {subnet} пересекается с маршрутом {destination}. Измените MGATE_BACKEND_SUBNET, MGATE_RESOLVER_IP и MGATE_VALKEY_IP в .env.')
    except Exception:
        continue
if skip_ports != '1':
    for service in c['services'].values():
        for port in service.get('ports', []):
            number = int(port['published'])
            address = port.get('host_ip', '0.0.0.0')
            if any(p == number and (ip == address or ip in ('0.0.0.0', '::') or address in ('0.0.0.0', '::')) for ip, p in reserved_ports):
                errors.append(f'Порт {number}/TCP уже опубликован другим Docker-контейнером. Проверьте docker ps и освободите порт.')
                continue
            if number in owned_ports:
                continue
            family = socket.AF_INET6 if ':' in address else socket.AF_INET
            with socket.socket(family, socket.SOCK_STREAM) as sock:
                try:
                    sock.bind((address, number))
                except OSError:
                    errors.append(f'Порт {address}:{number}/TCP недоступен. Найдите службу: ss -ltnp; освободите порт и повторите запуск.')
if errors:
    sys.exit('\n'.join(errors))
print('  [OK] Ресурсы, каталог Docker, конфигурация и порты проверены.')
PYCODE
}

dns_hints() {
  python3 - "$work_dir/compose.json" <<'PYCODE'
import json, pathlib, socket, subprocess, sys
c = json.loads(pathlib.Path(sys.argv[1]).read_text())
hostname = c['services']['api']['environment']['MGATE_HOSTNAME']
try:
    addresses = sorted({row[4][0] for row in socket.getaddrinfo(hostname, None, socket.AF_INET)})
except socket.gaierror:
    addresses = []
local = json.loads(subprocess.check_output(['ip', '-j', 'address'], text=True))
local_ips = {a['local'] for interface in local for a in interface.get('addr_info', [])}
if not addresses:
    print(f'  [!] Нет A-записи {hostname}. Добавьте её в DNS: IP — публичный IPv4 этого сервера.')
else:
    print(f"  [OK] A {hostname}: {', '.join(addresses)}")
    if not local_ips.intersection(addresses):
        print('  [!] A-запись не совпадает с адресами интерфейсов. Проверьте публичный IP / NAT; отключите CDN-прокси.')
    for address in addresses:
        try:
            ptr = socket.gethostbyaddr(address)[0].rstrip('.')
        except OSError:
            ptr = ''
        if ptr.lower() != hostname.lower():
            print(f'  [!] У провайдера сервера настройте PTR {address} → {hostname}.')
PYCODE
  warn 'В firewall хоста и провайдера разрешите входящие TCP 25,80,443,465,587,110,143,993,995,4190; исходящие TCP 25,80,443 и UDP/TCP 53. Сохраните доступ по SSH.'
  warn 'Внешнюю доступность портов проверьте с другой машины. Блокировку исходящего TCP/25 снимает провайдер сервера.'
}

wait_ready() {
  python3 - "$install_dir" "$wait_timeout" <<'PYCODE'
import json, subprocess, sys, time
root, timeout = sys.argv[1:]
command = ['docker', 'compose', '--project-directory', root, '--env-file', root + '/.env', '-f', root + '/docker-compose.yml']
expected = set(subprocess.check_output(command + ['config', '--services'], text=True).split())
end = time.monotonic() + int(timeout)
pending = sorted(expected)
while time.monotonic() < end:
    ids = subprocess.check_output(command + ['ps', '--all', '--quiet'], text=True).split()
    containers = json.loads(subprocess.check_output(['docker', 'inspect', *ids], text=True)) if ids else []
    ready = set()
    for container in containers:
        service = container['Config']['Labels']['com.docker.compose.service']
        state = container['State']
        if service == 'migrate':
            if state['Status'] == 'exited' and state['ExitCode'] == 0:
                ready.add(service)
            elif state['Status'] in ('exited', 'dead'):
                sys.exit('Миграции завершились с ошибкой. Проверьте docker compose logs migrate в каталоге установки.')
        elif state['Status'] == 'running' and state.get('Health', {}).get('Status', 'healthy') == 'healthy':
            ready.add(service)
        elif state['Status'] in ('exited', 'dead'):
            sys.exit('Сервис остановлен: ' + service + '. Проверьте docker compose logs ' + service)
    pending = sorted(expected - ready)
    if not pending:
        print('  [OK] Миграции завершены, все сервисы готовы.')
        break
    print('  […] Ожидание: ' + ', '.join(pending), flush=True)
    time.sleep(min(5, max(0, end - time.monotonic())))
else:
    sys.exit('Истекло время ожидания: ' + ', '.join(pending) + '. Проверьте docker compose ps / logs; повторите с --wait-timeout 1800.')
PYCODE
}

capture_bootstrap_env() {
  local migrate_id
  migrate_id=$(compose ps --all --quiet migrate)
  [[ -n $migrate_id && $migrate_id != *$'\n'* ]] || die "Не найден единственный контейнер migrate. Проверьте docker compose ps -a."
  # Read the effective container values: older compose config versions escape literal '$'.
  docker inspect --format '{{json .Config.Env}}' "$migrate_id" > "$work_dir/bootstrap-env.json"
}

connect_domain() {
  # Credentials go only to the local Traefik listener; no DNS resolution or proxies.
  python3 - "$work_dir/compose.json" "$install_dir/.env" "$work_dir/bootstrap-env.json" <<'PYCODE'
import http.client, json, pathlib, ssl, sys
c = json.loads(pathlib.Path(sys.argv[1]).read_text())
env = dict(line.split('=', 1) for line in pathlib.Path(sys.argv[2]).read_text().splitlines() if line and not line.startswith('#') and '=' in line)
domain = env.get('MGATE_MAIL_DOMAIN')
marker = pathlib.Path(sys.argv[2]).parent / '.mgate-installed-domain'
e = dict(value.split('=', 1) for value in json.loads(pathlib.Path(sys.argv[3]).read_text()) if '=' in value)
hostname, email, password = e['MGATE_HOSTNAME'], e['MGATE_ADMIN_EMAIL'], e.get('MGATE_ADMIN_PASSWORD')
port = c['services']['traefik']['ports']
port = next(p for p in port if int(p['target']) == 443)
address = port.get('host_ip', '0.0.0.0')
address = {'0.0.0.0': '127.0.0.1', '::': '::1'}.get(address, address)
# The bootstrap certificate is self-signed; bypass verification on the local socket only.
context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
context.check_hostname = False
context.verify_mode = ssl.CERT_NONE

def request(method, path, body=None, token=None):
    conn = http.client.HTTPSConnection(address, int(port['published']), context=context, timeout=20)
    headers = {'Host': hostname, 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    try:
        conn.request(method, path, json.dumps(body) if body is not None else None, headers)
        response = conn.getresponse()
        raw = response.read()
        return response.status, json.loads(raw) if raw else {}
    finally:
        conn.close()

try:
    status, body = request('GET', '/api/v1/system/health')
    if status != 200 or body.get('status') != 'ok':
        sys.exit('Локальная панель не прошла проверку API. Проверьте docker compose logs traefik api.')
    if not domain:
        print('  [!] Добавьте почтовый домен в разделе «Домены» панели администратора.')
        sys.exit(0)
    if marker.exists() and marker.read_text().strip() == domain:
        print(f'  [OK] Почтовый домен {domain} уже настроен установщиком.')
        sys.exit(0)
    if not password:
        sys.exit('Не задан пароль администратора. Подключите домен через панель администратора.')
    status, body = request('POST', '/api/v1/auth/login', {'email': email, 'password': password})
    if status != 200 or not body.get('token'):
        sys.exit('Не удалось войти для настройки домена. Подключите домен в панели администратора; если пароль менялся, используйте актуальный.')
    token = body['token']
    try:
        status, _ = request('POST', '/api/v1/admin/domains', {'name': domain}, token)
        if status not in (200, 201, 409):
            sys.exit(f'Не удалось подключить домен (HTTP {status}). Проверьте раздел «Домены» и лимит редакции в панели.')
    finally:
        request('POST', '/api/v1/auth/logout', token=token)
except (OSError, ValueError, http.client.HTTPException):
    sys.exit('Не удалось обратиться к локальной панели. Проверьте docker compose logs traefik api; повторите установщик или подключите домен в панели.')
marker.write_text(domain + '\n')
marker.chmod(0o600)
print(f'  [OK] Почтовый домен {domain} подключён.')
print(f'Добавьте DNS: A {hostname} → публичный IPv4 сервера; MX {domain} → 10 {hostname}.')
print(f'TXT {domain}: v=spf1 mx ~all; TXT _dmarc.{domain}: v=DMARC1; p=none')
print('DKIM и остальные записи скопируйте из мастера DNS в разделе «Домены» панели.')
PYCODE
}

main() {
  parse_args "$@"
  [[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || die "Образы MGate доступны только для Linux x86_64. Используйте сервер этой архитектуры."
  ((BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 3))) || die "Нужен Bash 4.3+."
  ((EUID == 0)) || die "Запустите с правами root: sudo bash install-mgate.sh (параметры см. --help)."
  os_id='' os_codename=''
  if [[ -r /etc/os-release ]]; then
    # /etc/os-release is trusted system configuration, never source downloaded .env files.
    # shellcheck source=/dev/null
    os_id=$(. /etc/os-release; printf '%s' "${ID:-}")
    # shellcheck source=/dev/null
    os_codename=$(. /etc/os-release; printf '%s' "${VERSION_CODENAME:-}")
  fi
  local source_dir=
  if [[ -n ${BASH_SOURCE[0]:-} && -f ${BASH_SOURCE[0]} ]]; then
    source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
  fi
  if [[ -z $install_dir ]]; then
    if [[ -n $source_dir && -f $source_dir/docker-compose.yml && -f $source_dir/.env.example ]]; then
      install_dir=$source_dir
    else
      install_dir=/opt/mgate
    fi
  fi
  [[ $install_dir == /* && $install_dir != / && $install_dir != *$'\n'* ]] || die "--dir должен быть абсолютным путём к отдельному каталогу."
  work_dir=$(mktemp -d)
  trap 'rm -rf -- "$work_dir"' EXIT
  trap 'printf "  [ОШИБКА] Установка прервана. Исправьте указанную выше причину и повторите запуск. Существующие данные сохранены.\n" >&2' ERR
  prepare_dependencies
  check_host_resources
  prepare_docker
  prepare_release
  configure
  preflight
  dns_hints
  if ((skip_pull == 0)); then
    compose pull || die "Не удалось скачать образы. Проверьте доступ к ghcr.io и Docker Hub, свободное место и MGATE_VERSION в .env."
  fi
  compose up -d --no-build || die "Ошибка запуска. В каталоге установки выполните docker compose ps и docker compose logs."
  wait_ready
  if [[ -f $install_dir/scripts/updater.py && -d /run/systemd/system ]] && command -v systemctl >/dev/null; then
    if ! bash "$install_dir/scripts/update.sh" --dir "$install_dir" --install-service; then
      warn 'MGate запущен, но службу обновления подключить не удалось. Выполните sudo make updater-install в каталоге установки.'
    fi
  fi
  capture_bootstrap_env
  connect_domain
  compose ps
  python3 - "$work_dir/bootstrap-env.json" "$install_dir" <<'PYCODE'
import json, pathlib, shlex, sys
e = dict(value.split('=', 1) for value in json.loads(pathlib.Path(sys.argv[1]).read_text()) if '=' in value)
print('\nMGate установлен. Панель: https://' + e['MGATE_HOSTNAME'] + '/admin')
print('Логин: ' + e['MGATE_ADMIN_EMAIL'])
print('Каталог: ' + sys.argv[2])
if e.get('MGATE_ADMIN_PASSWORD'):
    print('Первоначальный пароль администратора: MGATE_ADMIN_PASSWORD в ' + sys.argv[2] + '/.env (откройте через sudo less).')
else:
    print("Первый пароль был выведен при инициализации: docker compose logs migrate | grep -A2 'initial superadmin'")
print('Если пароль утерян: docker compose exec api mgate admin reset-password ' + shlex.quote(e['MGATE_ADMIN_EMAIL']))
PYCODE
  warn 'По умолчанию TLS-сертификат самоподписанный. Загрузите собственную цепочку PEM и ключ в разделе «Сертификаты»; автоматический выпуск пока не реализован.'
  printf 'Управление: cd %q && docker compose ps (или logs / restart / down). Тома с почтой и БД сохраняются.\n' "$install_dir"
}

# Sourcing is used by the isolated installer tests. An empty BASH_SOURCE also covers stdin.
if [[ -z ${BASH_SOURCE[0]:-} || ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
