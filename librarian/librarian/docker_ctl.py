"""Docker container management via Unix socket API."""

import json
import logging
import socket
from urllib.parse import quote

log = logging.getLogger(__name__)

DOCKER_SOCKET = "/var/run/docker.sock"


def _request(method: str, path: str, body: bytes | None = None) -> dict | list | None:
    """Make a raw HTTP request to the Docker Unix socket."""
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(30)
        sock.connect(DOCKER_SOCKET)

        headers = f"{method} {path} HTTP/1.1\r\nHost: localhost\r\n"
        if body:
            headers += f"Content-Type: application/json\r\nContent-Length: {len(body)}\r\n"
        headers += "Connection: close\r\n\r\n"

        sock.sendall(headers.encode())
        if body:
            sock.sendall(body)

        response = b""
        while True:
            chunk = sock.recv(8192)
            if not chunk:
                break
            response += chunk
        sock.close()

        # Parse HTTP response
        parts = response.split(b"\r\n\r\n", 1)
        if len(parts) < 2:
            return None

        body_data = parts[1]
        # Handle chunked transfer encoding
        header_str = parts[0].decode()
        if "Transfer-Encoding: chunked" in header_str:
            body_data = _decode_chunked(body_data)

        if not body_data.strip():
            return None

        return json.loads(body_data)
    except Exception as e:
        log.warning("Docker API request failed: %s %s — %s", method, path, e)
        return None


def _decode_chunked(data: bytes) -> bytes:
    """Decode chunked transfer encoding."""
    result = b""
    while data:
        line_end = data.find(b"\r\n")
        if line_end < 0:
            break
        size_str = data[:line_end].decode().strip()
        if not size_str:
            data = data[line_end + 2:]
            continue
        try:
            chunk_size = int(size_str, 16)
        except ValueError:
            break
        if chunk_size == 0:
            break
        start = line_end + 2
        result += data[start:start + chunk_size]
        data = data[start + chunk_size + 2:]
    return result


def is_available() -> bool:
    """Check if Docker socket is accessible."""
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(2)
        sock.connect(DOCKER_SOCKET)
        sock.close()
        return True
    except Exception:
        return False


def list_containers(all_containers: bool = False) -> list[dict]:
    """List Docker containers with status info."""
    path = "/containers/json?all=true" if all_containers else "/containers/json"
    data = _request("GET", path)
    if not isinstance(data, list):
        return []

    containers = []
    for c in data:
        name = (c.get("Names") or ["/unknown"])[0].lstrip("/")
        image = c.get("Image", "")
        state = c.get("State", "unknown")
        status = c.get("Status", "")
        created = c.get("Created", 0)

        # Extract ports
        ports = []
        for p in c.get("Ports") or []:
            if p.get("PublicPort"):
                ports.append(f"{p['PublicPort']}:{p['PrivatePort']}")

        containers.append({
            "id": c.get("Id", "")[:12],
            "name": name,
            "image": image,
            "state": state,
            "status": status,
            "created": created,
            "ports": ports,
        })

    containers.sort(key=lambda x: x["name"])
    return containers


def get_container(name: str) -> dict | None:
    """Get detailed info for a container by name."""
    data = _request("GET", f"/containers/{quote(name, safe='')}/json")
    if not isinstance(data, dict):
        return None

    state = data.get("State", {})
    config = data.get("Config", {})
    host_config = data.get("HostConfig", {})

    return {
        "id": data.get("Id", "")[:12],
        "name": data.get("Name", "").lstrip("/"),
        "image": config.get("Image", ""),
        "state": state.get("Status", "unknown"),
        "running": state.get("Running", False),
        "started_at": state.get("StartedAt", ""),
        "finished_at": state.get("FinishedAt", ""),
        "restart_count": data.get("RestartCount", 0),
        "env": [e.split("=", 1)[0] for e in config.get("Env", [])],  # keys only, no values
        "mounts": [m.get("Destination", "") for m in data.get("Mounts", [])],
        "memory_limit": host_config.get("Memory", 0),
    }


def restart_container(name: str) -> bool:
    """Restart a container by name."""
    result = _request("POST", f"/containers/{quote(name, safe='')}/restart?t=10")
    return result is None  # 204 No Content = success


def stop_container(name: str) -> bool:
    """Stop a container by name."""
    result = _request("POST", f"/containers/{quote(name, safe='')}/stop?t=10")
    return result is None


def start_container(name: str) -> bool:
    """Start a stopped container by name."""
    result = _request("POST", f"/containers/{quote(name, safe='')}/start")
    return result is None


def get_container_logs(name: str, tail: int = 50) -> str:
    """Get recent logs from a container."""
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(10)
        sock.connect(DOCKER_SOCKET)

        path = f"/containers/{quote(name, safe='')}/logs?stdout=true&stderr=true&tail={tail}"
        request = f"GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        sock.sendall(request.encode())

        response = b""
        while True:
            chunk = sock.recv(8192)
            if not chunk:
                break
            response += chunk
        sock.close()

        parts = response.split(b"\r\n\r\n", 1)
        if len(parts) < 2:
            return ""

        raw = parts[1]

        # Decode chunked transfer encoding first
        header_str = parts[0].decode()
        if "chunked" in header_str.lower():
            raw = _decode_chunked(raw)

        # Docker multiplexed stream: 8-byte header per frame
        # byte 0: stream type (1=stdout, 2=stderr)
        # bytes 4-7: frame size (big endian)
        lines = []
        i = 0
        while i + 8 <= len(raw):
            size = int.from_bytes(raw[i + 4:i + 8], "big")
            if size == 0 or i + 8 + size > len(raw):
                break
            line = raw[i + 8:i + 8 + size]
            lines.append(line.decode("utf-8", errors="replace").rstrip())
            i += 8 + size

        return "\n".join(lines)
    except Exception as e:
        log.warning("Failed to get logs for %s: %s", name, e)
        return ""


def check_image_updates(image: str) -> dict | None:
    """Check if a newer version of an image is available on the registry.
    Returns {current_id, update_available} or None on error."""
    # Get local image ID
    local = _request("GET", f"/images/{quote(image, safe='')}/json")
    if not isinstance(local, dict):
        return None

    local_id = local.get("Id", "")[:12]
    repo_digests = local.get("RepoDigests", [])

    return {
        "image": image,
        "local_id": local_id,
        "repo_digests": repo_digests,
    }
