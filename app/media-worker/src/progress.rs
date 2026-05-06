use std::env;
use std::fs::OpenOptions;
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Map, Value};

const DEFAULT_EVENTS_STREAM: &str = "crate:media-worker:events";
const DEFAULT_JOB_PREFIX: &str = "crate:media-worker:job";
const DEFAULT_CANCEL_PREFIX: &str = "crate:media-worker:cancel";
const DEFAULT_TTL_SECONDS: u64 = 86_400;
const DEFAULT_MAXLEN: usize = 10_000;
const CANCEL_CHECK_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug)]
pub struct ProgressSink {
    job_id: Option<String>,
    progress_path: Option<PathBuf>,
    cancel_path: Option<PathBuf>,
    redis: Option<RedisProgress>,
    cancel_state: Mutex<CancelState>,
}

#[derive(Debug, Default)]
struct CancelState {
    last_redis_check: Option<Instant>,
    cancelled: bool,
}

impl ProgressSink {
    pub fn new(
        job_id: Option<String>,
        progress_path: Option<&str>,
        cancel_path: Option<&str>,
    ) -> Self {
        Self {
            job_id,
            progress_path: progress_path.map(PathBuf::from),
            cancel_path: cancel_path.map(PathBuf::from),
            redis: RedisProgress::from_env(),
            cancel_state: Mutex::new(CancelState::default()),
        }
    }

    pub fn check_cancelled(&self) -> Result<(), String> {
        if self.is_cancelled() {
            return Err("job cancelled".to_string());
        }
        Ok(())
    }

    pub fn is_cancelled(&self) -> bool {
        if self
            .cancel_path
            .as_ref()
            .map(|path| path.exists())
            .unwrap_or(false)
        {
            return true;
        }

        let Some(redis) = self.redis.as_ref() else {
            return false;
        };
        let Some(job_id) = self.job_id.as_ref() else {
            return false;
        };

        let mut state = match self.cancel_state.lock() {
            Ok(state) => state,
            Err(_) => return false,
        };
        if state.cancelled {
            return true;
        }
        if state
            .last_redis_check
            .map(|checked| checked.elapsed() < CANCEL_CHECK_INTERVAL)
            .unwrap_or(false)
        {
            return false;
        }
        state.last_redis_check = Some(Instant::now());
        if redis.cancelled(job_id).unwrap_or(false) {
            state.cancelled = true;
            return true;
        }
        false
    }

    pub fn emit(&self, event: &str, fields: Value) {
        let payload = self.payload(event, fields);
        if let Some(redis) = self.redis.as_ref() {
            redis.emit(&payload);
        }
        self.emit_jsonl(&payload);
    }

    fn payload(&self, event: &str, fields: Value) -> Value {
        let mut payload = Map::new();
        payload.insert("event".to_string(), Value::String(event.to_string()));
        payload.insert("ts_ms".to_string(), json!(timestamp_ms()));
        if let Some(job_id) = self.job_id.as_ref() {
            payload.insert("job_id".to_string(), Value::String(job_id.clone()));
        }
        if let Value::Object(extra) = fields {
            for (key, value) in extra {
                payload.insert(key, value);
            }
        }
        Value::Object(payload)
    }

    fn emit_jsonl(&self, payload: &Value) {
        let Some(path) = self.progress_path.as_ref() else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let Ok(mut handle) = OpenOptions::new().create(true).append(true).open(path) else {
            return;
        };
        if serde_json::to_writer(&mut handle, payload).is_ok() {
            let _ = handle.write_all(b"\n");
        }
    }
}

#[derive(Clone, Debug)]
struct RedisProgress {
    target: RedisTarget,
    stream_key: String,
    job_prefix: String,
    cancel_prefix: String,
    ttl_seconds: u64,
    maxlen: usize,
}

impl RedisProgress {
    fn from_env() -> Option<Self> {
        let url = env::var("CRATE_MEDIA_WORKER_REDIS_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                env::var("REDIS_URL")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })?;
        Some(Self {
            target: RedisTarget::parse(&url).ok()?,
            stream_key: env::var("CRATE_MEDIA_WORKER_EVENTS_STREAM")
                .unwrap_or_else(|_| DEFAULT_EVENTS_STREAM.to_string()),
            job_prefix: env::var("CRATE_MEDIA_WORKER_JOB_PREFIX")
                .unwrap_or_else(|_| DEFAULT_JOB_PREFIX.to_string()),
            cancel_prefix: env::var("CRATE_MEDIA_WORKER_CANCEL_PREFIX")
                .unwrap_or_else(|_| DEFAULT_CANCEL_PREFIX.to_string()),
            ttl_seconds: parse_env_u64(
                "CRATE_MEDIA_WORKER_PROGRESS_TTL_SECONDS",
                DEFAULT_TTL_SECONDS,
            ),
            maxlen: parse_env_usize("CRATE_MEDIA_WORKER_EVENTS_MAXLEN", DEFAULT_MAXLEN),
        })
    }

    fn emit(&self, payload: &Value) {
        let Some(job_id) = payload.get("job_id").and_then(Value::as_str) else {
            return;
        };
        let event = payload
            .get("event")
            .and_then(Value::as_str)
            .unwrap_or("progress");
        let ts_ms = payload
            .get("ts_ms")
            .map(value_to_redis_text)
            .unwrap_or_else(|| timestamp_ms().to_string());
        let payload_json = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string());

        let _ = self.command(&[
            "XADD",
            &self.stream_key,
            "MAXLEN",
            "~",
            &self.maxlen.to_string(),
            "*",
            "job_id",
            job_id,
            "event",
            event,
            "ts_ms",
            &ts_ms,
            "payload_json",
            &payload_json,
        ]);

        let job_key = self.job_key(job_id);
        let mut hset_args = vec![
            "HSET".to_string(),
            job_key.clone(),
            "job_id".to_string(),
            job_id.to_string(),
            "event".to_string(),
            event.to_string(),
            "status".to_string(),
            status_for_event(event).to_string(),
            "updated_at_ms".to_string(),
            ts_ms,
            "payload_json".to_string(),
            payload_json,
        ];
        for field in [
            "kind",
            "index",
            "total",
            "bytes",
            "duration_ms",
            "output_path",
            "source_path",
        ] {
            if let Some(value) = payload.get(field) {
                hset_args.push(field.to_string());
                hset_args.push(value_to_redis_text(value));
            }
        }
        let hset_refs = hset_args.iter().map(String::as_str).collect::<Vec<_>>();
        let _ = self.command(&hset_refs);
        let _ = self.command(&["EXPIRE", &job_key, &self.ttl_seconds.to_string()]);
    }

    fn cancelled(&self, job_id: &str) -> Result<bool, String> {
        match self.command(&["EXISTS", &self.cancel_key(job_id)])? {
            RedisValue::Integer(value) => Ok(value > 0),
            _ => Ok(false),
        }
    }

    fn job_key(&self, job_id: &str) -> String {
        format!("{}:{job_id}", self.job_prefix)
    }

    fn cancel_key(&self, job_id: &str) -> String {
        format!("{}:{job_id}", self.cancel_prefix)
    }

    fn command(&self, args: &[&str]) -> Result<RedisValue, String> {
        let mut stream = self.target.connect().map_err(|err| err.to_string())?;
        write_command(&mut stream, args).map_err(|err| err.to_string())?;
        read_response(&mut stream).map_err(|err| err.to_string())
    }
}

#[derive(Clone, Debug)]
struct RedisTarget {
    addr: String,
    password: Option<String>,
    db: Option<u32>,
}

impl RedisTarget {
    fn parse(url: &str) -> Result<Self, String> {
        let rest = url
            .strip_prefix("redis://")
            .ok_or_else(|| "only redis:// URLs are supported".to_string())?;
        let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
        let (userinfo, hostport) = authority
            .rsplit_once('@')
            .map(|(user, host)| (Some(user), host))
            .unwrap_or((None, authority));
        let password = userinfo.and_then(|value| {
            let text = value
                .rsplit_once(':')
                .map(|(_, pass)| pass)
                .unwrap_or(value);
            (!text.is_empty()).then(|| text.to_string())
        });
        let addr = if hostport.contains(':') {
            hostport.to_string()
        } else {
            format!("{hostport}:6379")
        };
        let db = path
            .split('/')
            .next()
            .filter(|value| !value.is_empty())
            .and_then(|value| value.parse::<u32>().ok());
        Ok(Self { addr, password, db })
    }

    fn connect(&self) -> io::Result<TcpStream> {
        let mut stream = TcpStream::connect(&self.addr)?;
        stream.set_read_timeout(Some(Duration::from_millis(750)))?;
        stream.set_write_timeout(Some(Duration::from_millis(750)))?;
        if let Some(password) = self.password.as_ref() {
            write_command(&mut stream, &["AUTH", password])?;
            let _ = read_response(&mut stream)?;
        }
        if let Some(db) = self.db {
            write_command(&mut stream, &["SELECT", &db.to_string()])?;
            let _ = read_response(&mut stream)?;
        }
        Ok(stream)
    }
}

#[derive(Debug)]
enum RedisValue {
    Integer(i64),
    Other,
}

fn write_command(stream: &mut TcpStream, args: &[&str]) -> io::Result<()> {
    write!(stream, "*{}\r\n", args.len())?;
    for arg in args {
        write!(stream, "${}\r\n", arg.as_bytes().len())?;
        stream.write_all(arg.as_bytes())?;
        stream.write_all(b"\r\n")?;
    }
    stream.flush()
}

fn read_response(stream: &mut TcpStream) -> io::Result<RedisValue> {
    let mut prefix = [0_u8; 1];
    stream.read_exact(&mut prefix)?;
    match prefix[0] {
        b'+' => {
            let _ = read_line(stream)?;
            Ok(RedisValue::Other)
        }
        b'-' => Err(io::Error::new(io::ErrorKind::Other, read_line(stream)?)),
        b':' => {
            let line = read_line(stream)?;
            Ok(RedisValue::Integer(line.parse::<i64>().unwrap_or(0)))
        }
        b'$' => {
            let len = read_line(stream)?.parse::<isize>().unwrap_or(-1);
            if len > 0 {
                let mut buf = vec![0_u8; len as usize + 2];
                stream.read_exact(&mut buf)?;
            }
            Ok(RedisValue::Other)
        }
        b'*' => {
            let count = read_line(stream)?.parse::<usize>().unwrap_or(0);
            for _ in 0..count {
                let _ = read_response(stream)?;
            }
            Ok(RedisValue::Other)
        }
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid Redis response",
        )),
    }
}

fn read_line(stream: &mut TcpStream) -> io::Result<String> {
    let mut bytes = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        stream.read_exact(&mut byte)?;
        if byte[0] == b'\r' {
            stream.read_exact(&mut byte)?;
            break;
        }
        bytes.push(byte[0]);
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

fn status_for_event(event: &str) -> &str {
    match event {
        "finished" => "ready",
        "failed" => "failed",
        "cancelled" => "cancelled",
        _ => "running",
    }
}

fn value_to_redis_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn parse_env_u64(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

fn parse_env_usize(name: &str, default: usize) -> usize {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default)
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{status_for_event, RedisTarget};

    #[test]
    fn parses_basic_redis_url() {
        let target = RedisTarget::parse("redis://redis:6379/0").unwrap();
        assert_eq!(target.addr, "redis:6379");
        assert_eq!(target.db, Some(0));
        assert_eq!(target.password, None);
    }

    #[test]
    fn parses_redis_url_with_password() {
        let target = RedisTarget::parse("redis://:secret@localhost:6380/2").unwrap();
        assert_eq!(target.addr, "localhost:6380");
        assert_eq!(target.db, Some(2));
        assert_eq!(target.password.as_deref(), Some("secret"));
    }

    #[test]
    fn maps_events_to_status() {
        assert_eq!(status_for_event("started"), "running");
        assert_eq!(status_for_event("finished"), "ready");
        assert_eq!(status_for_event("failed"), "failed");
        assert_eq!(status_for_event("cancelled"), "cancelled");
    }
}
