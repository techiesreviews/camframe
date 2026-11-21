//! Opt-in, loopback-only HTTP transport. The UI applies checked commands; sockets never touch it.
use camframe_core::prompter::{host_allowed, origin_allowed, validate};
use serde_json::{Value, json};
use std::io::Read;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc,
};
use std::time::Duration;
use tiny_http::{Header, Request, Response, Server};

pub struct Command {
    pub generation: u64,
    pub kind: String,
    pub body: Value,
    pub cancelled: Arc<AtomicBool>,
    pub reply: mpsc::Sender<(u16, Value)>,
}
pub struct Link {
    server: Arc<Server>,
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}
impl Link {
    pub fn start(commands: async_channel::Sender<Command>, generation: u64) -> Result<Self, String> {
        let server = Arc::new(
            Server::http("127.0.0.1:47833")
                .map_err(|error| format!("Could not open Prompter link on port 47833: {error}"))?,
        );
        let stop = Arc::new(AtomicBool::new(false));
        let running = Arc::clone(&stop);
        let listener = Arc::clone(&server);
        let active = Arc::new(AtomicUsize::new(0));
        let handle = std::thread::spawn(move || {
            while !running.load(Ordering::Relaxed) {
                let request = match listener.recv_timeout(Duration::from_millis(100)) {
                    Ok(Some(request)) => request,
                    Ok(None) => continue,
                    Err(_) => break,
                };
                if active.load(Ordering::Relaxed) >= 4 {
                    respond(request, 503, json!({"ok":false,"error":"Prompter link is busy."}), None, false);
                    continue;
                }
                active.fetch_add(1, Ordering::Relaxed);
                let active = Arc::clone(&active);
                let commands = commands.clone();
                std::thread::spawn(move || {
                    handle(request, &commands, generation);
                    active.fetch_sub(1, Ordering::Relaxed);
                });
            }
        });
        Ok(Self { server, stop, handle: Some(handle) })
    }
}
impl Drop for Link {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.server.unblock();
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn header(request: &Request, name: &'static str) -> Option<String> {
    request.headers().iter().find(|header| header.field.equiv(name)).map(|header| header.value.to_string())
}
fn respond(request: Request, status: u16, body: Value, origin: Option<&str>, preflight: bool) {
    let private = header(&request, "Access-Control-Request-Private-Network").as_deref() == Some("true");
    let text = if status == 204 { String::new() } else { body.to_string() };
    let mut response = Response::from_string(text).with_status_code(status);
    let mut headers = vec![
        ("Cache-Control", "no-store".to_string()),
        ("X-Content-Type-Options", "nosniff".to_string()),
        ("Content-Type", "application/json; charset=utf-8".to_string()),
    ];
    if let Some(origin) = origin {
        headers.extend([("Access-Control-Allow-Origin", origin.to_string()), ("Vary", "Origin".into())]);
    }
    if preflight {
        headers.extend([
            ("Access-Control-Allow-Methods", "GET, POST".into()),
            ("Access-Control-Allow-Headers", "Content-Type".into()),
            ("Access-Control-Max-Age", "600".into()),
        ]);
        if private {
            headers.push(("Access-Control-Allow-Private-Network", "true".into()));
        }
    }
    for (name, value) in headers {
        if let Ok(header) = Header::from_bytes(name, value) {
            response.add_header(header);
        }
    }
    let _ = request.respond(response);
}
fn handle(mut request: Request, commands: &async_channel::Sender<Command>, generation: u64) {
    if request.headers().iter().filter(|h| h.field.equiv("Host")).count() != 1
        || !host_allowed(header(&request, "Host").as_deref().unwrap_or(""))
    {
        respond(request, 403, json!({"ok":false,"error":"Wrong host."}), None, false);
        return;
    }
    let origin = header(&request, "Origin");
    if request.headers().iter().filter(|h| h.field.equiv("Origin")).count() > 1 || !origin_allowed(origin.as_deref()) {
        respond(request, 403, json!({"ok":false,"error":"This page may not control CamFrame."}), None, false);
        return;
    }
    if request.method().as_str() == "OPTIONS" {
        respond(request, 204, Value::Null, origin.as_deref(), true);
        return;
    }
    let path = request.url().split('?').next().unwrap_or("");
    let kind = match path {
        "/camframe/status" => "status",
        "/camframe/cue" => "cue",
        "/camframe/scenes" => "scenes",
        "/camframe/small-size" => "small-size",
        _ => {
            respond(request, 404, json!({"ok":false,"error":"Not found."}), origin.as_deref(), false);
            return;
        }
    }
    .to_string();
    if request.method().as_str() != if kind == "status" { "GET" } else { "POST" } {
        respond(
            request,
            405,
            json!({"ok":false,"error":if kind=="status"{"Use GET."}else{"Use POST."}}),
            origin.as_deref(),
            false,
        );
        return;
    }
    if origin.as_deref() == Some("null") && matches!(kind.as_str(), "scenes" | "small-size") {
        respond(
            request,
            403,
            json!({"ok":false,"error":"This page may switch the view but not save. Use the prompter site or localhost."}),
            origin.as_deref(),
            false,
        );
        return;
    }
    let body = if kind == "status" {
        Value::Null
    } else {
        let content_type = header(&request, "Content-Type").unwrap_or_default();
        if !content_type.split(';').next().is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json")) {
            respond(request, 415, json!({"ok":false,"error":"Send JSON."}), origin.as_deref(), false);
            return;
        }
        let mut bytes = Vec::new();
        let result = request.as_reader().take(1025).read_to_end(&mut bytes);
        if bytes.len() > 1024 {
            respond(request, 413, json!({"ok":false,"error":"Request too large."}), origin.as_deref(), false);
            return;
        }
        let parsed = if result.is_ok() {
            serde_json::from_slice(&bytes)
                .map_err(|_| "Not valid JSON.".to_string())
                .and_then(|body| validate(&kind, &body))
        } else {
            Err("Could not read request.".into())
        };
        match parsed {
            Ok(body) => body,
            Err(error) => {
                respond(request, 400, json!({"ok":false,"error":error,"code":"bad-request"}), origin.as_deref(), false);
                return;
            }
        }
    };
    let (reply, answer) = mpsc::channel();
    let cancelled = Arc::new(AtomicBool::new(false));
    let command = Command { generation, kind: kind.clone(), body, cancelled: Arc::clone(&cancelled), reply };
    let (status, mut response) = if commands.try_send(command).is_ok() {
        answer.recv_timeout(Duration::from_secs(2)).unwrap_or_else(|_| {
            cancelled.store(true, Ordering::Relaxed);
            (503, json!({"ok":false,"error":"CamFrame is not ready yet."}))
        })
    } else {
        (503, json!({"ok":false,"error":"CamFrame is not ready yet."}))
    };
    if origin.as_deref() == Some("null") {
        if kind == "status" {
            response = json!({"app":response["app"],"version":response["version"],"scenes":response["scenes"],"api":response["api"]});
        } else if let Some(map) = response.as_object_mut() {
            map.remove("view");
            map.remove("layout");
            if map.get("code").and_then(Value::as_str) == Some("does-not-fit") {
                map.insert("error".into(), json!("That size and place do not fit this display."));
            }
        }
    }
    respond(request, status, response, origin.as_deref(), false);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn exchange(request: &str, status: Option<Value>) -> (String, bool) {
        let server = Server::http("127.0.0.1:0").unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let (commands, receiver) = async_channel::bounded::<Command>(1);
        let response = std::thread::spawn(move || {
            if let Some(status) = status
                && let Ok(command) = receiver.recv_blocking()
            {
                let _ = command.reply.send((200, status));
                true
            } else {
                false
            }
        });
        let worker = std::thread::spawn(move || {
            handle(server.recv().unwrap(), &commands, 1);
        });
        let mut socket = std::net::TcpStream::connect(address).unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        socket.write_all(request.as_bytes()).unwrap();
        let mut text = String::new();
        socket.read_to_string(&mut text).unwrap();
        worker.join().unwrap();
        (text, response.join().unwrap())
    }
    #[test]
    fn null_origin_cannot_save_and_wrong_host_cannot_reach_the_ui() {
        let (response, called) = exchange(
            "POST /camframe/scenes HTTP/1.1\r\nHost: localhost:47833\r\nOrigin: null\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
            None,
        );
        assert!(response.starts_with("HTTP/1.1 403"));
        assert!(!called);
        let (response, called) =
            exchange("GET /camframe/status HTTP/1.1\r\nHost: evil.example:47833\r\nConnection: close\r\n\r\n", None);
        assert!(response.starts_with("HTTP/1.1 403"));
        assert!(!called);
    }
    #[test]
    fn null_status_redacts_display_layout_and_private_camera_information() {
        let body = json!({"app":"camframe","version":"0.1.0","scenes":["Desk"],"api":2,"view":{"x":12345},"look":{"cameraId":"private-device"},"sceneDetails":["private-layout"]});
        let (response, called) = exchange(
            "GET /camframe/status HTTP/1.1\r\nHost: 127.0.0.1:47833\r\nOrigin: null\r\nConnection: close\r\n\r\n",
            Some(body),
        );
        assert!(called);
        assert!(response.starts_with("HTTP/1.1 200"));
        assert!(!response.contains("private"));
        assert!(!response.contains("12345"));
        assert!(response.contains("Desk"));
    }
}
