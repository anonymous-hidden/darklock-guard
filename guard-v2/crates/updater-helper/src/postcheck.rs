use anyhow::{anyhow, Result};
use std::process::{Command, ExitStatus};

pub fn post_update_self_test(cmdline: &str) -> Result<ExitStatus> {
    let mut parts = cmdline.split_whitespace();
    let prog = parts.next().ok_or_else(|| anyhow!("empty test cmd"))?;
    let args: Vec<&str> = parts.collect();
    let status = Command::new(prog).args(args).status()?;
    Ok(status)
}
