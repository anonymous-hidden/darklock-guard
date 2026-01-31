mod backup;
mod install;
mod manifest;
mod postcheck;
mod selfcheck;
mod util;
mod verify;

use anyhow::{anyhow, Result};
use clap::{Parser, Subcommand};
use tracing::info;

use crate::backup::{backup_current, cleanup_old_backups};
use crate::install::{install_package, rollback_from_manifest, start_service, stop_service};
use crate::manifest::{load_manifest, ReleaseManifest};
use crate::postcheck::post_update_self_test;
use crate::util::{download_to_path, temp_download_path};
use crate::verify::{verify_release_signature, verify_sha256};

#[derive(Parser, Debug)]
#[command(author, version, about = "Darklock Updater Helper", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Ensure the updater binary matches expected hash (fail closed)
    SelfCheck {
        #[arg(long)]
        version_file: String,
    },
    /// Download package and verify hash + signature
    Stage {
        #[arg(long)]
        manifest: String,
        #[arg(long)]
        output: Option<String>,
    },
    /// Backup current install (keep last 2)
    Backup {
        #[arg(long)]
        install_dir: String,
        #[arg(long)]
        backup_dir: String,
    },
    /// Install a verified package
    Install {
        #[arg(long)]
        package: String,
        #[arg(long)]
        install_dir: String,
        #[arg(long)]
        backup_dir: String,
        #[arg(long)]
        version_file: String,
        #[arg(long)]
        stop_cmd: Option<String>,
        #[arg(long)]
        start_cmd: Option<String>,
    },
    /// Rollback from backup manifest
    Rollback {
        #[arg(long)]
        backup_manifest: String,
        #[arg(long)]
        install_dir: String,
        #[arg(long)]
        start_cmd: Option<String>,
    },
    /// Cleanup temp files
    Cleanup {
        #[arg(long)]
        path: String,
    },
    /// Post-update self-test (runs command) with rollback on failure
    PostCheck {
        #[arg(long)]
        test_cmd: String,
        #[arg(long)]
        backup_manifest: String,
        #[arg(long)]
        install_dir: String,
        #[arg(long)]
        start_cmd: Option<String>,
    },
}

fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    match cli.command {
        Commands::SelfCheck { version_file } => {
            selfcheck::self_integrity_check(&version_file)?;
        }
        Commands::Stage { manifest, output } => {
            let manifest = load_manifest(&manifest)?;
            ensure_not_revoked(&manifest)?;
            let out = output.unwrap_or_else(|| temp_download_path());
            let download_path = download_to_path(&manifest.download_url, &out)?;
            verify_sha256(&download_path, &manifest.sha256)?;
            verify_release_signature(&download_path, &manifest.signature)?;
            info!("stage-complete path={}", download_path.display());
            println!("{}", download_path.display());
        }
        Commands::Backup {
            install_dir,
            backup_dir,
        } => {
            let manifest_path = backup_current(&install_dir, &backup_dir)?;
            cleanup_old_backups(&backup_dir, 2)?;
            println!("{}", manifest_path.display());
        }
        Commands::Install {
            package,
            install_dir,
            backup_dir,
            version_file,
            stop_cmd,
            start_cmd,
        } => {
            selfcheck::self_integrity_check(&version_file)?;
            stop_service(stop_cmd)?;
            let backup_manifest = backup_current(&install_dir, &backup_dir)?;
            cleanup_old_backups(&backup_dir, 2)?;
            install_package(&package, &install_dir)?;
            start_service(start_cmd)?;
            println!("{}", backup_manifest.display());
        }
        Commands::Rollback {
            backup_manifest,
            install_dir,
            start_cmd,
        } => {
            rollback_from_manifest(&backup_manifest, &install_dir)?;
            start_service(start_cmd)?;
        }
        Commands::Cleanup { path } => {
            std::fs::remove_file(&path).ok();
        }
        Commands::PostCheck {
            test_cmd,
            backup_manifest,
            install_dir,
            start_cmd,
        } => {
            let status = post_update_self_test(&test_cmd)?;
            if !status.success() {
                rollback_from_manifest(&backup_manifest, &install_dir)?;
                start_service(start_cmd)?;
                return Err(anyhow!("post-update self-test failed; rolled back"));
            }
        }
    }
    Ok(())
}

fn ensure_not_revoked(manifest: &ReleaseManifest) -> Result<()> {
    if manifest.revoked.unwrap_or(false) {
        return Err(anyhow!("release revoked"));
    }
    Ok(())
}
