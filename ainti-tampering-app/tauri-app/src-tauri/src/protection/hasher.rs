//! High-performance hashing module with BLAKE3 and SHA-256 support
//!
//! Features:
//! - Multi-threaded worker pool for parallel hashing
//! - Streaming reads (never loads full file into memory)
//! - Chunk hashing for large files
//! - Prefilter using metadata (size + mtime)

use crate::protection::{ProtectionError, Result};
use crate::protection::models::HashAlgorithm;
use sha2::{Sha256, Digest};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{mpsc, Semaphore};

/// Default buffer size for streaming reads (64KB)
const BUFFER_SIZE: usize = 64 * 1024;

/// Default worker pool size
const DEFAULT_WORKERS: usize = 4;

/// Hasher configuration
#[derive(Debug, Clone)]
pub struct HasherConfig {
    /// Hash algorithm to use
    pub algorithm: HashAlgorithm,
    /// Number of worker threads
    pub workers: usize,
    /// Buffer size for reading
    pub buffer_size: usize,
    /// Large file threshold (files larger than this use chunk hashing)
    pub large_file_threshold: u64,
    /// Chunk size for large files
    pub chunk_size: u64,
}

impl Default for HasherConfig {
    fn default() -> Self {
        Self {
            algorithm: HashAlgorithm::Blake3,
            workers: DEFAULT_WORKERS,
            buffer_size: BUFFER_SIZE,
            large_file_threshold: 64 * 1024 * 1024, // 64MB
            chunk_size: 4 * 1024 * 1024, // 4MB
        }
    }
}

/// Result of hashing a file
#[derive(Debug, Clone)]
pub struct HashResult {
    /// The file's hash (hex encoded)
    pub hash: String,
    /// Size of the file
    pub size: u64,
    /// Modification time (Unix timestamp)
    pub mtime: i64,
    /// File mode/permissions
    pub mode: u32,
    /// Chunk size used (if large file)
    pub chunk_size: Option<u64>,
    /// Individual chunk hashes (if large file)
    pub chunk_hashes: Option<Vec<String>>,
}

/// High-performance file hasher
pub struct Hasher {
    config: HasherConfig,
    semaphore: Arc<Semaphore>,
}

impl Hasher {
    /// Create a new hasher with default config
    pub fn new() -> Self {
        Self::with_config(HasherConfig::default())
    }
    
    /// Create a hasher with custom config
    pub fn with_config(config: HasherConfig) -> Self {
        let semaphore = Arc::new(Semaphore::new(config.workers));
        Self { config, semaphore }
    }
    
    /// Hash a single file synchronously
    pub fn hash_file(&self, path: &Path) -> Result<HashResult> {
        let metadata = std::fs::metadata(path)?;
        let size = metadata.len();
        let mtime = metadata.modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
            .unwrap_or(0);
        
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode()
        };
        #[cfg(not(unix))]
        let mode = if metadata.permissions().readonly() { 0o444 } else { 0o644 };
        
        // Use chunk hashing for large files
        if size > self.config.large_file_threshold {
            return self.hash_file_chunked(path, size, mtime, mode);
        }
        
        let file = File::open(path)?;
        let mut reader = BufReader::with_capacity(self.config.buffer_size, file);
        
        let hash = match self.config.algorithm {
            HashAlgorithm::Blake3 => self.hash_blake3_stream(&mut reader)?,
            HashAlgorithm::Sha256 => self.hash_sha256_stream(&mut reader)?,
        };
        
        Ok(HashResult {
            hash,
            size,
            mtime,
            mode,
            chunk_size: None,
            chunk_hashes: None,
        })
    }
    
    /// Hash a large file using chunks
    fn hash_file_chunked(&self, path: &Path, size: u64, mtime: i64, mode: u32) -> Result<HashResult> {
        let file = File::open(path)?;
        let mut reader = BufReader::with_capacity(self.config.buffer_size, file);
        
        let chunk_size = self.config.chunk_size;
        let mut chunk_hashes = Vec::new();
        let mut chunk_buffer = vec![0u8; chunk_size as usize];
        
        loop {
            let mut bytes_read = 0;
            while bytes_read < chunk_size as usize {
                match reader.read(&mut chunk_buffer[bytes_read..])? {
                    0 => break, // EOF
                    n => bytes_read += n,
                }
            }
            
            if bytes_read == 0 {
                break;
            }
            
            let chunk_hash = match self.config.algorithm {
                HashAlgorithm::Blake3 => {
                    let hash = blake3::hash(&chunk_buffer[..bytes_read]);
                    hash.to_hex().to_string()
                }
                HashAlgorithm::Sha256 => {
                    let mut hasher = Sha256::new();
                    hasher.update(&chunk_buffer[..bytes_read]);
                    hex::encode(hasher.finalize())
                }
            };
            
            chunk_hashes.push(chunk_hash);
            
            if bytes_read < chunk_size as usize {
                break; // Last chunk was partial
            }
        }
        
        // Compute root hash from chunk hashes
        let combined = chunk_hashes.join("");
        let root_hash = match self.config.algorithm {
            HashAlgorithm::Blake3 => {
                blake3::hash(combined.as_bytes()).to_hex().to_string()
            }
            HashAlgorithm::Sha256 => {
                let mut hasher = Sha256::new();
                hasher.update(combined.as_bytes());
                hex::encode(hasher.finalize())
            }
        };
        
        Ok(HashResult {
            hash: root_hash,
            size,
            mtime,
            mode,
            chunk_size: Some(chunk_size),
            chunk_hashes: Some(chunk_hashes),
        })
    }
    
    /// Stream hash using BLAKE3
    fn hash_blake3_stream<R: Read>(&self, reader: &mut R) -> Result<String> {
        let mut hasher = blake3::Hasher::new();
        let mut buffer = vec![0u8; self.config.buffer_size];
        
        loop {
            match reader.read(&mut buffer)? {
                0 => break,
                n => { hasher.update(&buffer[..n]); },
            }
        }
        
        Ok(hasher.finalize().to_hex().to_string())
    }
    
    /// Stream hash using SHA-256
    fn hash_sha256_stream<R: Read>(&self, reader: &mut R) -> Result<String> {
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; self.config.buffer_size];
        
        loop {
            match reader.read(&mut buffer)? {
                0 => break,
                n => hasher.update(&buffer[..n]),
            }
        }
        
        Ok(hex::encode(hasher.finalize()))
    }
    
    /// Hash multiple files in parallel using a worker pool
    pub async fn hash_files_parallel<P: AsRef<Path> + Send + Sync + 'static>(
        &self,
        paths: Vec<P>,
        progress_tx: Option<mpsc::Sender<(usize, Option<HashResult>)>>,
    ) -> Result<Vec<(usize, std::result::Result<HashResult, String>)>> {
        let config = self.config.clone();
        let semaphore = self.semaphore.clone();
        
        let mut handles = Vec::with_capacity(paths.len());
        
        for (idx, path) in paths.into_iter().enumerate() {
            let config = config.clone();
            let semaphore = semaphore.clone();
            let progress_tx = progress_tx.clone();
            
            let handle = tokio::spawn(async move {
                let _permit = semaphore.acquire().await.unwrap();
                
                let path_ref = path.as_ref();
                let hasher = Hasher::with_config(config);
                let result = hasher.hash_file(path_ref);
                
                if let Some(tx) = progress_tx {
                    let _ = tx.send((idx, result.as_ref().ok().cloned())).await;
                }
                
                (idx, result.map_err(|e| e.to_string()))
            });
            
            handles.push(handle);
        }
        
        let mut results = Vec::with_capacity(handles.len());
        for handle in handles {
            if let Ok(result) = handle.await {
                results.push(result);
            }
        }
        
        // Sort by index to maintain order
        results.sort_by_key(|(idx, _)| *idx);
        
        Ok(results)
    }
    
    /// Quick hash just the first and last chunks for fast comparison
    pub fn quick_hash(&self, path: &Path) -> Result<String> {
        let metadata = std::fs::metadata(path)?;
        let size = metadata.len();
        
        // For small files, just hash the whole thing
        if size < self.config.buffer_size as u64 * 2 {
            let result = self.hash_file(path)?;
            return Ok(result.hash);
        }
        
        let mut file = File::open(path)?;
        let mut buffer = vec![0u8; self.config.buffer_size];
        
        // Read first chunk
        let first_bytes = std::io::Read::read(&mut file, &mut buffer)?;
        
        // Seek to last chunk
        use std::io::{Seek, SeekFrom};
        file.seek(SeekFrom::End(-(self.config.buffer_size as i64)))?;
        let last_bytes = std::io::Read::read(&mut file, &mut buffer[first_bytes..])?;
        
        // Hash combined first + last
        let combined_len = first_bytes + last_bytes;
        let hash = match self.config.algorithm {
            HashAlgorithm::Blake3 => {
                blake3::hash(&buffer[..combined_len]).to_hex().to_string()
            }
            HashAlgorithm::Sha256 => {
                let mut hasher = Sha256::new();
                hasher.update(&buffer[..combined_len]);
                hex::encode(hasher.finalize())
            }
        };
        
        Ok(hash)
    }
}

impl Default for Hasher {
    fn default() -> Self {
        Self::new()
    }
}

/// Prefilter check using metadata only (no hashing)
/// Returns true if file metadata matches baseline (candidate for skip in quick mode)
pub fn metadata_matches(
    path: &Path,
    baseline_size: u64,
    baseline_mtime: i64,
) -> bool {
    match std::fs::metadata(path) {
        Ok(metadata) => {
            let size = metadata.len();
            let mtime = metadata.modified()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
                .unwrap_or(0);
            
            size == baseline_size && mtime == baseline_mtime
        }
        Err(_) => false,
    }
}

/// Get file metadata for prefiltering
pub fn get_file_metadata(path: &Path) -> Result<(u64, i64, u32)> {
    let metadata = std::fs::metadata(path)?;
    let size = metadata.len();
    let mtime = metadata.modified()
        .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64)
        .unwrap_or(0);
    
    #[cfg(unix)]
    let mode = {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode()
    };
    #[cfg(not(unix))]
    let mode = if metadata.permissions().readonly() { 0o444 } else { 0o644 };
    
    Ok((size, mtime, mode))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;
    
    #[test]
    fn test_hash_small_file() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"hello world").unwrap();
        
        let hasher = Hasher::new();
        let result = hasher.hash_file(file.path()).unwrap();
        
        assert!(!result.hash.is_empty());
        assert_eq!(result.size, 11);
        assert!(result.chunk_hashes.is_none());
    }
    
    #[test]
    fn test_blake3_vs_sha256() {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(b"test content").unwrap();
        
        let blake3_hasher = Hasher::with_config(HasherConfig {
            algorithm: HashAlgorithm::Blake3,
            ..Default::default()
        });
        let sha256_hasher = Hasher::with_config(HasherConfig {
            algorithm: HashAlgorithm::Sha256,
            ..Default::default()
        });
        
        let blake3_result = blake3_hasher.hash_file(file.path()).unwrap();
        let sha256_result = sha256_hasher.hash_file(file.path()).unwrap();
        
        assert_ne!(blake3_result.hash, sha256_result.hash);
        assert_eq!(blake3_result.hash.len(), 64); // BLAKE3 = 32 bytes = 64 hex chars
        assert_eq!(sha256_result.hash.len(), 64); // SHA-256 = 32 bytes = 64 hex chars
    }
}
