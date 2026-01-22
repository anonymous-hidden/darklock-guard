"""
Agent/Broker IPC Protocol for FileGuard
=======================================
Secure inter-process communication between the FileGuard agent
(file watcher service) and the secret broker using named pipes.

Architecture:
    Agent (User process)           Broker (Protected process)
           |                              |
           |---[Named Pipe + Auth]--->    |
           |                              |
           |<--[Token Response]------|
           |                              |

Protocol:
1. Agent connects to named pipe
2. Agent sends challenge request
3. Broker responds with challenge
4. Agent proves identity (shared secret)
5. Broker issues short-lived token
6. Agent uses token for operations

Security Properties:
- Named pipes provide process-level isolation
- Challenge-response prevents replay attacks
- Short-lived tokens limit exposure window
- All messages are signed
"""

import os
import sys
import json
import secrets
import hashlib
import hmac
import struct
import threading
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, Dict, Any, Tuple, Callable
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum

IS_WINDOWS = sys.platform == 'win32'


class MessageType(Enum):
    """Types of IPC messages."""
    # Handshake
    HELLO = 'hello'
    CHALLENGE = 'challenge'
    CHALLENGE_RESPONSE = 'challenge_response'
    AUTH_SUCCESS = 'auth_success'
    AUTH_FAILURE = 'auth_failure'
    
    # Token operations
    REQUEST_TOKEN = 'request_token'
    TOKEN_RESPONSE = 'token_response'
    REVOKE_TOKEN = 'revoke_token'
    
    # Key operations
    GET_SIGNING_KEY = 'get_signing_key'
    GET_ENCRYPTION_KEY = 'get_encryption_key'
    KEY_RESPONSE = 'key_response'
    
    # Status
    STATUS_REQUEST = 'status_request'
    STATUS_RESPONSE = 'status_response'
    
    # Control
    PING = 'ping'
    PONG = 'pong'
    ERROR = 'error'
    SHUTDOWN = 'shutdown'


@dataclass
class IPCMessage:
    """
    A message in the IPC protocol.
    
    All messages are signed with HMAC for integrity.
    """
    msg_type: MessageType
    payload: Dict[str, Any]
    nonce: str                          # Unique message ID
    timestamp: datetime
    signature: Optional[str] = None
    
    # Maximum message size (1MB)
    MAX_SIZE = 1024 * 1024
    
    def to_bytes(self, signing_key: Optional[bytes] = None) -> bytes:
        """
        Serialize message to bytes for transmission.
        
        Format: length (4 bytes) + JSON message
        """
        data = {
            'type': self.msg_type.value,
            'payload': self.payload,
            'nonce': self.nonce,
            'timestamp': self.timestamp.isoformat(),
        }
        
        # Sign if key provided
        if signing_key:
            sig_data = json.dumps(data, sort_keys=True)
            signature = hmac.new(
                signing_key,
                sig_data.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            data['signature'] = signature
        
        json_bytes = json.dumps(data).encode('utf-8')
        
        if len(json_bytes) > self.MAX_SIZE:
            raise ValueError("Message too large")
        
        length = struct.pack('>I', len(json_bytes))
        return length + json_bytes
    
    @classmethod
    def from_bytes(
        cls,
        data: bytes,
        signing_key: Optional[bytes] = None
    ) -> 'IPCMessage':
        """
        Deserialize message from bytes.
        
        Verifies signature if signing key is provided.
        """
        if len(data) < 4:
            raise ValueError("Message too short")
        
        length = struct.unpack('>I', data[:4])[0]
        
        if len(data) < 4 + length:
            raise ValueError("Incomplete message")
        
        json_bytes = data[4:4+length]
        msg_data = json.loads(json_bytes.decode('utf-8'))
        
        # Verify signature if present and key provided
        signature = msg_data.pop('signature', None)
        
        if signing_key and signature:
            sig_data = json.dumps(msg_data, sort_keys=True)
            expected = hmac.new(
                signing_key,
                sig_data.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(signature, expected):
                raise ValueError("Invalid message signature")
        
        return cls(
            msg_type=MessageType(msg_data['type']),
            payload=msg_data['payload'],
            nonce=msg_data['nonce'],
            timestamp=datetime.fromisoformat(msg_data['timestamp']),
            signature=signature,
        )
    
    @classmethod
    def create(
        cls,
        msg_type: MessageType,
        payload: Optional[Dict[str, Any]] = None
    ) -> 'IPCMessage':
        """Create a new message with auto-generated nonce."""
        return cls(
            msg_type=msg_type,
            payload=payload or {},
            nonce=secrets.token_urlsafe(16),
            timestamp=datetime.utcnow(),
        )


class IPCChannel(ABC):
    """
    Abstract base class for IPC channels.
    
    Implementations provide platform-specific transport.
    """
    
    @abstractmethod
    def connect(self) -> bool:
        """Connect to the channel."""
        pass
    
    @abstractmethod
    def disconnect(self) -> None:
        """Disconnect from the channel."""
        pass
    
    @abstractmethod
    def send(self, data: bytes) -> bool:
        """Send data through the channel."""
        pass
    
    @abstractmethod
    def receive(self, timeout: float = 5.0) -> Optional[bytes]:
        """Receive data from the channel."""
        pass
    
    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Check if channel is connected."""
        pass


class WindowsNamedPipeClient(IPCChannel):
    """
    Windows named pipe client implementation.
    """
    
    def __init__(self, pipe_name: str = r'\\.\pipe\FileGuardBroker'):
        self.pipe_name = pipe_name
        self._handle = None
    
    def connect(self) -> bool:
        """Connect to the named pipe server."""
        if IS_WINDOWS:
            try:
                import win32file
                import win32pipe
                
                # Wait for pipe to be available
                max_attempts = 10
                for _ in range(max_attempts):
                    try:
                        self._handle = win32file.CreateFile(
                            self.pipe_name,
                            win32file.GENERIC_READ | win32file.GENERIC_WRITE,
                            0,
                            None,
                            win32file.OPEN_EXISTING,
                            0,
                            None
                        )
                        
                        # Set pipe mode to message
                        win32pipe.SetNamedPipeHandleState(
                            self._handle,
                            win32pipe.PIPE_READMODE_MESSAGE,
                            None,
                            None
                        )
                        
                        return True
                        
                    except Exception as e:
                        if 'ERROR_PIPE_BUSY' in str(e):
                            win32pipe.WaitNamedPipe(self.pipe_name, 500)
                        else:
                            raise
                
                return False
                
            except Exception as e:
                print(f"Named pipe connect error: {e}")
                return False
        else:
            return False
    
    def disconnect(self) -> None:
        """Disconnect from the pipe."""
        if self._handle:
            try:
                import win32file
                win32file.CloseHandle(self._handle)
            except Exception:
                pass
            self._handle = None
    
    def send(self, data: bytes) -> bool:
        """Send data through the pipe."""
        if not self._handle:
            return False
        
        try:
            import win32file
            win32file.WriteFile(self._handle, data)
            return True
        except Exception as e:
            print(f"Pipe send error: {e}")
            return False
    
    def receive(self, timeout: float = 5.0) -> Optional[bytes]:
        """Receive data from the pipe."""
        if not self._handle:
            return None
        
        try:
            import win32file
            _, data = win32file.ReadFile(self._handle, IPCMessage.MAX_SIZE)
            return data
        except Exception as e:
            print(f"Pipe receive error: {e}")
            return None
    
    @property
    def is_connected(self) -> bool:
        return self._handle is not None


class WindowsNamedPipeServer(IPCChannel):
    """
    Windows named pipe server implementation.
    """
    
    def __init__(self, pipe_name: str = r'\\.\pipe\FileGuardBroker'):
        self.pipe_name = pipe_name
        self._handle = None
        self._connected = False
    
    def connect(self) -> bool:
        """Create and listen on the named pipe."""
        if IS_WINDOWS:
            try:
                import win32pipe
                import win32file
                
                # Create the named pipe
                self._handle = win32pipe.CreateNamedPipe(
                    self.pipe_name,
                    win32pipe.PIPE_ACCESS_DUPLEX,
                    win32pipe.PIPE_TYPE_MESSAGE | win32pipe.PIPE_READMODE_MESSAGE | win32pipe.PIPE_WAIT,
                    1,  # Max instances
                    IPCMessage.MAX_SIZE,  # Output buffer
                    IPCMessage.MAX_SIZE,  # Input buffer
                    0,  # Default timeout
                    None  # Security attributes
                )
                
                return True
                
            except Exception as e:
                print(f"Named pipe server error: {e}")
                return False
        else:
            return False
    
    def wait_for_connection(self, timeout: float = None) -> bool:
        """Wait for a client to connect."""
        if not self._handle:
            return False
        
        try:
            import win32pipe
            win32pipe.ConnectNamedPipe(self._handle, None)
            self._connected = True
            return True
        except Exception as e:
            print(f"Wait for connection error: {e}")
            return False
    
    def disconnect(self) -> None:
        """Disconnect client and close pipe."""
        if self._handle:
            try:
                import win32pipe
                import win32file
                
                if self._connected:
                    win32pipe.DisconnectNamedPipe(self._handle)
                
                win32file.CloseHandle(self._handle)
            except Exception:
                pass
            
            self._handle = None
            self._connected = False
    
    def send(self, data: bytes) -> bool:
        """Send data to connected client."""
        if not self._handle or not self._connected:
            return False
        
        try:
            import win32file
            win32file.WriteFile(self._handle, data)
            return True
        except Exception as e:
            print(f"Pipe send error: {e}")
            return False
    
    def receive(self, timeout: float = 5.0) -> Optional[bytes]:
        """Receive data from connected client."""
        if not self._handle or not self._connected:
            return None
        
        try:
            import win32file
            _, data = win32file.ReadFile(self._handle, IPCMessage.MAX_SIZE)
            return data
        except Exception as e:
            print(f"Pipe receive error: {e}")
            return None
    
    @property
    def is_connected(self) -> bool:
        return self._connected


class UnixSocketClient(IPCChannel):
    """
    Unix domain socket client for Linux/macOS.
    """
    
    def __init__(self, socket_path: str = '/tmp/fileguard_broker.sock'):
        self.socket_path = socket_path
        self._socket = None
    
    def connect(self) -> bool:
        """Connect to the Unix socket."""
        try:
            import socket
            
            self._socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self._socket.connect(self.socket_path)
            return True
            
        except Exception as e:
            print(f"Unix socket connect error: {e}")
            return False
    
    def disconnect(self) -> None:
        """Disconnect from the socket."""
        if self._socket:
            try:
                self._socket.close()
            except Exception:
                pass
            self._socket = None
    
    def send(self, data: bytes) -> bool:
        """Send data through the socket."""
        if not self._socket:
            return False
        
        try:
            self._socket.sendall(data)
            return True
        except Exception as e:
            print(f"Socket send error: {e}")
            return False
    
    def receive(self, timeout: float = 5.0) -> Optional[bytes]:
        """Receive data from the socket."""
        if not self._socket:
            return None
        
        try:
            self._socket.settimeout(timeout)
            
            # Read length first
            length_data = self._socket.recv(4)
            if len(length_data) < 4:
                return None
            
            length = struct.unpack('>I', length_data)[0]
            
            # Read message
            data = b''
            while len(data) < length:
                chunk = self._socket.recv(min(4096, length - len(data)))
                if not chunk:
                    break
                data += chunk
            
            return length_data + data
            
        except Exception as e:
            print(f"Socket receive error: {e}")
            return None
    
    @property
    def is_connected(self) -> bool:
        return self._socket is not None


class UnixSocketServer(IPCChannel):
    """
    Unix domain socket server for Linux/macOS.
    """
    
    def __init__(self, socket_path: str = '/tmp/fileguard_broker.sock'):
        self.socket_path = socket_path
        self._socket = None
        self._client = None
    
    def connect(self) -> bool:
        """Create and bind the socket."""
        try:
            import socket
            
            # Remove old socket file if exists
            if os.path.exists(self.socket_path):
                os.unlink(self.socket_path)
            
            self._socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self._socket.bind(self.socket_path)
            
            # Set restrictive permissions
            os.chmod(self.socket_path, 0o600)
            
            self._socket.listen(1)
            return True
            
        except Exception as e:
            print(f"Unix socket server error: {e}")
            return False
    
    def wait_for_connection(self, timeout: float = None) -> bool:
        """Wait for a client to connect."""
        if not self._socket:
            return False
        
        try:
            if timeout:
                self._socket.settimeout(timeout)
            
            self._client, _ = self._socket.accept()
            return True
            
        except Exception as e:
            print(f"Wait for connection error: {e}")
            return False
    
    def disconnect(self) -> None:
        """Disconnect and cleanup."""
        if self._client:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None
        
        if self._socket:
            try:
                self._socket.close()
            except Exception:
                pass
            self._socket = None
        
        if os.path.exists(self.socket_path):
            try:
                os.unlink(self.socket_path)
            except Exception:
                pass
    
    def send(self, data: bytes) -> bool:
        """Send data to connected client."""
        if not self._client:
            return False
        
        try:
            self._client.sendall(data)
            return True
        except Exception as e:
            print(f"Socket send error: {e}")
            return False
    
    def receive(self, timeout: float = 5.0) -> Optional[bytes]:
        """Receive data from connected client."""
        if not self._client:
            return None
        
        try:
            self._client.settimeout(timeout)
            
            # Read length first
            length_data = self._client.recv(4)
            if len(length_data) < 4:
                return None
            
            length = struct.unpack('>I', length_data)[0]
            
            # Read message
            data = b''
            while len(data) < length:
                chunk = self._client.recv(min(4096, length - len(data)))
                if not chunk:
                    break
                data += chunk
            
            return length_data + data
            
        except Exception as e:
            print(f"Socket receive error: {e}")
            return None
    
    @property
    def is_connected(self) -> bool:
        return self._client is not None


def get_ipc_client() -> IPCChannel:
    """Get platform-appropriate IPC client."""
    if IS_WINDOWS:
        return WindowsNamedPipeClient()
    else:
        return UnixSocketClient()


def get_ipc_server() -> IPCChannel:
    """Get platform-appropriate IPC server."""
    if IS_WINDOWS:
        return WindowsNamedPipeServer()
    else:
        return UnixSocketServer()


class BrokerClient:
    """
    Client for communicating with the secret broker.
    
    Handles authentication and token requests.
    """
    
    def __init__(self, shared_secret: bytes):
        """
        Initialize the broker client.
        
        Args:
            shared_secret: Secret shared with broker for auth
        """
        self._secret = shared_secret
        self._channel = get_ipc_client()
        self._session_key: Optional[bytes] = None
        self._authenticated = False
    
    def connect(self) -> bool:
        """Connect to the broker."""
        if not self._channel.connect():
            return False
        
        return self._authenticate()
    
    def _authenticate(self) -> bool:
        """Perform challenge-response authentication."""
        try:
            # Send hello
            hello = IPCMessage.create(MessageType.HELLO, {
                'client_id': secrets.token_urlsafe(8),
                'version': '1.0',
            })
            
            if not self._channel.send(hello.to_bytes()):
                return False
            
            # Receive challenge
            data = self._channel.receive()
            if not data:
                return False
            
            challenge = IPCMessage.from_bytes(data)
            if challenge.msg_type != MessageType.CHALLENGE:
                return False
            
            # Compute response
            challenge_value = challenge.payload['challenge']
            response_value = hmac.new(
                self._secret,
                challenge_value.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            # Send response
            response = IPCMessage.create(MessageType.CHALLENGE_RESPONSE, {
                'response': response_value,
            })
            
            if not self._channel.send(response.to_bytes(self._secret)):
                return False
            
            # Receive auth result
            data = self._channel.receive()
            if not data:
                return False
            
            result = IPCMessage.from_bytes(data, self._secret)
            
            if result.msg_type == MessageType.AUTH_SUCCESS:
                # Derive session key
                session_nonce = result.payload.get('session_nonce', '')
                self._session_key = hashlib.sha256(
                    self._secret + session_nonce.encode()
                ).digest()
                self._authenticated = True
                return True
            
            return False
            
        except Exception as e:
            print(f"Authentication error: {e}")
            return False
    
    def request_token(
        self,
        token_type: str,
        ttl_seconds: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Request a token from the broker.
        
        Args:
            token_type: Type of token to request
            ttl_seconds: Requested lifetime
            
        Returns:
            Token data or None
        """
        if not self._authenticated:
            return None
        
        msg = IPCMessage.create(MessageType.REQUEST_TOKEN, {
            'token_type': token_type,
            'ttl_seconds': ttl_seconds,
        })
        
        if not self._channel.send(msg.to_bytes(self._session_key)):
            return None
        
        data = self._channel.receive()
        if not data:
            return None
        
        response = IPCMessage.from_bytes(data, self._session_key)
        
        if response.msg_type == MessageType.TOKEN_RESPONSE:
            return response.payload.get('token')
        
        return None
    
    def get_signing_key(self, token_id: str) -> Optional[bytes]:
        """Get signing key material."""
        if not self._authenticated:
            return None
        
        msg = IPCMessage.create(MessageType.GET_SIGNING_KEY, {
            'token_id': token_id,
        })
        
        if not self._channel.send(msg.to_bytes(self._session_key)):
            return None
        
        data = self._channel.receive()
        if not data:
            return None
        
        response = IPCMessage.from_bytes(data, self._session_key)
        
        if response.msg_type == MessageType.KEY_RESPONSE:
            key_hex = response.payload.get('key')
            if key_hex:
                return bytes.fromhex(key_hex)
        
        return None
    
    def disconnect(self) -> None:
        """Disconnect from the broker."""
        self._channel.disconnect()
        self._authenticated = False
        self._session_key = None


class BrokerServer:
    """
    Server side of the broker IPC.
    
    Handles authentication and token issuance.
    """
    
    def __init__(
        self,
        shared_secret: bytes,
        token_handler: Callable[[str, Optional[int]], Optional[Dict[str, Any]]],
        signing_key_handler: Callable[[str], Optional[bytes]]
    ):
        """
        Initialize the broker server.
        
        Args:
            shared_secret: Secret for authentication
            token_handler: Function to issue tokens
            signing_key_handler: Function to get signing keys
        """
        self._secret = shared_secret
        self._token_handler = token_handler
        self._signing_key_handler = signing_key_handler
        self._channel = get_ipc_server()
        self._running = False
        self._session_keys: Dict[str, bytes] = {}
    
    def start(self) -> bool:
        """Start the broker server."""
        if not self._channel.connect():
            return False
        
        self._running = True
        return True
    
    def run(self) -> None:
        """Main server loop."""
        while self._running:
            try:
                # Wait for connection
                if not self._channel.wait_for_connection(timeout=1.0):
                    continue
                
                # Handle client
                self._handle_client()
                
            except Exception as e:
                print(f"Server error: {e}")
    
    def _handle_client(self) -> None:
        """Handle a connected client."""
        try:
            # Receive hello
            data = self._channel.receive()
            if not data:
                return
            
            hello = IPCMessage.from_bytes(data)
            if hello.msg_type != MessageType.HELLO:
                return
            
            client_id = hello.payload.get('client_id', 'unknown')
            
            # Send challenge
            challenge_value = secrets.token_urlsafe(32)
            challenge = IPCMessage.create(MessageType.CHALLENGE, {
                'challenge': challenge_value,
            })
            
            if not self._channel.send(challenge.to_bytes()):
                return
            
            # Receive response
            data = self._channel.receive()
            if not data:
                return
            
            response = IPCMessage.from_bytes(data, self._secret)
            
            if response.msg_type != MessageType.CHALLENGE_RESPONSE:
                return
            
            # Verify response
            expected = hmac.new(
                self._secret,
                challenge_value.encode('utf-8'),
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(response.payload.get('response', ''), expected):
                failure = IPCMessage.create(MessageType.AUTH_FAILURE, {
                    'reason': 'Invalid challenge response',
                })
                self._channel.send(failure.to_bytes())
                return
            
            # Generate session key
            session_nonce = secrets.token_urlsafe(16)
            session_key = hashlib.sha256(
                self._secret + session_nonce.encode()
            ).digest()
            
            self._session_keys[client_id] = session_key
            
            # Send success
            success = IPCMessage.create(MessageType.AUTH_SUCCESS, {
                'session_nonce': session_nonce,
            })
            
            if not self._channel.send(success.to_bytes(self._secret)):
                return
            
            # Handle requests
            self._handle_requests(client_id, session_key)
            
        except Exception as e:
            print(f"Client handler error: {e}")
    
    def _handle_requests(self, client_id: str, session_key: bytes) -> None:
        """Handle authenticated requests from client."""
        while self._running:
            try:
                data = self._channel.receive(timeout=30.0)
                if not data:
                    break
                
                msg = IPCMessage.from_bytes(data, session_key)
                
                if msg.msg_type == MessageType.REQUEST_TOKEN:
                    token_type = msg.payload.get('token_type')
                    ttl = msg.payload.get('ttl_seconds')
                    
                    token = self._token_handler(token_type, ttl)
                    
                    response = IPCMessage.create(MessageType.TOKEN_RESPONSE, {
                        'token': token,
                    })
                    
                    self._channel.send(response.to_bytes(session_key))
                
                elif msg.msg_type == MessageType.GET_SIGNING_KEY:
                    token_id = msg.payload.get('token_id')
                    
                    key = self._signing_key_handler(token_id)
                    
                    response = IPCMessage.create(MessageType.KEY_RESPONSE, {
                        'key': key.hex() if key else None,
                    })
                    
                    self._channel.send(response.to_bytes(session_key))
                
                elif msg.msg_type == MessageType.PING:
                    pong = IPCMessage.create(MessageType.PONG, {})
                    self._channel.send(pong.to_bytes(session_key))
                
                elif msg.msg_type == MessageType.SHUTDOWN:
                    break
                
            except Exception as e:
                print(f"Request handler error: {e}")
                break
    
    def stop(self) -> None:
        """Stop the server."""
        self._running = False
        self._channel.disconnect()
