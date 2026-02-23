/**
 * Auth page — Login / Register screens.
 * Shown on first run and every launch.
 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Eye, EyeOff, Loader2, UserPlus, LogIn } from "lucide-react";
import logo from "@/assets/logo.png";
import { login, register } from "@/lib/tauri";
import { useAuthStore } from "@/store/authStore";

type Mode = "login" | "register";

export default function AuthPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result =
        mode === "login"
          ? await login(username, password)
          : await register(username, email, password);

      setAuth(result);
      navigate("/security-check");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dl-bg relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-dl-accent/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-dl-accent/3 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative w-full max-w-md mx-4"
      >
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-dl-accent/10 mb-4">
            <img src={logo} alt="Darklock" className="w-12 h-12 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-dl-text">Darklock Secure Channel</h1>
          <p className="text-dl-text-dim text-sm mt-1">End-to-end encrypted messaging</p>
        </div>

        {/* Card */}
        <div className="dl-card">
          {/* Mode tabs */}
          <div className="flex gap-1 p-1 bg-dl-elevated rounded-lg mb-6">
            {(["login", "register"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${
                  mode === m
                    ? "bg-dl-accent text-white"
                    : "text-dl-text-dim hover:text-dl-text"
                }`}
              >
                {m === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}
                {m === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-dl-text-dim mb-1.5">
                Username{mode === "login" && " or Email"}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="dl-input"
                placeholder={mode === "login" ? "alice or alice@example.com" : "Choose a username"}
                required
                autoFocus
              />
            </div>

            <AnimatePresence mode="wait">
              {mode === "register" && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <label className="block text-xs font-medium text-dl-text-dim mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="dl-input"
                    placeholder="alice@example.com"
                    required={mode === "register"}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div>
              <label className="block text-xs font-medium text-dl-text-dim mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="dl-input pr-10"
                  placeholder="••••••••"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-dl-muted hover:text-dl-text transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 p-3 rounded-lg bg-dl-danger/10 border border-dl-danger/20 text-sm text-dl-danger"
              >
                <Lock size={14} />
                {error}
              </motion.div>
            )}

            <button type="submit" disabled={loading} className="dl-btn-primary w-full py-2.5">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Lock size={16} />
                  {mode === "login" ? "Sign In" : "Create Account"}
                </>
              )}
            </button>
          </form>

          {mode === "register" && (
            <p className="text-xs text-dl-muted text-center mt-4">
              Your identity key is generated locally and never sent to the server.
            </p>
          )}
        </div>

        <p className="text-xs text-dl-muted text-center mt-4">
          Darklock Secure Channel v0.1 · E2E Encrypted
        </p>
      </motion.div>
    </div>
  );
}
