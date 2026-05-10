use clash_verge_logging::{Type, logging};
use std::process::{Command, Stdio};

const SIDECAR_IMAGES: [&str; 2] = ["shenxianyun-mihomo.exe", "shenxianyun-mihomo-alpha.exe"];

pub fn kill_sidecars(reason: &str) {
    for image in SIDECAR_IMAGES {
        kill_sidecar(image, reason);
    }
}

fn kill_sidecar(image: &str, reason: &str) {
    let output = Command::new("taskkill")
        .args(["/F", "/T", "/IM", image])
        .stdin(Stdio::null())
        .output();

    match output {
        Ok(output) if output.status.success() => {
            logging!(
                info,
                Type::System,
                "cleaned windows sidecar process: {image}, reason: {reason}"
            );
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let message = format!("{stdout}{stderr}");
            if message.contains("not found") || message.contains("not running") || output.status.code() == Some(128) {
                logging!(
                    debug,
                    Type::System,
                    "windows sidecar process already stopped: {image}, reason: {reason}"
                );
            } else {
                logging!(
                    warn,
                    Type::System,
                    "failed to clean windows sidecar process: {image}, reason: {reason}, message: {message}"
                );
            }
        }
        Err(err) => {
            logging!(
                warn,
                Type::System,
                "failed to run taskkill for sidecar process: {image}, reason: {reason}, error: {err}"
            );
        }
    }
}
