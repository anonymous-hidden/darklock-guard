import { useRef, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { encryptMessage, decryptMessage, encryptWithSessionKey, decryptWithSessionKey } from '../crypto/messageEncrypt';
import { SessionRatchet } from '../crypto/ratchet';

export function useCrypto() {
  const auth = useAuthStore();
  const sessionsRef = useRef(new Map()); // peerId → SessionRatchet

  const getOrCreateSession = useCallback(async (peerPublicKey) => {
    if (sessionsRef.current.has(peerPublicKey)) {
      return sessionsRef.current.get(peerPublicKey);
    }
    const ratchet = new SessionRatchet(auth.privateKey, auth.publicKey);
    await ratchet.init(peerPublicKey);
    sessionsRef.current.set(peerPublicKey, ratchet);
    return ratchet;
  }, [auth.privateKey, auth.publicKey]);

  const encrypt = useCallback(async (plaintext, recipientPublicKey) => {
    const session = await getOrCreateSession(recipientPublicKey);
    const sessionKey = session.getSessionKey();

    let payload;
    if (sessionKey) {
      payload = await encryptWithSessionKey(plaintext, sessionKey);
      payload.useSessionKey = true;
    } else {
      payload = await encryptMessage(plaintext, recipientPublicKey, auth.privateKey);
      payload.useSessionKey = false;
    }

    session.tick();
    payload.senderPublicKey = auth.publicKey;
    payload.ephemeralKey = session.getEphemeralPublicKey();

    return { payload, needsRotation: session.needsRotation() };
  }, [auth.privateKey, auth.publicKey, getOrCreateSession]);

  const decrypt = useCallback(async (encryptedPayload, senderPublicKey) => {
    if (encryptedPayload.useSessionKey) {
      const session = await getOrCreateSession(senderPublicKey);
      const sessionKey = session.getSessionKey();
      if (sessionKey) {
        return await decryptWithSessionKey(encryptedPayload, sessionKey);
      }
    }
    return await decryptMessage(encryptedPayload, senderPublicKey, auth.privateKey);
  }, [auth.privateKey, getOrCreateSession]);

  const rotateSession = useCallback(async (peerPublicKey) => {
    const session = await getOrCreateSession(peerPublicKey);
    return await session.rotate();
  }, [getOrCreateSession]);

  const receivePeerKey = useCallback(async (peerPublicKey, ephemeralKey) => {
    const session = await getOrCreateSession(peerPublicKey);
    await session.receivePeerEphemeralKey(ephemeralKey);
  }, [getOrCreateSession]);

  const destroyAllSessions = useCallback(async () => {
    for (const session of sessionsRef.current.values()) {
      await session.destroy();
    }
    sessionsRef.current.clear();
  }, []);

  return { encrypt, decrypt, rotateSession, receivePeerKey, destroyAllSessions };
}
