import { useState, type FormEvent } from "react";
import { api } from "../api";
import { login } from "../store";
import type { User } from "../types";
import { Logo } from "./icons";

export function Auth() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ token: string; user: User }>(
        "POST",
        mode === "login" ? "/api/auth/login" : "/api/auth/register",
        mode === "login" ? { username, password } : { username, password, displayName },
      );
      await login(res.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <Logo size={44} />
          <span>RUdis</span>
        </div>
        <h1>{isLogin ? "С возвращением!" : "Создать аккаунт"}</h1>
        <p className="muted">
          {isLogin ? "Рады видеть вас снова." : "Серверы, каналы и голос — всё на русском."}
        </p>

        <label>
          <span>Логин</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>
        {!isLogin && (
          <label>
            <span>Отображаемое имя</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Как вас называть"
              maxLength={32}
            />
          </label>
        )}
        <label>
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <button className="btn primary wide" disabled={busy}>
          {busy ? "Секунду…" : isLogin ? "Войти" : "Зарегистрироваться"}
        </button>

        <p className="auth-switch">
          {isLogin ? "Нет аккаунта? " : "Уже есть аккаунт? "}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(isLogin ? "register" : "login");
              setError("");
            }}
          >
            {isLogin ? "Зарегистрироваться" : "Войти"}
          </button>
        </p>
      </form>
    </div>
  );
}
