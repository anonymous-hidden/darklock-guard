"""
Merkle Tree Hasher for FileGuard
================================
Implements Merkle tree hashing for efficient partial verification
of large files. Enables detecting which specific chunks were modified
without re-hashing the entire file.

Architecture:
                    [Root Hash]
                   /            \
           [Hash AB]            [Hash CD]
           /      \              /      \
      [Hash A]  [Hash B]   [Hash C]  [Hash D]
         |         |          |         |
     [Chunk 1] [Chunk 2]  [Chunk 3] [Chunk 4]

Benefits:
- O(log n) verification of single chunk changes
- Efficient delta detection for large files
- Proof generation for third-party verification
- Chunk-level integrity checking

Design Philosophy:
- Standard Merkle tree construction
- Deterministic ordering
- Efficient memory usage with streaming
"""

import hashlib
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field
from math import ceil, log2


# Default chunk size: 1MB
DEFAULT_CHUNK_SIZE = 1024 * 1024


@dataclass
class MerkleNode:
    """
    A node in the Merkle tree.
    
    Can be either a leaf (containing chunk hash) or
    an interior node (containing hash of children).
    """
    hash: str
    level: int                          # 0 = leaf level
    index: int                          # Position at this level
    is_leaf: bool = False
    chunk_start: Optional[int] = None   # Byte offset for leaves
    chunk_end: Optional[int] = None     # Byte offset for leaves
    left_child: Optional['MerkleNode'] = None
    right_child: Optional['MerkleNode'] = None
    
    def to_dict(self) -> dict:
        """Serialize to dictionary (without children for storage)."""
        d = {
            'hash': self.hash,
            'level': self.level,
            'index': self.index,
            'is_leaf': self.is_leaf,
        }
        if self.is_leaf:
            d['chunk_start'] = self.chunk_start
            d['chunk_end'] = self.chunk_end
        return d


@dataclass
class MerkleProof:
    """
    Merkle proof for verifying a single chunk.
    
    Contains the sibling hashes needed to reconstruct
    the root hash from a given leaf.
    """
    leaf_index: int
    leaf_hash: str
    proof_hashes: List[Tuple[str, str]]  # List of (position, hash)
    root_hash: str
    
    def to_dict(self) -> dict:
        """Serialize for storage/transmission."""
        return {
            'leaf_index': self.leaf_index,
            'leaf_hash': self.leaf_hash,
            'proof_hashes': self.proof_hashes,
            'root_hash': self.root_hash,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'MerkleProof':
        """Deserialize from dictionary."""
        return cls(
            leaf_index=data['leaf_index'],
            leaf_hash=data['leaf_hash'],
            proof_hashes=data['proof_hashes'],
            root_hash=data['root_hash'],
        )


@dataclass
class MerkleTree:
    """
    Complete Merkle tree for a file.
    
    Contains all nodes and provides methods for
    verification and proof generation.
    """
    root_hash: str
    leaf_count: int
    tree_height: int
    chunk_size: int
    total_size: int
    leaves: List[MerkleNode] = field(default_factory=list)
    _all_nodes: Dict[Tuple[int, int], MerkleNode] = field(default_factory=dict)
    
    def get_root(self) -> Optional[MerkleNode]:
        """Get the root node."""
        return self._all_nodes.get((self.tree_height, 0))
    
    def get_leaf(self, index: int) -> Optional[MerkleNode]:
        """Get a leaf node by index."""
        if 0 <= index < len(self.leaves):
            return self.leaves[index]
        return None
    
    def generate_proof(self, leaf_index: int) -> Optional[MerkleProof]:
        """
        Generate a Merkle proof for a specific leaf.
        
        The proof contains sibling hashes needed to verify
        the leaf is part of the tree.
        """
        if leaf_index < 0 or leaf_index >= self.leaf_count:
            return None
        
        leaf = self.leaves[leaf_index]
        proof_hashes = []
        
        current_index = leaf_index
        
        for level in range(self.tree_height):
            # Find sibling
            if current_index % 2 == 0:
                # Current is left child, sibling is right
                sibling_index = current_index + 1
                position = 'right'
            else:
                # Current is right child, sibling is left
                sibling_index = current_index - 1
                position = 'left'
            
            sibling = self._all_nodes.get((level, sibling_index))
            if sibling:
                proof_hashes.append((position, sibling.hash))
            
            # Move up to parent
            current_index = current_index // 2
        
        return MerkleProof(
            leaf_index=leaf_index,
            leaf_hash=leaf.hash,
            proof_hashes=proof_hashes,
            root_hash=self.root_hash,
        )
    
    def to_dict(self) -> dict:
        """Serialize tree structure."""
        return {
            'root_hash': self.root_hash,
            'leaf_count': self.leaf_count,
            'tree_height': self.tree_height,
            'chunk_size': self.chunk_size,
            'total_size': self.total_size,
            'leaves': [l.to_dict() for l in self.leaves],
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'MerkleTree':
        """Deserialize tree (leaves only, rebuild for full tree)."""
        leaves = []
        for i, leaf_data in enumerate(data['leaves']):
            leaves.append(MerkleNode(
                hash=leaf_data['hash'],
                level=0,
                index=i,
                is_leaf=True,
                chunk_start=leaf_data.get('chunk_start'),
                chunk_end=leaf_data.get('chunk_end'),
            ))
        
        tree = cls(
            root_hash=data['root_hash'],
            leaf_count=data['leaf_count'],
            tree_height=data['tree_height'],
            chunk_size=data['chunk_size'],
            total_size=data['total_size'],
            leaves=leaves,
        )
        
        # Store leaves in lookup
        for leaf in leaves:
            tree._all_nodes[(0, leaf.index)] = leaf
        
        return tree


class MerkleHasher:
    """
    Builds and verifies Merkle trees for files.
    
    Supports streaming construction for large files and
    efficient verification of individual chunks.
    """
    
    def __init__(
        self,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        hash_algorithm: str = 'sha256'
    ):
        """
        Initialize the Merkle hasher.
        
        Args:
            chunk_size: Size of each chunk in bytes
            hash_algorithm: Hash algorithm to use
        """
        self.chunk_size = chunk_size
        self.algorithm = hash_algorithm
    
    def _hash(self, data: bytes) -> str:
        """Compute hash of data."""
        return hashlib.new(self.algorithm, data).hexdigest()
    
    def _combine_hashes(self, left: str, right: str) -> str:
        """Combine two hashes into a parent hash."""
        combined = f"{left}:{right}".encode('utf-8')
        return self._hash(combined)
    
    def build_tree(self, file_path: Path) -> MerkleTree:
        """
        Build a Merkle tree for a file.
        
        Args:
            file_path: Path to file to hash
            
        Returns:
            Complete MerkleTree structure
        """
        file_path = Path(file_path)
        file_size = file_path.stat().st_size
        
        # Build leaf nodes by hashing chunks
        leaves: List[MerkleNode] = []
        all_nodes: Dict[Tuple[int, int], MerkleNode] = {}
        
        with open(file_path, 'rb') as f:
            chunk_index = 0
            offset = 0
            
            while True:
                chunk = f.read(self.chunk_size)
                if not chunk:
                    break
                
                chunk_hash = self._hash(chunk)
                
                leaf = MerkleNode(
                    hash=chunk_hash,
                    level=0,
                    index=chunk_index,
                    is_leaf=True,
                    chunk_start=offset,
                    chunk_end=offset + len(chunk),
                )
                
                leaves.append(leaf)
                all_nodes[(0, chunk_index)] = leaf
                
                offset += len(chunk)
                chunk_index += 1
        
        # Handle empty file
        if not leaves:
            empty_hash = self._hash(b'')
            leaf = MerkleNode(
                hash=empty_hash,
                level=0,
                index=0,
                is_leaf=True,
                chunk_start=0,
                chunk_end=0,
            )
            leaves.append(leaf)
            all_nodes[(0, 0)] = leaf
        
        # Calculate tree height
        leaf_count = len(leaves)
        tree_height = max(1, ceil(log2(leaf_count))) if leaf_count > 1 else 1
        
        # Build tree bottom-up
        current_level = leaves.copy()
        level = 0
        
        while len(current_level) > 1:
            next_level = []
            
            for i in range(0, len(current_level), 2):
                left = current_level[i]
                
                # Handle odd number of nodes
                if i + 1 < len(current_level):
                    right = current_level[i + 1]
                    combined_hash = self._combine_hashes(left.hash, right.hash)
                else:
                    # Promote single node
                    combined_hash = left.hash
                    right = None
                
                parent = MerkleNode(
                    hash=combined_hash,
                    level=level + 1,
                    index=i // 2,
                    is_leaf=False,
                    left_child=left,
                    right_child=right,
                )
                
                next_level.append(parent)
                all_nodes[(level + 1, i // 2)] = parent
            
            current_level = next_level
            level += 1
        
        root = current_level[0] if current_level else leaves[0]
        
        return MerkleTree(
            root_hash=root.hash,
            leaf_count=leaf_count,
            tree_height=level + 1,
            chunk_size=self.chunk_size,
            total_size=file_size,
            leaves=leaves,
            _all_nodes=all_nodes,
        )
    
    def build_tree_from_bytes(self, data: bytes) -> MerkleTree:
        """
        Build a Merkle tree from bytes in memory.
        
        Args:
            data: Bytes to build tree from
            
        Returns:
            MerkleTree structure
        """
        # Split into chunks
        chunks = []
        for i in range(0, len(data), self.chunk_size):
            chunks.append(data[i:i + self.chunk_size])
        
        if not chunks:
            chunks = [b'']
        
        # Build leaves
        leaves: List[MerkleNode] = []
        all_nodes: Dict[Tuple[int, int], MerkleNode] = {}
        offset = 0
        
        for i, chunk in enumerate(chunks):
            chunk_hash = self._hash(chunk)
            
            leaf = MerkleNode(
                hash=chunk_hash,
                level=0,
                index=i,
                is_leaf=True,
                chunk_start=offset,
                chunk_end=offset + len(chunk),
            )
            
            leaves.append(leaf)
            all_nodes[(0, i)] = leaf
            offset += len(chunk)
        
        # Build tree
        leaf_count = len(leaves)
        tree_height = max(1, ceil(log2(leaf_count))) if leaf_count > 1 else 1
        
        current_level = leaves.copy()
        level = 0
        
        while len(current_level) > 1:
            next_level = []
            
            for i in range(0, len(current_level), 2):
                left = current_level[i]
                
                if i + 1 < len(current_level):
                    right = current_level[i + 1]
                    combined_hash = self._combine_hashes(left.hash, right.hash)
                else:
                    combined_hash = left.hash
                    right = None
                
                parent = MerkleNode(
                    hash=combined_hash,
                    level=level + 1,
                    index=i // 2,
                    is_leaf=False,
                    left_child=left,
                    right_child=right,
                )
                
                next_level.append(parent)
                all_nodes[(level + 1, i // 2)] = parent
            
            current_level = next_level
            level += 1
        
        root = current_level[0] if current_level else leaves[0]
        
        return MerkleTree(
            root_hash=root.hash,
            leaf_count=leaf_count,
            tree_height=level + 1,
            chunk_size=self.chunk_size,
            total_size=len(data),
            leaves=leaves,
            _all_nodes=all_nodes,
        )
    
    def verify_proof(self, proof: MerkleProof) -> bool:
        """
        Verify a Merkle proof.
        
        Args:
            proof: The proof to verify
            
        Returns:
            True if proof is valid
        """
        current_hash = proof.leaf_hash
        
        for position, sibling_hash in proof.proof_hashes:
            if position == 'left':
                current_hash = self._combine_hashes(sibling_hash, current_hash)
            else:
                current_hash = self._combine_hashes(current_hash, sibling_hash)
        
        return current_hash == proof.root_hash
    
    def find_modified_chunks(
        self,
        original_tree: MerkleTree,
        file_path: Path
    ) -> List[int]:
        """
        Find which chunks have been modified.
        
        Compares current file state against stored tree
        and returns indices of modified chunks.
        
        Args:
            original_tree: The original Merkle tree
            file_path: Path to current file
            
        Returns:
            List of modified chunk indices
        """
        modified = []
        
        with open(file_path, 'rb') as f:
            for i, leaf in enumerate(original_tree.leaves):
                # Read chunk at same position
                f.seek(leaf.chunk_start)
                chunk_size = leaf.chunk_end - leaf.chunk_start
                chunk = f.read(chunk_size)
                
                current_hash = self._hash(chunk)
                
                if current_hash != leaf.hash:
                    modified.append(i)
        
        return modified
    
    def verify_chunk(
        self,
        tree: MerkleTree,
        chunk_index: int,
        chunk_data: bytes
    ) -> bool:
        """
        Verify a single chunk matches the tree.
        
        Args:
            tree: The Merkle tree
            chunk_index: Index of chunk to verify
            chunk_data: The chunk data
            
        Returns:
            True if chunk matches
        """
        if chunk_index < 0 or chunk_index >= tree.leaf_count:
            return False
        
        expected_hash = tree.leaves[chunk_index].hash
        actual_hash = self._hash(chunk_data)
        
        return actual_hash == expected_hash
    
    def get_chunk_hash(
        self,
        file_path: Path,
        chunk_index: int
    ) -> Optional[str]:
        """
        Get hash of a specific chunk from file.
        
        Args:
            file_path: Path to file
            chunk_index: Index of chunk
            
        Returns:
            Hash string or None if invalid index
        """
        try:
            offset = chunk_index * self.chunk_size
            
            with open(file_path, 'rb') as f:
                f.seek(offset)
                chunk = f.read(self.chunk_size)
                
                if not chunk:
                    return None
                
                return self._hash(chunk)
                
        except Exception:
            return None


class MerkleTreeStore:
    """
    Persistent storage for Merkle trees.
    
    Stores trees alongside file paths for later verification.
    """
    
    def __init__(self, storage_dir: Path):
        """
        Initialize the store.
        
        Args:
            storage_dir: Directory for storing trees
        """
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self._index_file = self.storage_dir / 'merkle_index.json'
        self._index = self._load_index()
    
    def _load_index(self) -> Dict[str, str]:
        """Load path to tree file mapping."""
        if self._index_file.exists():
            import json
            return json.loads(self._index_file.read_text())
        return {}
    
    def _save_index(self) -> None:
        """Save index to disk."""
        import json
        self._index_file.write_text(json.dumps(self._index, indent=2))
    
    def _get_tree_path(self, file_hash: str) -> Path:
        """Get storage path for a tree."""
        return self.storage_dir / f"tree_{file_hash[:16]}.json"
    
    def store(self, file_path: str, tree: MerkleTree) -> None:
        """
        Store a Merkle tree for a file.
        
        Args:
            file_path: Path to the file
            tree: The Merkle tree
        """
        import json
        
        # Use root hash as identifier
        tree_path = self._get_tree_path(tree.root_hash)
        tree_path.write_text(json.dumps(tree.to_dict(), indent=2))
        
        # Update index
        self._index[file_path] = tree.root_hash
        self._save_index()
    
    def load(self, file_path: str) -> Optional[MerkleTree]:
        """
        Load the Merkle tree for a file.
        
        Args:
            file_path: Path to the file
            
        Returns:
            MerkleTree or None if not found
        """
        import json
        
        root_hash = self._index.get(file_path)
        if not root_hash:
            return None
        
        tree_path = self._get_tree_path(root_hash)
        if not tree_path.exists():
            return None
        
        data = json.loads(tree_path.read_text())
        return MerkleTree.from_dict(data)
    
    def delete(self, file_path: str) -> bool:
        """
        Delete stored tree for a file.
        
        Args:
            file_path: Path to file
            
        Returns:
            True if deleted
        """
        root_hash = self._index.get(file_path)
        if not root_hash:
            return False
        
        tree_path = self._get_tree_path(root_hash)
        if tree_path.exists():
            tree_path.unlink()
        
        del self._index[file_path]
        self._save_index()
        return True
    
    def list_files(self) -> List[str]:
        """List all files with stored trees."""
        return list(self._index.keys())
