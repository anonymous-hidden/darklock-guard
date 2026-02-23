/**
 * SpotifyCallbackPage — handles the Spotify OAuth redirect.
 * This page loads in the popup window, extracts the auth code,
 * exchanges it for tokens, and posts the result to the parent window.
 */
import { useEffect, useState } from "react";

export default function SpotifyCallbackPage() {
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [message, setMessage] = useState("Connecting to Spotify…");

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const error = params.get("error");

        if (error) throw new Error(`Spotify denied: ${error}`);
        if (!code) throw new Error("No authorization code received");

        // Retrieve PKCE verifier and clientId from window.name (survives cross-origin redirect)
        let verifier: string | null = null;
        let clientId: string | null = null;
        try {
          const state = JSON.parse(window.name);
          verifier = state.verifier;
          clientId = state.clientId;
        } catch {
          throw new Error("PKCE state missing — try again");
        }

        if (!verifier || !clientId) throw new Error("PKCE state missing — try again");

        setMessage("Exchanging token…");

        // Exchange code for tokens
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: "http://127.0.0.1:5173/spotify-callback",
          client_id: clientId,
          code_verifier: verifier,
        });

        const res = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Token exchange failed: ${err}`);
        }

        const tokens = await res.json();

        // Send tokens to parent window — use '*' since popup may be different origin
        if (window.opener) {
          window.opener.postMessage(
            { type: "SPOTIFY_AUTH_SUCCESS", ...tokens },
            "*"
          );
        }

        setStatus("success");
        setMessage("Connected! Closing…");
        window.name = "";
        setTimeout(() => window.close(), 800);
      } catch (err) {
        setStatus("error");
        setMessage(String(err));
        if (window.opener) {
          window.opener.postMessage(
            { type: "SPOTIFY_AUTH_ERROR", error: String(err) },
            "*"
          );
        }
      }
    })();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f1117",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        gap: 16,
      }}
    >
      {/* Spotify logo mark */}
      <svg width="52" height="52" viewBox="0 0 24 24" fill="#1DB954">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>

      {status === "processing" && (
        <div style={{ width: 28, height: 28, border: "3px solid rgba(255,255,255,0.1)", borderTop: "3px solid #1DB954", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      )}
      {status === "success" && (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1DB954" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {status === "error" && (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      )}

      <p style={{ fontSize: 14, color: status === "error" ? "#ef4444" : "rgba(255,255,255,0.7)", maxWidth: 300, textAlign: "center" }}>
        {message}
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
