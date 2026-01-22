"""
File System Watcher for FileGuard
=================================
Real-time monitoring of protected files and folders using watchdog.
Detects changes as they happen and triggers appropriate responses.

Design Philosophy:
- Non-blocking, event-driven architecture
- Debouncing to handle rapid successive changes
- Graceful degradation if watching fails
- Periodic verification as failsafe
"""

import os
import sys
import time
import threading
from pathlib import Path
from typing import Dict, Set, Callable, Optional, List
from dataclasses import dataclass
from datetime import datetime, timedelta
from queue import Queue, Empty
from watchdog.observers import Observer
from watchdog.events import (
    FileSystemEventHandler,
    FileSystemEvent,
    FileCreatedEvent,
    FileDeletedEvent,
    FileModifiedEvent,
    FileMovedEvent,
    DirCreatedEvent,
    DirDeletedEvent,
    DirModifiedEvent,
    DirMovedEvent,
)

from .policy import ChangeType, ProtectionPolicy


@dataclass
class FileEvent:
    """
    Normalized file system event for processing.
    
    Wraps watchdog events in a consistent format.
    """
    path: str
    change_type: ChangeType
    timestamp: datetime
    old_path: Optional[str] = None  # For rename/move events
    is_directory: bool = False
    
    def __str__(self) -> str:
        return f"{self.change_type.name}: {self.path}"


class EventDebouncer:
    """
    Debounces rapid file system events.
    
    When a file is saved, we often get multiple events in quick succession
    (e.g., MODIFY, MODIFY, MODIFY). This class coalesces them into a single
    event after a short delay.
    """
    
    def __init__(self, delay_seconds: float = 0.5):
        """
        Initialize the debouncer.
        
        Args:
            delay_seconds: Time to wait before processing events
        """
        self.delay = delay_seconds
        self._pending: Dict[str, FileEvent] = {}
        self._lock = threading.Lock()
        self._timers: Dict[str, threading.Timer] = {}
    
    def add_event(self, event: FileEvent, callback: Callable[[FileEvent], None]) -> None:
        """
        Add an event to the debouncer.
        
        If an event for the same path is already pending, it gets
        replaced. The callback fires after the delay expires.
        
        Args:
            event: The file event to debounce
            callback: Function to call with the event after delay
        """
        with self._lock:
            # Cancel existing timer for this path
            if event.path in self._timers:
                self._timers[event.path].cancel()
            
            # Store the most recent event
            self._pending[event.path] = event
            
            # Set up new timer
            def fire():
                with self._lock:
                    if event.path in self._pending:
                        final_event = self._pending.pop(event.path)
                        self._timers.pop(event.path, None)
                        callback(final_event)
            
            timer = threading.Timer(self.delay, fire)
            self._timers[event.path] = timer
            timer.start()
    
    def cancel_all(self) -> None:
        """Cancel all pending events."""
        with self._lock:
            for timer in self._timers.values():
                timer.cancel()
            self._timers.clear()
            self._pending.clear()


class ProtectedFileHandler(FileSystemEventHandler):
    """
    Watchdog event handler for protected files and folders.
    
    Translates watchdog events into our normalized FileEvent format
    and routes them through the debouncer.
    """
    
    def __init__(
        self,
        event_callback: Callable[[FileEvent], None],
        debounce_delay: float = 0.5
    ):
        """
        Initialize the handler.
        
        Args:
            event_callback: Function to call for each detected event
            debounce_delay: Seconds to debounce rapid events
        """
        super().__init__()
        self._callback = event_callback
        self._debouncer = EventDebouncer(debounce_delay)
    
    def _to_file_event(self, event: FileSystemEvent) -> Optional[FileEvent]:
        """Convert a watchdog event to our FileEvent format."""
        path = event.src_path
        is_dir = isinstance(event, (DirCreatedEvent, DirDeletedEvent, 
                                     DirModifiedEvent, DirMovedEvent))
        
        if isinstance(event, (FileCreatedEvent, DirCreatedEvent)):
            change_type = ChangeType.CREATED
        elif isinstance(event, (FileDeletedEvent, DirDeletedEvent)):
            change_type = ChangeType.DELETED
        elif isinstance(event, (FileModifiedEvent, DirModifiedEvent)):
            change_type = ChangeType.CONTENT_MODIFIED
        elif isinstance(event, (FileMovedEvent, DirMovedEvent)):
            change_type = ChangeType.RENAMED
            return FileEvent(
                path=event.dest_path,
                change_type=change_type,
                timestamp=datetime.now(),
                old_path=event.src_path,
                is_directory=is_dir
            )
        else:
            return None
        
        return FileEvent(
            path=path,
            change_type=change_type,
            timestamp=datetime.now(),
            is_directory=is_dir
        )
    
    def on_any_event(self, event: FileSystemEvent) -> None:
        """Handle any filesystem event."""
        # Skip directory events if we only care about files
        # (but keep them for folder protection)
        
        file_event = self._to_file_event(event)
        if file_event:
            self._debouncer.add_event(file_event, self._callback)
    
    def stop(self) -> None:
        """Stop the handler and cancel pending events."""
        self._debouncer.cancel_all()


class FileWatcher:
    """
    Central file watching coordinator.
    
    Manages watching multiple files and folders, routing events
    to the appropriate handlers, and maintaining watch state.
    """
    
    def __init__(
        self,
        event_callback: Callable[[FileEvent], None],
        debounce_delay: float = 0.5
    ):
        """
        Initialize the file watcher.
        
        Args:
            event_callback: Function to call for each detected event
            debounce_delay: Seconds to debounce rapid events
        """
        self._callback = event_callback
        self._debounce_delay = debounce_delay
        
        # Watchdog observer
        self._observer: Optional[Observer] = None
        
        # Track what we're watching
        self._watched_paths: Dict[str, any] = {}  # path -> watch handle
        self._handlers: Dict[str, ProtectedFileHandler] = {}  # path -> handler
        
        # Thread safety
        self._lock = threading.Lock()
        
        # Running state
        self._running = False
    
    def start(self) -> bool:
        """
        Start the file watcher.
        
        Returns:
            True if started successfully
        """
        with self._lock:
            if self._running:
                return True
            
            try:
                self._observer = Observer()
                self._observer.start()
                self._running = True
                return True
            except Exception as e:
                print(f"Failed to start file watcher: {e}")
                return False
    
    def stop(self) -> None:
        """Stop the file watcher and clean up."""
        with self._lock:
            if not self._running:
                return
            
            # Stop all handlers
            for handler in self._handlers.values():
                handler.stop()
            
            # Stop observer
            if self._observer:
                self._observer.stop()
                self._observer.join(timeout=5.0)
                self._observer = None
            
            self._watched_paths.clear()
            self._handlers.clear()
            self._running = False
    
    def add_watch(self, path: str, recursive: bool = False) -> bool:
        """
        Add a path to be watched.
        
        Args:
            path: File or folder path to watch
            recursive: Whether to watch subdirectories (folders only)
            
        Returns:
            True if watch was added successfully
        """
        path = str(Path(path).absolute())
        
        with self._lock:
            if not self._running:
                if not self.start():
                    return False
            
            if path in self._watched_paths:
                return True  # Already watching
            
            # Determine what to watch
            # For files, we watch the parent directory and filter events
            watch_path = path
            is_file = os.path.isfile(path)
            
            if is_file:
                watch_path = str(Path(path).parent)
            
            # Create handler
            handler = ProtectedFileHandler(
                event_callback=lambda e: self._route_event(e, path, is_file),
                debounce_delay=self._debounce_delay
            )
            
            try:
                watch_handle = self._observer.schedule(
                    handler,
                    watch_path,
                    recursive=recursive and not is_file
                )
                
                self._watched_paths[path] = watch_handle
                self._handlers[path] = handler
                return True
                
            except Exception as e:
                print(f"Failed to add watch for {path}: {e}")
                return False
    
    def remove_watch(self, path: str) -> bool:
        """
        Remove a path from watching.
        
        Args:
            path: Path to stop watching
            
        Returns:
            True if watch was removed
        """
        path = str(Path(path).absolute())
        
        with self._lock:
            if path not in self._watched_paths:
                return False
            
            # Stop handler
            if path in self._handlers:
                self._handlers[path].stop()
                del self._handlers[path]
            
            # Unschedule watch
            watch_handle = self._watched_paths.pop(path)
            if self._observer and watch_handle:
                try:
                    self._observer.unschedule(watch_handle)
                except Exception:
                    pass  # May already be unscheduled
            
            return True
    
    def _route_event(self, event: FileEvent, original_path: str, is_file: bool) -> None:
        """
        Route an event to the callback if it's relevant.
        
        For file watches, filters events to only those affecting the watched file.
        """
        event_path = str(Path(event.path).absolute())
        original_path = str(Path(original_path).absolute())
        
        if is_file:
            # Only process events for the specific file
            if event_path != original_path:
                return
        else:
            # For folders, ensure event is within the watched folder
            if not event_path.startswith(original_path):
                return
        
        # Call the registered callback
        self._callback(event)
    
    def is_watching(self, path: str) -> bool:
        """Check if a path is currently being watched."""
        path = str(Path(path).absolute())
        with self._lock:
            return path in self._watched_paths
    
    def get_watched_paths(self) -> List[str]:
        """Get list of all currently watched paths."""
        with self._lock:
            return list(self._watched_paths.keys())
    
    @property
    def is_running(self) -> bool:
        """Check if the watcher is running."""
        return self._running


class PeriodicVerifier:
    """
    Periodic verification scanner as a failsafe.
    
    The filesystem watcher might miss events in certain situations:
    - Network drives that don't support notifications
    - Events that occurred while the app wasn't running
    - Edge cases in the OS notification system
    
    This scanner runs periodically to catch anything missed.
    """
    
    def __init__(
        self,
        verify_callback: Callable[[str], None],
        interval_seconds: int = 300  # 5 minutes default
    ):
        """
        Initialize the periodic verifier.
        
        Args:
            verify_callback: Function to call with each path to verify
            interval_seconds: Seconds between verification scans
        """
        self._callback = verify_callback
        self._interval = interval_seconds
        
        self._paths: Set[str] = set()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
    
    def start(self) -> None:
        """Start the periodic verifier."""
        with self._lock:
            if self._running:
                return
            
            self._running = True
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
    
    def stop(self) -> None:
        """Stop the periodic verifier."""
        with self._lock:
            if not self._running:
                return
            
            self._running = False
            self._stop_event.set()
            
            if self._thread:
                self._thread.join(timeout=5.0)
                self._thread = None
    
    def add_path(self, path: str) -> None:
        """Add a path to be verified periodically."""
        with self._lock:
            self._paths.add(str(Path(path).absolute()))
    
    def remove_path(self, path: str) -> None:
        """Remove a path from periodic verification."""
        with self._lock:
            self._paths.discard(str(Path(path).absolute()))
    
    def _run_loop(self) -> None:
        """Main verification loop."""
        while not self._stop_event.wait(timeout=self._interval):
            self._verify_all()
    
    def _verify_all(self) -> None:
        """Verify all registered paths."""
        with self._lock:
            paths_to_verify = list(self._paths)
        
        for path in paths_to_verify:
            if self._stop_event.is_set():
                break
            
            try:
                self._callback(path)
            except Exception as e:
                print(f"Verification failed for {path}: {e}")
    
    def verify_now(self) -> None:
        """Trigger immediate verification of all paths."""
        threading.Thread(target=self._verify_all, daemon=True).start()
    
    def set_interval(self, seconds: int) -> None:
        """Update the verification interval."""
        self._interval = max(60, seconds)  # Minimum 1 minute
    
    @property
    def interval(self) -> int:
        """Get current verification interval."""
        return self._interval
