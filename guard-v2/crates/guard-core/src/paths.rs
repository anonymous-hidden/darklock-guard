use directories::ProjectDirs;
use std::path::PathBuf;

pub const APP_QUALIFIER: &str = "com";
pub const APP_ORG: &str = "darklock";
pub const APP_NAME: &str = "guard";

pub fn data_dir() -> anyhow::Result<PathBuf> {
    let dirs = ProjectDirs::from(APP_QUALIFIER, APP_ORG, APP_NAME)
        .ok_or_else(|| anyhow::anyhow!("cannot determine data directory"))?;
    Ok(dirs.data_dir().to_path_buf())
}

pub fn log_dir() -> anyhow::Result<PathBuf> {
    Ok(data_dir()?.join("logs"))
}

pub fn ipc_socket_path() -> anyhow::Result<PathBuf> {
    #[cfg(unix)]
    {
        Ok(data_dir()?.join("guard.ipc"))
    }
    #[cfg(windows)]
    {
        Ok(PathBuf::from(r"\\.\pipe\DarklockGuardIpc"))
    }
}

pub fn status_socket_path() -> anyhow::Result<PathBuf> {
    if let Ok(override_path) = std::env::var("GUARD_STATUS_SOCKET") {
        return Ok(PathBuf::from(override_path));
    }
    #[cfg(unix)]
    {
        Ok(data_dir()?.join("guard-status.ipc"))
    }
    #[cfg(windows)]
    {
        Ok(PathBuf::from(r"\\.\pipe\DarklockGuardStatus"))
    }
}
