use clash_verge_logging::{Type, logging};
use std::mem::size_of;
use windows::Win32::{
    Foundation::CloseHandle,
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
        },
        Threading::{OpenProcess, PROCESS_TERMINATE, TerminateProcess},
    },
};

const SIDECAR_IMAGES: [&str; 2] = ["verge-mihomo.exe", "verge-mihomo-alpha.exe"];

pub fn kill_sidecars(reason: &str) {
    match kill_sidecars_inner(reason) {
        Ok(killed) if killed > 0 => {
            logging!(
                info,
                Type::System,
                "cleaned {killed} windows sidecar process(es), reason: {reason}"
            );
        }
        Ok(_) => {
            logging!(
                debug,
                Type::System,
                "windows sidecar processes already stopped, reason: {reason}"
            );
        }
        Err(err) => {
            logging!(
                warn,
                Type::System,
                "failed to clean windows sidecar processes, reason: {reason}, error: {err}"
            );
        }
    }
}

fn kill_sidecars_inner(reason: &str) -> windows::core::Result<usize> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)? };
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut killed = 0usize;

    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry).is_ok() };
    while has_entry {
        let name = process_name(&entry);
        if SIDECAR_IMAGES.iter().any(|image| image.eq_ignore_ascii_case(&name))
            && terminate_process(entry.th32ProcessID, &name, reason)
        {
            killed += 1;
        }

        has_entry = unsafe { Process32NextW(snapshot, &mut entry).is_ok() };
    }

    unsafe {
        CloseHandle(snapshot)?;
    }

    Ok(killed)
}

fn process_name(entry: &PROCESSENTRY32W) -> String {
    let len = entry
        .szExeFile
        .iter()
        .position(|ch| *ch == 0)
        .unwrap_or(entry.szExeFile.len());

    String::from_utf16_lossy(&entry.szExeFile[..len])
}

fn terminate_process(pid: u32, name: &str, reason: &str) -> bool {
    let process = match unsafe { OpenProcess(PROCESS_TERMINATE, false, pid) } {
        Ok(process) => process,
        Err(err) => {
            logging!(
                warn,
                Type::System,
                "failed to open sidecar process: {name} pid={pid}, reason: {reason}, error: {err}"
            );
            return false;
        }
    };

    let result = unsafe { TerminateProcess(process, 1) };
    let _ = unsafe { CloseHandle(process) };

    match result {
        Ok(_) => {
            logging!(
                info,
                Type::System,
                "terminated sidecar process: {name} pid={pid}, reason: {reason}"
            );
            true
        }
        Err(err) => {
            logging!(
                warn,
                Type::System,
                "failed to terminate sidecar process: {name} pid={pid}, reason: {reason}, error: {err}"
            );
            false
        }
    }
}
