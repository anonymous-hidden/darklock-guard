"""
Append-Only Event Chain for FileGuard
=====================================
Tamper-evident log with cryptographic chaining similar to blockchain.
Each event references the hash of the previous event, creating an
unbreakable chain that detects any tampering.

Architecture:
    [Event N]        [Event N+1]      [Event N+2]
    prev_hash:H(N-1) prev_hash:H(N)   prev_hash:H(N+1)
    data: {...}      data: {...}      data: {...}
    hash: H(N)       hash: H(N+1)     hash: H(N+2)

Properties:
- Append-only: New events can only be added at the end
- Tamper-evident: Modifying any event breaks the chain
- Verifiable: Anyone can verify chain integrity
- Immutable history: Complete audit trail

Design Philosophy:
- Blockchain-inspired cryptographic linking
- Efficient verification without reading all events
- Support for checkpoints to limit verification scope
"""

import os
import json
import hashlib
import threading
import hmac
from pathlib import Path
from typing import Optional, List, Dict, Any, Generator, Tuple, Callable
from datetime import datetime
from dataclasses import dataclass, field
from enum import Enum


class ChainEventType(Enum):
    """Types of events in the chain."""
    # File protection events
    FILE_PROTECTED = 'file_protected'
    FILE_UNPROTECTED = 'file_unprotected'
    FILE_MODIFIED = 'file_modified'
    FILE_RESTORED = 'file_restored'
    FILE_SEALED = 'file_sealed'
    FILE_UNSEALED = 'file_unsealed'
    
    # Security events
    TAMPER_DETECTED = 'tamper_detected'
    SIGNATURE_INVALID = 'signature_invalid'
    KEY_ROTATED = 'key_rotated'
    
    # System events
    SERVICE_STARTED = 'service_started'
    SERVICE_STOPPED = 'service_stopped'
    CHECKPOINT_CREATED = 'checkpoint_created'
    CHAIN_VERIFIED = 'chain_verified'
    
    # Policy events
    POLICY_CHANGED = 'policy_changed'
    ALERT_GENERATED = 'alert_generated'


class ChainIntegrity(Enum):
    """Result of chain integrity verification."""
    VALID = 'valid'                     # Chain is intact
    BROKEN = 'broken'                   # Chain link is broken
    TAMPERED = 'tampered'               # Event was modified
    MISSING_EVENTS = 'missing_events'   # Events were deleted
    GENESIS_INVALID = 'genesis_invalid' # First event is invalid


@dataclass
class ChainEvent:
    """
    A single event in the append-only chain.
    
    Each event contains:
    - Sequence number for ordering
    - Timestamp for when it occurred
    - Event type and payload
    - Hash of previous event (chain link)
    - Hash of this event (computed)
    """
    sequence: int                       # Sequential event number
    timestamp: datetime                 # When event occurred
    event_type: ChainEventType          # Type of event
    payload: Dict[str, Any]             # Event data
    previous_hash: str                  # Hash of previous event
    event_hash: str = ''                # Hash of this event (computed)
    signature: Optional[str] = None     # Optional HMAC signature
    
    # Genesis event has this as previous_hash
    GENESIS_HASH = '0' * 64
    
    def compute_hash(self) -> str:
        """
        Compute the hash of this event.
        
        The hash includes all fields except the hash itself,
        ensuring any modification is detectable.
        """
        data = self._get_hashable_string()
        return hashlib.sha256(data.encode('utf-8')).hexdigest()
    
    def _get_hashable_string(self) -> str:
        """Get canonical string for hashing."""
        parts = [
            str(self.sequence),
            self.timestamp.isoformat(),
            self.event_type.value,
            json.dumps(self.payload, sort_keys=True),
            self.previous_hash,
        ]
        return '|'.join(parts)
    
    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return {
            'sequence': self.sequence,
            'timestamp': self.timestamp.isoformat(),
            'event_type': self.event_type.value,
            'payload': self.payload,
            'previous_hash': self.previous_hash,
            'event_hash': self.event_hash,
            'signature': self.signature,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ChainEvent':
        """Deserialize from dictionary."""
        return cls(
            sequence=data['sequence'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            event_type=ChainEventType(data['event_type']),
            payload=data['payload'],
            previous_hash=data['previous_hash'],
            event_hash=data['event_hash'],
            signature=data.get('signature'),
        )
    
    @classmethod
    def create_genesis(cls) -> 'ChainEvent':
        """Create the genesis (first) event."""
        event = cls(
            sequence=0,
            timestamp=datetime.utcnow(),
            event_type=ChainEventType.SERVICE_STARTED,
            payload={'message': 'Chain initialized'},
            previous_hash=cls.GENESIS_HASH,
        )
        event.event_hash = event.compute_hash()
        return event


@dataclass
class ChainCheckpoint:
    """
    A checkpoint in the chain for efficient verification.
    
    Checkpoints record the state at a specific point,
    allowing verification to start from a known-good state.
    """
    sequence: int                       # Sequence number at checkpoint
    event_hash: str                     # Hash of event at checkpoint
    created_at: datetime
    chain_length: int                   # Total events when created
    verified_until: int                 # Verified up to this sequence
    signature: Optional[str] = None     # Optional signature
    
    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return {
            'sequence': self.sequence,
            'event_hash': self.event_hash,
            'created_at': self.created_at.isoformat(),
            'chain_length': self.chain_length,
            'verified_until': self.verified_until,
            'signature': self.signature,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ChainCheckpoint':
        """Deserialize from dictionary."""
        return cls(
            sequence=data['sequence'],
            event_hash=data['event_hash'],
            created_at=datetime.fromisoformat(data['created_at']),
            chain_length=data['chain_length'],
            verified_until=data['verified_until'],
            signature=data.get('signature'),
        )


@dataclass
class VerificationResult:
    """Result of chain verification."""
    is_valid: bool
    integrity: ChainIntegrity
    verified_count: int
    first_invalid_sequence: Optional[int] = None
    error_message: Optional[str] = None
    verification_time_ms: float = 0


class EventChain:
    """
    Append-only event chain with cryptographic linking.
    
    Provides:
    - Secure event appending with chain linking
    - Chain integrity verification
    - Checkpoint creation for efficient verification
    - Event querying and filtering
    """
    
    def __init__(
        self,
        storage_path: Path,
        signing_key: Optional[bytes] = None,
        auto_checkpoint_interval: int = 1000
    ):
        """
        Initialize the event chain.
        
        Args:
            storage_path: Path to chain storage file
            signing_key: Optional key for HMAC signatures
            auto_checkpoint_interval: Events between auto-checkpoints
        """
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        
        self._signing_key = signing_key
        self._checkpoint_interval = auto_checkpoint_interval
        
        self._lock = threading.RLock()
        self._events: List[ChainEvent] = []
        self._checkpoints: List[ChainCheckpoint] = []
        self._last_hash: str = ChainEvent.GENESIS_HASH
        
        # Event listeners
        self._listeners: List[Callable[[ChainEvent], None]] = []
        
        # Load existing chain
        self._load()
    
    def _load(self) -> None:
        """Load chain from storage."""
        if not self.storage_path.exists():
            return
        
        try:
            # Use JSON Lines format for efficient appending
            with open(self.storage_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    
                    data = json.loads(line)
                    
                    if data.get('_type') == 'checkpoint':
                        self._checkpoints.append(ChainCheckpoint.from_dict(data))
                    else:
                        event = ChainEvent.from_dict(data)
                        self._events.append(event)
                        self._last_hash = event.event_hash
                        
        except Exception as e:
            print(f"Error loading chain: {e}")
    
    def _save_event(self, event: ChainEvent) -> None:
        """Append event to storage file."""
        with open(self.storage_path, 'a') as f:
            f.write(json.dumps(event.to_dict()) + '\n')
    
    def _save_checkpoint(self, checkpoint: ChainCheckpoint) -> None:
        """Append checkpoint to storage file."""
        data = checkpoint.to_dict()
        data['_type'] = 'checkpoint'
        
        with open(self.storage_path, 'a') as f:
            f.write(json.dumps(data) + '\n')
    
    def _sign_event(self, event: ChainEvent) -> None:
        """Add HMAC signature to event if signing key is set."""
        if self._signing_key:
            data = event._get_hashable_string() + '|' + event.event_hash
            signature = hmac.new(
                self._signing_key,
                data.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            event.signature = signature
    
    def _verify_signature(self, event: ChainEvent) -> bool:
        """Verify event HMAC signature."""
        if not self._signing_key or not event.signature:
            return True  # No signature to verify
        
        data = event._get_hashable_string() + '|' + event.event_hash
        expected = hmac.new(
            self._signing_key,
            data.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()
        
        return hmac.compare_digest(event.signature, expected)
    
    def append(
        self,
        event_type: ChainEventType,
        payload: Dict[str, Any]
    ) -> ChainEvent:
        """
        Append a new event to the chain.
        
        Args:
            event_type: Type of event
            payload: Event data
            
        Returns:
            The created event
        """
        with self._lock:
            # Initialize chain if empty
            if not self._events:
                genesis = ChainEvent.create_genesis()
                if self._signing_key:
                    self._sign_event(genesis)
                self._events.append(genesis)
                self._save_event(genesis)
                self._last_hash = genesis.event_hash
            
            # Create new event
            sequence = len(self._events)
            
            event = ChainEvent(
                sequence=sequence,
                timestamp=datetime.utcnow(),
                event_type=event_type,
                payload=payload,
                previous_hash=self._last_hash,
            )
            
            # Compute hash
            event.event_hash = event.compute_hash()
            
            # Sign if key is set
            self._sign_event(event)
            
            # Append to chain
            self._events.append(event)
            self._save_event(event)
            self._last_hash = event.event_hash
            
            # Notify listeners
            for listener in self._listeners:
                try:
                    listener(event)
                except Exception:
                    pass
            
            # Auto-checkpoint if needed
            if sequence > 0 and sequence % self._checkpoint_interval == 0:
                self.create_checkpoint()
            
            return event
    
    def verify_chain(
        self,
        from_sequence: int = 0,
        to_sequence: Optional[int] = None,
        use_checkpoint: bool = True
    ) -> VerificationResult:
        """
        Verify the integrity of the chain.
        
        Checks that each event's hash matches its computed hash
        and that the chain links are intact.
        
        Args:
            from_sequence: Starting sequence (inclusive)
            to_sequence: Ending sequence (exclusive, None = all)
            use_checkpoint: Start from nearest checkpoint if available
            
        Returns:
            VerificationResult with verification status
        """
        import time
        start_time = time.time()
        
        with self._lock:
            if not self._events:
                return VerificationResult(
                    is_valid=True,
                    integrity=ChainIntegrity.VALID,
                    verified_count=0,
                )
            
            # Find starting checkpoint if requested
            start_seq = from_sequence
            expected_prev_hash = ChainEvent.GENESIS_HASH if from_sequence == 0 else None
            
            if use_checkpoint and self._checkpoints:
                # Find latest checkpoint before from_sequence
                for cp in reversed(self._checkpoints):
                    if cp.sequence <= from_sequence:
                        start_seq = cp.sequence
                        expected_prev_hash = cp.event_hash
                        break
            
            # Determine range
            end_seq = to_sequence if to_sequence is not None else len(self._events)
            
            # Verify genesis if starting from 0
            if start_seq == 0:
                genesis = self._events[0]
                
                if genesis.previous_hash != ChainEvent.GENESIS_HASH:
                    return VerificationResult(
                        is_valid=False,
                        integrity=ChainIntegrity.GENESIS_INVALID,
                        verified_count=0,
                        first_invalid_sequence=0,
                        error_message="Genesis event has invalid previous hash",
                        verification_time_ms=(time.time() - start_time) * 1000,
                    )
                
                if genesis.compute_hash() != genesis.event_hash:
                    return VerificationResult(
                        is_valid=False,
                        integrity=ChainIntegrity.TAMPERED,
                        verified_count=0,
                        first_invalid_sequence=0,
                        error_message="Genesis event hash mismatch",
                        verification_time_ms=(time.time() - start_time) * 1000,
                    )
                
                expected_prev_hash = genesis.event_hash
                start_seq = 1
            
            # Verify chain
            for i in range(start_seq, min(end_seq, len(self._events))):
                event = self._events[i]
                
                # Verify hash integrity
                computed = event.compute_hash()
                if computed != event.event_hash:
                    return VerificationResult(
                        is_valid=False,
                        integrity=ChainIntegrity.TAMPERED,
                        verified_count=i - from_sequence,
                        first_invalid_sequence=i,
                        error_message=f"Event {i} hash mismatch",
                        verification_time_ms=(time.time() - start_time) * 1000,
                    )
                
                # Verify chain link
                if expected_prev_hash and event.previous_hash != expected_prev_hash:
                    return VerificationResult(
                        is_valid=False,
                        integrity=ChainIntegrity.BROKEN,
                        verified_count=i - from_sequence,
                        first_invalid_sequence=i,
                        error_message=f"Chain broken at event {i}",
                        verification_time_ms=(time.time() - start_time) * 1000,
                    )
                
                # Verify signature
                if not self._verify_signature(event):
                    return VerificationResult(
                        is_valid=False,
                        integrity=ChainIntegrity.TAMPERED,
                        verified_count=i - from_sequence,
                        first_invalid_sequence=i,
                        error_message=f"Event {i} signature invalid",
                        verification_time_ms=(time.time() - start_time) * 1000,
                    )
                
                expected_prev_hash = event.event_hash
            
            return VerificationResult(
                is_valid=True,
                integrity=ChainIntegrity.VALID,
                verified_count=min(end_seq, len(self._events)) - from_sequence,
                verification_time_ms=(time.time() - start_time) * 1000,
            )
    
    def create_checkpoint(self) -> ChainCheckpoint:
        """
        Create a checkpoint at the current position.
        
        Checkpoints allow efficient verification by establishing
        known-good points in the chain.
        
        Returns:
            The created checkpoint
        """
        with self._lock:
            if not self._events:
                raise ValueError("Cannot checkpoint empty chain")
            
            last_event = self._events[-1]
            
            checkpoint = ChainCheckpoint(
                sequence=last_event.sequence,
                event_hash=last_event.event_hash,
                created_at=datetime.utcnow(),
                chain_length=len(self._events),
                verified_until=last_event.sequence,
            )
            
            # Sign checkpoint
            if self._signing_key:
                data = f"{checkpoint.sequence}|{checkpoint.event_hash}|{checkpoint.created_at.isoformat()}"
                checkpoint.signature = hmac.new(
                    self._signing_key,
                    data.encode('utf-8'),
                    hashlib.sha256
                ).hexdigest()
            
            self._checkpoints.append(checkpoint)
            self._save_checkpoint(checkpoint)
            
            # Log checkpoint creation
            self.append(
                ChainEventType.CHECKPOINT_CREATED,
                {
                    'checkpoint_sequence': checkpoint.sequence,
                    'chain_length': checkpoint.chain_length,
                }
            )
            
            return checkpoint
    
    def get_event(self, sequence: int) -> Optional[ChainEvent]:
        """Get event by sequence number."""
        with self._lock:
            if 0 <= sequence < len(self._events):
                return self._events[sequence]
            return None
    
    def get_events(
        self,
        from_sequence: int = 0,
        to_sequence: Optional[int] = None,
        event_type: Optional[ChainEventType] = None,
        limit: int = 100
    ) -> List[ChainEvent]:
        """
        Get events with optional filtering.
        
        Args:
            from_sequence: Starting sequence (inclusive)
            to_sequence: Ending sequence (exclusive)
            event_type: Filter by event type
            limit: Maximum events to return
            
        Returns:
            List of matching events
        """
        with self._lock:
            end = to_sequence if to_sequence is not None else len(self._events)
            
            results = []
            for i in range(from_sequence, min(end, len(self._events))):
                event = self._events[i]
                
                if event_type and event.event_type != event_type:
                    continue
                
                results.append(event)
                
                if len(results) >= limit:
                    break
            
            return results
    
    def get_recent_events(
        self,
        count: int = 50,
        event_type: Optional[ChainEventType] = None
    ) -> List[ChainEvent]:
        """Get most recent events."""
        with self._lock:
            if event_type:
                # Filter and get last N matching
                matching = [e for e in self._events if e.event_type == event_type]
                return matching[-count:]
            else:
                return self._events[-count:]
    
    def search_events(
        self,
        query: str,
        fields: Optional[List[str]] = None
    ) -> List[ChainEvent]:
        """
        Search events by text in payload.
        
        Args:
            query: Text to search for
            fields: Payload fields to search (None = all)
            
        Returns:
            Matching events
        """
        with self._lock:
            results = []
            query_lower = query.lower()
            
            for event in self._events:
                if fields:
                    searchable = ' '.join(
                        str(event.payload.get(f, ''))
                        for f in fields
                    )
                else:
                    searchable = json.dumps(event.payload)
                
                if query_lower in searchable.lower():
                    results.append(event)
            
            return results
    
    def add_listener(self, callback: Callable[[ChainEvent], None]) -> None:
        """Add a listener for new events."""
        self._listeners.append(callback)
    
    def remove_listener(self, callback: Callable[[ChainEvent], None]) -> None:
        """Remove an event listener."""
        if callback in self._listeners:
            self._listeners.remove(callback)
    
    @property
    def length(self) -> int:
        """Get total number of events."""
        return len(self._events)
    
    @property
    def last_event(self) -> Optional[ChainEvent]:
        """Get the most recent event."""
        with self._lock:
            return self._events[-1] if self._events else None
    
    @property
    def checkpoints(self) -> List[ChainCheckpoint]:
        """Get all checkpoints."""
        return list(self._checkpoints)
    
    def get_chain_stats(self) -> Dict[str, Any]:
        """Get statistics about the chain."""
        with self._lock:
            event_counts = {}
            for event in self._events:
                key = event.event_type.value
                event_counts[key] = event_counts.get(key, 0) + 1
            
            return {
                'total_events': len(self._events),
                'checkpoints': len(self._checkpoints),
                'first_event': self._events[0].timestamp.isoformat() if self._events else None,
                'last_event': self._events[-1].timestamp.isoformat() if self._events else None,
                'last_hash': self._last_hash,
                'event_counts': event_counts,
            }
    
    def export_chain(self, output_path: Path) -> int:
        """
        Export chain to a file for backup.
        
        Args:
            output_path: Path to export to
            
        Returns:
            Number of events exported
        """
        with self._lock:
            data = {
                'exported_at': datetime.utcnow().isoformat(),
                'chain_length': len(self._events),
                'events': [e.to_dict() for e in self._events],
                'checkpoints': [c.to_dict() for c in self._checkpoints],
            }
            
            Path(output_path).write_text(json.dumps(data, indent=2))
            return len(self._events)


def create_event_chain(
    storage_dir: Path,
    signing_key: Optional[bytes] = None
) -> EventChain:
    """
    Factory function to create an event chain.
    
    Args:
        storage_dir: Directory for chain storage
        signing_key: Optional signing key from broker
        
    Returns:
        Configured EventChain instance
    """
    storage_path = Path(storage_dir) / 'event_chain.jsonl'
    return EventChain(storage_path, signing_key)
