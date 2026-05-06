use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use serde_json::json;

use crate::package::{build_album_package, build_track_artifact, PackageJob, TrackArtifactJob};

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

pub fn serve(addr: &str) -> io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    eprintln!("crate-media-worker listening on {addr}");

    for stream in listener.incoming() {
        match stream {
            Ok(mut stream) => {
                if let Err(err) = handle_connection(&mut stream) {
                    eprintln!("crate-media-worker request failed: {err}");
                }
            }
            Err(err) => eprintln!("crate-media-worker accept failed: {err}"),
        }
    }

    Ok(())
}

fn handle_connection(stream: &mut TcpStream) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(30)))?;
    stream.set_write_timeout(Some(Duration::from_secs(300)))?;

    let request = read_request(stream)?;
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/healthz") => write_json(
            stream,
            200,
            json!({"ok": true, "service": "crate-media-worker"}),
        ),
        ("POST", "/v1/packages/album") => {
            let job: Result<PackageJob, _> = serde_json::from_slice(&request.body);
            match job {
                Ok(job) => {
                    let result = build_album_package(job);
                    let status = if result.ok { 200 } else { 500 };
                    write_json(stream, status, serde_json::to_value(result).unwrap_or_else(|err| {
                        json!({"ok": false, "errors": [format!("serialize response: {err}")]})
                    }))
                }
                Err(err) => write_json(
                    stream,
                    400,
                    json!({"ok": false, "errors": [format!("invalid package job: {err}")]}),
                ),
            }
        }
        ("POST", "/v1/packages/track") => {
            let job: Result<TrackArtifactJob, _> = serde_json::from_slice(&request.body);
            match job {
                Ok(job) => {
                    let result = build_track_artifact(job);
                    let status = if result.ok { 200 } else { 500 };
                    write_json(
                        stream,
                        status,
                        serde_json::to_value(result).unwrap_or_else(|err| {
                            json!({"ok": false, "errors": [format!("serialize response: {err}")]})
                        }),
                    )
                }
                Err(err) => write_json(
                    stream,
                    400,
                    json!({"ok": false, "errors": [format!("invalid track artifact job: {err}")]}),
                ),
            }
        }
        _ => write_json(
            stream,
            404,
            json!({"ok": false, "errors": ["unknown route"]}),
        ),
    }
}

struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> io::Result<Request> {
    let mut buffer = Vec::with_capacity(8192);
    let mut chunk = [0_u8; 4096];
    let header_end;

    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "connection closed before headers",
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);

        if let Some(index) = find_header_end(&buffer) {
            header_end = index;
            break;
        }

        if buffer.len() > MAX_HEADER_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "headers exceed maximum size",
            ));
        }
    }

    let headers_raw = &buffer[..header_end];
    let mut body = buffer[header_end + 4..].to_vec();
    let headers_text = std::str::from_utf8(headers_raw)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    let mut lines = headers_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "missing HTTP request line"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("").to_string();
    let path = request_parts.next().unwrap_or("").to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }

    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);

    if content_length > MAX_BODY_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "body exceeds maximum size",
        ));
    }

    while body.len() < content_length {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "connection closed before body was complete",
            ));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(Request { method, path, body })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn write_json(stream: &mut TcpStream, status: u16, payload: serde_json::Value) -> io::Result<()> {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let body = serde_json::to_vec(&payload)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    stream.write_all(&body)
}
