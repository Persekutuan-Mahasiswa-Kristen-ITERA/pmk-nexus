"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { signInWithPassword } from "@/lib/auth/sign-in";
import type { SignInErrorCode } from "@/lib/auth/types";
import { AlertMessage, type AlertIcon, type AlertTone } from "@/components/ui/alert-message";
import { buttonClass, Spinner } from "@/components/ui/nx-button";
import { Card } from "@/components/ui/status-card";
import { TextField } from "@/components/ui/text-field";

// Final copy: docs/design/login.md 2.8. Keep in sync with the design, not with Supabase wording.
const ERROR_COPY: Record<SignInErrorCode, { tone: AlertTone; icon: AlertIcon; text: string }> = {
  empty_fields: { tone: "error", icon: "error", text: "Isi email dan kata sandi kamu." },
  invalid_credentials: { tone: "error", icon: "error", text: "Email atau kata sandi salah." },
  rate_limited: {
    tone: "warning",
    icon: "schedule",
    text: "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.",
  },
  network: {
    tone: "warning",
    icon: "wifi_off",
    text: "Tidak bisa terhubung. Periksa internetmu lalu coba lagi.",
  },
  server: { tone: "warning", icon: "warning", text: "Terjadi gangguan. Coba lagi sebentar lagi." },
};

const ALERT_ID = "login-alert";
const FORGOT_NOTE_ID = "forgot-note";

type Invalid = { email: boolean; password: boolean };
const NONE_INVALID: Invalid = { email: false, password: false };

export function LoginForm({ next, sessionEnded }: { next: string | null; sessionEnded: boolean }) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SignInErrorCode | null>(null);
  const [invalid, setInvalid] = useState<Invalid>(NONE_INVALID);
  const [showSessionNotice, setShowSessionNotice] = useState(sessionEnded);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return; // presses while busy are ignored

    setShowSessionNotice(false);

    // Checked here first so no request is sent for empty fields (AUTH-09).
    const emailEmpty = email.trim() === "";
    const passwordEmpty = password === "";
    if (emailEmpty || passwordEmpty) {
      setError("empty_fields");
      setInvalid({ email: emailEmpty, password: passwordEmpty });
      (emailEmpty ? emailRef : passwordRef).current?.focus();
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setInvalid(NONE_INVALID);

    let result: Awaited<ReturnType<typeof signInWithPassword>>;
    try {
      result = await signInWithPassword(email, password, next);
    } catch {
      result = { ok: false, error: "server" };
    }

    if (result.ok) {
      // Stay busy until the next page replaces this one (no flash back to "Masuk").
      router.replace(result.redirectTo);
      return;
    }

    busyRef.current = false;
    setBusy(false);
    setError(result.error);

    if (result.error === "invalid_credentials") {
      setInvalid({ email: true, password: true });
      setPassword("");
      passwordRef.current?.focus();
    } else if (result.error === "empty_fields") {
      const emailEmptyNow = email.trim() === "";
      setInvalid({ email: emailEmptyNow, password: !emailEmptyNow });
      (emailEmptyNow ? emailRef : passwordRef).current?.focus();
    }
  }

  const message = error ? ERROR_COPY[error] : null;
  const describedBy = (field: boolean) => (field && message ? ALERT_ID : undefined);

  return (
    <Card>
      <h1 className="font-heading text-display-sm text-title">Masuk ke PMK-NEXUS</h1>
      <p className="mt-1 text-body-md text-ink-body">Pakai email dan kata sandi akun PI-CORE kamu.</p>

      {message ? (
        <AlertMessage id={ALERT_ID} role="alert" tone={message.tone} icon={message.icon} className="mt-5">
          {message.text}
        </AlertMessage>
      ) : null}
      {showSessionNotice ? (
        <AlertMessage role="status" tone="info" className="mt-5">
          Sesi kamu berakhir. Masuk lagi.
        </AlertMessage>
      ) : null}

      <form noValidate onSubmit={handleSubmit} className="mt-5">
        <TextField
          ref={emailRef}
          id="email"
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="nama@student.itera.ac.id"
          leadingIcon={<Mail strokeWidth={1.75} />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={busy}
          invalid={invalid.email}
          aria-describedby={describedBy(invalid.email)}
        />

        <div className="mt-4">
          <TextField
            ref={passwordRef}
            id="password"
            name="password"
            label="Kata sandi"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            leadingIcon={<Lock strokeWidth={1.75} />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            readOnly={busy}
            invalid={invalid.password}
            aria-describedby={describedBy(invalid.password)}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label="Tampilkan kata sandi"
                className="flex size-11 items-center justify-center rounded-md text-ink-body hover:bg-ivory focus-visible:outline-offset-0"
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" className="size-5" strokeWidth={1.75} />
                ) : (
                  <Eye aria-hidden="true" className="size-5" strokeWidth={1.75} />
                )}
              </button>
            }
          />
        </div>

        <button
          type="button"
          onClick={() => setForgotOpen((v) => !v)}
          aria-expanded={forgotOpen}
          aria-controls={FORGOT_NOTE_ID}
          className={buttonClass("text", "-mx-2 mt-1 gap-1")}
        >
          Lupa kata sandi?
          {forgotOpen ? (
            <ChevronUp aria-hidden="true" className="size-[18px]" strokeWidth={2} />
          ) : (
            <ChevronDown aria-hidden="true" className="size-[18px]" strokeWidth={2} />
          )}
        </button>

        <div id={FORGOT_NOTE_ID} hidden={!forgotOpen}>
          {forgotOpen ? (
            <AlertMessage tone="info" className="mt-1">
              Kata sandi direset oleh admin PMK ITERA. Minta kata sandi sementara kepada mereka, lalu ganti di
              PI-CORE.
            </AlertMessage>
          ) : null}
        </div>

        <button type="submit" aria-busy={busy || undefined} className={buttonClass("primary", "mt-2")}>
          {busy ? (
            <>
              <Spinner />
              Memeriksa...
            </>
          ) : (
            "Masuk"
          )}
        </button>
      </form>
    </Card>
  );
}
